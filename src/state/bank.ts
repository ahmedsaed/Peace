import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import NotificationListener from '../../modules/notification-listener/src/NotificationListenerModule';
import { drainCaptures, isCapturing, readPending } from '@/db/bank-inbox';
import { db } from '@/db/client';
import { pendingCaptures, reviewableCaptures } from '@/db/repo/bank-captures';
import type { BankCapture } from '@/db/schema';
import { useSetting } from '@/state/settings';

/**
 * The inbox, held where every screen can see it change.
 *
 * NOT queried per screen, and that is the whole point. Reading a message takes a
 * network round trip, so the catch-up finishes SECONDS after the records list
 * has already loaded and found nothing — and the row then stayed invisible
 * until something else happened to re-render, which on a device meant changing
 * month or reopening the app. A screen that asks once cannot learn about an
 * answer that arrives later.
 *
 * Same shape as the settings store: SQLite stays the source of truth and this
 * is the in-memory copy that makes a change repaint every screen rather than
 * only the one that caused it.
 */
type BankInboxStore = {
  /** Read and awaiting a decision — what the records list shows. */
  captures: BankCapture[];
  /** Captured but not yet read, for the Settings card to report. */
  waiting: number;
  reload: () => void;
};

export const useBankInbox = create<BankInboxStore>((set) => ({
  captures: [],
  waiting: 0,
  reload: () =>
    set({
      captures: reviewableCaptures(db),
      // Capped read: this only ever feeds a count, and a backlog of thousands
      // would be a number nobody acts on differently from a backlog of fifty.
      waiting: pendingCaptures(db, 500).length,
    }),
}));

/**
 * Collecting bank messages, such as Android permits.
 *
 * THE MECHANISM IS THE APP BEING OPENED, exactly as it is for the Drive backup.
 * The listener service writes captures to a small native store whenever they
 * arrive — including while the app is closed, which is most of the time — and
 * this drains that store on launch and on every return to the foreground.
 *
 * Reading them costs a network request each, so it happens here rather than in
 * the service: a bank alert at 2am must not wake the phone to talk to Google,
 * and there is nothing waiting on the answer until somebody opens the app.
 *
 * Nothing here is load-bearing. Every failure leaves the messages in the queue
 * to be read next time, and the ledger untouched.
 */
export function BankCatchUp(): null {
  useBankCatchUp();
  return null;
}

/** Module-level so a foreground event during a read cannot start a second one. */
let running = false;

/**
 * Drain whatever was captured and read it.
 *
 * Exported because more than one thing legitimately wants to run it: the hook
 * below on launch, foreground and capture — and the Settings screen the moment
 * an API key is saved. Messages captured before there was a key sit `pending`
 * for want of one, and leaving them there until the next foreground is the same
 * "nothing appears to happen" the capture event exists to prevent.
 */
export async function runBankCatchUp(input: {
  senders: string[];
  homeCurrency: string;
  geminiModel: string;
  guidance?: string;
}): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Asked every time rather than cached: the user can switch capture off in
    // Settings between one call and the next.
    if (!isCapturing()) return;

    // THE DRAIN HAPPENS EVEN WITH NO SENDERS CONFIGURED. The native store is
    // bounded, so leaving unwanted messages in it would let a chatty group chat
    // push a bank's own message out before it was ever read.
    const drained = drainCaptures(input.senders);
    // Straight away, so a captured message shows as waiting even while the
    // reading of it is still in flight.
    if (drained > 0) useBankInbox.getState().reload();

    /**
     * Repainted after EACH message, not once at the end.
     *
     * A queue of five is five network round trips, and reloading only after the
     * last one meant the first four sat finished and invisible for as long as
     * the slowest took — the app holding answers it already had. The store is
     * cheap to reload and the screens are already subscribed.
     */
    const outcome = await readPending(
      input.homeCurrency,
      input.geminiModel,
      input.guidance ?? '',
      () => useBankInbox.getState().reload()
    );

    /**
     * THE REASON THE STORE EXISTS.
     *
     * Reading is a network round trip, so it lands well after every screen has
     * drawn. Without this the row appeared only when something else happened to
     * re-render — which on a device meant switching month or reopening the app,
     * and looked exactly like the feature not working.
     */
    if (outcome.read > 0 || outcome.failed > 0 || outcome.deferred > 0) {
      useBankInbox.getState().reload();
    }
  } catch (error) {
    // A message left pending is read next time. Nothing is lost and nothing
    // about the app should change because this failed.
    console.warn('[bank] catch-up failed', error);
  } finally {
    running = false;
  }
}

export function useBankCatchUp(): void {
  const senders = useSetting('bankSenders');
  const homeCurrency = useSetting('homeCurrency');
  const geminiModel = useSetting('geminiModel');
  const guidance = useSetting('bankGuidance');

  // Read through a ref inside the listener so the subscription is created once
  // rather than rebuilt whenever a setting changes. Written in an effect, never
  // during render — a ref mutated mid-render is invisible to React.
  const state = useRef({ senders, homeCurrency, geminiModel, guidance });
  useEffect(() => {
    state.current = { senders, homeCurrency, geminiModel, guidance };
  });

  useEffect(() => {
    const attempt = () => runBankCatchUp(state.current);

    void attempt();

    const foreground = AppState.addEventListener('change', (next) => {
      if (next === 'active') void attempt();
    });

    /**
     * A message arriving WHILE THE APP IS OPEN.
     *
     * The two triggers above only fire on launch and on returning to the
     * foreground, so a notification landing while someone is looking at the
     * records list produced nothing at all until they navigated — which reads
     * exactly like the feature being broken. The native side signals the moment
     * it captures something.
     *
     * Wrapped, because a build whose native module predates this event has no
     * `addListener` for it and must not take the app down over a nicety.
     */
    let capture: { remove: () => void } | null = null;
    try {
      capture = NotificationListener.addListener('onCapture', () => void attempt());
    } catch (error) {
      console.warn('[bank] could not listen for captures', error);
    }

    return () => {
      foreground.remove();
      capture?.remove();
    };
  }, []);
}
