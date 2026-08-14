/**
 * Captured bank messages.
 *
 * Pure database, tested against real SQLite in Node. The native capture lives in
 * `modules/notification-listener`, the reading in `lib/bank-sms.ts`, and the
 * orchestration in `db/bank-inbox.ts` — this file only stores and retrieves.
 */

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { newId } from '../../lib/id';
import * as schema from '../schema';
import { bankCaptures } from '../schema';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export type IncomingCapture = {
  captureKey: string;
  sender: string;
  body: string;
  postedAt: Date;
};

/**
 * Record messages that have just been drained off the native store.
 *
 * ONE STATEMENT, and it ignores anything already known. The native drain is
 * destructive — the store is read and cleared together — so this runs at the
 * one moment where losing a row loses the message for good. Doing it as an
 * insert that silently skips duplicates means a message re-posted by the
 * messaging app costs nothing, and a partly-failed batch cannot lose the rest.
 *
 * Returns how many were genuinely new, so the caller can say so without
 * counting the ones it skipped.
 */
export function recordCaptures(db: Db, incoming: IncomingCapture[]): number {
  if (incoming.length === 0) return 0;

  const before = countCaptures(db);

  db.insert(bankCaptures)
    .values(
      incoming.map((capture) => ({
        id: newId(),
        captureKey: capture.captureKey,
        sender: capture.sender,
        body: capture.body,
        postedAt: capture.postedAt,
      }))
    )
    // The unique index on `capture_key` is what makes this safe; without the
    // conflict clause the whole batch would throw on one repeat.
    .onConflictDoNothing({ target: bankCaptures.captureKey })
    .run();

  return countCaptures(db) - before;
}

function countCaptures(db: Db): number {
  return db.select({ n: sql<number>`count(*)` }).from(bankCaptures).get()?.n ?? 0;
}

/** Messages waiting to be read, oldest first — they are read in order. */
export function pendingCaptures(db: Db, limit = 25): schema.BankCapture[] {
  return db
    .select()
    .from(bankCaptures)
    .where(eq(bankCaptures.status, 'pending'))
    .orderBy(bankCaptures.postedAt)
    .limit(limit)
    .all();
}

export type ParsedFields = {
  amountMinor: number | null;
  currency: string | null;
  direction: 'out' | 'in' | null;
  merchant: string | null;
  /** Resolved to a real account when the model named one this ledger has. */
  matchedAccountId: string | null;
};

/** What the model made of a message. */
export function markParsed(db: Db, id: string, fields: ParsedFields): void {
  db.update(bankCaptures)
    .set({ ...fields, status: 'parsed', error: null })
    .where(eq(bankCaptures.id, id))
    .run();
}

/**
 * It could not be read, and why.
 *
 * The reason is stored rather than discarded: a screen that can only say
 * "could not read this" leaves the user with nothing to do, where "that key was
 * refused" names the fix. Same rule as everywhere else network failures reach a
 * person.
 */
export function markUnreadable(db: Db, id: string, error: string): void {
  db.update(bankCaptures)
    .set({ status: 'unreadable', error })
    .where(eq(bankCaptures.id, id))
    .run();
}

/** The user said no. Kept rather than deleted, so it is not offered again. */
export function dismissCapture(db: Db, id: string): void {
  db.update(bankCaptures).set({ status: 'dismissed' }).where(eq(bankCaptures.id, id)).run();
}

/**
 * A record was saved from this message.
 *
 * Told AFTER the write, never before — the same rule a recurring rule follows.
 * Marking it first and then failing to save loses the message; not marking it
 * offers the same transaction again tomorrow.
 */
export function markSaved(db: Db, id: string, transactionId: string): void {
  db.update(bankCaptures)
    .set({ status: 'saved', transactionId })
    .where(eq(bankCaptures.id, id))
    .run();
}

/**
 * Everything the user can see: captured, and not yet acted on.
 *
 * ALL THREE STATES, and each for its own reason.
 *
 * `pending` appears the moment the message lands, before anything has been read
 * — waiting several seconds for a network round trip before the row exists
 * makes the app look like it missed the notification, which is the impression
 * this feature can least afford.
 *
 * `unreadable` stays because a message the model could not make sense of is
 * still a bank alert the user may want to enter by hand; hiding it would mean
 * the app quietly swallowed one.
 */
export function reviewableCaptures(db: Db, limit = 100): schema.BankCapture[] {
  return db
    .select()
    .from(bankCaptures)
    .where(
      and(
        inArray(bankCaptures.status, ['pending', 'parsed', 'unreadable']),
        isNull(bankCaptures.transactionId)
      )
    )
    .orderBy(desc(bankCaptures.postedAt))
    .limit(limit)
    .all();
}

export function getCapture(db: Db, id: string): schema.BankCapture | undefined {
  return db.select().from(bankCaptures).where(eq(bankCaptures.id, id)).get();
}

/**
 * Forget messages that have been dealt with and are old enough not to matter.
 *
 * The bodies are bank alerts — the most sensitive text this app ever holds —
 * and keeping them forever to no purpose is the kind of thing a local-first app
 * should not do. Anything saved or dismissed more than `days` ago goes; nothing
 * still awaiting a decision is ever touched, however old.
 */
export function forgetHandled(db: Db, now: Date, days = 30): number {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const doomed = db
    .select({ id: bankCaptures.id })
    .from(bankCaptures)
    .where(and(inArray(bankCaptures.status, ['saved', 'dismissed']), sql`${bankCaptures.postedAt} < ${cutoff.getTime()}`))
    .all();

  if (doomed.length === 0) return 0;
  db.delete(bankCaptures)
    .where(inArray(bankCaptures.id, doomed.map((row) => row.id)))
    .run();
  return doomed.length;
}
