import { and, desc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';
import { alias, type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { formatDayHeading, periodBounds, type Period } from '../../lib/period';
import * as schema from '../schema';
import { ledgerSide, movesPosition, onExpenseSide, onIncomeSide } from './predicates';
import { accounts, attachments, categories, transactions } from '../schema';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export type RecordRow = {
  id: string;
  amountMinor: number;
  currency: string;
  note: string | null;
  occurredAt: Date;
  isTransfer: boolean;
  /** A balance correction, not spending. Rendered as its own kind of row. */
  isAdjustment: boolean;
  /** Money coming back on the expense side. */
  isRefund: boolean;
  /**
   * What was HANDED OVER, when that differs from what moved the account.
   *
   * A purchase abroad settles in the card's currency, so `amountMinor` is the
   * pounds and these are the euros — the figure the user recognises, and the
   * one the list showed nowhere at all.
   */
  originalAmountMinor: number | null;
  originalCurrency: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  accountName: string;
  counterAccountName: string | null;
  /**
   * How many receipts this record carries, for the list's indicator.
   *
   * On the SHARED row type rather than fetched by whichever screen wants it,
   * which is what makes the search results carry it too without anyone
   * remembering to ask. A field added here forces every producer to answer —
   * the same reason the icon map is split three ways rather than filtered.
   */
  attachmentCount: number;
  /**
   * What this row is worth in the HOME currency, or null when that is unknown.
   *
   * Null is the whole point of the field. A record in a currency this ledger
   * cannot value — no stored conversion, and the only rates here belong to
   * other records — must be EXCLUDED from a total rather than folded in at
   * face value: adding 100 dollars to 100 pounds gives 200 of nothing.
   * `dayTotals` counts those separately so the screen can say the total is
   * incomplete instead of quietly lying by a few hundred.
   */
  homeValueMinor: number | null;
};

/**
 * "How many receipts?", as a correlated subquery.
 *
 * ONE query, not a second pass keyed by id. A month is a few hundred rows and
 * the join is on an indexed column, so this costs nothing — while fetching the
 * counts separately would be a second round trip that can disagree with the
 * first, and would have to be repeated by every screen showing a record.
 */
const attachmentCount = sql<number>`(
  select count(*) from ${attachments} where ${attachments.transactionId} = ${transactions.id}
)`.mapWith(Number);

/**
 * A row's value in the home currency, or NULL when it cannot be valued.
 *
 * The exact expression `periodSummary` sums, extracted so the per-row column
 * and the month total cannot disagree about what a record is worth. Two
 * hand-kept copies of this is how a day's subtotals stop adding up to the
 * figure in the header directly above them.
 */
export function homeValue(homeCurrency: string) {
  const home = sql`${homeCurrency.toUpperCase()}`;
  return sql<number | null>`case
    when upper(coalesce(${transactions.homeCurrency}, ${transactions.currency})) = ${home}
    then coalesce(${transactions.homeAmountMinor}, ${transactions.amountMinor})
    else null
  end`;
}

export { attachmentCount };

/**
 * One month of records, newest first.
 *
 * TRANSFERS APPEAR ONCE. Both legs live in the table, so the outgoing (negative)
 * leg is the one listed — without that filter every transfer shows up twice,
 * once as money leaving and once as money arriving.
 */
export function listRecordsForPeriod(
  db: Db,
  period: Period,
  homeCurrency = 'EGP'
): RecordRow[] {
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
      isAdjustment: transactions.isAdjustment,
      isRefund: transactions.isRefund,
      originalAmountMinor: transactions.originalAmountMinor,
      originalCurrency: transactions.originalCurrency,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      categoryColor: categories.color,
      accountName: accounts.name,
      counterAccountName: counter.name,
      attachmentCount,
      homeValueMinor: homeValue(homeCurrency),
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
  /**
   * Balance corrections made this month. Signed.
   *
   * Kept out of income and expense — a correction is not a purchase — but part
   * of `balanceMinor`, because it moved real money. Without it the identity the
   * Records header depends on, `brought forward + balance = the Accounts
   * total`, silently stops holding the first time anyone reconciles a card.
   */
  adjustmentMinor: number;
  /** income + expense + adjustments: what the month did to your position. */
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
      expense: sql<number>`coalesce(sum(case when ${onExpenseSide()} then (case when upper(coalesce(${transactions.homeCurrency}, ${transactions.currency})) = ${home} then coalesce(${transactions.homeAmountMinor}, ${transactions.amountMinor}) else null end) else 0 end), 0)`,
      income: sql<number>`coalesce(sum(case when ${onIncomeSide()} then (case when upper(coalesce(${transactions.homeCurrency}, ${transactions.currency})) = ${home} then coalesce(${transactions.homeAmountMinor}, ${transactions.amountMinor}) else null end) else 0 end), 0)`,
      adjustment: sql<number>`coalesce(sum(case when ${transactions.isAdjustment} = 1 then (case when upper(coalesce(${transactions.homeCurrency}, ${transactions.currency})) = ${home} then coalesce(${transactions.homeAmountMinor}, ${transactions.amountMinor}) else null end) else 0 end), 0)`,
      unvalued: sql<number>`coalesce(sum(case when upper(coalesce(${transactions.homeCurrency}, ${transactions.currency})) = ${home} then 0 else 1 end), 0)`,
    })
    .from(transactions)
    .where(
      and(
        gte(transactions.occurredAt, start),
        lt(transactions.occurredAt, end),
        // The POSITION, so adjustments are inside this query and are then split
        // out below. Income and expense each carry their own guard.
        movesPosition()
      )
    )
    .get();

  const expenseMinor = Number(row?.expense ?? 0);
  const incomeMinor = Number(row?.income ?? 0);
  const adjustmentMinor = Number(row?.adjustment ?? 0);
  return {
    expenseMinor,
    incomeMinor,
    adjustmentMinor,
    balanceMinor: incomeMinor + expenseMinor + adjustmentMinor,
    // Records whose value in TODAY's home currency is unknown — almost always
    // because the home currency was changed after they were entered. Excluded
    // from the totals and counted, rather than summed in as if their numbers
    // meant something they do not.
    unvaluedCount: Number(row?.unvalued ?? 0),
  };
}

export type DayGroup = {
  key: string;
  heading: string;
  rows: RecordRow[];
  /**
   * What this day did to your position, in the home currency.
   *
   * Only the rows that MOVE it: a transfer between your own accounts is not a
   * day's spending, and counting it would make a day you shuffled money look
   * like a day you spent it. A correction does count — it moved real money —
   * which is the same split `periodSummary` makes for the month above.
   */
  totalMinor: number;
  /** Rows left out because this ledger cannot value them. */
  unvaluedCount: number;
};

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
      current = { key, heading: formatDayHeading(d), rows: [], totalMinor: 0, unvaluedCount: 0 };
      groups.push(current);
    }
    current.rows.push(row);

    // A transfer moves money between your own accounts and is neither spending
    // nor income; including it would make the day you moved savings across look
    // like the day you spent them. `ledgerSide` owns that question everywhere
    // else, and it owns it here.
    if (ledgerSide(row) === 'transfer') continue;

    if (row.homeValueMinor === null) {
      // Counted, never guessed at. A record in a currency this ledger cannot
      // value is excluded from the figure and reported beside it, so the total
      // is either right or visibly incomplete.
      current.unvaluedCount += 1;
      continue;
    }
    current.totalMinor += row.homeValueMinor;
  }

  return groups;
}
