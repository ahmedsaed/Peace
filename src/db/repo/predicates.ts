import { sql, type SQL } from 'drizzle-orm';

import { transactions } from '../schema';

/**
 * What a row counts towards.
 *
 * There are now two reasons a row is not ordinary spending — it is a transfer
 * leg, or it is a balance correction — and they do not have the same
 * consequences. Written out by hand at each query, that is six places to keep
 * in step and one of them will eventually be missed; the miss shows up as a
 * category screen quietly disagreeing with a header, which is the kind of bug
 * that survives review because both numbers look plausible.
 *
 * So the rules live here, once, and every total imports one of them.
 */

/**
 * Counts towards INCOME and EXPENSE.
 *
 * Excludes both:
 *   - transfer legs, because moving money between your own accounts is neither
 *     earning nor spending, and counting it inflates both sides equally;
 *   - adjustments, because a correction is not a purchase. Counting one would
 *     drop a category's worth of phantom spending into whichever month you
 *     happened to reconcile in.
 */
export function countsAsSpending(): SQL {
  return sql`${transactions.transferPairId} is null and ${transactions.isAdjustment} = 0`;
}

/**
 * Counts towards the running POSITION — what you are holding.
 *
 * Excludes transfer legs and nothing else. An adjustment belongs here: it is
 * real money, and leaving it out would put the Accounts screen and the Records
 * header permanently at odds with no way to tell which was wrong.
 *
 * Transfers are excluded rather than left in to cancel. They would cancel, but
 * only while both legs are valuable in the home currency — one leg on a dollar
 * account and one on a pound account leaves half a transfer in the total.
 */
export function movesPosition(): SQL {
  return sql`${transactions.transferPairId} is null`;
}

/**
 * WHICH SIDE OF THE LEDGER a row belongs to.
 *
 * Until refunds existed, the sign of `amount_minor` answered this on its own:
 * negative was spending, positive was earning. A refund breaks that — it is
 * money coming back, but it belongs to the expense side so it can net against
 * the category it reverses. Return E£800 of shoes and count it as income and
 * the month reports E£800 more income than you earned AND E£800 more expense
 * than you spent; the net is right, which is exactly why the bug survives.
 *
 * So the side is decided here, once, and NEVER by a bare `amount < 0` again.
 */
export function onExpenseSide(): SQL {
  return sql`${transactions.isAdjustment} = 0
    and (${transactions.amountMinor} < 0 or ${transactions.isRefund} = 1)`;
}

export function onIncomeSide(): SQL {
  return sql`${transactions.isAdjustment} = 0
    and ${transactions.amountMinor} > 0
    and ${transactions.isRefund} = 0`;
}

/**
 * Counts towards ONE ACCOUNT's balance.
 *
 * Everything does, including both transfer legs and adjustments: every row on
 * an account moved that account, which is the whole definition of a balance
 * being derived rather than stored.
 */
export function movesAccountBalance(): SQL {
  return sql`1 = 1`;
}
