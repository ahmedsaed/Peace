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
  /**
   * What was actually bought, line by line, as printed.
   *
   * A merchant and a total say what a record COST; this says what it was, and
   * it is the half a person needs three months later when "Carrefour 840" no
   * longer means anything. It goes in the note, which is one text field — so
   * the list subtitle truncates it to a line and search reads all of it.
   *
   * Not capped by line count. A long receipt is a long receipt, the text costs
   * nothing to store, and the only ceiling is a nonsense guard against a model
   * returning a runaway blob.
   */
  items: string | null;
};

export const EMPTY_READING: ReadReceipt = {
  amountMinor: null,
  currency: null,
  occurredOn: null,
  merchant: null,
  category: null,
  items: null,
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
 * THE FIELD RULES, which are not the user's to edit.
 *
 * The line between the two halves is what a field MEANS versus what is true of
 * one person's spending. That a "total" is the final figure and a date must be
 * yyyy-mm-dd is the output contract — offering it as editable text put the
 * app's own wiring in a settings box, invited someone to delete a rule the
 * parser depends on, and left nowhere to say the thing they actually wanted to
 * say. Their box starts EMPTY and holds only what no code could know: a shop
 * that keeps being misread, a service charge that should not count.
 */
const FIELD_RULES = [
  'total: the FINAL amount paid, after discounts and including tax and service.',
  '  Not a subtotal, not a single line item, not the change given.',
  'currency: the ISO 4217 code, if it is printed or unambiguous from the symbol.',
  'date: the date of the purchase in yyyy-mm-dd, not the date it was printed',
  '  if those differ, and not today.',
  'merchant: the trading name of the shop, as printed. No branch numbers,',
  '  no address, no legal suffix.',
  'category: the single best match from the list below, or null.',
  'items: every line of the receipt, one per line, as "name x quantity — price",',
  '  leaving out any part that is not printed. Copy the names as they appear,',
  '  abbreviations and all. Null if the receipt lists nothing itemised.',
].join('\n');

/**
 * The whole prompt: the contract, then the user's own rules, then the data.
 *
 * `guidance` is EMPTY for almost everybody and the prompt has to be complete
 * without it. What the user adds goes AFTER the field rules so a specific
 * instruction can qualify a general one, never the other way round, and the
 * category list goes last so it cannot be mistaken for prose.
 */
export function buildPrompt(categoryNames: string[], guidance = ''): string {
  const list = categoryNames.length > 0 ? categoryNames.join(', ') : 'none';
  const mine = guidance.trim();
  return [
    'You are reading a photograph of a receipt or invoice for an expense tracker.',
    'Return only what you can actually see. Use null for anything unreadable,',
    'missing, or that you would be guessing at — a null is far more useful here',
    'than a plausible invention, because the person will be checking these',
    'numbers against the paper in their hand.',
    '',
    FIELD_RULES,
    ...(mine === '' ? [] : ['', "The account holder's own rules, which override the above:", mine]),
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
    items: { type: 'string', nullable: true },
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
  /**
   * Generous, because a weekly shop really is forty lines — this is a guard
   * against a model that has started generating rather than reading, not a
   * limit on how much of a receipt may be kept.
   */
  const items = cleanString(body.items, 4_000);

  return {
    amountMinor: parseTotal(body.total, code ?? fallbackCurrency),
    currency: code,
    occurredOn: date && isRealDate(date) ? date : null,
    merchant,
    category,
    items,
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
    reading.category === null &&
    reading.items === null
  );
}

/**
 * The note a reading fills in: the shop, then what was in the basket.
 *
 * The merchant leads because it is the line the list shows. Contents follow
 * after a blank line, which keeps the subtitle readable and leaves the detail
 * one tap away — and makes the whole receipt searchable, which is the point.
 */
export function receiptNote(reading: Pick<ReadReceipt, 'merchant' | 'items'>): string {
  const merchant = reading.merchant?.trim();
  const items = reading.items?.trim();
  if (!merchant) return items ?? '';
  if (!items) return merchant;
  return `${merchant}\n\n${items}`;
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
