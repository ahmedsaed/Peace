/**
 * @jest-environment node
 *
 * Months that start on payday. Every query that thinks in months goes through
 * `periodBounds`, so moving the start day has to move ALL of them together —
 * the list, the totals, the budget's spending and the running position — or
 * two screens disagree about which month a record is in.
 */
import { createTestDb, type TestDb } from '../../test/db';
import { configurePeriods } from '../../lib/period';
import { accountId, catId, seedDefaults } from '../seed';
import { balanceByCurrency } from './accounts';
import { listBudgets, setBudget } from './budgets';
import { broughtForward } from './carry';
import { listRecordsForPeriod, periodSummary } from './records';
import { createRecord } from './transactions';

const spend = (db: TestDb, minor: number, when: Date) =>
  createRecord(db, {
    type: 'expense',
    accountId: accountId('cash'),
    categoryId: catId('groceries'),
    amountMinor: minor,
    homeCurrency: 'USD',
    occurredAt: when,
  });

describe('a month that starts on the 25th', () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb().db;
    seedDefaults(db, 'USD');
    spend(db, 10_000, new Date(2026, 9, 24, 18)); // 24 Oct — October's last day
    spend(db, 20_000, new Date(2026, 9, 26, 9)); // 26 Oct — November's second
    configurePeriods({ monthStart: 25 });
  });

  afterEach(() => configurePeriods({ monthStart: 1 }));

  it('lists and totals each record in the month it now belongs to', () => {
    expect(listRecordsForPeriod(db, '2026-10').map((r) => r.amountMinor)).toEqual([-10_000]);
    expect(listRecordsForPeriod(db, '2026-11').map((r) => r.amountMinor)).toEqual([-20_000]);
    expect(Math.abs(periodSummary(db, '2026-10', 'USD').expenseMinor)).toBe(10_000);
    expect(Math.abs(periodSummary(db, '2026-11', 'USD').expenseMinor)).toBe(20_000);
  });

  it('counts a budget against the same days', () => {
    setBudget(db, catId('food'), '2026-11', 50_000, 'USD');
    const food = listBudgets(db, '2026-11', 'USD').budgeted.find((b) => b.categoryId === catId('food'));
    expect(Math.abs(food?.spentMinor ?? 0)).toBe(20_000);
  });

  it('still reconciles: carried in + this month = what the accounts hold', () => {
    const carried = broughtForward(db, '2026-11', 'USD').amountMinor;
    const month = periodSummary(db, '2026-11', 'USD').balanceMinor;
    const held = balanceByCurrency(db).find((t) => t.currency === 'USD')!.balanceMinor;
    expect(carried + month).toBe(held);
  });

  it('goes back to calendar months when the setting does', () => {
    configurePeriods({ monthStart: 1 });
    expect(Math.abs(periodSummary(db, '2026-10', 'USD').expenseMinor)).toBe(30_000);
  });
});
