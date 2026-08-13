import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { drainCaptures, isCapturing, readPending } from '@/db/bank-inbox';
import { useSetting } from '@/state/settings';

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

export function useBankCatchUp(): void {
  const senders = useSetting('bankSenders');
  const homeCurrency = useSetting('homeCurrency');
  const geminiModel = useSetting('geminiModel');

  // Read through a ref inside the listener so the subscription is created once
  // rather than rebuilt whenever a setting changes. Written in an effect, never
  // during render — a ref mutated mid-render is invisible to React.
  const state = useRef({ senders, homeCurrency, geminiModel });
  useEffect(() => {
    state.current = { senders, homeCurrency, geminiModel };
  });

  useEffect(() => {
    const attempt = async () => {
      if (running) return;
      running = true;
      try {
        // Cheap and synchronous. Asked every time rather than cached, because
        // the user can switch capture off in Settings between two foregrounds.
        if (!isCapturing()) return;

        const current = state.current;
        // THE DRAIN HAPPENS EVEN WITH NO SENDERS CONFIGURED. The native store is
        // bounded, so leaving unwanted messages in it would let a chatty group
        // chat push a bank's own message out before it was ever read.
        drainCaptures(current.senders);

        await readPending(current.homeCurrency, current.geminiModel);
      } catch (error) {
        // A message left pending is read next time. Nothing is lost and nothing
        // about the app should change because this failed.
        console.warn('[bank] catch-up failed', error);
      } finally {
        running = false;
      }
    };

    void attempt();

    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void attempt();
    });
    return () => subscription.remove();
  }, []);
}
