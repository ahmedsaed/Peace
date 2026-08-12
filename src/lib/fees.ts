/**
 * Card fees.
 *
 * Pure. A fee is a percentage of money, which is the exact shape that
 * reintroduces float drift into a ledger built on integer minor units — so the
 * rate is basis points and the arithmetic stays in integers the whole way.
 */

/**
 * A fee on an amount, as an unsigned magnitude in the same minor units.
 *
 * `(amount * bp) / 10000` in that order: multiplying first keeps everything an
 * integer until the single division, where dividing first would round the rate
 * away before it was ever applied. 3% of E£1,246.83 is 124683 * 300 / 10000 =
 * 3740.49, which is E£37.40 — and it is the same E£37.40 every time.
 *
 * Zero when there is no rate, so a card with no fee profile costs nothing extra
 * and needs no special-casing at the call site.
 */
export function feeMinor(amountMinor: number, bp: number | null | undefined): number {
  if (!bp || bp <= 0) return 0;
  // Unsigned: a fee on a purchase and a fee on a refund are both charges. The
  // sign is applied by whoever writes the row.
  return Math.round((Math.abs(amountMinor) * bp) / 10_000);
}

export type ForeignPurchase = {
  /** What the card is charged, before any fee. */
  settledMinor: number;
  /** The card's commission on it. Zero when the card charges none. */
  feeMinor: number;
  /** What actually lands on the statement. */
  totalMinor: number;
};

/**
 * What a purchase abroad will cost, given a rate and the card's fee.
 *
 * This is an ESTIMATE and the screen has to say so: the bank settles days
 * later, at its own rate. That is what "Update balance" is for — the estimate
 * gets you a record on the day you spent, and the correction closes the gap
 * when the statement arrives. An estimate you can fix beats a blank you forget.
 */
export function foreignPurchase(
  settledMinor: number,
  feeBp: number | null | undefined
): ForeignPurchase {
  const fee = feeMinor(settledMinor, feeBp);
  return {
    settledMinor,
    feeMinor: fee,
    totalMinor: settledMinor + fee,
  };
}
