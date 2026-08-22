/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/db';
import { createAccount } from './accounts';
import { createRecord } from './transactions';
import {
  dismissCapture,
  forgetHandled,
  getCapture,
  markParsed,
  markSaved,
  markUnreadable,
  pendingCaptures,
  recordCaptures,
  reviewableCaptures,
} from './bank-captures';

const at = (day: number) => new Date(2026, 7, day, 12, 0);

const incoming = (key: string, day = 1, over: Record<string, unknown> = {}) => ({
  captureKey: key,
  sender: 'CIB',
  body: `Purchase of EGP ${day}00.00`,
  postedAt: at(day),
  ...over,
});

const PARSED = {
  amountMinor: 45_000,
  currency: 'EGP',
  direction: 'out' as const,
  merchant: 'CARREFOUR',
  matchedAccountId: null,
  matchedCategoryId: null,
  isWithdrawal: false,
};

describe('recording what was captured', () => {
  it('stores them and hands back how many were new', () => {
    const { db } = createTestDb();
    expect(recordCaptures(db, [incoming('a'), incoming('b', 2)])).toBe(2);
    expect(pendingCaptures(db)).toHaveLength(2);
  });

  /**
   * A messaging app re-posts a whole conversation when the next message lands,
   * so the same text arrives again AFTER the native store was drained and
   * cleared. Without the unique key it would be offered a second time.
   */
  it('ignores a message it has already seen', () => {
    const { db } = createTestDb();
    recordCaptures(db, [incoming('a')]);

    expect(recordCaptures(db, [incoming('a')])).toBe(0);
    expect(pendingCaptures(db)).toHaveLength(1);
  });

  /**
   * The native drain is DESTRUCTIVE — read and clear in one step — so one
   * repeat in a batch must not throw away the rest of it.
   */
  it('keeps the new ones when a batch contains a repeat', () => {
    const { db } = createTestDb();
    recordCaptures(db, [incoming('a')]);

    expect(recordCaptures(db, [incoming('a'), incoming('b', 2), incoming('c', 3)])).toBe(2);
    expect(pendingCaptures(db)).toHaveLength(3);
  });

  it('does nothing at all for an empty drain', () => {
    const { db } = createTestDb();
    expect(recordCaptures(db, [])).toBe(0);
  });

  it('reads the oldest first, because they are read in order', () => {
    const { db } = createTestDb();
    recordCaptures(db, [incoming('new', 9), incoming('old', 2)]);
    expect(pendingCaptures(db).map((c) => c.captureKey)).toEqual(['old', 'new']);
  });
});

describe('what the model made of a message', () => {
  const seed = () => {
    const { db } = createTestDb();
    recordCaptures(db, [incoming('a')]);
    return { db, id: pendingCaptures(db)[0].id };
  };

  it('stores the fields and stops it being pending', () => {
    const { db, id } = seed();
    markParsed(db, id, PARSED);

    const row = getCapture(db, id)!;
    expect(row.status).toBe('parsed');
    expect(row.amountMinor).toBe(45_000);
    expect(row.direction).toBe('out');
    expect(pendingCaptures(db)).toEqual([]);
  });

  /**
   * A screen that can only say "could not read this" leaves the user with
   * nothing to do. "That key was refused" names the fix.
   */
  it('keeps the reason it could not be read', () => {
    const { db, id } = seed();
    markUnreadable(db, id, 'That Gemini API key was refused.');

    const row = getCapture(db, id)!;
    expect(row.status).toBe('unreadable');
    expect(row.error).toMatch(/refused/);
  });

  it('clears a previous error when a retry succeeds', () => {
    const { db, id } = seed();
    markUnreadable(db, id, 'Could not reach Gemini.');
    markParsed(db, id, PARSED);

    // A stale error beside a good reading would be read as a warning about it.
    expect(getCapture(db, id)!.error).toBeNull();
  });
});

/**
 * The queue is what the user acts on. A message the model could not read stays
 * in it deliberately — it is still a bank alert the user may want to enter by
 * hand, and hiding it would mean the app quietly swallowed one.
 */
describe('the review queue', () => {
  const seed = () => {
    const { db } = createTestDb();
    createAccount(db, { id: 'bank', name: 'Bank', currency: 'EGP' });
    recordCaptures(db, [incoming('a', 1), incoming('b', 2), incoming('c', 3)]);
    const [first, second, third] = pendingCaptures(db);
    return { db, first, second, third };
  };

  /**
   * ALL THREE STATES, including `pending`.
   *
   * The row appears the moment the message lands rather than after the network
   * round trip that reads it — waiting several seconds for a row to exist makes
   * the app look like it missed the notification entirely.
   */
  it('holds everything captured and not yet acted on', () => {
    const { db, first, second } = seed();
    markParsed(db, first.id, PARSED);
    markUnreadable(db, second.id, 'Could not reach Gemini.');
    // The third is still pending, and is shown too — with a reading indicator.

    expect(reviewableCaptures(db).map((c) => c.captureKey).sort()).toEqual(['a', 'b', 'c']);
  });

  it('drops one the user dismissed', () => {
    const { db, first } = seed();
    markParsed(db, first.id, PARSED);
    dismissCapture(db, first.id);

    expect(reviewableCaptures(db).map((c) => c.captureKey)).not.toContain('a');
    // Kept rather than deleted, so it is never offered again.
    expect(getCapture(db, first.id)!.status).toBe('dismissed');
  });

  it('drops one a record was saved from, and links the two', () => {
    const { db, first } = seed();
    const record = createRecord(db, {
      type: 'expense',
      accountId: 'bank',
      amountMinor: 45_000,
      occurredAt: at(1),
    });
    markParsed(db, first.id, PARSED);
    markSaved(db, first.id, record.id);

    expect(reviewableCaptures(db).map((c) => c.captureKey)).not.toContain('a');
    expect(getCapture(db, first.id)!.transactionId).toBe(record.id);
  });

  it('shows the newest first', () => {
    const { db, first, second, third } = seed();
    for (const c of [first, second, third]) markParsed(db, c.id, PARSED);
    expect(reviewableCaptures(db).map((c) => c.captureKey)).toEqual(['c', 'b', 'a']);
  });
});

/**
 * These bodies are bank alerts — the most sensitive text this app holds — and
 * keeping them forever to no purpose is not what a local-first app should do.
 */
describe('forgetting what has been dealt with', () => {
  it('forgets old handled messages', () => {
    const { db } = createTestDb();
    recordCaptures(db, [incoming('old', 1)]);
    const [row] = pendingCaptures(db);
    dismissCapture(db, row.id);

    expect(forgetHandled(db, new Date(2026, 8, 20), 30)).toBe(1);
    expect(getCapture(db, row.id)).toBeUndefined();
  });

  /**
   * NEVER touches one still awaiting a decision, however old. A message that
   * sat unread for two months is exactly the one the user has not dealt with.
   */
  it('never forgets one still waiting on the user', () => {
    const { db } = createTestDb();
    recordCaptures(db, [incoming('pending', 1), incoming('parsed', 1)]);
    const [a, b] = pendingCaptures(db);
    markParsed(db, b.id, PARSED);

    expect(forgetHandled(db, new Date(2027, 0, 1), 30)).toBe(0);
    expect(getCapture(db, a.id)).toBeDefined();
    expect(getCapture(db, b.id)).toBeDefined();
  });

  it('keeps a handled message that is still recent', () => {
    const { db } = createTestDb();
    recordCaptures(db, [incoming('recent', 20)]);
    const [row] = pendingCaptures(db);
    dismissCapture(db, row.id);

    expect(forgetHandled(db, new Date(2026, 7, 25), 30)).toBe(0);
    expect(getCapture(db, row.id)).toBeDefined();
  });
});
