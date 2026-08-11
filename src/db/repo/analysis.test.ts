/**
 * @jest-environment node
 */
import { createTestDb, type TestDb } from '../../test/db';
import { createAccount } from './accounts';
import { cashFlow, cashFlowPeak, categoryBreakdown } from './analysis';
import { createCategory } from './categories';
import { createRecord, createTransfer } from './transactions';

const on = (year: number, month: number, day: number) => new Date(year, month - 1, day, 12, 0);

function seed() {
  const { db } = createTestDb();

  createAccount(db, { id: 'bank', name: 'Bank', currency: 'EGP' });
  createAccount(db, { id: 'usd', name: 'Dollar jar', currency: 'USD' });

  createCategory(db, { id: 'food', name: 'Food', kind: 'expense', sortOrder: 0 });
  createCategory(db, { id: 'coffee', name: 'Coffee', kind: 'expense', parentId: 'food' });
  createCategory(db, { id: 'transport', name: 'Transport', kind: 'expense', sortOrder: 1 });
  createCategory(db, { id: 'salary', name: 'Salary', kind: 'income', sortOrder: 0 });
  createCategory(db, { id: 'bonus', name: 'Bonus', kind: 'income', sortOrder: 1 });

  return db;
}

const spend = (db: TestDb, id: string, categoryId: string | null, minor: number, when: Date) =>
  createRecord(db, {
    id,
    accountId: 'bank',
    categoryId,
    type: 'expense',
    amountMinor: minor,
    occurredAt: when,
  });

const earn = (db: TestDb, id: string, categoryId: string | null, minor: number, when: Date) =>
  createRecord(db, {
    id,
    accountId: 'bank',
    categoryId,
    type: 'income',
    amountMinor: minor,
    occurredAt: when,
  });

describe('categoryBreakdown', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
  });

  it('splits a month by top-level category', () => {
    spend(db, 'a', 'food', 30_000, on(2026, 8, 3));
    spend(db, 'b', 'transport', 10_000, on(2026, 8, 4));

    const out = categoryBreakdown(db, '2026-08', 'expense');
    expect(out.slices.map((s) => [s.label, s.amountMinor])).toEqual([
      ['Food', 30_000],
      ['Transport', 10_000],
    ]);
    expect(out.totalMinor).toBe(40_000);
  });

  /**
   * The same roll-up Budgets uses. Two screens showing one month under
   * different groupings is how a person stops trusting both.
   */
  it('rolls a sub-category up to its parent', () => {
    spend(db, 'a', 'coffee', 9_500, on(2026, 8, 3));
    const out = categoryBreakdown(db, '2026-08', 'expense');
    expect(out.slices).toHaveLength(1);
    expect(out.slices[0].label).toBe('Food');
    expect(out.slices[0].amountMinor).toBe(9_500);
  });

  it('reports amounts unsigned, so a wedge cannot be negative', () => {
    spend(db, 'a', 'food', 30_000, on(2026, 8, 3));
    expect(categoryBreakdown(db, '2026-08', 'expense').slices[0].amountMinor).toBeGreaterThan(0);
  });

  it('omits categories with nothing in them', () => {
    // Nineteen zero-width wedges are not a chart.
    spend(db, 'a', 'food', 30_000, on(2026, 8, 3));
    expect(categoryBreakdown(db, '2026-08', 'expense').slices).toHaveLength(1);
  });

  it('separates income from expense', () => {
    spend(db, 'a', 'food', 30_000, on(2026, 8, 3));
    earn(db, 'b', 'salary', 900_000, on(2026, 8, 1));

    expect(categoryBreakdown(db, '2026-08', 'expense').totalMinor).toBe(30_000);
    const income = categoryBreakdown(db, '2026-08', 'income');
    expect(income.totalMinor).toBe(900_000);
    expect(income.slices[0].label).toBe('Salary');
  });

  /**
   * Moving money between your own accounts is neither. Counting it would make a
   * transfer to savings the biggest wedge of the month.
   */
  it('ignores transfers on both sides', () => {
    createAccount(db, { id: 'cash', name: 'Cash', currency: 'EGP' });
    createTransfer(db, {
      fromAccountId: 'bank',
      toAccountId: 'cash',
      amountMinor: 500_000,
      occurredAt: on(2026, 8, 6),
    });

    expect(categoryBreakdown(db, '2026-08', 'expense').totalMinor).toBe(0);
    expect(categoryBreakdown(db, '2026-08', 'expense').uncategorisedMinor).toBe(0);
    expect(categoryBreakdown(db, '2026-08', 'income').totalMinor).toBe(0);
  });

  it('reports uncategorised money rather than dropping it', () => {
    spend(db, 'a', null, 12_000, on(2026, 8, 5));
    const out = categoryBreakdown(db, '2026-08', 'expense');
    expect(out.uncategorisedMinor).toBe(12_000);
    expect(out.totalMinor).toBe(0);
  });

  it('stays inside its month', () => {
    spend(db, 'a', 'food', 30_000, on(2026, 7, 31));
    spend(db, 'b', 'food', 10_000, on(2026, 9, 1));
    expect(categoryBreakdown(db, '2026-08', 'expense').totalMinor).toBe(0);
  });

  it('values a foreign record at its converted amount', () => {
    createRecord(db, {
      id: 'x',
      accountId: 'usd',
      categoryId: 'food',
      type: 'expense',
      amountMinor: 2_500, // $25
      currency: 'USD',
      fxRate: 50,
      homeCurrency: 'EGP',
      occurredAt: on(2026, 8, 7),
    });
    // E£1,250, not the raw 2,500.
    expect(categoryBreakdown(db, '2026-08', 'expense').totalMinor).toBe(125_000);
  });

  it('excludes and counts what it cannot value', () => {
    createRecord(db, {
      id: 'x',
      accountId: 'usd',
      categoryId: 'food',
      type: 'expense',
      amountMinor: 2_500,
      currency: 'USD',
      fxRate: 50,
      homeCurrency: 'EGP',
      occurredAt: on(2026, 8, 7),
    });
    const out = categoryBreakdown(db, '2026-08', 'expense', 'USD');
    expect(out.unvaluedCount).toBe(1);
    expect(out.totalMinor).toBe(0);
  });

  it('carries the colour and icon the chart draws with', () => {
    spend(db, 'a', 'food', 30_000, on(2026, 8, 3));
    const slice = categoryBreakdown(db, '2026-08', 'expense').slices[0];
    expect(slice.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(slice.id).toBe('food');
  });

  it('has nothing to show for an empty month', () => {
    const out = categoryBreakdown(db, '2026-08', 'expense');
    expect(out.slices).toEqual([]);
    expect(out.totalMinor).toBe(0);
  });
});

describe('cashFlow', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
  });

  it('returns one point per month, oldest first, ending on the month asked for', () => {
    const points = cashFlow(db, '2026-08', { months: 3 });
    expect(points.map((p) => p.period)).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('crosses a year boundary', () => {
    expect(cashFlow(db, '2026-01', { months: 3 }).map((p) => p.period)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
  });

  it('reports income and expense as magnitudes, and the net signed', () => {
    earn(db, 'i', 'salary', 900_000, on(2026, 8, 1));
    spend(db, 'e', 'food', 250_000, on(2026, 8, 3));

    const august = cashFlow(db, '2026-08', { months: 1 })[0];
    expect(august.incomeMinor).toBe(900_000);
    // A bar length is a magnitude even though the ledger stores it negative.
    expect(august.expenseMinor).toBe(250_000);
    expect(august.netMinor).toBe(650_000);
  });

  it('goes negative on a month that cost more than it brought in', () => {
    spend(db, 'e', 'food', 250_000, on(2026, 8, 3));
    expect(cashFlow(db, '2026-08', { months: 1 })[0].netMinor).toBe(-250_000);
  });

  it('reports an empty month as zero rather than omitting it', () => {
    // A gap in the series would make the chart lie about the shape of the year.
    earn(db, 'i', 'salary', 900_000, on(2026, 8, 1));
    const points = cashFlow(db, '2026-08', { months: 3 });
    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({ period: '2026-06', incomeMinor: 0, expenseMinor: 0 });
  });

  it('excludes transfers', () => {
    createAccount(db, { id: 'cash', name: 'Cash', currency: 'EGP' });
    createTransfer(db, {
      fromAccountId: 'bank',
      toAccountId: 'cash',
      amountMinor: 500_000,
      occurredAt: on(2026, 8, 6),
    });
    const august = cashFlow(db, '2026-08', { months: 1 })[0];
    expect(august.incomeMinor).toBe(0);
    expect(august.expenseMinor).toBe(0);
  });

  /**
   * A record at 11pm on the last day of a month belongs to the month the user
   * lived. Grouping in SQL would need SQLite's `localtime`, which reads the
   * PROCESS timezone — so the same database would bucket differently on a
   * device set to Cairo and on CI set to UTC.
   */
  it('buckets by local calendar month, not by UTC', () => {
    spend(db, 'late', 'food', 10_000, new Date(2026, 7, 31, 23, 30));
    const points = cashFlow(db, '2026-09', { months: 2 });
    expect(points[0]).toMatchObject({ period: '2026-08', expenseMinor: 10_000 });
    expect(points[1].expenseMinor).toBe(0);
  });
});

describe('cashFlowPeak', () => {
  it('is the tallest bar of either kind', () => {
    expect(
      cashFlowPeak([
        { period: '2026-07', incomeMinor: 100, expenseMinor: 400, netMinor: -300 },
        { period: '2026-08', incomeMinor: 900, expenseMinor: 200, netMinor: 700 },
      ])
    ).toBe(900);
  });

  it('is 0 for an empty series, not -Infinity', () => {
    // Math.max() with no arguments is -Infinity, and dividing by it silently
    // gives every bar a width of -0.
    expect(cashFlowPeak([])).toBe(0);
  });
});
