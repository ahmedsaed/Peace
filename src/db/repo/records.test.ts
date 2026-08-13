/**
 * @jest-environment node
 */
import { createTestDb, type TestDb } from '../../test/db';
import { accountId, catId, seedDefaults } from '../seed';
import { groupByDay, listRecordsForPeriod, periodSummary, type RecordRow } from './records';
import { createRecord, createTransfer } from './transactions';
import { addAttachment } from './attachments';

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
      // No corrections in these months; the field is asserted so a future
      // adjustment leaking into income or expense fails here.
      adjustmentMinor: 0,
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
      // No corrections in these months; the field is asserted so a future
      // adjustment leaking into income or expense fails here.
      adjustmentMinor: 0,
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
      // No corrections in these months; the field is asserted so a future
      // adjustment leaking into income or expense fails here.
      adjustmentMinor: 0,
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

/**
 * The list's receipt indicator.
 *
 * Counted in the SAME query as the row, so the mark can never describe a
 * different moment from the row it sits on.
 */
describe('how many receipts a row carries', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb().db;
    seedDefaults(db);
  });

  const hash = (seed: string) => seed.padEnd(64, '0');
  const attach = (transactionId: string, seedText: string) =>
    addAttachment(db, {
      transactionId,
      fileName: `${hash(seedText)}.jpg`,
      mimeType: 'image/jpeg',
      byteSize: 1000,
      sha256: hash(seedText),
    });

  const spend = (id: string) =>
    createRecord(db, {
      id,
      type: 'expense',
      accountId: CASH,
      amountMinor: 100,
      occurredAt: new Date(2026, 7, 5, 12),
    });

  it('reports zero for a record with none', () => {
    spend('r1');
    expect(listRecordsForPeriod(db, '2026-08')[0].attachmentCount).toBe(0);
  });

  it('counts what is attached', () => {
    spend('r1');
    attach('r1', 'a');
    attach('r1', 'b');
    expect(listRecordsForPeriod(db, '2026-08')[0].attachmentCount).toBe(2);
  });

  /**
   * A correlated subquery is used precisely to avoid this: a JOIN onto
   * `attachments` would return one ROW PER RECEIPT, so a record with two
   * receipts would appear in the list twice — and the month's totals are
   * computed elsewhere, so nothing else would contradict it.
   */
  it('does not duplicate the record itself', () => {
    spend('r1');
    attach('r1', 'a');
    attach('r1', 'b');
    attach('r1', 'c');
    expect(listRecordsForPeriod(db, '2026-08')).toHaveLength(1);
  });

  it('counts per record rather than across the month', () => {
    spend('r1');
    spend('r2');
    attach('r1', 'a');

    const byId = new Map(listRecordsForPeriod(db, '2026-08').map((r) => [r.id, r.attachmentCount]));
    expect(byId.get('r1')).toBe(1);
    expect(byId.get('r2')).toBe(0);
  });
});

/**
 * The per-day subtotal in each section heading, behind the `showTotal` setting.
 *
 * It has to agree with the month header directly above it, which is why the
 * home-currency expression is shared with `periodSummary` rather than written
 * out a second time here.
 */
describe('what a day did to your position', () => {
  const row = (over: Partial<RecordRow>): RecordRow => ({
    id: `r${Math.random()}`,
    amountMinor: -100,
    currency: 'EGP',
    note: null,
    occurredAt: new Date(2026, 7, 5, 12),
    isTransfer: false,
    isAdjustment: false,
    isRefund: false,
    categoryName: null,
    categoryIcon: null,
    categoryColor: null,
    accountName: 'Cash',
    counterAccountName: null,
    attachmentCount: 0,
    homeValueMinor: -100,
    ...over,
  });

  it('nets a day of spending and income', () => {
    const [day] = groupByDay([
      row({ amountMinor: -3_000, homeValueMinor: -3_000 }),
      row({ amountMinor: 10_000, homeValueMinor: 10_000 }),
    ]);
    expect(day.totalMinor).toBe(7_000);
    expect(day.unvaluedCount).toBe(0);
  });

  /**
   * A transfer between your own accounts is neither spending nor income. Left
   * in, the day you moved savings across would read exactly like the day you
   * spent them.
   */
  it('leaves transfers out', () => {
    const [day] = groupByDay([
      row({ amountMinor: -3_000, homeValueMinor: -3_000 }),
      row({ isTransfer: true, amountMinor: -50_000, homeValueMinor: -50_000 }),
    ]);
    expect(day.totalMinor).toBe(-3_000);
  });

  /** A correction moved real money, so it belongs in the position. */
  it('counts a balance correction', () => {
    const [day] = groupByDay([row({ isAdjustment: true, amountMinor: -1_500, homeValueMinor: -1_500 })]);
    expect(day.totalMinor).toBe(-1_500);
  });

  /**
   * A refund is an expense with a POSITIVE amount. Its sign is what makes the
   * day's net right, and reading the side from the sign is the bug that rule
   * exists to prevent.
   */
  it('nets a refund against the day it came back on', () => {
    const [day] = groupByDay([
      row({ amountMinor: -80_000, homeValueMinor: -80_000 }),
      row({ isRefund: true, amountMinor: 30_000, homeValueMinor: 30_000 }),
    ]);
    expect(day.totalMinor).toBe(-50_000);
  });

  /**
   * 100 dollars plus 100 pounds is 200 of nothing. An unvaluable record is
   * excluded and COUNTED, so the screen can say the figure is incomplete
   * rather than being quietly wrong by a few hundred.
   */
  it('excludes what it cannot value, and says how many', () => {
    const [day] = groupByDay([
      row({ amountMinor: -3_000, homeValueMinor: -3_000 }),
      row({ currency: 'USD', amountMinor: -5_000, homeValueMinor: null }),
    ]);
    expect(day.totalMinor).toBe(-3_000);
    expect(day.unvaluedCount).toBe(1);
  });

  it('totals each day separately', () => {
    const groups = groupByDay([
      row({ occurredAt: new Date(2026, 7, 6, 9), amountMinor: -1_000, homeValueMinor: -1_000 }),
      row({ occurredAt: new Date(2026, 7, 5, 9), amountMinor: -2_000, homeValueMinor: -2_000 }),
    ]);
    expect(groups.map((g) => g.totalMinor)).toEqual([-1_000, -2_000]);
  });

  it('is zero for a day of nothing but transfers', () => {
    // Zero rather than absent: the day HAS rows, and its position simply did
    // not move. Hiding the figure would read as a missing total.
    const [day] = groupByDay([row({ isTransfer: true, homeValueMinor: -100 })]);
    expect(day.totalMinor).toBe(0);
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
    isAdjustment: false,
    isRefund: false,
    categoryName: null,
    categoryIcon: null,
    categoryColor: null,
    accountName: 'Cash',
    counterAccountName: null,
    attachmentCount: 0,
    homeValueMinor: -100,
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
