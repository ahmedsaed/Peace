import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { periodBounds, type Period } from '../../lib/period';
import { countsAsSpending } from './predicates';
import * as schema from '../schema';
import { categories, transactions } from '../schema';

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
  homeCurrency = 'EGP'
): TopCategoryTotals {
  const { start, end } = periodBounds(period);
  const home = sql`${homeCurrency.toUpperCase()}`;

  // NULL when the row has no value in today's home currency, so it drops out of
  // SUM rather than being added as though its number meant something it does
  // not. Changing the home currency is what puts rows in this state.
  const valued = sql<number>`case when upper(coalesce(${transactions.homeCurrency}, ${transactions.currency})) = ${home}
      then coalesce(${transactions.homeAmountMinor}, ${transactions.amountMinor}) else null end`;

  const direction =
    kind === 'expense'
      ? sql`${transactions.amountMinor} < 0`
      : sql`${transactions.amountMinor} > 0`;

  const rows = db
    .select({
      topId: sql<string | null>`coalesce(${categories.parentId}, ${categories.id})`,
      total: sql<number>`coalesce(sum(${valued}), 0)`,
      unvalued: sql<number>`coalesce(sum(case when ${valued} is null then 1 else 0 end), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        gte(transactions.occurredAt, start),
        lt(transactions.occurredAt, end),
        // Neither a transfer leg nor a balance correction is spending: one
        // would make moving money between your own accounts look like a
        // month's expenditure, the other would drop phantom spending into
        // whichever month you reconciled in. One definition, in predicates.ts.
        countsAsSpending(),
        direction
      )
    )
    .groupBy(sql`coalesce(${categories.parentId}, ${categories.id})`)
    .all();

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

/** Top-level categories of one kind, in the order the app shows them. */
export function topLevelCategories(db: Db, kind: CategoryKind): schema.Category[] {
  return db
    .select()
    .from(categories)
    .where(and(isNull(categories.parentId), eq(categories.kind, kind)))
    .orderBy(categories.sortOrder, categories.name)
    .all();
}
