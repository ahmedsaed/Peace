import { and, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { periodBounds, type Period } from '../../lib/period';
import { movesAccountBalance, movesPosition } from './predicates';
import * as schema from '../schema';
import { accounts, transactions, type Account } from '../schema';

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
        // The POSITION, so adjustments count and transfers do not — see
        // predicates.ts for why transfers are excluded rather than left to
        // cancel.
        movesPosition()
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
    .where(movesPosition())
    .get();

  return Number(opening?.total ?? 0) + Number(moved?.total ?? 0);
}

// ---------------------------------------------------------------------------
// Where the figure comes from
// ---------------------------------------------------------------------------

/**
 * One account's contribution to a running position or a month's net.
 *
 * `amountMinor` is SIGNED and denominated in the HOME currency, never in the
 * account's own — these numbers are summed against each other, and minor units
 * are not comparable across currencies. A dollar jar therefore contributes
 * whatever its records were converted to on the day each was entered, and its
 * opening balance contributes nothing at all, because no rate was ever chosen
 * for money that was simply already there. That omission is reported through
 * `unvaluedCount` rather than guessed at, exactly as `broughtForward` does.
 */
export type AccountPosition = {
  id: string;
  name: string;
  type: Account['type'];
  /** The account's OWN currency, for saying which one could not be valued. */
  currency: string;
  icon: string | null;
  color: string | null;
  archived: boolean;
  /** Signed, in home-currency minor units. Negative on a card means debt. */
  amountMinor: number;
  /** Records here with no value in today's home currency, plus a foreign opening balance. */
  unvaluedCount: number;
};

/**
 * The shared half of the two breakdowns below.
 *
 * The transaction filter goes in the JOIN, never in a WHERE: moved to the WHERE
 * it would drop every account that has no rows in the window, and an account
 * holding an opening balance and nothing else would silently vanish from a list
 * whose whole job is to add up to a number shown elsewhere.
 */
function contributions(
  db: Db,
  homeCurrency: string,
  window: SQL,
  /** Opening balances belong to a POSITION and not to a month's movement. */
  withOpening: boolean
): AccountPosition[] {
  const home = sql`${homeCurrency.toUpperCase()}`;

  // The same valuation rule as every other total in the app, and deliberately
  // the same expression `broughtForward` uses: two hand-kept copies is how a
  // breakdown stops adding up to the header above it.
  const valued = sql<number>`case when upper(coalesce(${transactions.homeCurrency}, ${transactions.currency})) = ${home}
      then coalesce(${transactions.homeAmountMinor}, ${transactions.amountMinor}) else null end`;

  const rows = db
    .select({
      account: accounts,
      // TRANSFER LEGS ARE IN, unlike every total in this file above. A total
      // asks what you are worth and a transfer changes nothing about that; ONE
      // ACCOUNT's figure asks where the money is, and a transfer is precisely
      // the thing that moves it. Leave the legs out and the cash you withdrew
      // last week is missing from Cash and still sitting in Bank — a list that
      // adds up to the right number while being wrong on two of its rows,
      // which is the worst way for it to be wrong.
      //
      // The total survives because the two legs cancel EXACTLY: `createTransfer`
      // writes one currency, one rate and one home currency across both, so
      // their home values are +X and -X and they are valued or unvalued
      // together. Nothing else in this file may rely on that.
      moved: sql<number>`coalesce(sum(case when ${movesAccountBalance()} then ${valued} else null end), 0)`,
      // Counted on the POSITION rule, though, so this agrees with the figure
      // the records header prints. A transfer that cannot be valued was never
      // counted towards anything to begin with, and reporting it as an
      // uncounted record would describe a movement nothing was ever going to
      // include — see `broughtForward`'s transfer test.
      unvalued: sql<number>`coalesce(sum(case when ${transactions.id} is not null and ${movesPosition()} and ${valued} is null then 1 else 0 end), 0)`,
    })
    .from(accounts)
    .leftJoin(transactions, and(eq(transactions.accountId, accounts.id), window))
    .groupBy(accounts.id)
    .all();

  return rows
    // ARCHIVED ACCOUNTS STAY IN. Their money is still in the total — archiving
    // hides an account from the pickers, it does not spend what is in it — so
    // dropping them here would produce a list that adds up to less than the
    // figure it is explaining, which is the one thing this screen may not do.
    // Sorted on the ROW, while `sortOrder` is still in hand: it is ordering
    // information and not something a breakdown has any reason to render.
    .sort(
      (a, b) =>
        a.account.sortOrder - b.account.sortOrder ||
        a.account.name.localeCompare(b.account.name)
    )
    .map(({ account, moved, unvalued }) => {
      const openingCounts =
        withOpening && account.currency.toUpperCase() === homeCurrency.toUpperCase();
      const openingUnvalued = withOpening && !openingCounts && account.openingBalance !== 0;

      return {
        id: account.id,
        name: account.name,
        type: account.type,
        currency: account.currency,
        icon: account.icon,
        color: account.color,
        archived: account.archived,
        amountMinor: (openingCounts ? account.openingBalance : 0) + Number(moved),
        unvaluedCount: Number(unvalued) + (openingUnvalued ? 1 : 0),
      };
    });
}

/**
 * Every account's position at the END of `period` — what makes up "Now".
 *
 * Summed, this is exactly `broughtForward(period) + periodSummary(period)`,
 * which is the identity `carry.test.ts` pins. It is deliberately the position
 * at the end of the month being LOOKED AT rather than today's balances: those
 * agree only while nothing is dated after the viewed month, and a breakdown
 * that stops adding up as soon as you scroll back a month is worse than none.
 */
export function positionByAccount(
  db: Db,
  period: Period,
  homeCurrency = 'EGP'
): AccountPosition[] {
  const { end } = periodBounds(period);
  return contributions(db, homeCurrency, lt(transactions.occurredAt, end), true);
}

/**
 * Every account's net movement WITHIN `period` — what makes up "Balance".
 *
 * The same breakdown for the other thing the third cell can show. Opening
 * balances are excluded: they have no date, so they moved in no month.
 */
export function movementByAccount(
  db: Db,
  period: Period,
  homeCurrency = 'EGP'
): AccountPosition[] {
  const { start, end } = periodBounds(period);
  return contributions(
    db,
    homeCurrency,
    and(gte(transactions.occurredAt, start), lt(transactions.occurredAt, end))!,
    false
  );
}
