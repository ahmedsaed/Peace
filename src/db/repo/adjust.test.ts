/**
 * @jest-environment node
 */
import { createTestDb, type TestDb } from '../../test/db';
import { accountBalance, previewReconcile, reconcileAccount } from './adjust';
import { createAccount, listAccountsWithBalance } from './accounts';
import { broughtForward } from './carry';
import { categoryBreakdown } from './analysis';
import { createCategory, InvariantError } from './categories';
import { periodSummary } from './records';
import { createRecord, createTransfer } from './transactions';
import { listBudgets, setBudget } from './budgets';

const on = (year: number, month: number, day: number) => new Date(year, month - 1, day, 12, 0);

function seed() {
  const { db } = createTestDb();
  createAccount(db, { id: 'bank', name: 'Bank', currency: 'EGP', openingBalance: 100_000 });
  createAccount(db, { id: 'card', name: 'Kenana', type: 'card', currency: 'EGP' });
  createCategory(db, { id: 'food', name: 'Food', kind: 'expense', sortOrder: 0 });
  createCategory(db, { id: 'salary', name: 'Salary', kind: 'income', sortOrder: 0 });
  return db;
}

const spend = (db: TestDb, id: string, minor: number, when: Date, accountId = 'card') =>
  createRecord(db, {
    id,
    accountId,
    categoryId: 'food',
    type: 'expense',
    amountMinor: minor,
    occurredAt: when,
  });

describe('accountBalance', () => {
  it('is the opening balance plus everything on the account', () => {
    const db = seed();
    spend(db, 'a', 25_000, on(2026, 8, 3), 'bank');
    expect(accountBalance(db, 'bank')).toBe(75_000);
  });

  it('is negative on a card, because the balance is what you owe', () => {
    const db = seed();
    spend(db, 'a', 25_000, on(2026, 8, 3));
    expect(accountBalance(db, 'card')).toBe(-25_000);
  });

  it('counts both legs of a transfer against the accounts they moved', () => {
    const db = seed();
    createTransfer(db, {
      fromAccountId: 'bank',
      toAccountId: 'card',
      amountMinor: 40_000,
      occurredAt: on(2026, 8, 9),
    });
    expect(accountBalance(db, 'bank')).toBe(60_000);
    // Paying the card reduces what is owed.
    expect(accountBalance(db, 'card')).toBe(40_000);
  });

  it('refuses an account that does not exist', () => {
    expect(() => accountBalance(seed(), 'nope')).toThrow(InvariantError);
  });
});

describe('previewReconcile', () => {
  it('reports the gap without writing anything', () => {
    const db = seed();
    spend(db, 'a', 25_000, on(2026, 8, 3));

    // The bank says 260 owed; the ledger believes 250.
    const preview = previewReconcile(db, 'card', -26_000);
    expect(preview).toEqual({
      currentMinor: -25_000,
      targetMinor: -26_000,
      differenceMinor: -1_000,
    });
    // Nothing written: a reconciliation you cannot check first is one you
    // cannot refuse.
    expect(accountBalance(db, 'card')).toBe(-25_000);
  });
});

describe('reconcileAccount', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
    spend(db, 'a', 25_000, on(2026, 8, 3));
  });

  it('moves the account to the balance the bank shows', () => {
    reconcileAccount(db, 'card', -26_000, { occurredAt: on(2026, 8, 10) });
    expect(accountBalance(db, 'card')).toBe(-26_000);
  });

  it('writes nothing when the ledger is already right', () => {
    // A permanent row in the list saying nothing happened is worse than no row.
    expect(reconcileAccount(db, 'card', -25_000)).toBeNull();
    expect(accountBalance(db, 'card')).toBe(-25_000);
  });

  it('can correct in either direction', () => {
    reconcileAccount(db, 'card', -20_000, { occurredAt: on(2026, 8, 10) });
    expect(accountBalance(db, 'card')).toBe(-20_000);
    reconcileAccount(db, 'card', -30_000, { occurredAt: on(2026, 8, 11) });
    expect(accountBalance(db, 'card')).toBe(-30_000);
  });

  it('carries no category, by construction', () => {
    const row = reconcileAccount(db, 'card', -26_000, { occurredAt: on(2026, 8, 10) })!;
    expect(row.categoryId).toBeNull();
    expect(row.isAdjustment).toBe(true);
  });

  it('is denominated in the account currency', () => {
    createAccount(db, { id: 'usd', name: 'Dollar jar', currency: 'USD' });
    const row = reconcileAccount(db, 'usd', 5_000, { occurredAt: on(2026, 8, 10) })!;
    expect(row.currency).toBe('USD');
  });

  it('refuses a fractional balance', () => {
    expect(() => reconcileAccount(db, 'card', 100.5)).toThrow(/integer/);
  });
});

/**
 * THE POINT OF THE WHOLE FEATURE. A correction moves what you hold and never
 * what you spent. If it leaked into expense, reconciling a card would drop a
 * category's worth of phantom spending into whichever month you did it in.
 */
describe('an adjustment is not spending', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
    spend(db, 'a', 25_000, on(2026, 8, 3));
    reconcileAccount(db, 'card', -30_000, { occurredAt: on(2026, 8, 10) });
  });

  it('stays out of income and expense', () => {
    const summary = periodSummary(db, '2026-08');
    expect(summary.expenseMinor).toBe(-25_000);
    expect(summary.incomeMinor).toBe(0);
  });

  it('is reported on its own, not hidden', () => {
    // Silently dropping it would leave the balance moving with nothing to
    // explain it.
    expect(periodSummary(db, '2026-08').adjustmentMinor).toBe(-5_000);
  });

  it('is part of what the month did to your position', () => {
    expect(periodSummary(db, '2026-08').balanceMinor).toBe(-30_000);
  });

  it('never appears in a category breakdown', () => {
    const breakdown = categoryBreakdown(db, '2026-08', 'expense');
    expect(breakdown.totalMinor).toBe(25_000);
    // Nor as uncategorised spending, which is where a null category would
    // otherwise land it.
    expect(breakdown.uncategorisedMinor).toBe(0);
  });

  /**
   * Belt and braces, and worth being honest about which is which: this passes
   * for TWO independent reasons — the `countsAsSpending` predicate excludes
   * adjustments, and `reconcileAccount` gives them no category to be filed
   * under in the first place. Breaking the predicate alone does not fail this
   * test; the breakdown test above is the one that catches that. It stays
   * because it would catch the day someone decides an adjustment should carry
   * a category after all.
   */
  it('never counts against a budget', () => {
    setBudget(db, 'food', '2026-08', 50_000);
    const summary = listBudgets(db, '2026-08');
    expect(summary.budgeted[0].spentMinor).toBe(25_000);
    expect(summary.totalSpentMinor).toBe(25_000);
  });

  it('carries into the next month as position, not as spending', () => {
    const bf = broughtForward(db, '2026-09');
    expect(bf.ledgerMinor).toBe(-30_000);
  });
});

/**
 * The identity the Records header depends on. It is the reason `balanceMinor`
 * had to grow a third component rather than adjustments being quietly dropped.
 */
describe('reconciling keeps the screens in agreement', () => {
  it('brought forward + this month still equals the accounts total', () => {
    const db = seed();
    createRecord(db, {
      id: 'i',
      accountId: 'bank',
      categoryId: 'salary',
      type: 'income',
      amountMinor: 900_000,
      occurredAt: on(2026, 7, 1),
    });
    spend(db, 'a', 25_000, on(2026, 8, 3));
    reconcileAccount(db, 'card', -31_000, { occurredAt: on(2026, 8, 10) });
    createTransfer(db, {
      fromAccountId: 'bank',
      toAccountId: 'card',
      amountMinor: 10_000,
      occurredAt: on(2026, 8, 12),
    });

    const bf = broughtForward(db, '2026-08');
    const august = periodSummary(db, '2026-08');
    const total = listAccountsWithBalance(db).reduce((sum, a) => sum + a.balanceMinor, 0);

    expect(bf.amountMinor + august.balanceMinor).toBe(total);
  });
});
