/**
 * @jest-environment node
 */
import { createTestDb, type TestDb } from '../../test/db';
import { accountBalance } from './adjust';
import { createAccount } from './accounts';
import { categoryBreakdown } from './analysis';
import { listBudgets, setBudget } from './budgets';
import { createCategory } from './categories';
import { periodSummary } from './records';
import { searchRecords } from './search';
import { EMPTY_QUERY } from '../../lib/search-query';
import { createRecord, getRecord, updateRecord } from './transactions';

const on = (year: number, month: number, day: number) => new Date(year, month - 1, day, 12, 0);

function seed() {
  const { db } = createTestDb();
  createAccount(db, { id: 'bank', name: 'Bank', currency: 'EGP' });
  createCategory(db, { id: 'clothing', name: 'Clothing', kind: 'expense', sortOrder: 0 });
  createCategory(db, { id: 'food', name: 'Food', kind: 'expense', sortOrder: 1 });
  createCategory(db, { id: 'salary', name: 'Salary', kind: 'income', sortOrder: 0 });
  return db;
}

const buy = (db: TestDb, id: string, categoryId: string, minor: number, when: Date) =>
  createRecord(db, {
    id,
    accountId: 'bank',
    categoryId,
    type: 'expense',
    amountMinor: minor,
    occurredAt: when,
  });

const refund = (db: TestDb, id: string, categoryId: string, minor: number, when: Date) =>
  createRecord(db, {
    id,
    accountId: 'bank',
    categoryId,
    type: 'expense',
    isRefund: true,
    amountMinor: minor,
    occurredAt: when,
  });

describe('a refund is stored as a positive expense', () => {
  it('keeps the amount positive', () => {
    const db = seed();
    const row = refund(db, 'r', 'clothing', 80_000, on(2026, 8, 5));
    expect(row.amountMinor).toBe(80_000);
    expect(row.isRefund).toBe(true);
  });

  it('puts the money back in the account', () => {
    const db = seed();
    buy(db, 'b', 'clothing', 80_000, on(2026, 8, 3));
    expect(accountBalance(db, 'bank')).toBe(-80_000);
    refund(db, 'r', 'clothing', 80_000, on(2026, 8, 5));
    expect(accountBalance(db, 'bank')).toBe(0);
  });

  it('is only a refund on the expense side', () => {
    // A "refund of income" is just an expense. The flag is ignored rather than
    // producing a negative income row nothing knows how to read.
    const db = seed();
    const row = createRecord(db, {
      id: 'x',
      accountId: 'bank',
      categoryId: 'salary',
      type: 'income',
      isRefund: true,
      amountMinor: 50_000,
      occurredAt: on(2026, 8, 5),
    });
    expect(row.isRefund).toBe(false);
    expect(row.amountMinor).toBe(50_000);
  });
});

/**
 * THE BUG THIS FIXES. Logged as income, the month reports E£800 more income
 * than was earned AND E£800 more expense than was spent. The net comes out
 * right, which is exactly why it survives — but every category breakdown is a
 * lie and Clothing keeps a purchase that was undone.
 */
describe('what the totals see', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
    buy(db, 'b', 'clothing', 80_000, on(2026, 8, 3));
    refund(db, 'r', 'clothing', 80_000, on(2026, 8, 5));
  });

  it('nets against expense rather than inflating income', () => {
    const summary = periodSummary(db, '2026-08');
    expect(summary.expenseMinor).toBe(0);
    expect(summary.incomeMinor).toBe(0);
  });

  it('nets against the category it reverses', () => {
    // Clothing must not keep a purchase that was undone.
    const breakdown = categoryBreakdown(db, '2026-08', 'expense');
    expect(breakdown.totalMinor).toBe(0);
    expect(breakdown.slices).toEqual([]);
  });

  it('never shows up on the income side', () => {
    expect(categoryBreakdown(db, '2026-08', 'income').totalMinor).toBe(0);
  });

  it('gives back budget headroom', () => {
    setBudget(db, 'clothing', '2026-08', 200_000);
    expect(listBudgets(db, '2026-08').budgeted[0].spentMinor).toBe(0);
  });
});

describe('a partial refund', () => {
  it('leaves what it did not cover', () => {
    // Four at dinner, three settle up: the meal cost you the remainder.
    const db = seed();
    buy(db, 'b', 'food', 100_000, on(2026, 8, 3));
    refund(db, 'r', 'food', 75_000, on(2026, 8, 6));

    expect(periodSummary(db, '2026-08').expenseMinor).toBe(-25_000);
    expect(categoryBreakdown(db, '2026-08', 'expense').slices[0].amountMinor).toBe(25_000);
  });

  it('can exceed the purchase and turn the category positive', () => {
    // Rare but real: a refund landing in a month where nothing was bought.
    const db = seed();
    refund(db, 'r', 'food', 75_000, on(2026, 8, 6));
    expect(periodSummary(db, '2026-08').expenseMinor).toBe(75_000);
    expect(periodSummary(db, '2026-08').incomeMinor).toBe(0);
  });
});

describe('a refund in a later month', () => {
  it('reduces the month it lands in, not the one that was spent', () => {
    // The money came back in September; August still cost what it cost.
    const db = seed();
    buy(db, 'b', 'clothing', 80_000, on(2026, 8, 3));
    refund(db, 'r', 'clothing', 80_000, on(2026, 9, 5));

    expect(periodSummary(db, '2026-08').expenseMinor).toBe(-80_000);
    expect(periodSummary(db, '2026-09').expenseMinor).toBe(80_000);
  });
});

describe('search', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
    buy(db, 'b', 'clothing', 80_000, on(2026, 8, 3));
    refund(db, 'r', 'clothing', 80_000, on(2026, 8, 5));
  });

  it('finds a refund on the expense side, not the income side', () => {
    const asExpense = searchRecords(db, { ...EMPTY_QUERY, kind: 'expense' });
    expect(asExpense.rows.map((r) => r.id).sort()).toEqual(['b', 'r']);

    const asIncome = searchRecords(db, { ...EMPTY_QUERY, kind: 'income' });
    expect(asIncome.rows).toEqual([]);
  });

  it('nets it in the search totals too', () => {
    // The totals on every screen have to agree about what a refund is.
    expect(searchRecords(db, { ...EMPTY_QUERY, kind: 'expense' }).expenseMinor).toBe(0);
  });
});

/**
 * THE BUG THE FLOW CAUGHT. The SQL predicates were fixed to decide sides by
 * `isRefund` rather than by sign, but three callers still inferred the side
 * from `amountMinor < 0` — so editing or duplicating a refund silently turned
 * it into income, which is precisely the failure this feature removes.
 */
describe('a refund survives being edited', () => {
  it('stays an expense-side refund when something unrelated changes', () => {
    const db = seed();
    const row = refund(db, 'r', 'clothing', 80_000, on(2026, 8, 5));

    updateRecord(db, row.id, { note: 'returned the jacket' });

    const after = getRecord(db, row.id)!;
    expect(after.isRefund).toBe(true);
    // Still positive: flipping the sign would deepen the expense rather than
    // undo it.
    expect(after.amountMinor).toBe(80_000);
    expect(periodSummary(db, '2026-08').incomeMinor).toBe(0);
    expect(periodSummary(db, '2026-08').expenseMinor).toBe(80_000);
  });

  it('keeps its sign when the amount is edited', () => {
    const db = seed();
    const row = refund(db, 'r', 'clothing', 80_000, on(2026, 8, 5));
    updateRecord(db, row.id, { amountMinor: 50_000 });

    const after = getRecord(db, row.id)!;
    expect(after.amountMinor).toBe(50_000);
    expect(after.isRefund).toBe(true);
  });

  it('does not turn an ordinary expense into a refund', () => {
    const db = seed();
    const row = buy(db, 'b', 'clothing', 80_000, on(2026, 8, 3));
    updateRecord(db, row.id, { note: 'kept it' });

    const after = getRecord(db, row.id)!;
    expect(after.isRefund).toBe(false);
    expect(after.amountMinor).toBe(-80_000);
  });

  it('leaves income alone', () => {
    const db = seed();
    const row = createRecord(db, {
      id: 'i',
      accountId: 'bank',
      categoryId: 'salary',
      type: 'income',
      amountMinor: 900_000,
      occurredAt: on(2026, 8, 1),
    });
    updateRecord(db, row.id, { note: 'August' });

    const after = getRecord(db, row.id)!;
    expect(after.isRefund).toBe(false);
    expect(after.amountMinor).toBe(900_000);
    expect(periodSummary(db, '2026-08').incomeMinor).toBe(900_000);
  });
});
