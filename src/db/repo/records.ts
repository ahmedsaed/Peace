import { and, desc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';
import { alias, type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { formatDayHeading, periodBounds, type Period } from '../../lib/period';
import * as schema from '../schema';
import { accounts, categories, transactions } from '../schema';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export type RecordRow = {
  id: string;
  amountMinor: number;
  currency: string;
  note: string | null;
  occurredAt: Date;
  isTransfer: boolean;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  accountName: string;
  counterAccountName: string | null;
};

/**
 * One month of records, newest first.
 *
 * TRANSFERS APPEAR ONCE. Both legs live in the table, so the outgoing (negative)
 * leg is the one listed — without that filter every transfer shows up twice,
 * once as money leaving and once as money arriving.
 */
export function listRecordsForPeriod(db: Db, period: Period): RecordRow[] {
  const { start, end } = periodBounds(period);
  const counter = alias(accounts, 'counter_account');

  const rows = db
    .select({
      id: transactions.id,
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
      note: transactions.note,
      occurredAt: transactions.occurredAt,
      transferPairId: transactions.transferPairId,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      categoryColor: categories.color,
      accountName: accounts.name,
      counterAccountName: counter.name,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(counter, eq(counter.id, transactions.counterAccountId))
    .where(
      and(
        gte(transactions.occurredAt, start),
        lt(transactions.occurredAt, end),
        // Either a normal record, or the outgoing leg of a transfer.
        or(isNull(transactions.transferPairId), lt(transactions.amountMinor, 0))
      )
    )
    .orderBy(desc(transactions.occurredAt), desc(transactions.createdAt))
    .all();

  return rows.map(({ transferPairId, ...row }) => ({
    ...row,
    isTransfer: transferPairId !== null,
  }));
}

export type PeriodSummary = {
  /** Records excluded because their value in the home currency is unknown. */
  unvaluedCount: number;
  expenseMinor: number;
  incomeMinor: number;
  balanceMinor: number;
};

/**
 * Month totals.
 *
 * TRANSFERS ARE EXCLUDED from both sides. Moving money between your own
 * accounts is neither income nor expense; counting it would inflate both by the
 * same amount and make the month look far busier than it was.
 */
/**
 * Totals for the month, in the HOME currency.
 *
 * The sign test still uses `amount_minor` — a conversion never changes whether
 * money came in or went out — but what gets SUMMED is the converted amount.
 * Adding raw amounts across currencies produced a number with no meaning: 100
 * dollars plus 100 pounds came out as 200 and was labelled pounds.
 */
export function periodSummary(db: Db, period: Period, homeCurrency = 'EGP'): PeriodSummary {
  const { start, end } = periodBounds(period);

  const home = sql`${homeCurrency.toUpperCase()}`;

  const row = db
    .select({
      expense: sql<number>`coalesce(sum(case when ${transactions.amountMinor} < 0 then (case when upper(coalesce(${transactions.homeCurrency}, ${transactions.currency})) = ${home} then coalesce(${transactions.homeAmountMinor}, ${transactions.amountMinor}) else null end) else 0 end), 0)`,
      income: sql<number>`coalesce(sum(case when ${transactions.amountMinor} > 0 then (case when upper(coalesce(${transactions.homeCurrency}, ${transactions.currency})) = ${home} then coalesce(${transactions.homeAmountMinor}, ${transactions.amountMinor}) else null end) else 0 end), 0)`,
      unvalued: sql<number>`coalesce(sum(case when upper(coalesce(${transactions.homeCurrency}, ${transactions.currency})) = ${home} then 0 else 1 end), 0)`,
    })
    .from(transactions)
    .where(
      and(
        gte(transactions.occurredAt, start),
        lt(transactions.occurredAt, end),
        isNull(transactions.transferPairId)
      )
    )
    .get();

  const expenseMinor = Number(row?.expense ?? 0);
  const incomeMinor = Number(row?.income ?? 0);
  return {
    expenseMinor,
    incomeMinor,
    balanceMinor: incomeMinor + expenseMinor,
    // Records whose value in TODAY's home currency is unknown — almost always
    // because the home currency was changed after they were entered. Excluded
    // from the totals and counted, rather than summed in as if their numbers
    // meant something they do not.
    unvaluedCount: Number(row?.unvalued ?? 0),
  };
}

export type DayGroup = { key: string; heading: string; rows: RecordRow[] };

/**
 * Pure: split rows into day sections, preserving the order they arrive in.
 * Separated from the query so it can be tested without a database, and so the
 * list can regroup filtered rows without another round trip.
 *
 * Days are keyed by LOCAL calendar date — an 11pm purchase belongs to the day
 * the user lived, not to tomorrow because UTC rolled over.
 */
export function groupByDay(rows: RecordRow[]): DayGroup[] {
  const groups: DayGroup[] = [];
  let current: DayGroup | null = null;

  for (const row of rows) {
    const d = row.occurredAt;
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    if (!current || current.key !== key) {
      current = { key, heading: formatDayHeading(d), rows: [] };
      groups.push(current);
    }
    current.rows.push(row);
  }

  return groups;
}
