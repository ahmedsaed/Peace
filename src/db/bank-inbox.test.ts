/**
 * @jest-environment node
 *
 * The ORDER of reading a bank message, which is where losing one lives.
 *
 * Every piece is tested where it is defined — the filtering and validation in
 * `lib/bank-sms.ts`, the storage in `repo/bank-captures.ts`, the transport in
 * `lib/gemini.ts`. What this guards is the sequence, and specifically the rule
 * that a BUSY MODEL MUST NOT BURN THE MESSAGE.
 */

jest.mock('../../modules/notification-listener/src/NotificationListenerModule', () => ({
  __esModule: true,
  default: {
    isPermitted: jest.fn(() => true),
    openSettings: jest.fn(),
    isEnabled: jest.fn(() => true),
    setEnabled: jest.fn(),
    pendingCount: jest.fn(() => 0),
    drain: jest.fn(() => '[]'),
  },
}));
jest.mock('../lib/secrets', () => ({ getGeminiKey: jest.fn(async () => 'a-key') }));
/**
 * The real client opens expo-sqlite, which does not exist in Node. A GETTER
 * rather than a value: the module under test imports `db` once at load, and each
 * test needs its own in-memory database behind that same binding.
 */
jest.mock('./client', () => ({
  get db() {
    return (globalThis as unknown as { __testDb: unknown }).__testDb;
  },
  sqliteDb: {},
  DATABASE_NAME: 'peace.db',
}));
jest.mock('../lib/gemini', () => {
  const actual = jest.requireActual('../lib/gemini');
  return { ...actual, readBankMessage: jest.fn() };
});

/* eslint-disable import/first */
import NotificationListener from '../../modules/notification-listener/src/NotificationListenerModule';
import { GeminiError, readBankMessage } from '../lib/gemini';
import { getGeminiKey } from '../lib/secrets';
import { createTestDb } from '../test/db';
import { drainCaptures, readPending } from './bank-inbox';
import { pendingCaptures, recordCaptures } from './repo/bank-captures';
import { bankCaptures } from './schema';
/* eslint-enable import/first */

const mocked = {
  drain: NotificationListener.drain as jest.Mock,
  isEnabled: NotificationListener.isEnabled as jest.Mock,
  readBankMessage: readBankMessage as jest.Mock,
  getGeminiKey: getGeminiKey as jest.Mock,
};

/** The module holds one `db`; point it at a fresh in-memory one per test. */
let db: ReturnType<typeof createTestDb>['db'];
beforeEach(() => {
  jest.clearAllMocks();
  db = createTestDb().db;
  (globalThis as unknown as { __testDb: unknown }).__testDb = db;
  mocked.getGeminiKey.mockResolvedValue('a-key');
  mocked.isEnabled.mockReturnValue(true);
});

const capture = (sender: string, body: string, postedAt = 1_760_000_000_000) => ({
  sender,
  body,
  packageName: 'com.google.android.apps.messaging',
  postedAt,
});

const GOOD = { amount: 450, currency: 'EGP', direction: 'out', merchant: 'CARREFOUR' };

describe('draining what the service captured', () => {
  it('keeps only the senders on the list', () => {
    mocked.drain.mockReturnValue(
      JSON.stringify([capture('CIB', 'Purchase of EGP 450'), capture('Mum', 'call me')])
    );

    expect(drainCaptures(['CIB'])).toBe(1);
    expect(pendingCaptures(db).map((c) => c.sender)).toEqual(['CIB']);
  });

  /**
   * THE STORE IS EMPTIED EITHER WAY. It is bounded, so leaving unwanted messages
   * in it would let a chatty group chat push a bank's own message out before it
   * was ever read.
   */
  it('drains even when nothing matches', () => {
    mocked.drain.mockReturnValue(JSON.stringify([capture('Mum', 'call me')]));

    expect(drainCaptures(['CIB'])).toBe(0);
    expect(mocked.drain).toHaveBeenCalledTimes(1);
  });

  it('reads nothing at all when no sender is configured', () => {
    mocked.drain.mockReturnValue(JSON.stringify([capture('CIB', 'Purchase of EGP 450')]));

    expect(drainCaptures([])).toBe(0);
    // Still drained: an empty list means "read nothing", not "keep everything".
    expect(mocked.drain).toHaveBeenCalledTimes(1);
  });

  it('survives the native module being absent', () => {
    // An old build, or a JS bundle running against native code without it.
    mocked.drain.mockImplementation(() => {
      throw new Error('no such module');
    });
    expect(drainCaptures(['CIB'])).toBe(0);
  });
});

describe('reading what is waiting', () => {
  const queue = (...bodies: string[]) => {
    recordCaptures(
      db,
      bodies.map((body, i) => ({
        captureKey: `k${i}`,
        sender: 'CIB',
        body,
        postedAt: new Date(2026, 7, i + 1),
      }))
    );
  };

  it('stores what the model made of each message', async () => {
    queue('Purchase of EGP 450 at CARREFOUR');
    mocked.readBankMessage.mockResolvedValue(GOOD);

    expect(await readPending('EGP', 'gemini-flash-latest')).toEqual({
      read: 1,
      failed: 0,
      deferred: 0,
    });

    const [row] = db.select().from(bankCaptures).all();
    expect(row.status).toBe('parsed');
    expect(row.amountMinor).toBe(45_000);
    expect(row.direction).toBe('out');
  });

  /**
   * THE BUG THIS FILE EXISTS FOR.
   *
   * `gemini-flash-latest` answers 503 "high demand" often enough that it is the
   * common path, not an edge case — measured against the live API, one attempt
   * in two. Marking the message unreadable parks it in the queue with an error
   * beside it and NOTHING to retry it, so a message that would have read
   * perfectly a minute later has to be typed in by hand forever.
   */
  it('leaves a message pending when the model is merely busy', async () => {
    queue('Purchase of EGP 450');
    mocked.readBankMessage.mockRejectedValue(
      new GeminiError('Gemini is unavailable right now.', true)
    );

    const outcome = await readPending('EGP', 'gemini-flash-latest');

    expect(outcome).toEqual({ read: 0, failed: 0, deferred: 1 });
    // Still pending, so the next launch, foreground or capture reads it.
    expect(pendingCaptures(db)).toHaveLength(1);
  });

  /** One retry turns most 503s into a reading nobody knew was at risk. */
  it('retries once, and keeps the reading when the second attempt lands', async () => {
    queue('Purchase of EGP 450');
    mocked.readBankMessage
      .mockRejectedValueOnce(new GeminiError('Gemini is unavailable right now.', true))
      .mockResolvedValueOnce(GOOD);

    expect(await readPending('EGP', 'gemini-flash-latest')).toEqual({
      read: 1,
      failed: 0,
      deferred: 0,
    });
    expect(mocked.readBankMessage).toHaveBeenCalledTimes(2);
  });

  /**
   * A wrong key is not going to become a right one. Retrying it wastes a call
   * and delays telling the user the one thing they can act on.
   */
  it('does not retry a failure a retry cannot fix', async () => {
    queue('Purchase of EGP 450');
    mocked.readBankMessage.mockRejectedValue(
      new GeminiError('That Gemini API key was refused.', false)
    );

    const outcome = await readPending('EGP', 'gemini-flash-latest');

    expect(outcome).toEqual({ read: 0, failed: 1, deferred: 0 });
    expect(mocked.readBankMessage).toHaveBeenCalledTimes(1);
    expect(pendingCaptures(db)).toHaveLength(0);

    const [row] = db.select().from(bankCaptures).all();
    expect(row.status).toBe('unreadable');
    // The reason is kept, so the screen names the fix rather than shrugging.
    expect(row.error).toMatch(/key was refused/);
  });

  /** One bad message must not stop the rest of the queue. */
  it('carries on past a message it cannot read', async () => {
    queue('first', 'second');
    mocked.readBankMessage
      .mockRejectedValueOnce(new GeminiError('That Gemini API key was refused.', false))
      .mockResolvedValueOnce(GOOD);

    expect(await readPending('EGP', 'gemini-flash-latest')).toEqual({
      read: 1,
      failed: 1,
      deferred: 0,
    });
  });

  /**
   * Messages stay pending and are read the moment a key is added. Marking them
   * unreadable here would bury a queue of perfectly good messages behind a
   * setting, and the user would have to enter every one by hand.
   */
  it('does nothing at all without a key, and marks nothing', async () => {
    queue('Purchase of EGP 450');
    mocked.getGeminiKey.mockResolvedValue(null);

    expect(await readPending('EGP', 'gemini-flash-latest')).toEqual({
      read: 0,
      failed: 0,
      deferred: 0,
    });
    expect(mocked.readBankMessage).not.toHaveBeenCalled();
    expect(pendingCaptures(db)).toHaveLength(1);
  });

  it('asks for nothing when the queue is empty', async () => {
    expect(await readPending('EGP', 'gemini-flash-latest')).toEqual({
      read: 0,
      failed: 0,
      deferred: 0,
    });
    expect(mocked.getGeminiKey).not.toHaveBeenCalled();
  });

  /**
   * REPORTED AFTER EACH MESSAGE, not once at the end.
   *
   * Every message is its own network round trip, so a queue of three finished
   * its first several seconds before its last — and reporting only at the end
   * meant the app sat on answers it already had while the screen showed
   * nothing. Counted rather than merely called: one notification at the end
   * would satisfy "was it called".
   */
  it('reports progress per message, not once at the end', async () => {
    queue('first', 'second', 'third');
    mocked.readBankMessage.mockResolvedValue(GOOD);

    const seen: number[] = [];
    await readPending('EGP', 'gemini-flash-latest', '', () => seen.push(1));

    expect(seen).toHaveLength(3);
  });

  /** A message that could not be read is news too — the row has to stop spinning. */
  it('reports a failure as progress as well', async () => {
    queue('first');
    mocked.readBankMessage.mockRejectedValue(
      new GeminiError('That Gemini API key was refused.', false)
    );

    let calls = 0;
    await readPending('EGP', 'gemini-flash-latest', '', () => {
      calls += 1;
    });

    expect(calls).toBe(1);
  });

  /**
   * A DEFERRED MESSAGE IS NOT PROGRESS. It stays pending and its row keeps
   * spinning, which is the truth — announcing it would repaint the screen to
   * say nothing changed.
   */
  it('says nothing when a message is merely deferred', async () => {
    queue('first');
    mocked.readBankMessage.mockRejectedValue(new GeminiError('Gemini is busy.', true));

    let calls = 0;
    await readPending('EGP', 'gemini-flash-latest', '', () => {
      calls += 1;
    });

    expect(calls).toBe(0);
  });

  it('reads the oldest first, because that is the order the money moved', async () => {
    queue('oldest', 'newest');
    mocked.readBankMessage.mockResolvedValue(GOOD);

    await readPending('EGP', 'gemini-flash-latest');

    const prompts = mocked.readBankMessage.mock.calls.map((call) => call[2] as string);
    expect(prompts[0]).toContain('oldest');
    expect(prompts[1]).toContain('newest');
  });
});
