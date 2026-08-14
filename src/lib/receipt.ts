/**
 * Reading a receipt photo into the fields of a record.
 *
 * THE MODEL IS A TYPIST, NOT AN ACCOUNTANT. Everything it returns is treated as
 * text somebody typed badly: parsed, range-checked, and dropped if it does not
 * survive. It never reaches the ledger directly — it fills in a form that was
 * already there and that still works when this returns nothing at all. Same
 * rule as the rate fetch: a dead network, a wrong key or a model having a bad
 * day must not stop a record being saved.
 *
 * The parsing is pure and lives here so it can be tested against the replies a
 * model actually produces — including the malformed ones, which are the
 * interesting cases and which no amount of testing on a device would cover.
 */

import { decimalsFor, roundHalfAwayFromZero } from './money';

/** Everything a receipt can offer. Every field is optional; the model guesses. */
export type ReadReceipt = {
  /** Positive minor units. The SIGN is the record type's business, not ours. */
  amountMinor: number | null;
  /** ISO 4217, uppercased, only when it looks like one. */
  currency: string | null;
  /** yyyy-mm-dd, local calendar. */
  occurredOn: string | null;
  /** The shop. Goes in the note, because that is where a name belongs. */
  merchant: string | null;
  /** A category NAME to match against the user's own. Never an id. */
  category: string | null;
};

export const EMPTY_READING: ReadReceipt = {
  amountMinor: null,
  currency: null,
  occurredOn: null,
  merchant: null,
  category: null,
};

export class ReceiptError extends Error {}

/**
 * What the model is asked for.
 *
 * The category list is passed IN rather than left to the model's imagination:
 * a returned "Groceries" that does not exist in this ledger is useless, and
 * inventing categories from receipts would fill the picker with junk within a
 * week. Asking it to choose from the user's own names makes the answer either
 * usable or absent.
 */
/**
 * The part of the prompt the USER may edit.
 *
 * Split from the system half deliberately. What a "total" means, whether a
 * service charge counts, how to recognise a particular shop — that is domain
 * knowledge about somebody's own spending, and they know it better than this
 * file does. The output contract is not: an editable instruction that could
 * break the JSON shape would turn a bad sentence into an unparseable reply.
 *
 * Shipped as the default, so an untouched app behaves exactly as before and the
 * field doubles as documentation of what the model is being told.
 */
export const DEFAULT_RECEIPT_GUIDANCE = [
  'total: the FINAL amount paid, after discounts and including tax and service.',
  '  Not a subtotal, not a single line item, not the change given.',
  'currency: the ISO 4217 code, if it is printed or unambiguous from the symbol.',
  'date: the date of the purchase in yyyy-mm-dd, not the date it was printed',
  '  if those differ, and not today.',
  'merchant: the trading name of the shop, as printed. No branch numbers,',
  '  no address, no legal suffix.',
  'category: the single best match from the list below, or null.',
].join('\n');

/**
 * The whole prompt: system rules, then the user's guidance, then the data.
 *
 * The ORDER matters. The system half goes first so the discipline it sets —
 * report what you see, prefer a null to an invention — frames everything after
 * it, and the category list goes last so it cannot be mistaken for prose.
 */
export function buildPrompt(categoryNames: string[], guidance = DEFAULT_RECEIPT_GUIDANCE): string {
  const list = categoryNames.length > 0 ? categoryNames.join(', ') : 'none';
  return [
    'You are reading a photograph of a receipt or invoice for an expense tracker.',
    'Return only what you can actually see. Use null for anything unreadable,',
    'missing, or that you would be guessing at — a null is far more useful here',
    'than a plausible invention, because the person will be checking these',
    'numbers against the paper in their hand.',
    '',
    guidance.trim() || DEFAULT_RECEIPT_GUIDANCE,
    '',
    `The categories to choose from: ${list}.`,
  ].join('\n');
}

/**
 * The shape the model must answer in.
 *
 * Asking for structured output rather than parsing prose is what keeps this
 * honest — a model asked for JSON returns a number as a number, where one asked
 * in English returns "the total is 120 EGP" and invites a regex that will
 * eventually read the wrong figure off a receipt.
 */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    total: { type: 'number', nullable: true },
    currency: { type: 'string', nullable: true },
    date: { type: 'string', nullable: true },
    merchant: { type: 'string', nullable: true },
    category: { type: 'string', nullable: true },
  },
} as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real calendar date, not merely a well-shaped string.
 *
 * "2026-02-31" matches the pattern and is not a day. Left unchecked it becomes
 * a Date that silently rolls into March and dates the record to a day the user
 * was not shopping.
 */
function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  // A model that returns a paragraph has misunderstood the question, and a
  // 4,000-character "merchant" would be pasted straight into the note field.
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Turn whatever came back into something the record screen can use.
 *
 * NOTHING HERE THROWS ON A BAD FIELD. A receipt whose date is unreadable but
 * whose total is clear is a useful reading, and refusing the whole thing
 * because one field is junk would throw away the part that saves the typing.
 * Only a reply that is not an object at all is refused.
 */
export function parseReading(raw: unknown, fallbackCurrency = 'USD'): ReadReceipt {
  if (typeof raw !== 'object' || raw === null) {
    throw new ReceiptError('The model returned something that was not a reading.');
  }

  const body = raw as Record<string, unknown>;

  /**
   * Only a currency that looks like ISO 4217. "E£", "pounds" and "USD dollars"
   * all reach here and none of them is a code `decimalsFor` can use.
   *
   * NOT TRUNCATED BEFORE IT IS TESTED. Capping this at three characters first
   * turned "pounds" into "POU", which passed the pattern and became a currency
   * — a validator that manufactures the thing it is meant to reject.
   */
  const currency = cleanString(body.currency, 40);
  const code = currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : null;

  const date = cleanString(body.date, 10);
  const merchant = cleanString(body.merchant, 80);
  const category = cleanString(body.category, 60);

  return {
    amountMinor: parseTotal(body.total, code ?? fallbackCurrency),
    currency: code,
    occurredOn: date && isRealDate(date) ? date : null,
    merchant,
    category,
  };
}

/**
 * The total, as integer minor units.
 *
 * Scaled by the currency's own decimal places rather than by a hard-coded 100:
 * money is integer minor units everywhere in this app, and yen has no minor
 * unit while dinars have three, so a fixed 100 is wrong by a factor of a
 * hundred in both directions.
 *
 * The magnitude is left UNSIGNED. Which side of the ledger a record sits on is
 * decided by its type, never by the sign of a number — the rule that a refund
 * is an expense with a positive amount exists precisely because guessing from
 * the sign gets it wrong.
 */
function parseTotal(value: unknown, currency: string): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;

  const magnitude = Math.abs(value);
  if (magnitude === 0) return null;

  // A receipt for a trillion is a misread decimal point or a model hallucinating
  // a barcode, and writing it would wreck every total on every screen until it
  // was found. The ceiling is deliberately generous: it exists to catch nonsense,
  // not to second-guess an expensive purchase.
  if (magnitude >= 1e12) return null;

  /**
   * Scale, TRIM THE FLOAT NOISE, then round symmetrically.
   *
   * `toFixed` was the obvious way to do this and it is wrong: 120.005 is held
   * as slightly less than 120.005, so `toFixed(2)` gives "120.00" and the
   * receipt that says 120.01 is entered a unit light. The same trap as
   * `5000 * 3.03 * 0.01` giving 151.49999999999997 — round only after the noise
   * is gone, and round away from zero rather than toward +infinity.
   */
  const scale = 10 ** decimalsFor(currency);
  return roundHalfAwayFromZero(Number((magnitude * scale).toPrecision(12)));
}

/** Did the reading actually find anything worth filling in? */
export function isEmptyReading(reading: ReadReceipt): boolean {
  return (
    reading.amountMinor === null &&
    reading.occurredOn === null &&
    reading.merchant === null &&
    reading.category === null
  );
}

/**
 * Match a returned category name to one the user actually has.
 *
 * Case- and space-insensitive, and NEVER creates one. A model that returns
 * "Groceries " or "groceries" means the same category a person does; a model
 * that returns "Sundries" for a ledger that has no such category means nothing
 * at all, and inventing it would fill the picker with junk within a week.
 */
export function matchCategory<T extends { id: string; name: string }>(
  wanted: string | null,
  categories: T[]
): T | null {
  if (!wanted) return null;
  const needle = wanted.trim().toLowerCase();
  return categories.find((c) => c.name.trim().toLowerCase() === needle) ?? null;
}
