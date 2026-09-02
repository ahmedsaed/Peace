/**
 * @jest-environment node
 */
import { createTestDb, type TestDb } from '../../test/db';
import { accountBalance } from './adjust';
import { createAccount } from './accounts';
import { createCategory } from './categories';
import { periodSummary } from './records';
import { linkById, reversedBy, reverses, LINK_LIMIT } from './reversal';
import {
  createRecord,
  createTransfer,
  deleteRecord,
  restoreRecords,
  updateTransfer,
} from './transactions';

const on = (year: number, month: number, day: number) => new Date(year, month - 1, day, 12, 0);

function seed() {
  const { db } = createTestDb();
  createAccount(db, { id: 'bank', name: 'Bank', currency: 'EGP' });
  createAccount(db, { id: 'cash', name: 'Cash', currency: 'EGP' });
  createCategory(db, { id: 'clothing', name: 'Clothing', kind: 'expense' });
  return db;
}

const move = (db: TestDb, from: string, to: string, minor: number, day: number, over = {}) =>
  createTransfer(db, {
    fromAccountId: from,
    toAccountId: to,
    amountMinor: minor,
    occurredAt: on(2026, 8, day),
    ...over,
  });

describe('reversing a transfer', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
  });

  it('leaves both accounts where they started', () => {
    // The whole point. Nothing about the totals needs a new rule for this —
    // a reversal is a transfer, and transfers are already outside every income
    // and expense figure there is.
    const { out } = move(db, 'bank', 'cash', 50_000, 3);
    expect(accountBalance(db, 'bank')).toBe(-50_000);

    move(db, 'cash', 'bank', 50_000, 5, { reversesId: out.id });
    expect(accountBalance(db, 'bank')).toBe(0);
    expect(accountBalance(db, 'cash')).toBe(0);
  });

  it('stays out of income and expense', () => {
    const { out } = move(db, 'bank', 'cash', 50_000, 3);
    move(db, 'cash', 'bank', 50_000, 5, { reversesId: out.id });

    const summary = periodSummary(db, '2026-08');
    expect(summary.expenseMinor).toBe(0);
    expect(summary.incomeMinor).toBe(0);
  });

  it('marks only the OUTGOING leg', () => {
    // Both legs exist, but every list renders the negative one and every id a
    // screen holds is that leg's. On both legs, "what reverses this transfer?"
    // would answer with the same transfer twice.
    const { out } = move(db, 'bank', 'cash', 50_000, 3);
    const reversal = move(db, 'cash', 'bank', 50_000, 5, { reversesId: out.id });

    expect(reversal.out.reversesId).toBe(out.id);
    expect(reversal.in.reversesId).toBeNull();
    expect(reversedBy(db, out.id).count).toBe(1);
  });

  it('points back at what it undoes', () => {
    const { out } = move(db, 'bank', 'cash', 50_000, 3);
    const reversal = move(db, 'cash', 'bank', 50_000, 5, { reversesId: out.id });

    const link = reverses(db, reversal.out.id);
    expect(link).not.toBeNull();
    expect(link!.id).toBe(out.id);
    expect(link!.kind).toBe('reversal');
    // Named the way the list names it, so the sheet does not describe the
    // record in a dialect of its own.
    expect(link!.label).toBe('Bank → Cash');
  });

  it('reports nothing for a row that undoes nothing', () => {
    const { out } = move(db, 'bank', 'cash', 50_000, 3);
    expect(reverses(db, out.id)).toBeNull();
    expect(reversedBy(db, out.id)).toEqual({ links: [], count: 0, totalMinor: 0 });
  });
});

describe('a refund points at the purchase it hands back', () => {
  let db: TestDb;
  let purchaseId: string;
  beforeEach(() => {
    db = seed();
    purchaseId = createRecord(db, {
      id: 'shoes',
      accountId: 'bank',
      categoryId: 'clothing',
      type: 'expense',
      amountMinor: 80_000,
      occurredAt: on(2026, 8, 3),
    }).id;
  });

  const refund = (id: string, minor: number, day: number) =>
    createRecord(db, {
      id,
      accountId: 'bank',
      categoryId: 'clothing',
      type: 'expense',
      isRefund: true,
      amountMinor: minor,
      occurredAt: on(2026, 8, day),
      reversesId: purchaseId,
    });

  it('resolves in both directions', () => {
    refund('back', 80_000, 5);

    expect(reverses(db, 'back')!.id).toBe(purchaseId);
    expect(reverses(db, 'back')!.kind).toBe('refund');
    // The category, which is what a refund is filed against and the only useful
    // way to name the purchase in one line.
    expect(reverses(db, 'back')!.label).toBe('Clothing');

    const back = reversedBy(db, purchaseId);
    expect(back.count).toBe(1);
    expect(back.links[0].id).toBe('back');
  });

  it('adds up EVERY refund, not just the ones it lists', () => {
    // The sheet caps its list; the total must not be capped with it, or
    // "E£120 of E£800 came back" silently means "the first four of them".
    for (let i = 0; i < LINK_LIMIT + 2; i++) refund(`r${i}`, 10_000, 5 + i);

    const back = reversedBy(db, purchaseId);
    expect(back.links).toHaveLength(LINK_LIMIT);
    expect(back.count).toBe(LINK_LIMIT + 2);
    expect(back.totalMinor).toBe((LINK_LIMIT + 2) * 10_000);
  });

  it('lists the newest first', () => {
    refund('early', 10_000, 5);
    refund('late', 20_000, 9);
    expect(reversedBy(db, purchaseId).links.map((l) => l.id)).toEqual(['late', 'early']);
  });

  it('reports a PARTIAL refund as what actually came back', () => {
    refund('part', 5_000, 5);
    const back = reversedBy(db, purchaseId);
    // Not 80_000. "Refunded" on an E£800 purchase says nothing about whether
    // E£50 or all of it returned, and the difference is the whole question.
    expect(back.totalMinor).toBe(5_000);
  });
});

/**
 * WHY `reverses_id` IS NOT A FOREIGN KEY.
 *
 * `on delete set null` is the obvious declaration and it is wrong here: delete
 * is UNDOABLE, so nulling the pointer means tapping Undo restores the purchase
 * with the link gone for ever — silent loss, on the one path that exists to
 * prevent loss.
 */
describe('deleting what a row reverses', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
  });

  it('leaves the refund alone, and the pointer with it', () => {
    const purchase = createRecord(db, {
      id: 'shoes',
      accountId: 'bank',
      categoryId: 'clothing',
      type: 'expense',
      amountMinor: 80_000,
      occurredAt: on(2026, 8, 3),
    });
    createRecord(db, {
      id: 'back',
      accountId: 'bank',
      categoryId: 'clothing',
      type: 'expense',
      isRefund: true,
      amountMinor: 80_000,
      occurredAt: on(2026, 8, 5),
      reversesId: purchase.id,
    });

    const removed = deleteRecord(db, purchase.id);

    // The refund survives — it is a record of money that really did arrive.
    expect(linkById(db, 'back')).not.toBeNull();
    // ...and the link resolves to nothing while the purchase is away, which is
    // what the sheet reports rather than pretending there was never a link.
    expect(reverses(db, 'back')).toBeNull();

    // The round trip that a foreign key would have broken.
    restoreRecords(db, removed);
    expect(reverses(db, 'back')!.id).toBe(purchase.id);
  });

  it('keeps a reversal pointing at a transfer that comes back', () => {
    const { out } = move(db, 'bank', 'cash', 50_000, 3);
    const reversal = move(db, 'cash', 'bank', 50_000, 5, { reversesId: out.id });

    // Deleting one leg of a transfer takes both.
    const removed = deleteRecord(db, out.id);
    expect(removed).toHaveLength(2);
    expect(reverses(db, reversal.out.id)).toBeNull();

    restoreRecords(db, removed);
    expect(reverses(db, reversal.out.id)!.id).toBe(out.id);
  });
});

/**
 * The claim has to survive the EDIT path too.
 *
 * Creating the reversal is the obvious half and the pickers stay live
 * afterwards. A stale claim is not harmless: it marks the original as undone
 * and takes its Reverse action away, while the money now moves between two
 * accounts that have nothing to do with it.
 */
describe('editing a reversal', () => {
  let db: TestDb;
  let originalId: string;
  let reversalId: string;
  beforeEach(() => {
    db = seed();
    createAccount(db, { id: 'jar', name: 'Dollar jar', currency: 'EGP' });
    originalId = move(db, 'bank', 'cash', 50_000, 3).out.id;
    reversalId = move(db, 'cash', 'bank', 50_000, 5, { reversesId: originalId }).out.id;
  });

  it('keeps the claim when only the amount changes', () => {
    // Sending part of it back is a real reversal of part, and the sheet says
    // how much actually went rather than assuming all of it did.
    updateTransfer(db, reversalId, { amountMinor: 20_000 });

    expect(reverses(db, reversalId)!.id).toBe(originalId);
    expect(reversedBy(db, originalId).totalMinor).toBe(-20_000);
  });

  it('keeps the claim when only the note or date changes', () => {
    updateTransfer(db, reversalId, { note: 'sent it back', occurredAt: on(2026, 8, 7) });
    expect(reverses(db, reversalId)!.id).toBe(originalId);
  });

  it('drops the claim when either end is redirected', () => {
    updateTransfer(db, reversalId, { toAccountId: 'jar' });

    expect(reverses(db, reversalId)).toBeNull();
    // ...and the original is offerable again, rather than sitting marked as
    // undone by money that went somewhere else.
    expect(reversedBy(db, originalId).count).toBe(0);
  });

  it('drops the claim when the source end is redirected', () => {
    updateTransfer(db, reversalId, { fromAccountId: 'jar' });
    expect(reverses(db, reversalId)).toBeNull();
  });

  it('leaves an ordinary transfer alone', () => {
    // Nothing to clear, and editing one must not touch a column it never set.
    updateTransfer(db, originalId, { toAccountId: 'jar' });
    expect(reverses(db, originalId)).toBeNull();
    expect(reverses(db, reversalId)!.id).toBe(originalId);
  });
});
