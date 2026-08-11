import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { periodBounds, type Period } from '../../lib/period';
import * as schema from '../schema';
import { accounts, transactions } from '../schema';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export type BroughtForward = {
  /** Signed. Negative means you started the month already behind. */
  amountMinor: number;
  /** What was in the accounts before any record was logged. */
  openingMinor: number;
  /** Net of every recorded month before this one. */
  ledgerMinor: number;
  /**
   * Things left out because they have no value in today's home currency —
   * foreign-currency opening balances, and records converted for a different
   * home currency. Counted rather than guessed at.
   */
  unvaluedCount: number;
};

/**
 * What you were holding when the month started.
 *
 * This is the honest version of "carry-over". It is NOT a budget feature: a
 * limit that grows when you fail to use it is not a limit, and every awkward
 * question that idea raises — does it compound, does an overspend carry as a
 * debt — exists because the concept fights itself. What actually carries from
 * one month to the next is *money*, and money is a running balance.
 *
 * Two parts, because both are money you had:
 *
 *   - `openingMinor` — the balances the accounts were created with. These have
 *     no date, so they belong before all time. Leaving them out would leave the
 *     running total permanently short of the Accounts screen by however much
 *     you started with, with nothing on either screen explaining the gap.
 *   - `ledgerMinor` — every income and expense recorded before this month.
 *
 * Add this month's net and you get the Accounts screen's total. That identity
 * is the point, and it is what `carry.test.ts` pins.
 */
export function broughtForward(
  db: Db,
  period: Period,
  homeCurrency = 'EGP'
): BroughtForward {
  const { start } = periodBounds(period);
  const home = sql`${homeCurrency.toUpperCase()}`;

  // An opening balance is denominated in the ACCOUNT's currency and has no
  // conversion attached — there is no rate stored for "money that was already
  // there". So it counts only when the account is already held in the home
  // currency; anything else is reported rather than converted at a rate nobody
  // chose.
  const opening = db
    .select({
      total: sql<number>`coalesce(sum(case when upper(${accounts.currency}) = ${home} then ${accounts.openingBalance} else null end), 0)`,
      unvalued: sql<number>`coalesce(sum(case when upper(${accounts.currency}) <> ${home} and ${accounts.openingBalance} <> 0 then 1 else 0 end), 0)`,
    })
    .from(accounts)
    .get();

  // Same valuation rule as every other total in the app: what cannot be valued
  // in today's home currency falls out of the SUM and is counted instead.
  const valued = sql<number>`case when upper(coalesce(${transactions.homeCurrency}, ${transactions.currency})) = ${home}
      then coalesce(${transactions.homeAmountMinor}, ${transactions.amountMinor}) else null end`;

  const ledger = db
    .select({
      total: sql<number>`coalesce(sum(${valued}), 0)`,
      unvalued: sql<number>`coalesce(sum(case when ${valued} is null then 1 else 0 end), 0)`,
    })
    .from(transactions)
    .where(
      and(
        lt(transactions.occurredAt, start),
        // TRANSFERS ARE EXCLUDED. Both legs are in the table and they cancel, so
        // including them would be harmless arithmetic — but only by accident,
        // and only while both legs are valuable in the home currency. One leg
        // on a dollar account and one on a pound account would leave half a
        // transfer in the total.
        isNull(transactions.transferPairId)
      )
    )
    .get();

  const openingMinor = Number(opening?.total ?? 0);
  const ledgerMinor = Number(ledger?.total ?? 0);

  return {
    amountMinor: openingMinor + ledgerMinor,
    openingMinor,
    ledgerMinor,
    unvaluedCount: Number(opening?.unvalued ?? 0) + Number(ledger?.unvalued ?? 0),
  };
}

/**
 * The running total at the end of each of a series of months.
 *
 * Takes the opening figure once and then walks forward, rather than asking the
 * database for each month independently: the cash-flow strip needs six of these
 * and they are a prefix sum of numbers it already has.
 */
export function runningTotals(
  startingMinor: number,
  monthlyNet: number[]
): number[] {
  const out: number[] = [];
  let running = startingMinor;
  for (const net of monthlyNet) {
    running += net;
    out.push(running);
  }
  return out;
}

/** Every account's balance summed, for the identity test. Home currency only. */
export function totalHeld(db: Db, homeCurrency = 'EGP'): number {
  const home = sql`${homeCurrency.toUpperCase()}`;

  const opening = db
    .select({
      total: sql<number>`coalesce(sum(case when upper(${accounts.currency}) = ${home} then ${accounts.openingBalance} else 0 end), 0)`,
    })
    .from(accounts)
    .get();

  const valued = sql<number>`case when upper(coalesce(${transactions.homeCurrency}, ${transactions.currency})) = ${home}
      then coalesce(${transactions.homeAmountMinor}, ${transactions.amountMinor}) else null end`;

  const moved = db
    .select({ total: sql<number>`coalesce(sum(${valued}), 0)` })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(isNull(transactions.transferPairId))
    .get();

  return Number(opening?.total ?? 0) + Number(moved?.total ?? 0);
}
