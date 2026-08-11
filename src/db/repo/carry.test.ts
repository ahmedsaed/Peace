/**
 * @jest-environment node
 */
import { createTestDb, type TestDb } from '../../test/db';
import { createAccount, listAccountsWithBalance } from './accounts';
import { broughtForward, runningTotals, totalHeld } from './carry';
import { createCategory } from './categories';
import { periodSummary } from './records';
import { createRecord, createTransfer } from './transactions';

const on = (year: number, month: number, day: number) => new Date(year, month - 1, day, 12, 0);

function seed({ opening = 0 } = {}) {
  const { db } = createTestDb();
  createAccount(db, { id: 'bank', name: 'Bank', currency: 'EGP', openingBalance: opening });
  createAccount(db, { id: 'usd', name: 'Dollar jar', currency: 'USD' });
  createCategory(db, { id: 'food', name: 'Food', kind: 'expense', sortOrder: 0 });
  createCategory(db, { id: 'salary', name: 'Salary', kind: 'income', sortOrder: 0 });
  return db;
}

const spend = (db: TestDb, id: string, minor: number, when: Date, accountId = 'bank') =>
  createRecord(db, {
    id,
    accountId,
    categoryId: 'food',
    type: 'expense',
    amountMinor: minor,
    occurredAt: when,
  });

const earn = (db: TestDb, id: string, minor: number, when: Date, accountId = 'bank') =>
  createRecord(db, {
    id,
    accountId,
    categoryId: 'salary',
    type: 'income',
    amountMinor: minor,
    occurredAt: when,
  });

describe('broughtForward', () => {
  it('is nothing before anything has happened', () => {
    expect(broughtForward(seed(), '2026-08')).toMatchObject({
      amountMinor: 0,
      openingMinor: 0,
      ledgerMinor: 0,
    });
  });

  it('carries the net of every earlier month', () => {
    const db = seed();
    earn(db, 'i1', 900_000, on(2026, 6, 1));
    spend(db, 'e1', 250_000, on(2026, 6, 5));
    earn(db, 'i2', 900_000, on(2026, 7, 1));
    spend(db, 'e2', 300_000, on(2026, 7, 5));

    // (900,000 - 250,000) + (900,000 - 300,000)
    expect(broughtForward(db, '2026-08').ledgerMinor).toBe(1_250_000);
  });

  it('stops at the first day of the month asked for', () => {
    const db = seed();
    earn(db, 'before', 100_000, new Date(2026, 6, 31, 23, 59));
    earn(db, 'inside', 900_000, new Date(2026, 7, 1, 0, 1));
    expect(broughtForward(db, '2026-08').ledgerMinor).toBe(100_000);
  });

  /**
   * EXACTLY midnight on the 1st belongs to the new month, not to the carry.
   * The bound is half-open — `< start`, not `<= start` — and only a record
   * landing precisely on the boundary can tell the two apart. A record a minute
   * either side passes under both.
   */
  it('excludes a record landing exactly on the boundary', () => {
    const db = seed();
    earn(db, 'midnight', 900_000, new Date(2026, 7, 1, 0, 0, 0, 0));
    expect(broughtForward(db, '2026-08').ledgerMinor).toBe(0);
    // ...and it is inside the month itself, so nothing has been lost.
    expect(periodSummary(db, '2026-08').incomeMinor).toBe(900_000);
  });

  /**
   * The boundary is LOCAL midnight. An 11pm income on the 31st belongs to the
   * month the user lived, not to the next one because UTC had rolled over.
   */
  it('uses the local month boundary', () => {
    const db = seed();
    earn(db, 'late', 100_000, new Date(2026, 6, 31, 23, 30));
    expect(broughtForward(db, '2026-08').ledgerMinor).toBe(100_000);
    expect(broughtForward(db, '2026-07').ledgerMinor).toBe(0);
  });

  it('goes negative when more was spent than earned', () => {
    const db = seed();
    spend(db, 'e1', 250_000, on(2026, 6, 5));
    expect(broughtForward(db, '2026-08').amountMinor).toBe(-250_000);
  });

  /**
   * Money that was in the account before the first record is still money you
   * have. Leaving it out would put the running total permanently below the
   * Accounts screen with nothing explaining the gap.
   */
  it('includes what the accounts were opened with', () => {
    const db = seed({ opening: 500_000 });
    earn(db, 'i1', 900_000, on(2026, 6, 1));

    const bf = broughtForward(db, '2026-08');
    expect(bf.openingMinor).toBe(500_000);
    expect(bf.ledgerMinor).toBe(900_000);
    expect(bf.amountMinor).toBe(1_400_000);
  });

  it('counts an opening balance even for the very first month', () => {
    // An opening balance has no date, so it belongs before all time.
    const db = seed({ opening: 500_000 });
    expect(broughtForward(db, '2020-01').amountMinor).toBe(500_000);
  });

  /**
   * Both legs of a transfer are in the table and they cancel, so including them
   * would be right only by accident — and only while both are valuable in the
   * home currency.
   */
  it('excludes transfers', () => {
    const db = seed();
    createAccount(db, { id: 'cash', name: 'Cash', currency: 'EGP' });
    createTransfer(db, {
      fromAccountId: 'bank',
      toAccountId: 'cash',
      amountMinor: 500_000,
      occurredAt: on(2026, 6, 6),
    });
    expect(broughtForward(db, '2026-08').ledgerMinor).toBe(0);
  });

  /**
   * THE ASSERTION THAT ACTUALLY BITES. The amount above is zero either way,
   * because a transfer's two legs cancel — so it proves the filter is there
   * only by accident. `unvaluedCount` is where including transfers shows: both
   * legs would fall out of the SUM and be counted, and the screen would say
   * "2 records are not counted" about a movement that was never counted in the
   * first place.
   */
  it('does not report a transfer as an uncountable record', () => {
    const db = seed();
    createAccount(db, { id: 'cash', name: 'Cash', currency: 'EGP' });
    createTransfer(db, {
      fromAccountId: 'bank',
      toAccountId: 'cash',
      amountMinor: 500_000,
      homeCurrency: 'EGP',
      occurredAt: on(2026, 6, 6),
    });
    // Home currency has since changed, so neither leg can be valued.
    expect(broughtForward(db, '2026-08', 'USD').unvaluedCount).toBe(0);
  });

  it('values a foreign record at its converted amount', () => {
    const db = seed();
    createRecord(db, {
      id: 'x',
      accountId: 'usd',
      categoryId: 'food',
      type: 'expense',
      amountMinor: 2_500, // $25
      currency: 'USD',
      fxRate: 50,
      homeCurrency: 'EGP',
      occurredAt: on(2026, 6, 7),
    });
    expect(broughtForward(db, '2026-08').ledgerMinor).toBe(-125_000);
  });

  /**
   * There is no rate stored for "money that was already there", so a foreign
   * opening balance cannot be converted at any rate the user chose. Counting it
   * is the only honest option.
   */
  it('reports a foreign opening balance rather than converting it', () => {
    const { db } = createTestDb();
    createAccount(db, { id: 'usd', name: 'Dollar jar', currency: 'USD', openingBalance: 100_000 });

    const bf = broughtForward(db, '2026-08', 'EGP');
    expect(bf.openingMinor).toBe(0);
    expect(bf.unvaluedCount).toBe(1);
  });

  it('does not count a foreign account that was opened empty', () => {
    // Nothing to convert means nothing to warn about.
    const db = seed();
    expect(broughtForward(db, '2026-08').unvaluedCount).toBe(0);
  });

  it('counts records it cannot value in the home currency', () => {
    const db = seed();
    createRecord(db, {
      id: 'x',
      accountId: 'usd',
      categoryId: 'food',
      type: 'expense',
      amountMinor: 2_500,
      currency: 'USD',
      fxRate: 50,
      homeCurrency: 'EGP',
      occurredAt: on(2026, 6, 7),
    });
    const bf = broughtForward(db, '2026-08', 'USD');
    expect(bf.unvaluedCount).toBe(1);
    expect(bf.ledgerMinor).toBe(0);
  });
});

/**
 * THE IDENTITY THAT MAKES THE FEATURE TRUSTWORTHY.
 *
 * If brought-forward plus this month's net does not equal what the Accounts
 * screen says, one of the two screens is lying and the user has no way to tell
 * which. This is the assertion that pins them together.
 */
describe('brought forward + this month = what you hold', () => {
  it('reconciles with the accounts total', () => {
    const db = seed({ opening: 500_000 });
    createAccount(db, { id: 'cash', name: 'Cash', currency: 'EGP', openingBalance: 20_000 });

    earn(db, 'i1', 900_000, on(2026, 6, 1));
    spend(db, 'e1', 250_000, on(2026, 7, 5));
    earn(db, 'i2', 900_000, on(2026, 8, 1));
    spend(db, 'e2', 300_000, on(2026, 8, 9), 'cash');
    createTransfer(db, {
      fromAccountId: 'bank',
      toAccountId: 'cash',
      amountMinor: 100_000,
      occurredAt: on(2026, 8, 10),
    });

    const bf = broughtForward(db, '2026-08');
    const august = periodSummary(db, '2026-08');
    const accountsTotal = listAccountsWithBalance(db).reduce((sum, a) => sum + a.balanceMinor, 0);

    expect(bf.amountMinor + august.balanceMinor).toBe(accountsTotal);
    expect(totalHeld(db)).toBe(accountsTotal);
  });

  it('still reconciles when nothing has been recorded at all', () => {
    const db = seed({ opening: 500_000 });
    const bf = broughtForward(db, '2026-08');
    const accountsTotal = listAccountsWithBalance(db).reduce((sum, a) => sum + a.balanceMinor, 0);
    expect(bf.amountMinor + periodSummary(db, '2026-08').balanceMinor).toBe(accountsTotal);
  });
});

describe('runningTotals', () => {
  it('is a prefix sum starting from what was brought forward', () => {
    expect(runningTotals(1_000, [500, -200, 300])).toEqual([1_500, 1_300, 1_600]);
  });

  it('starts from zero when nothing was brought forward', () => {
    expect(runningTotals(0, [500, 500])).toEqual([500, 1_000]);
  });

  it('can go negative and come back', () => {
    expect(runningTotals(100, [-500, 900])).toEqual([-400, 500]);
  });

  it('has nothing to total for an empty series', () => {
    expect(runningTotals(1_000, [])).toEqual([]);
  });
});
