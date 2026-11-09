import { and, eq, gte, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { periodBounds, type Period } from '../../lib/period';
import { movesPosition, onExpenseSide, onIncomeSide } from './predicates';
import * as schema from '../schema';
import { categories, transactionTags, transactions } from '../schema';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export type CategoryKind = 'expense' | 'income';

export type TopCategoryTotals = {
  /** Category id -> UNSIGNED magnitude in the home currency's minor units. */
  byCategory: Map<string, number>;
  /** Money with no category, which no category screen can account for. */
  uncategorised: number;
  /** Rows with no value in today's home currency, excluded from the totals. */
  unvalued: number;
};

/**
 * One month of money in or out, rolled up to TOP-LEVEL categories.
 *
 * Shared by the budgets and analysis screens deliberately. Both need the same
 * four rules — roll a sub-category up to its parent, exclude transfers, value
 * everything in today's home currency, and keep what cannot be valued separate
 * — and two hand-kept copies of a money query is exactly how one screen ends up
 * quietly disagreeing with another.
 *
 * The roll-up is why this is not a plain GROUP BY category_id: a record filed
 * under "Coffee" has to land on "Food", or a parent reports zero while the
 * money is plainly gone. `COALESCE(parent_id, id)` does it in one pass, and
 * since categories are only ever two levels deep there is no recursion to get
 * wrong.
 */
export function totalsByTopCategory(
  db: Db,
  period: Period,
  kind: CategoryKind,
  homeCurrency = 'EGP',
  /**
   * Narrow to records carrying this tag.
   *
   * WHAT MAKES A TAG SAFE ON THIS SCREEN. Tags overlap and most records carry
   * none, so a ring OF tags cannot sum to 100 — but a ring of CATEGORIES
   * within a tag can, because categories are still exclusive inside any subset
   * of the ledger. Filtering rather than re-slicing is what keeps the chart
   * and its legend honest.
   */
  tagId: string | null = null
): TopCategoryTotals {
  const rows = sideTotals(
    db,
    period,
    kind,
    homeCurrency,
    tagId,
    sql<string | null>`coalesce(${categories.parentId}, ${categories.id})`
  );

  const byCategory = new Map<string, number>();
  let uncategorised = 0;
  let unvalued = 0;

  for (const row of rows) {
    unvalued += Number(row.unvalued ?? 0);
    const total = Math.abs(Number(row.total ?? 0));
    // A record with no category is still money moved. Dropping it silently
    // would leave these screens disagreeing with the records list, with nothing
    // on either saying why.
    if (row.topId === null) uncategorised += total;
    else byCategory.set(row.topId, total);
  }

  return { byCategory, uncategorised, unvalued };
}

/**
 * One month of money in or out per category EXACTLY as filed — no roll-up —
 * SIGNED in the direction of `kind`: positive is money spent (or earned),
 * negative is money that came back.
 *
 * Analysis needs both halves of what `totalsByTopCategory` throws away. The
 * sub-category, to break a parent down; and the SIGN, because a month in which
 * "Groceries" holds nothing but the refund for last month's shop nets as money
 * returned. Made positive, that refund would be drawn as spending, and the
 * sub-categories would add up to more than the parent they sit under.
 */
export function totalsByCategory(
  db: Db,
  period: Period,
  kind: CategoryKind,
  homeCurrency = 'EGP',
  tagId: string | null = null
): {
  byCategory: Map<string, number>;
  uncategorised: number;
  unvalued: number;
} {
  const rows = sideTotals(db, period, kind, homeCurrency, tagId, transactions.categoryId);
  // Stored amounts are negative for spending, so expense flips to read as "spent".
  const direction = kind === 'expense' ? -1 : 1;

  const byCategory = new Map<string, number>();
  let uncategorised = 0;
  let unvalued = 0;

  for (const row of rows) {
    unvalued += Number(row.unvalued ?? 0);
    // `+ 0` folds the -0 that negating an empty sum produces.
    const total = direction * Number(row.total ?? 0) + 0;
    // Kept as `totalsByTopCategory` reports it, so the footnote under the ring
    // says the same thing it always has.
    if (row.topId === null) uncategorised += Math.abs(total);
    else if (total !== 0) byCategory.set(row.topId, total);
  }

  return { byCategory, uncategorised, unvalued };
}

/**
 * The query both of the above are made of: valued sums on one side of the
 * ledger, transfers excluded, optionally within a tag, grouped by `group`.
 */
function sideTotals(
  db: Db,
  period: Period,
  kind: CategoryKind,
  homeCurrency: string,
  tagId: string | null,
  group: SQL<string | null> | typeof transactions.categoryId
) {
  const valued = valuedIn(homeCurrency);
  return db
    .select({
      topId: group,
      total: sql<number>`coalesce(sum(${valued}), 0)`,
      unvalued: sql<number>`coalesce(sum(case when ${valued} is null then 1 else 0 end), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(sideOf(period, kind, tagId))
    .groupBy(group)
    .all();
}

/**
 * Every valued row on one side of one month, with WHEN it happened — what the
 * Pace and Weekdays slides are drawn from.
 *
 * The same `where` as the totals above, deliberately: these slides sit beside
 * the ring, and a day-by-day line that summed to a different figure from the
 * one in the ring's hole would be the screen disagreeing with itself.
 * Amounts are SIGNED in the direction of `kind`, like `totalsByCategory`, so a
 * refund pulls its day down instead of adding to it. Rows with no value in the
 * home currency are left out, as they are from every total.
 */
export function sideAmounts(
  db: Db,
  period: Period,
  kind: CategoryKind,
  homeCurrency = 'EGP',
  tagId: string | null = null
): { at: Date; amountMinor: number }[] {
  const valued = valuedIn(homeCurrency);
  const direction = kind === 'expense' ? -1 : 1;
  return db
    .select({ at: transactions.occurredAt, amount: valued })
    .from(transactions)
    .where(and(sideOf(period, kind, tagId), sql`${valued} is not null`))
    .all()
    .map((row) => ({
      at: row.at,
      amountMinor: direction * Number(row.amount) + 0,
    }));
}

/**
 * A row's amount in the home currency, or NULL when it has no value in it, so
 * it drops out of SUM rather than being added as though its number meant
 * something it does not. Changing the home currency is what puts rows in that
 * state.
 */
function valuedIn(homeCurrency: string): SQL<number> {
  const home = sql`${homeCurrency.toUpperCase()}`;
  return sql<number>`case when upper(coalesce(${transactions.homeCurrency}, ${transactions.currency})) = ${home}
      then coalesce(${transactions.homeAmountMinor}, ${transactions.amountMinor}) else null end`;
}

/** One month, one side of the ledger, transfers excluded, optionally one tag. */
function sideOf(period: Period, kind: CategoryKind, tagId: string | null): SQL | undefined {
  const { start, end } = periodBounds(period);
  // By SIDE, not by sign: a refund is positive but belongs to expense, so it
  // nets against the category it reverses instead of inflating income.
  const direction = kind === 'expense' ? onExpenseSide() : onIncomeSide();
  return and(
    gte(transactions.occurredAt, start),
    lt(transactions.occurredAt, end),
    // `direction` already excludes adjustments; this drops transfer legs.
    movesPosition(),
    direction,
    // EXISTS rather than a join: a record can carry several tags, and
    // joining would count it once per tag and inflate the very total this
    // screen exists to state.
    tagId
      ? sql`exists (select 1 from ${transactionTags}
            where ${transactionTags.transactionId} = ${transactions.id}
              and ${transactionTags.tagId} = ${tagId})`
      : undefined
  );
}

/** Every category of one kind, archived ones included, in the order the app shows them. */
export function categoriesOfKind(db: Db, kind: CategoryKind): schema.Category[] {
  return db
    .select()
    .from(categories)
    .where(eq(categories.kind, kind))
    .orderBy(categories.sortOrder, categories.name)
    .all();
}

/** Top-level categories of one kind, in the order the app shows them. */
export function topLevelCategories(db: Db, kind: CategoryKind): schema.Category[] {
  return db
    .select()
    .from(categories)
    .where(and(isNull(categories.parentId), eq(categories.kind, kind)))
    .orderBy(categories.sortOrder, categories.name)
    .all();
}
