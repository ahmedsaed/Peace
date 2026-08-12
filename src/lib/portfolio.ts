/**
 * Keeping an investment portfolio near its target allocation.
 *
 * Ported from a web tool of the same design, with the arithmetic redone to this
 * codebase's rules. The strategy itself is unchanged and is the good part:
 *
 *   IT NEVER TELLS YOU TO SELL. Drift is corrected by steering the NEXT
 *   contribution towards whatever is underweight — no capital gains event, no
 *   transaction cost, nothing to act on until you were going to invest anyway.
 *   An overweight class simply gets nothing this round.
 *
 * A property worth naming because it falls out of the maths rather than being
 * special-cased: once the portfolio IS at target, "what each class needs"
 * reduces to `newMoney × target`, so the split becomes target-weighted on its
 * own. There is no separate branch for the already-balanced case.
 *
 * This is deliberately NOT wired to the ledger. Buying units does not create a
 * transaction, and portfolio value does not move the Accounts total — it keeps
 * its own tables and its own arithmetic.
 */

import { roundHalfAwayFromZero } from './money';

/**
 * Units are integers, scaled — you can hold 12.347 of a fund, and a float would
 * be the same mistake as a float amount of money.
 */
export const UNIT_SCALE = 1_000_000;

/**
 * Target weights are BASIS POINTS, not percentages. 60% is 6000.
 *
 * The same reasoning as `foreignFeeBp` on a card, plus one benefit specific to
 * this feature: "the targets must add up to 100%" becomes an EXACT integer
 * comparison against 10000. The tool this came from compared floats with a
 * `Math.abs(sum - 100) > 0.01` tolerance, which is a tolerance precisely
 * because floats cannot answer the question honestly.
 */
export const FULL_ALLOCATION_BP = 10_000;

export type AssetClass = {
  id: string;
  name: string;
  targetBp: number;
};

export type Holding = {
  id: string;
  name: string;
  assetClassId: string;
  /** Scaled by UNIT_SCALE. */
  unitsMicro: number;
  /** Minor units of the home currency, per ONE whole unit. */
  priceMinor: number;
};

/** What one holding is worth, in minor units. */
export function holdingValueMinor(holding: Holding): number {
  return roundHalfAwayFromZero((holding.unitsMicro * holding.priceMinor) / UNIT_SCALE);
}

export function totalValueMinor(holdings: Holding[]): number {
  return holdings.reduce((total, h) => total + holdingValueMinor(h), 0);
}

export function valueByClass(holdings: Holding[]): Map<string, number> {
  const byClass = new Map<string, number>();
  for (const holding of holdings) {
    byClass.set(
      holding.assetClassId,
      (byClass.get(holding.assetClassId) ?? 0) + holdingValueMinor(holding)
    );
  }
  return byClass;
}

export const targetsTotalBp = (classes: AssetClass[]) =>
  classes.reduce((sum, c) => sum + c.targetBp, 0);

/** Exactly 100%, with no tolerance, because basis points make that answerable. */
export const targetsAreComplete = (classes: AssetClass[]) =>
  classes.length > 0 && targetsTotalBp(classes) === FULL_ALLOCATION_BP;

export type DriftRow = {
  assetClassId: string;
  name: string;
  targetBp: number;
  currentBp: number;
  currentValueMinor: number;
  /** Signed: positive is overweight. */
  driftBp: number;
};

export function analyse(classes: AssetClass[], holdings: Holding[]): DriftRow[] {
  const total = totalValueMinor(holdings);
  const byClass = valueByClass(holdings);

  return classes.map((c) => {
    const currentValueMinor = byClass.get(c.id) ?? 0;
    // An empty portfolio is 0% of everything rather than a division by zero.
    const currentBp =
      total > 0 ? roundHalfAwayFromZero((currentValueMinor / total) * FULL_ALLOCATION_BP) : 0;

    return {
      assetClassId: c.id,
      name: c.name,
      targetBp: c.targetBp,
      currentBp,
      currentValueMinor,
      driftBp: currentBp - c.targetBp,
    };
  });
}

/** Two percentage points, and five. Beyond that it wants attention. */
export const DRIFT_WATCH_BP = 200;
export const DRIFT_ALERT_BP = 500;

export type DriftBand = 'on-target' | 'drifting' | 'off-target';

export function driftBand(driftBp: number): DriftBand {
  const size = Math.abs(driftBp);
  if (size > DRIFT_ALERT_BP) return 'off-target';
  if (size > DRIFT_WATCH_BP) return 'drifting';
  return 'on-target';
}

/**
 * Split a whole amount across weights so the parts sum to it EXACTLY.
 *
 * Rounding each share on its own leaves the total a piastre or two out, and
 * "invest these four amounts" that do not add up to the number just typed is
 * the kind of error that makes someone stop trusting the screen. Largest
 * remainder distributes the difference; ties break on the earlier index so the
 * same input never reorders itself between two renders.
 *
 * The same rule as `sharePercents` in analysis.ts, applied to money instead of
 * percentages — with the added constraint that money must not be invented or
 * destroyed by the rounding.
 */
export function allocateMinor(totalMinor: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (totalMinor <= 0 || sum <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (Math.max(0, w) / sum) * totalMinor);
  const floors = exact.map((value) => Math.floor(value));
  let remaining = totalMinor - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const out = [...floors];
  for (const { index } of order) {
    if (remaining <= 0) break;
    out[index] += 1;
    remaining -= 1;
  }
  return out;
}

export type Recommendation = {
  assetClassId: string;
  name: string;
  currentValueMinor: number;
  targetBp: number;
  /** What it would take to reach target once the new money is in. */
  shortfallMinor: number;
  /** What to actually put in, summing exactly to the amount being invested. */
  investMinor: number;
  overweight: boolean;
};

/**
 * How to spread the next contribution.
 *
 * Every class is measured against the portfolio it will be part of AFTER the
 * money goes in — `total + newMoney` — because that is the pot the target
 * percentages will apply to. Measuring against today's total would aim at a
 * moving target and undershoot every time.
 */
export function recommend(
  classes: AssetClass[],
  holdings: Holding[],
  newMoneyMinor: number
): Recommendation[] {
  const byClass = valueByClass(holdings);
  const totalAfter = totalValueMinor(holdings) + Math.max(0, newMoneyMinor);

  const rows = classes.map((c) => {
    const currentValueMinor = byClass.get(c.id) ?? 0;
    const gap =
      roundHalfAwayFromZero((totalAfter * c.targetBp) / FULL_ALLOCATION_BP) - currentValueMinor;

    return {
      assetClassId: c.id,
      name: c.name,
      currentValueMinor,
      targetBp: c.targetBp,
      // Never negative: this strategy does not sell. An overweight class is
      // left alone and corrected by future contributions going elsewhere.
      shortfallMinor: Math.max(0, gap),
      overweight: gap <= 0,
    };
  });

  const amounts = allocateMinor(
    Math.max(0, newMoneyMinor),
    rows.map((r) => r.shortfallMinor)
  );

  return rows.map((row, index) => ({ ...row, investMinor: amounts[index] }));
}
