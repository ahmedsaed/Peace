/**
 * Turning a bank's SMS into the fields of a record.
 *
 * THE MESSAGE IS READ, NOT THE INBOX. Android hands over the notification the
 * messaging app already showed, which is the same text a person reads off their
 * lock screen — no `READ_SMS`, no access to conversation history, and nothing
 * captured from any app but the one that owns SMS.
 *
 * NOTHING IS PARSED WITH A REGEX. Per-bank templates were the original plan and
 * are a trap: they work on the four messages you tested with, and the fifth is
 * a new template the bank rolled out on a Tuesday. The model reads it, and
 * everything it returns is checked the same way a receipt's is — range-checked,
 * dropped if it does not survive, and never written to the ledger without a
 * person agreeing to it.
 *
 * Pure. No network, no database, no native module — so the filtering, the
 * de-duplication and the validation are all tested without a phone.
 */

import { decimalsFor, roundHalfAwayFromZero } from './money';

/** One notification, exactly as the native side captured it. */
export type Capture = {
  /** Whatever the messaging app put in the title: "CIB", a short code, a number. */
  sender: string;
  body: string;
  packageName: string;
  /** Epoch ms, from Android. */
  postedAt: number;
};

/** What a bank message turned out to say. Every field may be absent. */
export type BankReading = {
  /** Positive minor units. Which side of the ledger is `direction`'s job. */
  amountMinor: number | null;
  currency: string | null;
  /**
   * Money OUT or money IN, as the message says in words.
   *
   * Read from "debited", "purchase", "withdrawal" or "credited", never inferred
   * from a sign — the message carries no sign, and guessing is how a refund
   * becomes income.
   */
  direction: 'out' | 'in' | null;
  /** The shop or counterparty, for the note. */
  merchant: string | null;
  /**
   * An ACCOUNT NAME to match against the user's own. Never an id.
   *
   * A bank writes "card ending 0042", which means nothing to this app on its
   * own — so the user's own account names are offered in the prompt and their
   * own guidance is where the mapping lives. Getting this right is what puts
   * the record on the card that was actually charged, and the currency follows
   * the account.
   *
   * THE TAIL ITSELF IS NOT ASKED FOR. It was, and nothing ever read it: the
   * name is what resolves to an account, and anyone wanting to see the digits
   * has the whole message in front of them on the review sheet. Same rule as
   * the date — a field the model returns and the app ignores is a field
   * somebody eventually wires up.
   */
  account: string | null;
  /**
   * A category NAME to match against the user's own. Never an id.
   *
   * The receipt reader has offered the user's categories from the start; this
   * one asked for nothing and so filed every bank record as Uncategorised —
   * which looked like the model declining to guess and was the app never
   * asking. Same list, same matcher, same rule: an invented name resolves to
   * nothing rather than creating a category.
   */
  category: string | null;
  /**
   * A CASH WITHDRAWAL, which is not spending at all.
   *
   * Money leaving a bank account at an ATM has not been spent — it has moved
   * to the notes in a pocket, and it is spent later, one purchase at a time.
   * Filed as an expense it is counted TWICE: once at the machine and again at
   * the shop, so the month reads high and the cash account never fills. It is
   * a transfer, and the only one a bank message can describe.
   */
  withdrawal: boolean;
};

export const EMPTY_BANK_READING: BankReading = {
  amountMinor: null,
  currency: null,
  direction: null,
  merchant: null,
  account: null,
  category: null,
  withdrawal: false,
};

export class BankSmsError extends Error {}

/**
 * Which senders are worth reading.
 *
 * CASE-INSENSITIVE SUBSTRING, and the forgiving direction is chosen on purpose.
 * Senders are not stable strings — the same bank arrives as "CIB", "CIB Bank"
 * and "CIB-Alerts" depending on the route the message took — and the two
 * failures are not equal: a message that is not read is a record silently never
 * offered, while a message read that should not have been is one junk proposal
 * dismissed with a tap.
 */
export function matchesSender(sender: string, allowed: string[]): boolean {
  const needle = sender.trim().toLowerCase();
  if (needle === '') return false;
  return allowed.some((entry) => {
    const candidate = entry.trim().toLowerCase();
    return candidate !== '' && needle.includes(candidate);
  });
}

/**
 * A stable identity for a captured message.
 *
 * The native store de-duplicates within itself, but a message can be captured
 * again AFTER a drain — a messaging app re-posts a whole conversation when the
 * next message arrives — so the same text can come back an hour later and be
 * offered a second time. Sender plus body is the identity; the posted time is
 * NOT, because a re-post carries a new one for the same words.
 *
 * FNV-1a, in JavaScript, because this must be synchronous and deterministic.
 * It is not a security hash and does not need to be: the cost of a collision is
 * one message not offered, and the input space is one person's bank alerts.
 */
export function captureKey(sender: string, body: string): string {
  const input = `${sender.trim().toLowerCase()}\0${body.trim()}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // The FNV prime, applied with shifts so it stays inside 32 bits in JS.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Read what the native side handed over.
 *
 * Anything malformed is DROPPED rather than throwing: one unreadable entry must
 * not cost the whole drain, because the drain has already cleared the store and
 * there is nothing to retry from.
 */
export function parseCaptures(json: string): Capture[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    console.warn('[bank-sms] the capture store held something that was not JSON');
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const out: Capture[] = [];
  for (const item of raw) {
    const entry = (item ?? {}) as Record<string, unknown>;
    const sender = typeof entry.sender === 'string' ? entry.sender.trim() : '';
    const body = typeof entry.body === 'string' ? entry.body.trim() : '';
    const postedAt = Number(entry.postedAt);
    if (sender === '' || body === '' || !Number.isFinite(postedAt)) continue;

    out.push({
      sender,
      body,
      packageName: typeof entry.packageName === 'string' ? entry.packageName : '',
      postedAt,
    });
  }
  return out;
}

/**
 * What the model is asked.
 *
 * The message is quoted rather than described, and the instruction is to read
 * only what is written. A bank SMS states its amount and its direction in
 * words; anything it does not state is a null, because a plausible invention
 * here becomes a wrong number in somebody's ledger.
 *
 * THE DATE IS NOT ASKED FOR. Android stamps the notification with the moment it
 * arrived, to the second, and a bank alert arrives when the money moves — so
 * the exact answer is already in hand. Asking a model to read "13/08/2026"
 * instead invites the one mistake that cannot be spotted afterwards, because
 * the same string is a valid date under two conventions and both look right.
 *
 * THE FIELD RULES ARE NOT THE USER'S TO EDIT, and the line between the two
 * halves is what a field MEANS versus what is true of one person's money. What
 * "direction" is and how it must be read is the output contract — offering it
 * as editable text put the app's own wiring in a settings box, invited someone
 * to delete a rule the parser depends on, and left nowhere to say the thing
 * they actually wanted to say. Their box starts EMPTY and holds only what no
 * code could know: which card is which, a bank's particular wording.
 */
const FIELD_RULES = [
  'amount: the transaction amount as a number, unsigned.',
  'currency: the ISO 4217 code if the message names one or uses an unambiguous symbol.',
  'direction: "out" for a debit, purchase, withdrawal, payment or transfer sent;',
  '  "in" for a credit, deposit, refund or transfer received. Read the WORDS —',
  '  never infer it from anything else. Null if the message does not say.',
  'merchant: the shop or counterparty named, if any. No branch codes, no addresses.',
  'account: which of my accounts was charged, chosen from the list below, or null.',
  '  A message naming only a card number matches no account on its own; choose one',
  '  only when the message or a rule below identifies it.',
  'category: the single best match from the categories listed below, or null.',
  '  Guess from the merchant — a supermarket is groceries, a fuel station is',
  '  transport. Null only when the message names nothing to go on.',
  'withdrawal: true ONLY for cash taken out — an ATM, a cash advance, a counter',
  '  withdrawal. Cash moved into a pocket has not been spent yet, so this is not',
  '  a purchase. False for everything else, including transfers to other people.',
  '',
  'Ignore balance figures, available-credit figures, OTPs, marketing and anything',
  'that is not a single completed transaction. If the message is not about one,',
  'return nulls throughout.',
].join('\n');

/**
 * The whole prompt: the contract, then the user's own rules, then the message.
 *
 * `guidance` is EMPTY for almost everybody and the prompt has to be complete
 * without it. What the user adds is knowledge no code can hold — which card is
 * which, a bank's particular wording — and it goes AFTER the field rules so a
 * specific instruction can qualify a general one, never the other way round.
 */
export function buildBankPrompt(
  body: string,
  accountNames: string[] = [],
  guidance = '',
  categoryNames: string[] = []
): string {
  const accounts = accountNames.length > 0 ? accountNames.join(', ') : 'none';
  const categories = categoryNames.length > 0 ? categoryNames.join(', ') : 'none';
  const mine = guidance.trim();
  return [
    'You are reading a bank notification for an expense tracker.',
    'Return only what the message actually states. Use null for anything it does',
    'not say — a null is far more useful than a guess, because the person will be',
    'checking these figures against their bank.',
    '',
    FIELD_RULES,
    ...(mine === '' ? [] : ['', "The account holder's own rules, which override the above:", mine]),
    '',
    `My accounts: ${accounts}.`,
    `The categories to choose from: ${categories}.`,
    '',
    'The message:',
    body,
  ].join('\n');
}

/** The shape the model must answer in. Structured output, never prose. */
export const BANK_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    amount: { type: 'number', nullable: true },
    currency: { type: 'string', nullable: true },
    direction: { type: 'string', nullable: true, enum: ['out', 'in'] },
    merchant: { type: 'string', nullable: true },
    account: { type: 'string', nullable: true },
    category: { type: 'string', nullable: true },
    withdrawal: { type: 'boolean', nullable: true },
  },
} as const;

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Turn the reply into something a record screen can use.
 *
 * Nothing here throws on a bad field. A message whose merchant is unreadable
 * but whose amount and direction are plain still saves the typing, and refusing
 * it over one junk field throws that away. Only a reply that is not an object
 * at all is refused.
 */
export function parseBankReading(raw: unknown, fallbackCurrency = 'USD'): BankReading {
  if (typeof raw !== 'object' || raw === null) {
    throw new BankSmsError('The model returned something that was not a reading.');
  }
  const body = raw as Record<string, unknown>;

  // Not truncated before it is tested — capping this at three characters first
  // would turn "pounds" into "POU" and manufacture a currency.
  const currency = cleanString(body.currency, 40);
  const code = currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : null;

  const direction = body.direction === 'out' || body.direction === 'in' ? body.direction : null;

  return {
    amountMinor: parseAmount(body.amount, code ?? fallbackCurrency),
    currency: code,
    direction,
    merchant: cleanString(body.merchant, 80),
    account: cleanString(body.account, 60),
    category: cleanString(body.category, 60),
    // Only an explicit true. A model that omits the field, or answers "yes" as
    // a string, has not said this was a withdrawal — and wrongly calling a
    // purchase a transfer hides it from every spending total there is.
    withdrawal: body.withdrawal === true,
  };
}

function parseAmount(value: unknown, currency: string): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const magnitude = Math.abs(value);
  if (magnitude === 0) return null;
  // A misread decimal point or a balance figure read as an amount. Generous on
  // purpose: this catches nonsense, it does not second-guess a large transfer.
  if (magnitude >= 1e12) return null;

  // Scale, trim the float noise, then round away from zero — the same rule the
  // receipt reader follows, and for the same reason `toFixed` was wrong there.
  const scale = 10 ** decimalsFor(currency);
  return roundHalfAwayFromZero(Number((magnitude * scale).toPrecision(12)));
}

/**
 * Is this reading worth offering to the user?
 *
 * An amount AND a direction, or it is not a transaction this app can enter.
 * Everything else is decoration: a message with a total and no merchant is
 * still a record worth saving, but one with no direction is a number with no
 * meaning and would have to be guessed at — which is how a refund becomes
 * income.
 */
/**
 * Match a returned account name to one the user actually has.
 *
 * The same shape as `matchCategory` in receipt.ts, and never creates one: a
 * model that answers "Visa" for a ledger with no such account means nothing,
 * and inventing accounts from bank messages would be far worse than filing the
 * record against the default and letting the user move it.
 */
export function matchAccount<T extends { id: string; name: string }>(
  wanted: string | null,
  accounts: T[]
): T | null {
  if (!wanted) return null;
  const needle = wanted.trim().toLowerCase();
  return accounts.find((a) => a.name.trim().toLowerCase() === needle) ?? null;
}

/**
 * The note a record made from a bank message starts with.
 *
 * THE MESSAGE ALWAYS SURVIVES. What the model made of it goes first, because
 * that is the line worth reading in a list — but the bank's own words are the
 * only record of what was actually received, and they are exactly what is
 * wanted when the reading is wrong or absent. Dropping them left a failed
 * reading as an empty note: the app had the text, showed it in the grey row,
 * and then threw it away at the one moment it became permanent.
 *
 * Kept whole. A receipt's worth of text costs nothing to store, makes the row
 * subtitle no longer (it is one line and truncates), and gives search more of
 * the wording a person would actually type.
 */
export function captureNote(capture: { merchant: string | null; body: string }): string {
  const merchant = capture.merchant?.trim();
  const body = capture.body.trim();
  if (!merchant) return body;
  // Already the whole of it — a one-line alert whose merchant IS the message.
  if (merchant === body) return merchant;
  return `${merchant}\n\n${body}`;
}

export function isUsableReading(reading: BankReading): boolean {
  return reading.amountMinor !== null && reading.direction !== null;
}
