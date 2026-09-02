import {
  and,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm';
import { alias, type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import {
  amountBoundsMinor,
  likePattern,
  rangeBounds,
  type SearchQuery,
} from '../../lib/search-query';
import * as schema from '../schema';
import { accounts, categories, transactions } from '../schema';
import { countsAsSpending, onExpenseSide, onIncomeSide } from './predicates';
import { attachmentCount, homeValue, type RecordRow } from './records';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/**
 * How many rows the list will hold.
 *
 * A one-letter search matches most of the ledger, and building ten thousand row
 * objects on a keystroke is felt long before the list is scrolled that far. The
 * totals are computed by a SEPARATE aggregate over every match, so capping the
 * list never changes the number at the top — which is the one thing a cap must
 * not do.
 */
export const SEARCH_LIMIT = 300;

export type SearchOutcome = {
  rows: RecordRow[];
  /** Every match, not just the ones in `rows`. */
  matchCount: number;
  /** True when `rows` is a prefix of the matches rather than all of them. */
  truncated: boolean;
  expenseMinor: number;
  incomeMinor: number;
  /** Matches with no value in today's home currency, excluded from the totals. */
  unvaluedCount: number;
};

const EMPTY: SearchOutcome = {
  rows: [],
  matchCount: 0,
  truncated: false,
  expenseMinor: 0,
  incomeMinor: 0,
  unvaluedCount: 0,
};

/**
 * Every condition the query implies, as one AND.
 *
 * Built once and used by both the row query and the aggregate, because two
 * hand-kept copies of a filter is how a screen ends up showing twelve rows
 * under a total computed from fourteen.
 */
function conditions(
  query: SearchQuery,
  counter: ReturnType<typeof alias<typeof accounts, 'counter_account'>>,
  homeCurrency: string,
  now: Date
): SQL[] {
  const where: SQL[] = [
    // TRANSFERS APPEAR ONCE. Both legs are in the table; the outgoing
    // (negative) one is the leg the records list shows, and search has to agree
    // with it or the same transfer reads as two.
    or(isNull(transactions.transferPairId), lt(transactions.amountMinor, 0))!,
  ];

  const text = query.text.trim();
  if (text !== '') {
    const pattern = likePattern(text);
    // ESCAPE pairs with the escaping in `likePattern`. Without it a note
    // containing "%" would match every record while looking like a normal
    // search that found odd results.
    const like = (column: SQLWrapper) => sql`${column} like ${pattern} escape '\\'`;

    where.push(
      or(
        like(sql`coalesce(${transactions.note}, '')`),
        like(sql`coalesce(${categories.name}, '')`),
        like(accounts.name),
        like(sql`coalesce(${counter.name}, '')`)
      )!
    );
  }

  switch (query.kind) {
    case 'expense':
      where.push(isNull(transactions.transferPairId), onExpenseSide());
      break;
    case 'income':
      where.push(isNull(transactions.transferPairId), onIncomeSide());
      break;
    case 'transfer':
      where.push(isNotNull(transactions.transferPairId));
      break;
    case null:
      break;
  }

  if (query.accountId) {
    where.push(eq(transactions.accountId, query.accountId));
  }

  // WHERE A TRANSFER LANDED. Only the outgoing leg is listed, and on that leg
  // `counter_account_id` is the destination — so this is the only way to ask
  // for money that arrived somewhere. Every non-transfer row has NULL here, so
  // it narrows to transfers on its own; the type chip is a convenience, not the
  // thing making this correct.
  if (query.counterAccountId) {
    where.push(eq(transactions.counterAccountId, query.counterAccountId));
  }

  if (query.categoryId) {
    // A PARENT MATCHES ITS CHILDREN. Categories are two-tier, and picking
    // "Food" to then be told there were no records — because every one of them
    // is filed under "Groceries" or "Snacks" — is the filter lying about the
    // data. One level is all the schema allows, so no recursion is needed.
    where.push(
      sql`${transactions.categoryId} in (
        select ${categories.id} from ${categories}
        where ${categories.id} = ${query.categoryId} or ${categories.parentId} = ${query.categoryId}
      )`
    );
  }

  // Bounds are unsigned magnitudes, matched against abs() — the user is reading
  // "E£250" off the list, not "-250". See amountBoundsMinor.
  const { min, max } = amountBoundsMinor(query, homeCurrency);
  if (min !== null) where.push(sql`abs(${transactions.amountMinor}) >= ${min}`);
  if (max !== null) where.push(sql`abs(${transactions.amountMinor}) <= ${max}`);

  const range = rangeBounds(query.range, now);
  if (range) {
    where.push(gte(transactions.occurredAt, range.start), lt(transactions.occurredAt, range.end));
  }

  return where;
}

/**
 * Search the whole ledger.
 *
 * Deliberately not scoped to a month: the reason to reach for search is that
 * you do not remember WHEN. The month navigator is already the answer when you
 * do.
 *
 * Callers must check `isRunnable` first — an empty query returns an empty
 * outcome here rather than the entire ledger, but relying on that would mean
 * running two queries to learn there was nothing to ask.
 */
export function searchRecords(
  db: Db,
  query: SearchQuery,
  {
    homeCurrency = 'EGP',
    limit = SEARCH_LIMIT,
    now = new Date(),
  }: { homeCurrency?: string; limit?: number; now?: Date } = {}
): SearchOutcome {
  const counter = alias(accounts, 'counter_account');
  const where = conditions(query, counter, homeCurrency, now);

  const rows = db
    .select({
      id: transactions.id,
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
      note: transactions.note,
      occurredAt: transactions.occurredAt,
      transferPairId: transactions.transferPairId,
      isAdjustment: transactions.isAdjustment,
      isRefund: transactions.isRefund,
      reversesId: transactions.reversesId,
      originalAmountMinor: transactions.originalAmountMinor,
      originalCurrency: transactions.originalCurrency,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      categoryColor: categories.color,
      accountName: accounts.name,
      counterAccountName: counter.name,
      // Shared with the records list so a result looks the same in both places.
      // Search found this by refusing to typecheck when the field was added to
      // `RecordRow`, which is the point of it living on the shared type.
      attachmentCount,
      homeValueMinor: homeValue(homeCurrency),
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(counter, eq(counter.id, transactions.counterAccountId))
    .where(and(...where))
    .orderBy(desc(transactions.occurredAt), desc(transactions.createdAt))
    .limit(limit)
    .all();

  const home = sql`${homeCurrency.toUpperCase()}`;
  // `valued` is the record's home-currency amount when today's home currency is
  // the one it was converted for, and NULL otherwise. NULL falls out of SUM, so
  // an unvaluable record is excluded rather than summed in as if its number
  // meant something it does not.
  const valued = sql`case when upper(coalesce(${transactions.homeCurrency}, ${transactions.currency})) = ${home}
      then coalesce(${transactions.homeAmountMinor}, ${transactions.amountMinor}) else null end`;
  // Neither transfers nor balance corrections are income or expense — one copy
  // of that rule, in predicates.ts, because this is the sixth query that needs
  // it and the sixth is where a hand-written guard gets forgotten.
  const spendable = countsAsSpending();

  const totals = db
    .select({
      matches: sql<number>`count(*)`,
      expense: sql<number>`coalesce(sum(case when ${spendable} and ${onExpenseSide()} then ${valued} else 0 end), 0)`,
      income: sql<number>`coalesce(sum(case when ${spendable} and ${onIncomeSide()} then ${valued} else 0 end), 0)`,
      unvalued: sql<number>`coalesce(sum(case when ${spendable} and upper(coalesce(${transactions.homeCurrency}, ${transactions.currency})) <> ${home} then 1 else 0 end), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(counter, eq(counter.id, transactions.counterAccountId))
    .where(and(...where))
    .get();

  if (!totals) return EMPTY;

  const matchCount = Number(totals.matches ?? 0);

  return {
    rows: rows.map(({ transferPairId, ...row }) => ({
      ...row,
      isTransfer: transferPairId !== null,
    })),
    matchCount,
    truncated: matchCount > rows.length,
    expenseMinor: Number(totals.expense ?? 0),
    incomeMinor: Number(totals.income ?? 0),
    unvaluedCount: Number(totals.unvalued ?? 0),
  };
}
