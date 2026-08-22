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
  matchAccount,
  matchesSender,
  parseBankReading,
  parseCaptures,
} from '../lib/bank-sms';
import { matchCategory } from '../lib/receipt';
import { listAccountsWithBalance } from './repo/accounts';
import { listCategoriesFlat } from './repo/categories';
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

export type ReadOutcome = {
  read: number;
  /** Marked unreadable — something a retry cannot fix. */
  failed: number;
  /** Left pending because the failure was transient. Retried next time. */
  deferred: number;
};

/**
 * How long to wait before the second attempt.
 *
 * `gemini-flash-latest` answers 503 "high demand" often enough that one
 * immediate retry turns most of those into a reading the user never knew was
 * at risk. Short, because somebody may be watching the screen; once, because a
 * model that is busy twice in two seconds is busy, and the next app open is a
 * better time to ask again than a tight loop is.
 */
const RETRY_PAUSE_MS = 1_500;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  model: string,
  guidance = '',
  /**
   * Called after EACH message is settled, not once at the end.
   *
   * A queue of five took one network round trip each and then appeared all at
   * once, several seconds after the first was already known — the app sitting
   * on an answer it had. Reporting per message is what makes a backlog drain
   * visibly rather than arrive as a block.
   */
  onProgress?: () => void
): Promise<ReadOutcome> {
  const waiting = pendingCaptures(db);
  if (waiting.length === 0) return { read: 0, failed: 0, deferred: 0 };

  const key = await getGeminiKey();
  if (key === null) {
    // Not an error and not marked as one: the messages stay pending, and the
    // moment a key is added they are read. Marking them unreadable here would
    // bury a queue of perfectly good messages behind a setting.
    return { read: 0, failed: 0, deferred: 0 };
  }

  /**
   * The user's own account names, offered to the model.
   *
   * A bank writes "card ending 0042", which means nothing on its own — the
   * mapping from that to an account lives in the user's guidance, and this is
   * what gives it something real to name.
   */
  const accounts = listAccountsWithBalance(db);
  const accountNames = accounts.map((a) => a.name);
  /**
   * And the user's own categories, exactly as the receipt reader has always
   * offered them. Asking for nothing is why every bank record arrived
   * Uncategorised — which read as the model declining to guess and was the app
   * never putting the question.
   */
  const categories = listCategoriesFlat(db);
  const categoryNames = categories.map((c) => c.name);

  let read = 0;
  let failed = 0;
  let deferred = 0;

  for (const capture of waiting) {
    const outcome = await readOne(
      key,
      model,
      capture.body,
      fallbackCurrency,
      accountNames,
      guidance,
      categoryNames
    );

    if (outcome.kind === 'read') {
      const { account: _named, category: _guessed, withdrawal, ...fields } = outcome.fields;
      markParsed(db, capture.id, {
        ...fields,
        isWithdrawal: withdrawal,
        // Resolved here rather than at approval, so the row shows the right card
        // and the record inherits its currency and its fees.
        matchedAccountId: matchAccount(outcome.fields.account, accounts)?.id ?? null,
        /**
         * Matched WITHIN THE RIGHT SIDE of the ledger. Both kinds are offered
         * to the model because a bank sends salary alerts as well as purchases,
         * but "Refunds" as an income category must never come back attached to
         * a debit — the picker would then be showing a category the record's
         * own type does not contain.
         */
        matchedCategoryId:
          matchCategory(
            outcome.fields.category,
            categories.filter(
              (c) => c.kind === (outcome.fields.direction === 'in' ? 'income' : 'expense')
            )
          )?.id ?? null,
      });
      read += 1;
      onProgress?.();
      continue;
    }

    /**
     * A BUSY MODEL MUST NOT BURN THE MESSAGE.
     *
     * Marking it unreadable on a 503 parks it in the queue with an error beside
     * it and nothing to retry it — so a message that would have read perfectly
     * a minute later needs entering by hand forever. Left pending, it is simply
     * read at the next launch, foreground or capture.
     */
    if (outcome.transient) {
      deferred += 1;
      continue;
    }

    markUnreadable(db, capture.id, outcome.message);
    failed += 1;
    onProgress?.();
  }

  return { read, failed, deferred };
}

type ReadOne =
  | { kind: 'read'; fields: ReturnType<typeof parseBankReading> }
  | { kind: 'failed'; transient: boolean; message: string };

/**
 * One message, with a single retry when the first failure is worth retrying.
 *
 * The retry is here rather than in `gemini.ts` because only the caller knows
 * whether a second attempt is wanted: the receipt reader has a person watching
 * a spinner who can tap again, and this one has nobody watching at all.
 */
async function readOne(
  key: string,
  model: string,
  body: string,
  fallbackCurrency: string,
  accountNames: string[],
  guidance: string,
  categoryNames: string[]
): Promise<ReadOne> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await readBankMessage(
        key,
        model,
        buildBankPrompt(body, accountNames, guidance, categoryNames),
        BANK_RESPONSE_SCHEMA
      );
      return { kind: 'read', fields: parseBankReading(raw, fallbackCurrency) };
    } catch (error) {
      const transient = error instanceof GeminiError && error.transient;
      const message =
        error instanceof GeminiError ? error.message : 'That message could not be read.';

      if (!(error instanceof GeminiError)) {
        console.warn('[bank] reading a message failed', error);
      }

      // Nothing a second attempt would change — a wrong key, a blocked prompt,
      // a reply that was not a reading.
      if (!transient) return { kind: 'failed', transient: false, message };

      // Second time unlucky: leave it for the next catch-up rather than sitting
      // here retrying while somebody waits.
      if (attempt === 1) return { kind: 'failed', transient: true, message };

      await pause(RETRY_PAUSE_MS);
    }
  }

  // Unreachable: the loop either returns or exhausts both attempts above.
  return { kind: 'failed', transient: true, message: 'Could not reach Gemini.' };
}
