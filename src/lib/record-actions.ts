/**
 * What a long press may offer, as rules rather than as three booleans written
 * inline in a component.
 *
 * Pure, so every one of them is testable without a device — and in one place,
 * because they overlap: "ordinary spending" is the pre-condition for two of
 * them, "already undoes something" now disqualifies a third, and a rule spelled
 * out at each call site is a rule that gets forgotten at one of them. That is
 * the same lesson `predicates.ts` records for the SQL side.
 */

/**
 * The part of a record these rules read.
 *
 * Structural rather than the full row: an action must not start depending on
 * a field nobody thought about, and a caller that cannot supply `reversedBy`
 * has not asked the database the question the rule needs answered.
 */
export type ActionSubject = {
  isTransfer: boolean;
  isAdjustment: boolean;
  isRefund: boolean;
  /** Signed, as stored. */
  amountMinor: number;
  /** Set when this row exists to undo another one. */
  reversesId: string | null;
  /** How many rows point at this one as the thing they undo. */
  reversedByCount: number;
};

/**
 * An ordinary record: spending or earning, not a transfer and not a correction.
 *
 * Both of those are excluded from every income and expense total there is, so
 * an action that talks about categories or spending has nothing to say about
 * them.
 */
function ordinary(row: ActionSubject): boolean {
  return !row.isTransfer && !row.isAdjustment;
}

/**
 * Only spending can be refunded.
 *
 * A transfer has no category to net against, a correction is not a purchase,
 * income coming back is simply an expense, and a refund of a refund is not a
 * thing. Each would be a menu item that does nothing sensible.
 *
 * NOT blocked by an existing refund. Partial refunds are ordinary — a returned
 * item out of a basket, three people settling a dinner separately — so a
 * purchase can be refunded several times and the sheet reports how much has
 * come back rather than refusing.
 */
export function canRefund(row: ActionSubject): boolean {
  // NEVER `amountMinor < 0` as a stand-in for "is an expense": a refund is a
  // POSITIVE expense, and `isRefund` is what excludes it here. The sign test
  // is what keeps income out.
  return ordinary(row) && !row.isRefund && row.amountMinor < 0;
}

/**
 * Only a transfer can be reversed, and only once.
 *
 * Unlike a refund this is all-or-nothing: reversing a reversal re-creates the
 * original transfer, which is not an operation anybody wants by accident, and
 * reversing the same transfer twice moves the money back twice. Moving part of
 * it back is an ordinary transfer and does not need an action of its own.
 *
 * A correction is excluded even though it is not a transfer, because it moves a
 * balance rather than money between accounts — there is no far end to swap.
 */
export function canReverse(row: ActionSubject): boolean {
  return row.isTransfer && !row.isAdjustment && row.reversesId === null && row.reversedByCount === 0;
}

/**
 * Duplicate is for ordinary records only.
 *
 * NOT a refund: the case it appears to serve — three people settling a shared
 * dinner separately — is served better by refunding the ORIGINAL purchase three
 * times, so each refund derives from the thing it reverses. Copying a refund
 * detaches it from that for no gain and makes double-refunding a one-tap
 * mistake.
 *
 * NOT a correction: reconciling twice by the same amount is not a thing you
 * ever want; you reconcile again against the real balance instead.
 */
export function canDuplicate(row: ActionSubject): boolean {
  return ordinary(row) && !row.isRefund;
}
