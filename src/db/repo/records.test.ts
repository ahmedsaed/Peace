/**
 * @jest-environment node
 */
import { createTestDb, type TestDb } from '../../test/db';
import { accountId, catId, seedDefaults } from '../seed';
import { groupByDay, listRecordsForPeriod, periodSummary, type RecordRow } from './records';
import { createRecord, createTransfer } from './transactions';

const CASH = accountId('cash');
const BANK = accountId('bank');

describe('listRecordsForPeriod', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb().db;
    seedDefaults(db);
  });

  it('returns only records inside the month', () => {
    createRecord(db, {
      type: 'expense',
      accountId: CASH,
      amountMinor: 100,
      occurredAt: new Date(2026, 6, 31, 23, 59), // July
    });
    createRecord(db, {
      type: 'expense',
      accountId: CASH,
      amountMinor: 200,
      occurredAt: new Date(2026, 7, 1, 0, 0), // August, first instant
    });
    createRecord(db, {
      type: 'expense',
      accountId: CASH,
      amountMinor: 300,
      occurredAt: new Date(2026, 7, 31, 23, 59), // August, last instant
    });
    createRecord(db, {
      type: 'expense',
      accountId: CASH,
      amountMinor: 400,
      occurredAt: new Date(2026, 8, 1, 0, 0), // September
    });

    const rows = listRecordsForPeriod(db, '2026-08');
    expect(rows.map((r) => Math.abs(r.amountMinor)).sort()).toEqual([200, 300]);
  });

  it('lists newest first', () => {
    createRecord(db, {
      type: 'expense',
      accountId: CASH,
      amountMinor: 100,
      occurredAt: new Date(2026, 7, 5),
    });
    createRecord(db, {
      type: 'expense',
      accountId: CASH,
      amountMinor: 200,
      occurredAt: new Date(2026, 7, 9),
    });

    expect(listRecordsForPeriod(db, '2026-08').map((r) => r.amountMinor)).toEqual([-200, -100]);
  });

  it('joins the category and account for display', () => {
    createRecord(db, {
      type: 'expense',
      accountId: CASH,
      categoryId: catId('restaurants'),
      amountMinor: 8000,
      note: 'drink',
      occurredAt: new Date(2026, 7, 6),
    });

    const [row] = listRecordsForPeriod(db, '2026-08');
    expect(row.categoryName).toBe('Restaurants');
    expect(row.accountName).toBe('Cash');
    expect(row.note).toBe('drink');
    expect(row.isTransfer).toBe(false);
  });

  it('survives a record with no category', () => {
    // categoryId is nullable, and deleting a category sets it null.
    createRecord(db, {
      type: 'expense',
      accountId: CASH,
      amountMinor: 500,
      occurredAt: new Date(2026, 7, 6),
    });

    const [row] = listRecordsForPeriod(db, '2026-08');
    expect(row.categoryName).toBeNull();
    expect(row.accountName).toBe('Cash');
  });

  describe('transfers', () => {
    beforeEach(() => {
      createTransfer(db, {
        fromAccountId: BANK,
        toAccountId: CASH,
        amountMinor: 1_075_300,
        occurredAt: new Date(2026, 7, 6),
      });
    });

    it('appears exactly once, as the outgoing leg', () => {
      // Both legs are in the table; listing both would show every transfer twice.
      const rows = listRecordsForPeriod(db, '2026-08');
      expect(rows).toHaveLength(1);
      expect(rows[0].amountMinor).toBe(-1_075_300);
    });

    it('carries both account names so the row can read "Bank -> Cash"', () => {
      const [row] = listRecordsForPeriod(db, '2026-08');
      expect(row.isTransfer).toBe(true);
      expect(row.accountName).toBe('Bank');
      expect(row.counterAccountName).toBe('Cash');
      expect(row.categoryName).toBeNull();
    });
  });
});

describe('periodSummary', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb().db;
    seedDefaults(db);
  });

  it('is all zeroes for an empty month', () => {
    expect(periodSummary(db, '2026-08')).toEqual({
      expenseMinor: 0,
      incomeMinor: 0,
      balanceMinor: 0,
      // These records are all in the home currency, so none are excluded.
      unvaluedCount: 0,
    });
  });

  it('totals income and expense separately, and nets the balance', () => {
    createRecord(db, {
      type: 'expense',
      accountId: CASH,
      amountMinor: 8000,
      occurredAt: new Date(2026, 7, 5),
    });
    createRecord(db, {
      type: 'expense',
      accountId: CASH,
      amountMinor: 2000,
      occurredAt: new Date(2026, 7, 6),
    });
    createRecord(db, {
      type: 'income',
      accountId: BANK,
      amountMinor: 1_250_000,
      occurredAt: new Date(2026, 7, 1),
    });

    expect(periodSummary(db, '2026-08')).toEqual({
      expenseMinor: -10_000,
      incomeMinor: 1_250_000,
      balanceMinor: 1_240_000,
      // These records are all in the home currency, so none are excluded.
      unvaluedCount: 0,
    });
  });

  it('EXCLUDES transfers from both sides', () => {
    createRecord(db, {
      type: 'expense',
      accountId: CASH,
      amountMinor: 8000,
      occurredAt: new Date(2026, 7, 5),
    });
    createTransfer(db, {
      fromAccountId: BANK,
      toAccountId: CASH,
      amountMinor: 500_000,
      occurredAt: new Date(2026, 7, 6),
    });

    // Counting the transfer would report E£5,000 of income that never arrived
    // and E£5,000 of spending that never happened.
    expect(periodSummary(db, '2026-08')).toEqual({
      expenseMinor: -8000,
      incomeMinor: 0,
      balanceMinor: -8000,
      // These records are all in the home currency, so none are excluded.
      unvaluedCount: 0,
    });
  });

  it('ignores records from other months', () => {
    createRecord(db, {
      type: 'expense',
      accountId: CASH,
      amountMinor: 9999,
      occurredAt: new Date(2026, 6, 15),
    });
    expect(periodSummary(db, '2026-08').expenseMinor).toBe(0);
  });
});

describe('groupByDay', () => {
  const row = (day: number, hour = 12): RecordRow => ({
    id: `r${day}-${hour}`,
    amountMinor: -100,
    currency: 'EGP',
    note: null,
    occurredAt: new Date(2026, 7, day, hour),
    isTransfer: false,
    categoryName: null,
    categoryIcon: null,
    categoryColor: null,
    accountName: 'Cash',
    counterAccountName: null,
  });

  it('returns nothing for no rows', () => {
    expect(groupByDay([])).toEqual([]);
  });

  it('groups consecutive rows from the same day', () => {
    const groups = groupByDay([row(6, 18), row(6, 9), row(5, 20)]);
    expect(groups).toHaveLength(2);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[1].rows).toHaveLength(1);
  });

  it('labels each day the way the reference app does', () => {
    // 6 Aug 2026 is a Thursday.
    expect(groupByDay([row(6)])[0].heading).toBe('Aug 06, Thursday');
  });

  it('keeps the order it was given', () => {
    const groups = groupByDay([row(9), row(6), row(5)]);
    expect(groups.map((g) => g.heading)).toEqual([
      'Aug 09, Sunday',
      'Aug 06, Thursday',
      'Aug 05, Wednesday',
    ]);
  });

  it('splits on local midnight, not UTC', () => {
    // 23:30 and 00:30 are different days however the timezone is offset.
    const groups = groupByDay([row(6, 0), row(5, 23)]);
    expect(groups).toHaveLength(2);
  });
});
