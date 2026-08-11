/**
 * @jest-environment node
 */
import { eq, sql } from 'drizzle-orm';

import { createTestDb, type TestDb } from '../../test/db';
import { budgets, categories } from '../schema';
import { createAccount } from './accounts';
import {
  applySuggestions,
  assertBudgetable,
  clearBudget,
  copyBudgets,
  latestBudgetedPeriod,
  listBudgets,
  setBudget,
  suggestBudgets,
} from './budgets';
import { createCategory, InvariantError } from './categories';
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

  return db;
}

const spend = (
  db: TestDb,
  id: string,
  categoryId: string | null,
  amountMinor: number,
  when: Date
) =>
  createRecord(db, {
    id,
    accountId: 'bank',
    categoryId,
    type: 'expense',
    amountMinor,
    occurredAt: when,
  });

describe('what can carry a budget', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
  });

  it('accepts a top-level expense category', () => {
    expect(assertBudgetable(db, 'food').name).toBe('Food');
  });

  /**
   * The restriction is what makes "a parent's spending includes its children"
   * the whole story. Allowing both would need a rule for which one a record
   * counts against, and every version of that rule is invisible until it
   * surprises someone.
   */
  it('refuses a sub-category, and says why', () => {
    expect(() => assertBudgetable(db, 'coffee')).toThrow(InvariantError);
    expect(() => assertBudgetable(db, 'coffee')).toThrow(/already counts towards its parent/);
  });

  it('refuses income', () => {
    // A limit on money coming in is a target, not a budget, and would need the
    // opposite of every colour on the screen.
    expect(() => assertBudgetable(db, 'salary')).toThrow(/income has no budget/);
  });

  it('refuses a category that does not exist', () => {
    expect(() => assertBudgetable(db, 'nope')).toThrow(InvariantError);
  });

  it('refuses through setBudget too, not only through the assertion', () => {
    expect(() => setBudget(db, 'coffee', '2026-08', 50_000)).toThrow(InvariantError);
    expect(() => setBudget(db, 'salary', '2026-08', 50_000)).toThrow(InvariantError);
  });

  it('refuses a negative or fractional limit', () => {
    expect(() => setBudget(db, 'food', '2026-08', -1)).toThrow(/cannot be negative/);
    expect(() => setBudget(db, 'food', '2026-08', 100.5)).toThrow(/integer/);
  });
});

describe('spending rolls up to the parent', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
    setBudget(db, 'food', '2026-08', 300_000); // E£3,000
  });

  /**
   * The reason this is not a plain GROUP BY category_id. A record filed under
   * Coffee has to land on Food, or a parent budget reports zero while the money
   * is plainly gone.
   */
  it('counts a sub-category record against its parent', () => {
    spend(db, 'c1', 'coffee', 25_000, on(2026, 8, 3));
    expect(listBudgets(db, '2026-08').budgeted[0].spentMinor).toBe(25_000);
  });

  it('adds the own records of the parent to those of its children', () => {
    spend(db, 'c1', 'coffee', 25_000, on(2026, 8, 3));
    spend(db, 'f1', 'food', 40_000, on(2026, 8, 4));
    expect(listBudgets(db, '2026-08').budgeted[0].spentMinor).toBe(65_000);
  });

  it('reports spending as an unsigned magnitude', () => {
    // The ledger stores -25000. A negative here would run the progress bar
    // backwards and make every percentage negative.
    spend(db, 'c1', 'coffee', 25_000, on(2026, 8, 3));
    expect(listBudgets(db, '2026-08').budgeted[0].spentMinor).toBeGreaterThan(0);
  });

  it('ignores another month', () => {
    spend(db, 'c1', 'coffee', 25_000, on(2026, 7, 31));
    spend(db, 'c2', 'coffee', 10_000, on(2026, 9, 1));
    expect(listBudgets(db, '2026-08').budgeted[0].spentMinor).toBe(0);
  });

  it('ignores income filed against no budget of its own', () => {
    createRecord(db, {
      id: 'i1',
      accountId: 'bank',
      categoryId: 'salary',
      type: 'income',
      amountMinor: 900_000,
      occurredAt: on(2026, 8, 1),
    });
    expect(listBudgets(db, '2026-08').totalSpentMinor).toBe(0);
  });

  /**
   * Moving money between your own accounts is not spending. Counting it would
   * make a transfer to savings look like blowing a budget.
   */
  it('ignores transfers', () => {
    createAccount(db, { id: 'cash', name: 'Cash', currency: 'EGP' });
    createTransfer(db, {
      fromAccountId: 'bank',
      toAccountId: 'cash',
      amountMinor: 500_000,
      occurredAt: on(2026, 8, 6),
    });

    const summary = listBudgets(db, '2026-08');
    expect(summary.totalSpentMinor).toBe(0);
    // `uncategorisedMinor` is the assertion that bites. A transfer has no
    // category, so dropping the transfer filter leaves it out of every
    // category's spend and out of the total — while quietly reporting E£5,000
    // of "uncategorised spending" on the screen. The total alone is 0 either
    // way, so it proves nothing here.
    expect(summary.uncategorisedMinor).toBe(0);
  });
});

describe('the summary', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
  });

  it('splits budgeted from unbudgeted', () => {
    setBudget(db, 'food', '2026-08', 300_000);
    const summary = listBudgets(db, '2026-08');
    expect(summary.budgeted.map((r) => r.categoryId)).toEqual(['food']);
    expect(summary.unbudgeted.map((r) => r.categoryId)).toEqual(['transport']);
  });

  it('shows what an unbudgeted category is costing', () => {
    // "What am I not watching" is the question the second section answers, and
    // it cannot be answered by a list of names alone.
    spend(db, 't1', 'transport', 8_000, on(2026, 8, 2));
    const row = listBudgets(db, '2026-08').unbudgeted.find((r) => r.categoryId === 'transport');
    expect(row?.spentMinor).toBe(8_000);
    expect(row?.budgetMinor).toBe(0);
  });

  /**
   * TOTAL SPENT is spending against the budget, not the month's expenses. If
   * unbudgeted categories were added in, this number would be the figure the
   * records screen already shows and would say nothing about how the budget is
   * doing — it would also make "spent more than budgeted" true on any month
   * with a single unwatched purchase.
   */
  it('totals only the categories being watched', () => {
    setBudget(db, 'food', '2026-08', 300_000);
    spend(db, 'f1', 'food', 25_000, on(2026, 8, 3));
    spend(db, 't1', 'transport', 8_000, on(2026, 8, 2));

    const summary = listBudgets(db, '2026-08');
    expect(summary.totalBudgetMinor).toBe(300_000);
    expect(summary.totalSpentMinor).toBe(25_000);
  });

  /**
   * A record with no category cannot be budgeted, but it is still money out.
   * Dropping it would leave this screen quietly disagreeing with the records
   * screen and nothing on either saying why.
   */
  it('reports uncategorised spending separately', () => {
    spend(db, 'u1', null, 12_000, on(2026, 8, 5));
    const summary = listBudgets(db, '2026-08');
    expect(summary.uncategorisedMinor).toBe(12_000);
    expect(summary.totalSpentMinor).toBe(0);
  });

  it('values a foreign record at its converted amount', () => {
    setBudget(db, 'food', '2026-08', 300_000);
    createRecord(db, {
      id: 'x1',
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
    expect(listBudgets(db, '2026-08').budgeted[0].spentMinor).toBe(125_000);
  });

  it('excludes and counts a record with no value in the home currency', () => {
    setBudget(db, 'food', '2026-08', 300_000, 'USD');
    createRecord(db, {
      id: 'x1',
      accountId: 'usd',
      categoryId: 'food',
      type: 'expense',
      amountMinor: 2_500,
      currency: 'USD',
      fxRate: 50,
      homeCurrency: 'EGP',
      occurredAt: on(2026, 8, 7),
    });

    const summary = listBudgets(db, '2026-08', 'USD');
    expect(summary.unvaluedCount).toBe(1);
    expect(summary.budgeted[0].spentMinor).toBe(0);
  });

  /**
   * A limit of "3000" set when the home currency was pounds does not mean 3000
   * dollars. Counting it into the total would invent a budget nobody set.
   */
  it('sets aside a limit written in another home currency', () => {
    setBudget(db, 'food', '2026-08', 300_000, 'EGP');
    const summary = listBudgets(db, '2026-08', 'USD');
    expect(summary.staleCount).toBe(1);
    expect(summary.totalBudgetMinor).toBe(0);
    expect(summary.budgeted[0].stale).toBe(true);
    expect(summary.budgeted[0].budgetMinor).toBe(0);
  });
});

describe('setting a limit', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
  });

  const count = (db: TestDb) =>
    Number(db.select({ n: sql<number>`count(*)` }).from(budgets).get()?.n ?? 0);

  it('replaces rather than duplicating', () => {
    // The unique index on (category, period) is what makes "copy last month"
    // safe to run twice.
    setBudget(db, 'food', '2026-08', 300_000);
    setBudget(db, 'food', '2026-08', 400_000);
    expect(count(db)).toBe(1);
    expect(listBudgets(db, '2026-08').totalBudgetMinor).toBe(400_000);
  });

  it('keeps months apart', () => {
    setBudget(db, 'food', '2026-08', 300_000);
    setBudget(db, 'food', '2026-09', 350_000);
    expect(listBudgets(db, '2026-08').totalBudgetMinor).toBe(300_000);
    expect(listBudgets(db, '2026-09').totalBudgetMinor).toBe(350_000);
  });

  /**
   * A zero budget and no budget look identical on screen and mean the same
   * thing to a person. Storing the difference would only put the two rows in
   * different sections.
   */
  it('removes the limit when set to zero', () => {
    setBudget(db, 'food', '2026-08', 300_000);
    setBudget(db, 'food', '2026-08', 0);
    expect(count(db)).toBe(0);
    expect(listBudgets(db, '2026-08').budgeted).toEqual([]);
  });

  it('clears explicitly', () => {
    setBudget(db, 'food', '2026-08', 300_000);
    clearBudget(db, 'food', '2026-08');
    expect(listBudgets(db, '2026-08').budgeted).toEqual([]);
  });

  it('goes away with its category', () => {
    // ON DELETE CASCADE. A limit against a category that no longer exists would
    // sit in the total for ever with no row to show it on.
    setBudget(db, 'transport', '2026-08', 80_000);
    db.run(sql`delete from categories where id = 'transport'`);
    expect(count(db)).toBe(0);
  });
});

describe('copying a month', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
    setBudget(db, 'food', '2026-07', 300_000);
    setBudget(db, 'transport', '2026-07', 80_000);
  });

  it('brings every limit forward', () => {
    expect(copyBudgets(db, '2026-07', '2026-08')).toBe(2);
    expect(listBudgets(db, '2026-08').totalBudgetMinor).toBe(380_000);
  });

  it('is safe to run twice', () => {
    copyBudgets(db, '2026-07', '2026-08');
    copyBudgets(db, '2026-07', '2026-08');
    expect(listBudgets(db, '2026-08').budgeted).toHaveLength(2);
  });

  /**
   * A copy that skipped rows already touched would silently leave a mix of two
   * months with nothing saying which figure came from where.
   */
  it('overwrites what is already there', () => {
    setBudget(db, 'food', '2026-08', 999_000);
    copyBudgets(db, '2026-07', '2026-08');
    expect(listBudgets(db, '2026-08').budgeted[0].budgetMinor).toBe(300_000);
  });

  it('refuses to copy a month onto itself', () => {
    expect(copyBudgets(db, '2026-07', '2026-07')).toBe(0);
  });

  it('skips a limit whose category became a sub-category', () => {
    // One unhonourable row must not block the whole copy.
    db.update(categories).set({ parentId: 'food' }).where(eq(categories.id, 'transport')).run();
    expect(copyBudgets(db, '2026-07', '2026-08')).toBe(1);
    expect(listBudgets(db, '2026-08').budgeted.map((r) => r.categoryId)).toEqual(['food']);
  });
});

describe('suggesting limits from what was actually spent', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
  });

  it('has nothing to offer with no history at all', () => {
    const { suggestions, monthsWithData, basis } = suggestBudgets(db, '2026-08');
    expect(suggestions).toEqual([]);
    expect(monthsWithData).toBe(0);
    expect(basis).toBe('none');
  });

  /**
   * THE CASE THE FEATURE EXISTS FOR. Someone three weeks into using the app has
   * dozens of records and no complete month, and the first version of this
   * returned nothing for exactly them — the person who has never set a budget,
   * which is the entire audience.
   */
  it('falls back to the month being budgeted when no earlier month has data', () => {
    spend(db, 'a', 'food', 240_000, on(2026, 8, 3));
    spend(db, 'b', 'transport', 8_000, on(2026, 8, 4));

    const { suggestions, basis } = suggestBudgets(db, '2026-08');
    expect(basis).toBe('current-month');
    expect(suggestions.map((s) => s.categoryId)).toEqual(['food', 'transport']);
    // What was spent, rounded up — NOT extrapolated to a full month. Rent
    // logged on the 2nd would be multiplied by fifteen, and a confidently wrong
    // number is worse than a modest one the user can raise.
    expect(suggestions[0].averageMinor).toBe(240_000);
    expect(suggestions[0].amountMinor).toBe(240_000);
  });

  it('prefers a complete earlier month over the current one', () => {
    spend(db, 'past', 'food', 300_000, on(2026, 7, 4));
    spend(db, 'now', 'food', 999_000, on(2026, 8, 4));

    const { suggestions, basis } = suggestBudgets(db, '2026-08');
    expect(basis).toBe('past-months');
    expect(suggestions[0].averageMinor).toBe(300_000);
  });

  it('averages the months before the one being budgeted', () => {
    spend(db, 'a', 'food', 200_000, on(2026, 5, 4));
    spend(db, 'b', 'food', 300_000, on(2026, 6, 4));
    spend(db, 'c', 'food', 400_000, on(2026, 7, 4));
    // The month being budgeted must not feed its own suggestion.
    spend(db, 'd', 'food', 999_000, on(2026, 8, 4));

    const { suggestions, monthsWithData } = suggestBudgets(db, '2026-08');
    expect(monthsWithData).toBe(3);
    expect(suggestions[0].averageMinor).toBe(300_000);
  });

  /**
   * The trap this function exists to avoid. A ledger three weeks old would
   * otherwise have every suggestion divided by three and come out at a third of
   * what the person actually spends — worse than no suggestion, because it
   * looks authoritative.
   */
  it('divides by the months that have data, not by the window', () => {
    spend(db, 'a', 'food', 300_000, on(2026, 7, 4));
    const { suggestions, monthsWithData } = suggestBudgets(db, '2026-08');
    expect(monthsWithData).toBe(1);
    expect(suggestions[0].averageMinor).toBe(300_000);
  });

  it('rolls sub-category spending into the parent it would be budgeted on', () => {
    spend(db, 'a', 'coffee', 120_000, on(2026, 7, 4));
    expect(suggestBudgets(db, '2026-08').suggestions[0].categoryId).toBe('food');
  });

  it('rounds the offer up to a number a person would write down', () => {
    spend(db, 'a', 'food', 284_700, on(2026, 7, 4));
    const suggestion = suggestBudgets(db, '2026-08').suggestions[0];
    expect(suggestion.averageMinor).toBe(284_700);
    expect(suggestion.amountMinor).toBe(285_000);
  });

  it('offers nothing for a category never spent in', () => {
    // Nineteen rows of zero is the blank screen again, only pre-filled.
    spend(db, 'a', 'food', 100_000, on(2026, 7, 4));
    expect(suggestBudgets(db, '2026-08').suggestions.map((s) => s.categoryId)).toEqual(['food']);
  });

  it('ignores transfers and income, as the spend query does', () => {
    createRecord(db, {
      id: 'i1',
      accountId: 'bank',
      categoryId: 'salary',
      type: 'income',
      amountMinor: 900_000,
      occurredAt: on(2026, 7, 1),
    });
    expect(suggestBudgets(db, '2026-08').suggestions).toEqual([]);
  });

  it('applies as a real budget', () => {
    spend(db, 'a', 'food', 284_700, on(2026, 7, 4));
    spend(db, 'b', 'transport', 40_000, on(2026, 7, 5));

    const { suggestions } = suggestBudgets(db, '2026-08');
    expect(applySuggestions(db, '2026-08', suggestions)).toBe(2);

    const summary = listBudgets(db, '2026-08');
    expect(summary.budgeted.map((r) => r.budgetMinor)).toEqual([285_000, 40_000]);
  });
});

describe('latestBudgetedPeriod', () => {
  it('is null before anything is budgeted', () => {
    expect(latestBudgetedPeriod(seed(), '2026-08')).toBeNull();
  });

  it('finds the most recent earlier month', () => {
    const db = seed();
    setBudget(db, 'food', '2026-05', 100_000);
    setBudget(db, 'food', '2026-07', 200_000);
    expect(latestBudgetedPeriod(db, '2026-08')).toBe('2026-07');
  });

  it('does not offer the month being viewed, or a later one', () => {
    // "Copy from last month" pointing at the month you are already on is a
    // button that does nothing.
    const db = seed();
    setBudget(db, 'food', '2026-08', 100_000);
    setBudget(db, 'food', '2026-09', 200_000);
    expect(latestBudgetedPeriod(db, '2026-08')).toBeNull();
  });

  it('sorts by period as text, which is why the format is YYYY-MM', () => {
    // '2026-09' < '2026-10' as strings only because the month is zero-padded.
    const db = seed();
    setBudget(db, 'food', '2026-09', 100_000);
    setBudget(db, 'food', '2026-10', 200_000);
    expect(latestBudgetedPeriod(db, '2026-11')).toBe('2026-10');
  });
});
