/**
 * @jest-environment node
 */
import { createTestDb, type TestDb } from '../../test/db';
import { createAccount, listAccountsWithBalance, updateAccount } from './accounts';
import {
  broughtForward,
  positionByAccount,
  runningTotals,
  totalHeld,
  type AccountPosition,
} from './carry';
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

/**
 * THE SAME IDENTITY, IN TWO DIMENSIONS.
 *
 * The sheet behind the "Now" cell is a table: accounts down, time across. Every
 * COLUMN has to sum to a figure the app already shows somewhere else, and every
 * ROW has to sum to that account's balance — a table doing arithmetic in front
 * of the user and getting it wrong is worse than no table. These assertions are
 * the edges of it, not the individual cells.
 */
const sumBefore = (rows: AccountPosition[]) => rows.reduce((t, r) => t + r.beforeMinor, 0);
const sumMonth = (rows: AccountPosition[]) => rows.reduce((t, r) => t + r.monthMinor, 0);
const sumTotal = (rows: AccountPosition[]) => rows.reduce((t, r) => t + r.amountMinor, 0);

describe('positionByAccount', () => {
  /** Every column, against the figure it is claiming to break down. */
  it('reconciles all three columns with the header above them', () => {
    const db = seed({ opening: 500_000 });
    createAccount(db, { id: 'cash', name: 'Cash', currency: 'EGP', openingBalance: 20_000 });

    earn(db, 'i1', 900_000, on(2026, 6, 1));
    spend(db, 'e1', 250_000, on(2026, 7, 5));
    earn(db, 'i2', 900_000, on(2026, 8, 1));
    spend(db, 'e2', 300_000, on(2026, 8, 9), 'cash');

    const rows = positionByAccount(db, '2026-08');
    const bf = broughtForward(db, '2026-08');
    const august = periodSummary(db, '2026-08');

    expect(sumBefore(rows)).toBe(bf.amountMinor);
    expect(sumMonth(rows)).toBe(august.balanceMinor);
    expect(sumTotal(rows)).toBe(bf.amountMinor + august.balanceMinor);
  });

  /** And every row, against itself. */
  it('adds each account across to its own position', () => {
    const db = seed({ opening: 500_000 });
    earn(db, 'i1', 900_000, on(2026, 8, 1));

    for (const row of positionByAccount(db, '2026-08')) {
      expect([row.name, row.amountMinor]).toEqual([row.name, row.beforeMinor + row.monthMinor]);
    }
  });

  /**
   * THE QUESTION THE TABLE EXISTS TO ANSWER: how much of this is history?
   * An account can hold a great deal and have done nothing all month, and the
   * position alone cannot tell you that — which is the whole reason the middle
   * column is there.
   */
  it('separates what an account was already holding from what the month did', () => {
    const db = seed();
    createAccount(db, { id: 'cash', name: 'Cash', currency: 'EGP' });
    earn(db, 'old', 900_000, on(2026, 6, 1));
    spend(db, 'new', 300_000, on(2026, 8, 9), 'cash');

    const rows = positionByAccount(db, '2026-08');
    expect(rows.find((r) => r.id === 'bank')).toMatchObject({
      beforeMinor: 900_000,
      monthMinor: 0,
      amountMinor: 900_000,
    });
    expect(rows.find((r) => r.id === 'cash')).toMatchObject({
      beforeMinor: 0,
      monthMinor: -300_000,
      amountMinor: -300_000,
    });
  });

  /**
   * An opening balance has no date, so it belongs BEFORE all time — in the
   * first month's history column as much as in the twentieth's. Put it in the
   * month column and every account would appear to have received its opening
   * balance in whichever month you happened to be looking at.
   */
  it('puts an opening balance in the history column of every month', () => {
    const db = seed({ opening: 500_000 });
    for (const period of ['2020-01', '2026-08']) {
      expect(positionByAccount(db, period).find((r) => r.id === 'bank')).toMatchObject({
        beforeMinor: 500_000,
        monthMinor: 0,
      });
    }
  });

  /**
   * The reason the last column is the position at the END OF THE VIEWED MONTH
   * and not today's balances: those agree only while nothing is dated later.
   * Scroll back one month with a record in this one and the two separate.
   */
  it('ignores records dated after the month being viewed', () => {
    const db = seed();
    earn(db, 'july', 100_000, on(2026, 7, 4));
    earn(db, 'august', 900_000, on(2026, 8, 4));

    expect(sumTotal(positionByAccount(db, '2026-07'))).toBe(100_000);
    expect(sumTotal(positionByAccount(db, '2026-08'))).toBe(1_000_000);
    // ...where the Accounts screen, which knows nothing about a viewed month,
    // says the same thing only for the later of the two.
    expect(totalHeld(db)).toBe(1_000_000);
  });

  /**
   * A transfer moves one account's position and not the total. Both legs have
   * to land on the RIGHT accounts and in the RIGHT column — a table that put
   * both legs on one account, or one leg in the wrong month, would still add
   * up down the total column.
   */
  it('moves a transfer between the two accounts and not the total', () => {
    const db = seed({ opening: 500_000 });
    createAccount(db, { id: 'cash', name: 'Cash', currency: 'EGP' });
    createTransfer(db, {
      fromAccountId: 'bank',
      toAccountId: 'cash',
      amountMinor: 100_000,
      occurredAt: on(2026, 8, 10),
    });

    const rows = positionByAccount(db, '2026-08');
    expect(rows.find((r) => r.id === 'bank')).toMatchObject({
      beforeMinor: 500_000,
      monthMinor: -100_000,
      amountMinor: 400_000,
    });
    expect(rows.find((r) => r.id === 'cash')).toMatchObject({
      beforeMinor: 0,
      monthMinor: 100_000,
      amountMinor: 100_000,
    });
    expect(sumTotal(rows)).toBe(500_000);
    // The month did nothing to the position, which is exactly what a transfer
    // means and what the header beside it says.
    expect(sumMonth(rows)).toBe(periodSummary(db, '2026-08').balanceMinor);
  });

  /**
   * THE OTHER SCREEN. This table names accounts and prints a figure beside
   * each, and the Accounts tab does exactly the same thing — two screens
   * showing the same money, so a test has to say they agree. Transfers are the
   * case that separates them: excluded, as every total in this file excludes
   * them, Cash would read zero here and E£1,000 there.
   */
  it('agrees with the Accounts screen, account by account', () => {
    const db = seed({ opening: 500_000 });
    createAccount(db, { id: 'cash', name: 'Cash', currency: 'EGP', openingBalance: 20_000 });
    earn(db, 'i1', 900_000, on(2026, 8, 1));
    spend(db, 'e1', 300_000, on(2026, 8, 9), 'cash');
    createTransfer(db, {
      fromAccountId: 'bank',
      toAccountId: 'cash',
      amountMinor: 100_000,
      occurredAt: on(2026, 8, 10),
    });

    const held = new Map(listAccountsWithBalance(db).map((a) => [a.id, a.balanceMinor]));
    for (const row of positionByAccount(db, '2026-08')) {
      expect([row.id, row.amountMinor]).toEqual([row.id, held.get(row.id)]);
    }
  });

  /**
   * Archiving hides an account from the pickers; it does not spend what is in
   * it. Left out, the table would add up to less than the figure above it.
   */
  it('keeps an archived account that still holds money', () => {
    const db = seed();
    earn(db, 'i1', 300_000, on(2026, 8, 1));
    updateAccount(db, 'bank', { archived: true });

    const rows = positionByAccount(db, '2026-08');
    expect(rows.find((r) => r.id === 'bank')?.archived).toBe(true);
    expect(sumTotal(rows)).toBe(300_000);
  });

  /** An account with no records at all is still a row — it holds its opening balance. */
  it('lists an account that has only an opening balance', () => {
    const db = seed({ opening: 500_000 });
    expect(positionByAccount(db, '2026-08').find((r) => r.id === 'bank')?.amountMinor).toBe(
      500_000
    );
  });

  /**
   * A foreign opening balance has no rate attached, so it is reported rather
   * than converted — the same rule `broughtForward` follows, and the reason
   * the two still agree.
   */
  it('reports a foreign opening balance instead of valuing it', () => {
    const { db } = createTestDb();
    createAccount(db, { id: 'usd', name: 'Dollar jar', currency: 'USD', openingBalance: 100_000 });

    const row = positionByAccount(db, '2026-08', 'EGP').find((r) => r.id === 'usd');
    expect(row?.amountMinor).toBe(0);
    expect(row?.unvaluedBefore).toBe(1);
    // Dated nowhere, so it is not the MONTH that could not value it.
    expect(row?.unvaluedMonth).toBe(0);
  });

  /**
   * What the header counts as uncountable is what the table counts, and split
   * the same way: the records screen adds the carry scan's count to the
   * month's, so each has to match its own side.
   */
  it('counts the same unvalued records the header does, on the same side', () => {
    const db = seed();
    const foreign = (id: string, when: Date) =>
      createRecord(db, {
        id,
        accountId: 'usd',
        categoryId: 'food',
        type: 'expense',
        amountMinor: 2_500,
        currency: 'USD',
        fxRate: 50,
        homeCurrency: 'EGP',
        occurredAt: when,
      });
    foreign('earlier', on(2026, 6, 7));
    foreign('inside', on(2026, 8, 7));

    const rows = positionByAccount(db, '2026-08', 'USD');
    expect(rows.reduce((n, r) => n + r.unvaluedBefore, 0)).toBe(
      broughtForward(db, '2026-08', 'USD').unvaluedCount
    );
    expect(rows.reduce((n, r) => n + r.unvaluedMonth, 0)).toBe(
      periodSummary(db, '2026-08', 'USD').unvaluedCount
    );
  });
});
