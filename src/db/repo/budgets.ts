import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { roundUpSuggestion } from '../../lib/budget';
import { decimalsFor } from '../../lib/money';
import { addMonths, periodBounds, type Period } from '../../lib/period';
import { newId } from '../../lib/id';
import * as schema from '../schema';
import { budgets, categories, transactions } from '../schema';
import { InvariantError } from './categories';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/**
 * BUDGETS SIT ON TOP-LEVEL EXPENSE CATEGORIES ONLY.
 *
 * The alternative — a limit on any category at any depth — needs a rule for
 * what happens when a parent and its child both have one, and every version of
 * that rule is invisible until it surprises someone. Restricting to the top
 * level makes "a parent's spending includes its children" the whole story, so
 * a record can never be counted twice and the total is always the sum of the
 * rows above it.
 *
 * Income is excluded for a plainer reason: a limit on money coming in is not a
 * budget, it is a target, and it would need the opposite of every colour.
 */
export function assertBudgetable(db: Db, categoryId: string): schema.Category {
  const category = db.select().from(categories).where(eq(categories.id, categoryId)).get();

  if (!category) {
    throw new InvariantError(`Category "${categoryId}" does not exist.`);
  }
  if (category.parentId) {
    throw new InvariantError(
      `Budgets are set on top-level categories — "${category.name}" is a sub-category, and its spending already counts towards its parent.`
    );
  }
  if (category.kind !== 'expense') {
    throw new InvariantError(`"${category.name}" is income, and income has no budget.`);
  }
  return category;
}

export type BudgetRow = {
  categoryId: string;
  categoryName: string;
  categoryIcon: string | null;
  categoryColor: string | null;
  /** 0 when nothing is budgeted for this category this month. */
  budgetMinor: number;
  /** Unsigned magnitude of what was spent, INCLUDING sub-categories. */
  spentMinor: number;
  /**
   * True when the limit was set while a different home currency was in force,
   * so the number no longer means what it says.
   */
  stale: boolean;
};

export type BudgetSummary = {
  /** Categories with a limit this month, in category order. */
  budgeted: BudgetRow[];
  /** Everything else, so "what am I not watching" is answerable. */
  unbudgeted: BudgetRow[];
  totalBudgetMinor: number;
  totalSpentMinor: number;
  /** Spending that cannot be budgeted because the record has no category. */
  uncategorisedMinor: number;
  /** Records with no value in today's home currency, excluded from the spend. */
  unvaluedCount: number;
  /** Limits set in another home currency, excluded from the total. */
  staleCount: number;
};

/**
 * Spend per TOP-LEVEL category for one month, in the home currency.
 *
 * The roll-up is the reason this is not a plain GROUP BY category_id: a record
 * filed under "Coffee" has to land on "Food", or a parent budget would report
 * zero while the money was plainly gone. `COALESCE(parent_id, id)` does it in
 * one pass, and since categories are only two levels deep there is no recursion
 * to get wrong.
 */
function spendByTopCategory(
  db: Db,
  period: Period,
  homeCurrency: string
): { byCategory: Map<string, number>; uncategorised: number; unvalued: number } {
  const { start, end } = periodBounds(period);
  const home = sql`${homeCurrency.toUpperCase()}`;

  // NULL when the record has no value in today's home currency, so it falls out
  // of SUM rather than being added as if its number meant something it does not.
  const valued = sql<number>`case when upper(coalesce(${transactions.homeCurrency}, ${transactions.currency})) = ${home}
      then coalesce(${transactions.homeAmountMinor}, ${transactions.amountMinor}) else null end`;

  const rows = db
    .select({
      topId: sql<string | null>`coalesce(${categories.parentId}, ${categories.id})`,
      spent: sql<number>`coalesce(sum(${valued}), 0)`,
      unvalued: sql<number>`coalesce(sum(case when ${valued} is null then 1 else 0 end), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        gte(transactions.occurredAt, start),
        lt(transactions.occurredAt, end),
        // Transfers are neither spending nor income — counting them would make
        // moving money between your own accounts look like blowing a budget.
        isNull(transactions.transferPairId),
        lt(transactions.amountMinor, 0)
      )
    )
    .groupBy(sql`coalesce(${categories.parentId}, ${categories.id})`)
    .all();

  const byCategory = new Map<string, number>();
  let uncategorised = 0;
  let unvalued = 0;

  for (const row of rows) {
    unvalued += Number(row.unvalued ?? 0);
    const spent = Math.abs(Number(row.spent ?? 0));
    // A record with no category cannot be budgeted, but it is still money out.
    // Dropping it silently would leave the totals here disagreeing with the
    // month total on the records screen, with nothing on either screen saying why.
    if (row.topId === null) uncategorised += spent;
    else byCategory.set(row.topId, spent);
  }

  return { byCategory, uncategorised, unvalued };
}

export function listBudgets(
  db: Db,
  period: Period,
  homeCurrency = 'EGP'
): BudgetSummary {
  const tops = db
    .select()
    .from(categories)
    .where(and(isNull(categories.parentId), eq(categories.kind, 'expense')))
    .orderBy(categories.sortOrder, categories.name)
    .all();

  const limits = new Map(
    db
      .select()
      .from(budgets)
      .where(eq(budgets.period, period))
      .all()
      .map((b) => [b.categoryId, b])
  );

  const { byCategory, uncategorised, unvalued } = spendByTopCategory(db, period, homeCurrency);

  const budgeted: BudgetRow[] = [];
  const unbudgeted: BudgetRow[] = [];
  let totalBudgetMinor = 0;
  let totalSpentMinor = 0;
  let staleCount = 0;

  for (const category of tops) {
    const limit = limits.get(category.id);
    const stale = !!limit && limit.currency.toUpperCase() !== homeCurrency.toUpperCase();
    const spentMinor = byCategory.get(category.id) ?? 0;

    const row: BudgetRow = {
      categoryId: category.id,
      categoryName: category.name,
      categoryIcon: category.icon,
      categoryColor: category.color,
      budgetMinor: limit && !stale ? limit.amountMinor : 0,
      spentMinor,
      stale,
    };

    if (limit) {
      budgeted.push(row);
      if (stale) staleCount++;
      else totalBudgetMinor += limit.amountMinor;
      // Spend counts towards the total only for categories being watched.
      // Adding every category's spend would make "TOTAL SPENT" the month's
      // whole expense figure, which the records screen already shows and which
      // says nothing about how the budget is doing.
      totalSpentMinor += spentMinor;
    } else {
      unbudgeted.push(row);
    }
  }

  return {
    budgeted,
    unbudgeted,
    totalBudgetMinor,
    totalSpentMinor,
    uncategorisedMinor: uncategorised,
    unvaluedCount: unvalued,
    staleCount,
  };
}

/**
 * Set or replace one limit.
 *
 * An amount of zero REMOVES the limit rather than storing it. A zero budget and
 * no budget look identical on screen and mean the same thing to a person, so
 * storing the difference would only give the two rows different sections.
 */
export function setBudget(
  db: Db,
  categoryId: string,
  period: Period,
  amountMinor: number,
  currency = 'EGP'
): void {
  assertBudgetable(db, categoryId);

  if (!Number.isInteger(amountMinor)) {
    throw new InvariantError('A budget must be an integer number of minor units.');
  }
  if (amountMinor < 0) {
    throw new InvariantError('A budget cannot be negative.');
  }
  if (amountMinor === 0) {
    clearBudget(db, categoryId, period);
    return;
  }

  // The unique index on (category_id, period) is what makes this an upsert
  // rather than a de-duplication problem — and it is why "copy last month" is
  // safe to run twice.
  db.insert(budgets)
    .values({
      id: newId(),
      categoryId,
      period,
      amountMinor,
      currency: currency.toUpperCase(),
    })
    .onConflictDoUpdate({
      target: [budgets.categoryId, budgets.period],
      set: {
        amountMinor,
        currency: currency.toUpperCase(),
        updatedAt: new Date(),
      },
    })
    .run();
}

export function clearBudget(db: Db, categoryId: string, period: Period): void {
  db.delete(budgets)
    .where(and(eq(budgets.categoryId, categoryId), eq(budgets.period, period)))
    .run();
}

/**
 * Copy every limit from one month to another, returning how many landed.
 *
 * Existing limits in the destination are OVERWRITTEN. "Copy last month" is a
 * thing you reach for to start a month, and a copy that skipped the rows you
 * had already touched would silently give you a mix of two months with nothing
 * saying which was which.
 */
export function copyBudgets(db: Db, from: Period, to: Period, homeCurrency = 'EGP'): number {
  if (from === to) return 0;

  const source = db.select().from(budgets).where(eq(budgets.period, from)).all();
  let copied = 0;

  db.transaction((tx) => {
    for (const limit of source) {
      // A limit whose category has since been deleted or demoted to a
      // sub-category cannot be honoured. Skipping is right; throwing would make
      // one stale row block the whole copy.
      try {
        assertBudgetable(tx as Db, limit.categoryId);
      } catch {
        continue;
      }
      setBudget(tx as Db, limit.categoryId, to, limit.amountMinor, limit.currency || homeCurrency);
      copied++;
    }
  });

  return copied;
}

export type Suggestion = {
  categoryId: string;
  categoryName: string;
  categoryIcon: string | null;
  categoryColor: string | null;
  /** Rounded up to something a person would write down. */
  amountMinor: number;
  /** The unrounded average, so the screen can be honest about where it came from. */
  averageMinor: number;
};

export type SuggestionSet = {
  suggestions: Suggestion[];
  /**
   * How many of the months looked at actually contained any spending.
   *
   * The screen says this out loud. A suggestion built from one partial month is
   * still worth offering, but it is not the same claim as one built from three
   * full ones, and presenting them identically would be the app overstating
   * what it knows.
   */
  monthsWithData: number;
  /**
   * Where the numbers came from, because the sentence above them has to change
   * with it.
   *
   * `current-month` is the case that matters. A ledger a few weeks old has no
   * complete month to average, and the first version of this returned nothing
   * for exactly that user — the one with thirty-eight records who has never set
   * a budget, which is the entire audience for the feature. Falling back to
   * what has been spent so far is a starting point rather than an average, and
   * it is labelled as one.
   *
   * Deliberately NOT extrapolated to a full month. Rent logged on the 2nd would
   * be multiplied by fifteen, and a confidently wrong number is worse than a
   * modest one the user can raise.
   */
  basis: 'past-months' | 'current-month' | 'none';
};

/**
 * Suggest a limit per category from what was actually spent recently.
 *
 * This is the answer to "I have never set a budget and do not know what number
 * to write". MyMoney's only affordance is "copy from past months", which is
 * useless on the first month — there is nothing to copy — so it opens on a
 * blank screen asking for nineteen numbers you have no basis for.
 *
 * The average divides by the months that CONTAIN spending, not by `months`. A
 * ledger three weeks old would otherwise have every suggestion divided by three
 * and come out a third of what the person actually spends, which is worse than
 * no suggestion because it looks authoritative.
 */
export function suggestBudgets(
  db: Db,
  period: Period,
  { months = 3, homeCurrency = 'EGP' }: { months?: number; homeCurrency?: string } = {}
): SuggestionSet {
  const totals = new Map<string, number>();
  let monthsWithData = 0;

  for (let i = 1; i <= months; i++) {
    const past = addMonths(period, -i);
    const { byCategory } = spendByTopCategory(db, past, homeCurrency);
    if (byCategory.size === 0) continue;

    monthsWithData++;
    for (const [categoryId, spent] of byCategory) {
      totals.set(categoryId, (totals.get(categoryId) ?? 0) + spent);
    }
  }

  let basis: SuggestionSet['basis'] = 'past-months';

  if (monthsWithData === 0) {
    // No complete month to average. Fall back to the month being budgeted, so
    // someone three weeks into using the app gets a starting point instead of
    // being told to come back later — they are the whole audience for this.
    const { byCategory } = spendByTopCategory(db, period, homeCurrency);
    if (byCategory.size === 0) return { suggestions: [], monthsWithData: 0, basis: 'none' };

    basis = 'current-month';
    monthsWithData = 1;
    for (const [categoryId, spent] of byCategory) totals.set(categoryId, spent);
  }

  const tops = db
    .select()
    .from(categories)
    .where(and(isNull(categories.parentId), eq(categories.kind, 'expense')))
    .orderBy(categories.sortOrder, categories.name)
    .all();

  const decimals = decimalsFor(homeCurrency);
  const suggestions: Suggestion[] = [];

  for (const category of tops) {
    const total = totals.get(category.id);
    // A category you have never spent in does not need a limit. Offering one
    // for all nineteen is the blank screen again, only pre-filled with zeroes.
    if (!total) continue;

    const averageMinor = Math.round(total / monthsWithData);
    suggestions.push({
      categoryId: category.id,
      categoryName: category.name,
      categoryIcon: category.icon,
      categoryColor: category.color,
      amountMinor: roundUpSuggestion(averageMinor, decimals),
      averageMinor,
    });
  }

  return { suggestions, monthsWithData, basis };
}

/** Apply a set of suggestions as this month's budget. */
export function applySuggestions(
  db: Db,
  period: Period,
  suggestions: Suggestion[],
  homeCurrency = 'EGP'
): number {
  let applied = 0;
  db.transaction((tx) => {
    for (const suggestion of suggestions) {
      if (suggestion.amountMinor <= 0) continue;
      setBudget(tx as Db, suggestion.categoryId, period, suggestion.amountMinor, homeCurrency);
      applied++;
    }
  });
  return applied;
}

/** The most recent month at or before `before` that has any limits set. */
export function latestBudgetedPeriod(db: Db, before: Period): Period | null {
  const row = db
    .select({ period: budgets.period })
    .from(budgets)
    .where(lt(budgets.period, before))
    .orderBy(sql`${budgets.period} desc`)
    .limit(1)
    .get();

  return row?.period ?? null;
}
