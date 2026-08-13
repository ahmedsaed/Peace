/**
 * From a notification on the lock screen to a record waiting to be approved.
 *
 * Composition only — every decision lives elsewhere and is tested there:
 * the native module captures, `lib/bank-sms.ts` filters and validates,
 * `lib/gemini.ts` talks to the model, `repo/bank-captures.ts` stores. This file
 * owns the ORDER, which is where the losing-a-message mistakes live.
 *
 * NOTHING HERE IS LOAD-BEARING. Every failure ends with the ledger untouched
 * and, at worst, a message still sitting in the queue to be read later. A dead
 * network, a missing key or a model having a bad day must never stop a record
 * being entered by hand.
 */

import NotificationListener from '../../modules/notification-listener/src/NotificationListenerModule';
import {
  BANK_RESPONSE_SCHEMA,
  buildBankPrompt,
  captureKey,
  matchesSender,
  parseBankReading,
  parseCaptures,
} from '../lib/bank-sms';
import { GeminiError, readBankMessage } from '../lib/gemini';
import { getGeminiKey } from '../lib/secrets';
import { db } from './client';
import {
  markParsed,
  markUnreadable,
  pendingCaptures,
  recordCaptures,
} from './repo/bank-captures';

/** Whether the listener has been granted access on the system settings screen. */
export const isPermitted = () => NotificationListener.isPermitted();
export const openListenerSettings = () => NotificationListener.openSettings();
export const isCapturing = () => NotificationListener.isEnabled();
export const setCapturing = (on: boolean) => NotificationListener.setEnabled(on);

/**
 * Take everything the service captured and keep what a bank sent.
 *
 * THE SENDER FILTER IS APPLIED HERE, not natively, and the drain happens first
 * regardless. The native store must be emptied even of messages we do not want
 * — leaving them would fill a bounded store with a chatty friend's texts until
 * the bank's own message was pushed out of it.
 *
 * Returns how many NEW bank messages were kept, so a screen can say so without
 * counting the ones it threw away.
 */
export function drainCaptures(senders: string[]): number {
  let raw: string;
  try {
    raw = NotificationListener.drain();
  } catch (error) {
    // The module is missing entirely — an old build, or a JS bundle running
    // against native code that does not have it. Not a reason to fail a launch.
    console.warn('[bank] could not drain the capture store', error);
    return 0;
  }

  const wanted = parseCaptures(raw).filter((capture) => matchesSender(capture.sender, senders));
  if (wanted.length === 0) return 0;

  return recordCaptures(
    db,
    wanted.map((capture) => ({
      captureKey: captureKey(capture.sender, capture.body),
      sender: capture.sender,
      body: capture.body,
      postedAt: new Date(capture.postedAt),
    }))
  );
}

export type ReadOutcome = { read: number; failed: number };

/**
 * Read the messages that are waiting.
 *
 * ONE AT A TIME AND IN ORDER, oldest first. A bank's messages arrive in the
 * order the money moved, and reading them in that order means the queue reads
 * that way too. Sequential rather than parallel on purpose: a handful of
 * requests fired at once is how a free-tier key earns a 429, and there is no
 * hurry — nothing is waiting on this.
 *
 * A failure marks THAT message and moves on. One unreadable message must not
 * stop the rest, and the reason is stored so the screen can name it.
 */
export async function readPending(
  fallbackCurrency: string,
  model: string
): Promise<ReadOutcome> {
  const waiting = pendingCaptures(db);
  if (waiting.length === 0) return { read: 0, failed: 0 };

  const key = await getGeminiKey();
  if (key === null) {
    // Not an error and not marked as one: the messages stay pending, and the
    // moment a key is added they are read. Marking them unreadable here would
    // bury a queue of perfectly good messages behind a setting.
    return { read: 0, failed: 0 };
  }

  let read = 0;
  let failed = 0;

  for (const capture of waiting) {
    try {
      const raw = await readBankMessage(
        key,
        model,
        buildBankPrompt(capture.body),
        BANK_RESPONSE_SCHEMA
      );
      markParsed(db, capture.id, parseBankReading(raw, fallbackCurrency));
      read += 1;
    } catch (error) {
      const message =
        error instanceof GeminiError ? error.message : 'That message could not be read.';
      if (!(error instanceof GeminiError)) {
        console.warn('[bank] reading a message failed', error);
      }
      markUnreadable(db, capture.id, message);
      failed += 1;
    }
  }

  return { read, failed };
}
