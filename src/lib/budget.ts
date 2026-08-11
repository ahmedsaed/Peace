/**
 * Budget arithmetic.
 *
 * Pure — no database import — so every rule about what a budget MEANS is
 * testable without a device.
 *
 * A budget is a limit on *spending*, so everything here works in unsigned
 * magnitudes: a record is stored as -25000 and a budget as 3000_00, and asking
 * "how much of it is used" is a comparison between two positive numbers. The
 * sign is a fact about the ledger, not about the budget, and mixing the two is
 * how a progress bar ends up running backwards.
 */

/** Where a category sits against its limit. */
export type BudgetState =
  /** No limit set. Spending is reported, nothing is judged. */
  | 'none'
  | 'under'
  /** Nearly out. Worth a colour change while there is still time to act. */
  | 'close'
  | 'over';

/**
 * The point at which "fine" becomes "watch out".
 *
 * 90%, not 100%: a warning that arrives once the money is already gone is a
 * report, not a warning.
 */
export const CLOSE_FRACTION = 0.9;

export function budgetState(spentMinor: number, budgetMinor: number): BudgetState {
  if (budgetMinor <= 0) return 'none';
  const used = Math.abs(spentMinor) / budgetMinor;
  if (used > 1) return 'over';
  if (used >= CLOSE_FRACTION) return 'close';
  return 'under';
}

/**
 * How full the bar is, 0..1.
 *
 * CLAMPED, because a bar cannot be 140% long — it would either overflow its
 * container or, worse, be silently scaled so that every over-budget category
 * looked identically full. The percentage label carries the real number.
 */
export function budgetFraction(spentMinor: number, budgetMinor: number): number {
  if (budgetMinor <= 0) return 0;
  return Math.min(1, Math.abs(spentMinor) / budgetMinor);
}

/** The percentage a person reads. NOT clamped — 140% is the useful part. */
export function budgetPercent(spentMinor: number, budgetMinor: number): number {
  if (budgetMinor <= 0) return 0;
  return Math.round((Math.abs(spentMinor) / budgetMinor) * 100);
}

/**
 * What is left, as a signed number: positive is headroom, negative is overspend.
 *
 * Signed on purpose. Returning a magnitude plus a separate "is over" flag gives
 * callers two things to keep in step, and the day they disagree the screen says
 * "E£300 left" in the over-budget colour.
 */
export function remainingMinor(spentMinor: number, budgetMinor: number): number {
  return budgetMinor - Math.abs(spentMinor);
}

/**
 * Round a suggested limit up to something a person would actually write down.
 *
 * UP, never to nearest: these are derived from what you already spend, and a
 * limit rounded down is one you are guaranteed to breach in a month that looks
 * exactly like the last three. The suggestion should be defensible, not tight.
 *
 * The step widens with the amount because a single rule reads badly at both
 * ends — rounding E£9,083 to the nearest 10 gives E£9,090, which looks like a
 * calculation rather than a decision, and rounding E£64 to the nearest 50 gives
 * E£100, which is not a suggestion so much as a shrug.
 */
export function roundUpSuggestion(averageMinor: number, decimals: number): number {
  if (averageMinor <= 0) return 0;
  const unit = 10 ** decimals;
  const step = averageMinor >= 1000 * unit ? 50 * unit : 10 * unit;
  return Math.ceil(averageMinor / step) * step;
}
