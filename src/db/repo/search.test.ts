/**
 * @jest-environment node
 */
import { EMPTY_QUERY, type SearchQuery } from '../../lib/search-query';
import { createTestDb, type TestDb } from '../../test/db';
import { createAccount } from './accounts';
import { createCategory } from './categories';
import { searchRecords } from './search';
import { createRecord, createTransfer } from './transactions';

const q = (over: Partial<SearchQuery> = {}): SearchQuery => ({ ...EMPTY_QUERY, ...over });

/** 17 June 2026, so every relative range in the tests is deterministic. */
const NOW = new Date(2026, 5, 17, 12, 0);
const on = (year: number, month: number, day: number) => new Date(year, month - 1, day, 12, 0);

const search = (db: TestDb, query: SearchQuery, over = {}) =>
  searchRecords(db, query, { homeCurrency: 'EGP', now: NOW, ...over });

const ids = (db: TestDb, query: SearchQuery, over = {}) =>
  search(db, query, over)
    .rows.map((r) => r.id)
    .sort();

function seed() {
  const { db } = createTestDb();

  createAccount(db, { id: 'bank', name: 'Bank', currency: 'EGP' });
  createAccount(db, { id: 'cash', name: 'Cash', currency: 'EGP' });
  createAccount(db, { id: 'usd', name: 'Dollar jar', currency: 'USD' });

  createCategory(db, { id: 'food', name: 'Food', kind: 'expense' });
  createCategory(db, { id: 'snacks', name: 'Snacks', kind: 'expense', parentId: 'food' });
  createCategory(db, { id: 'transport', name: 'Transport', kind: 'expense' });
  createCategory(db, { id: 'salary', name: 'Salary', kind: 'income' });

  createRecord(db, {
    id: 'lunch',
    accountId: 'bank',
    categoryId: 'food',
    type: 'expense',
    amountMinor: 25_000, // E£250
    note: 'Lunch at Cilantro',
    occurredAt: on(2026, 6, 10),
  });
  createRecord(db, {
    id: 'crisps',
    accountId: 'cash',
    categoryId: 'snacks',
    type: 'expense',
    amountMinor: 3_500,
    note: 'crisps',
    occurredAt: on(2026, 6, 2),
  });
  createRecord(db, {
    id: 'taxi',
    accountId: 'cash',
    categoryId: 'transport',
    type: 'expense',
    amountMinor: 8_000,
    note: null,
    occurredAt: on(2026, 4, 20),
  });
  createRecord(db, {
    id: 'pay',
    accountId: 'bank',
    categoryId: 'salary',
    type: 'income',
    amountMinor: 900_000,
    note: 'June salary',
    occurredAt: on(2026, 6, 1),
  });
  createRecord(db, {
    id: 'old',
    accountId: 'bank',
    categoryId: 'food',
    type: 'expense',
    amountMinor: 12_000,
    note: 'Lunch last year',
    occurredAt: on(2025, 11, 4),
  });

  return db;
}

describe('text matching', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
  });

  it('matches the note', () => {
    expect(ids(db, q({ text: 'Cilantro' }))).toEqual(['lunch']);
  });

  it('ignores case', () => {
    expect(ids(db, q({ text: 'cilantro' }))).toEqual(['lunch']);
  });

  it('matches the category name', () => {
    // "Transport" appears in no note anywhere.
    expect(ids(db, q({ text: 'transport' }))).toEqual(['taxi']);
  });

  it('matches the account name', () => {
    expect(ids(db, q({ text: 'Cash' }))).toEqual(['crisps', 'taxi']);
  });

  it('matches a record with a null note without dropping it', () => {
    // COALESCE, not a bare LIKE: `null like '%x%'` is NULL, which is not true,
    // so an un-noted record would silently never match anything.
    expect(ids(db, q({ text: 'Transport' }))).toContain('taxi');
  });

  /**
   * Unescaped, these are wildcards. "%" would match the entire ledger while
   * looking exactly like an ordinary search that found more than expected.
   */
  it('treats SQL wildcards as literal text', () => {
    expect(search(db, q({ text: '%' })).matchCount).toBe(0);
    expect(search(db, q({ text: '_' })).matchCount).toBe(0);
    expect(search(db, q({ text: 'Lunc_' })).matchCount).toBe(0);
  });

  it('finds a note that really does contain a percent sign', () => {
    createRecord(db, {
      id: 'fee',
      accountId: 'bank',
      categoryId: 'food',
      type: 'expense',
      amountMinor: 500,
      note: '3% commission',
      occurredAt: on(2026, 6, 12),
    });
    expect(ids(db, q({ text: '3%' }))).toEqual(['fee']);
  });
});

describe('filters', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
  });

  it('filters by account', () => {
    expect(ids(db, q({ accountId: 'cash' }))).toEqual(['crisps', 'taxi']);
  });

  it('filters by category', () => {
    expect(ids(db, q({ categoryId: 'transport' }))).toEqual(['taxi']);
  });

  /**
   * Picking "Food" and being told there are no records — because every one of
   * them is filed under "Snacks" — is the filter lying about the data.
   */
  it('includes a sub-category when its parent is chosen', () => {
    expect(ids(db, q({ categoryId: 'food' }))).toEqual(['crisps', 'lunch', 'old']);
  });

  it('does not sweep a sibling in with a sub-category', () => {
    expect(ids(db, q({ categoryId: 'snacks' }))).toEqual(['crisps']);
  });

  it('filters by kind', () => {
    expect(ids(db, q({ kind: 'income' }))).toEqual(['pay']);
    expect(ids(db, q({ kind: 'expense' }))).toEqual(['crisps', 'lunch', 'old', 'taxi']);
  });

  it('filters by amount, unsigned', () => {
    // The user reads "E£250" off the list — an expense stored as -25000 still
    // has to answer a search for 200 to 300.
    expect(ids(db, q({ minAmount: '200', maxAmount: '300' }))).toEqual(['lunch']);
  });

  it('applies a min with no max', () => {
    expect(ids(db, q({ minAmount: '100' }))).toEqual(['lunch', 'old', 'pay']);
  });

  it('brackets a date range', () => {
    expect(ids(db, q({ range: 'month' }))).toEqual(['crisps', 'lunch', 'pay']);
    expect(ids(db, q({ range: 'quarter' }))).toEqual(['crisps', 'lunch', 'pay', 'taxi']);
    // 'old' is November 2025, outside this calendar year.
    expect(ids(db, q({ range: 'year' }))).toEqual(['crisps', 'lunch', 'pay', 'taxi']);
  });

  it('combines filters as AND, not OR', () => {
    expect(ids(db, q({ text: 'lunch', accountId: 'bank', range: 'month' }))).toEqual(['lunch']);
  });

  it('returns nothing rather than everything when nothing matches', () => {
    const outcome = search(db, q({ text: 'zzzz' }));
    expect(outcome.rows).toEqual([]);
    expect(outcome.matchCount).toBe(0);
    expect(outcome.expenseMinor).toBe(0);
  });
});

describe('transfers', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
    createTransfer(db, {
      fromAccountId: 'bank',
      toAccountId: 'cash',
      amountMinor: 50_000,
      note: 'topping up the wallet',
      occurredAt: on(2026, 6, 5),
    });
  });

  /**
   * Both legs are in the table. The records list shows the outgoing one; search
   * has to agree, or the same transfer reads as two separate movements.
   */
  it('appears once, as the outgoing leg', () => {
    const rows = search(db, q({ text: 'topping' })).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].isTransfer).toBe(true);
    expect(rows[0].amountMinor).toBeLessThan(0);
    expect(rows[0].accountName).toBe('Bank');
    expect(rows[0].counterAccountName).toBe('Cash');
  });

  it('is found by the name of either account', () => {
    // The counter account is joined too — "money I moved to Cash" is a search
    // someone will make.
    expect(search(db, q({ text: 'topping', accountId: 'bank' })).matchCount).toBe(1);
  });

  it('is excluded from the totals', () => {
    // A transfer is neither income nor expense. Counting it would inflate both
    // sides by the same amount and make the result look far busier than it was.
    const outcome = search(db, q({ range: 'month' }));
    expect(outcome.expenseMinor).toBe(-(25_000 + 3_500));
    expect(outcome.incomeMinor).toBe(900_000);
    // ...while still being listed.
    expect(outcome.rows.map((r) => r.id)).toContain(
      outcome.rows.find((r) => r.isTransfer)!.id
    );
  });

  it('can be isolated by kind', () => {
    const outcome = search(db, q({ kind: 'transfer' }));
    expect(outcome.matchCount).toBe(1);
    expect(outcome.expenseMinor).toBe(0);
    expect(outcome.incomeMinor).toBe(0);
  });
});

describe('totals', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
  });

  it('sums only the matches', () => {
    const outcome = search(db, q({ categoryId: 'food' }));
    expect(outcome.matchCount).toBe(3);
    expect(outcome.expenseMinor).toBe(-(25_000 + 3_500 + 12_000));
    expect(outcome.incomeMinor).toBe(0);
  });

  /**
   * The reason the totals are a separate aggregate rather than a sum over the
   * rows array. Capping the LIST must never change the NUMBER at the top —
   * a total that quietly means "the first 300 of them" is worse than no total.
   */
  it('is computed over every match, not over the capped list', () => {
    const outcome = search(db, q({ categoryId: 'food' }), { limit: 1 });
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.truncated).toBe(true);
    expect(outcome.matchCount).toBe(3);
    expect(outcome.expenseMinor).toBe(-(25_000 + 3_500 + 12_000));
  });

  it('is not marked truncated when everything fits', () => {
    expect(search(db, q({ categoryId: 'food' })).truncated).toBe(false);
  });

  it('sums the home-currency amount of a foreign record', () => {
    createRecord(db, {
      id: 'kindle',
      accountId: 'usd',
      categoryId: 'food',
      type: 'expense',
      amountMinor: 2_500, // $25
      currency: 'USD',
      fxRate: 50,
      homeCurrency: 'EGP',
      note: 'kindle',
      occurredAt: on(2026, 6, 14),
    });

    const outcome = search(db, q({ text: 'kindle' }));
    expect(outcome.rows[0].amountMinor).toBe(-2_500);
    expect(outcome.rows[0].currency).toBe('USD');
    // $25 at 50 is E£1,250 — the stored conversion, not the raw 2,500.
    expect(outcome.expenseMinor).toBe(-125_000);
    expect(outcome.unvaluedCount).toBe(0);
  });

  /**
   * Under-reporting in silence is the thing to avoid. A record converted to
   * pounds has no meaning in a dollar total, so it is counted rather than
   * summed in as if its number stood for something it does not.
   */
  it('excludes and counts a record with no value in the home currency', () => {
    createRecord(db, {
      id: 'kindle',
      accountId: 'usd',
      categoryId: 'food',
      type: 'expense',
      amountMinor: 2_500,
      currency: 'USD',
      fxRate: 50,
      homeCurrency: 'EGP',
      occurredAt: on(2026, 6, 14),
    });

    const outcome = search(db, q({ categoryId: 'food' }), { homeCurrency: 'USD' });
    expect(outcome.matchCount).toBe(4);
    // All four are listed, and all four were converted for EGP, not USD.
    expect(outcome.unvaluedCount).toBe(4);
    expect(outcome.expenseMinor).toBe(0);
  });
});

describe('ordering and limits', () => {
  it('returns the newest match first', () => {
    const db = seed();
    expect(search(db, q({ kind: 'expense' })).rows.map((r) => r.id)).toEqual([
      'lunch',
      'crisps',
      'taxi',
      'old',
    ]);
  });

  it('keeps the newest matches when it truncates', () => {
    // Cutting from the wrong end would hide exactly the records someone is
    // most likely to be looking for.
    const db = seed();
    expect(search(db, q({ kind: 'expense' }), { limit: 2 }).rows.map((r) => r.id)).toEqual([
      'lunch',
      'crisps',
    ]);
  });
});
