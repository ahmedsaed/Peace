/**
 * Presenting an account you OWE rather than one you hold.
 *
 * Pure — no database, no React. Nothing here changes a stored sign: the ledger
 * keeps a card balance negative like any other outflow, because that is what
 * makes `SUM(amount_minor)` across every account come out as net worth without
 * a single special case. This is the render boundary, and only the render
 * boundary.
 */

export type AccountKind = 'cash' | 'bank' | 'card' | 'savings' | 'loan';

/**
 * Accounts whose balance is money owed rather than money held.
 *
 * A card at −5,000 is not an emptied wallet, it is five thousand of debt, and
 * showing it the same way as a drained current account is what makes people
 * stop trusting the screen.
 */
export function isLiability(type: AccountKind): boolean {
  return type === 'card' || type === 'loan';
}

/**
 * Accounts that have a CARD's paperwork — a credit limit, a foreign-transaction
 * fee, a cash-advance fee.
 *
 * A SECOND PREDICATE, AND THE REASON IS THE QUESTION IT ANSWERS. `isLiability`
 * asks whether a balance is debt or holdings, and a card and a loan are the
 * same thing under that question. "Does this have a card profile?" is a
 * different question with a different answer, and the account form asked it
 * with `isLiability` — so a loan was offered a credit limit INSTEAD of its
 * opening balance, plus a foreign fee and a cash-advance fee, and the record
 * screen offered it the "spent abroad" commission flow. None of those are
 * things a loan has, and the principal had nowhere to go.
 *
 * A predicate reused for a question it was not written for is the same failure
 * as a rule copied out by hand: it reads as correct at every call site, and
 * only the one where the two questions disagree is wrong.
 */
export function hasCardProfile(type: AccountKind): boolean {
  return type === 'card';
}

/**
 * What a liability balance should read as, and how.
 *
 * A card at −5,000 becomes `5,000` labelled "owed". A card in credit — a refund
 * landed and you owe nothing — becomes `500` labelled "in credit", because
 * "−500 owed" is a double negative nobody should have to parse.
 */
export type OwedDisplay = {
  /** UNSIGNED, for formatting. The sign lives in `label`. */
  magnitudeMinor: number;
  label: 'owed' | 'in credit' | 'clear';
  /** True when this is debt, so the caller can pick the expense colour. */
  isDebt: boolean;
};

export function owedDisplay(balanceMinor: number): OwedDisplay {
  if (balanceMinor === 0) return { magnitudeMinor: 0, label: 'clear', isDebt: false };
  if (balanceMinor < 0) {
    return { magnitudeMinor: -balanceMinor, label: 'owed', isDebt: true };
  }
  // Positive on a card means the bank owes YOU — an over-payment or a refund
  // after the balance was already settled. Rare, but it happens, and it must
  // not read as "−500 owed".
  return { magnitudeMinor: balanceMinor, label: 'in credit', isDebt: false };
}

/**
 * How much of the limit is left.
 *
 * `null` when no limit is recorded, so callers show nothing rather than an
 * authoritative-looking zero. Floored at zero: being over the limit is a real
 * state, but "−E£200 available" is not a sentence, and the owed figure beside
 * it already tells that story.
 */
export function availableCredit(balanceMinor: number, creditLimitMinor: number | null): number | null {
  if (creditLimitMinor === null || creditLimitMinor <= 0) return null;
  const owed = Math.max(0, -balanceMinor);
  return Math.max(0, creditLimitMinor - owed);
}

/**
 * Convert what the bank shows into the balance the ledger should hold.
 *
 * Banking apps disagree about which number they put in front of you — some show
 * the outstanding balance, some the available credit. Rather than make someone
 * do the subtraction at the exact moment they are trying to correct an error,
 * both are accepted and converted here.
 *
 * Returns a SIGNED ledger balance: negative for debt, matching what is stored.
 */
/**
 * Negating zero gives NEGATIVE zero, which is not the same value: `Object.is`
 * separates them, a `=== 0` guard elsewhere may not, and it can surface as
 * "-E£0.00" on a card that is exactly settled. Every negation here goes through
 * this.
 */
const noNegativeZero = (n: number) => (n === 0 ? 0 : n);

export function targetBalanceFromOwed(owedMinor: number): number {
  // Typing a minus sign into a field labelled "owed" means the same thing as
  // not typing one. Nobody owes negative five thousand.
  return noNegativeZero(-Math.abs(owedMinor));
}

export function targetBalanceFromAvailable(
  availableMinor: number,
  creditLimitMinor: number
): number {
  return noNegativeZero(-(creditLimitMinor - Math.abs(availableMinor)));
}

// ---------------------------------------------------------------------------
// Fee rates
// ---------------------------------------------------------------------------

/**
 * "3" or "3.5" from a form into BASIS POINTS — 300, 350.
 *
 * Basis points because a fee is multiplied by money, and a percentage kept as a
 * float reintroduces exactly the drift integer minor units exist to prevent.
 * Two decimal places of a percent is the finest any card prices at.
 *
 * Returns null for anything unparseable so the caller can refuse rather than
 * silently store a zero, which would read as "no fee" and quietly stop charging
 * one.
 */
export function percentToBp(input: string): number | null {
  const cleaned = input.replace(/[\s%]/g, '').trim();
  if (cleaned === '') return null;
  if (!/^\d*\.?\d*$/.test(cleaned)) return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  // 100% is not a card fee, it is a typo — and one that would double every
  // foreign purchase.
  if (value > 100) return null;

  return Math.round(value * 100);
}

/** Basis points back to what the user typed: 300 -> "3", 350 -> "3.5". */
export function bpToPercent(bp: number | null): string {
  if (bp === null) return '';
  // Trailing zeroes stripped so a whole percent reads as "3" rather than "3.00"
  // in a field someone is about to edit.
  return String(Math.round(bp) / 100);
}
