/**
 * Speech, turned into the fields of a record — or into text for Penny.
 *
 * THE AUDIO GOES TO GEMINI ITSELF, not to Android's speech recogniser first.
 * The people asking for this speak Arabic and English in the same sentence
 * ("دفعت 300 Uber من الـ CIB"), and the platform recogniser listens for ONE
 * language per session: it would hear half of that sentence as noise. A model
 * that hears the audio understands both halves and the meaning at once, so a
 * record is one request rather than a transcript and then a second read.
 *
 * SAME DISCIPLINE AS A RECEIPT. Structured output, temperature zero, and
 * everything that comes back is text somebody typed badly — range-checked,
 * matched against the ledger's own names, dropped if it does not survive, and
 * never written anywhere except a form the person still has to save.
 *
 * Pure: no network, no recorder, no database. The recording lives in
 * `state/voice.ts`, the transport in `gemini.ts`.
 */

import { decimalsFor, roundHalfAwayFromZero } from './money';

/** What a spoken record can offer. Every field may be absent. */
export type VoiceReading = {
  /** Exactly what was heard, each language in its own script. Shown, never saved. */
  transcript: string | null;
  /**
   * Which kind of record was described, from the WORDS ("paid", "got", "moved"),
   * never from a sign — speech has none, and guessing is how a refund becomes
   * income.
   */
  type: 'expense' | 'income' | 'transfer' | null;
  /** Positive minor units, scaled by `currency` when one was said. */
  amountMinor: number | null;
  /** ISO 4217, only when the speaker named one. */
  currency: string | null;
  /** An ACCOUNT NAME to match against the user's own. Never an id. */
  account: string | null;
  /** Where a transfer went. Same matching, same rule. */
  toAccount: string | null;
  /** A category NAME from the user's own list, or nothing. */
  category: string | null;
  /** What the money was for, in the speaker's own words and language. */
  note: string | null;
  /** yyyy-mm-dd, only when a day was said ("yesterday", "on Thursday"). */
  occurredOn: string | null;
};

export const EMPTY_VOICE_READING: VoiceReading = {
  transcript: null,
  type: null,
  amountMinor: null,
  currency: null,
  account: null,
  toAccount: null,
  category: null,
  note: null,
  occurredOn: null,
};

export class VoiceError extends Error {}

/**
 * The longest clip either screen records. Speaking a record takes a few
 * seconds and a question rarely a minute; past that the mic is more likely
 * left open by accident than in use, and an open mic nobody is watching is the
 * one thing this feature must not become.
 */
export const MAX_CLIP_MS = 60_000;

/** Shorter than this is a tap, not a sentence — not worth a request. */
export const MIN_CLIP_MS = 600;

/**
 * The loudest moment of a clip that contains a voice, in dBFS.
 *
 * A MODEL GIVEN SILENCE INVENTS SPEECH. The first emulator test sent clips of
 * pure digital silence (its microphone was not connected) and got back fluent,
 * plausible Arabic sentences about electricity meters and club fees — and the
 * record screen filled itself in from them. So silence is caught HERE, before
 * anything is sent: the recorder meters every clip, and a clip whose peak never
 * rose above a quiet room was not spoken into.
 *
 * Speech held at a phone peaks around -25 to -10; a quiet room sits near -55;
 * a dead or muted microphone reports -160. -45 leaves a whisper room either way.
 */
export const SILENT_PEAK_DB = -45;

/** Was anything loud enough to be speech heard? Unknown (no metering) passes. */
export function heardAnything(peakDb: number | null): boolean {
  return peakDb === null || peakDb > SILENT_PEAK_DB;
}

/** What every spoken input shares: how to hear a mixed-language speaker. */
const HEARING_RULES = [
  'FIRST decide whether a person can clearly be heard speaking. If the audio is',
  'silent, is only noise, or you cannot make out the words, set speech to false',
  'and every other field to null. Never guess at words you cannot hear: an',
  'invented sentence is far worse than none, because the app acts on it.',
  '',
  'The speaker may mix Arabic (any dialect, often Egyptian) and English in one',
  'sentence. Both are normal; neither is noise.',
  'How numbers can sound (these show the FORM of speech, not what was said):',
  '"ميتين وخمسين" is 250, "ألف ونص" is 1500, "two fifty" is 250.',
].join('\n');

const FIELD_RULES = [
  'speech: true only if words were clearly spoken.',
  'transcript: exactly what was said, word for word. Write Arabic in Arabic',
  '  script and English in Latin letters, as spoken. Do not translate.',
  'type: "expense" for money spent or paid, "income" for money received or',
  '  earned, "transfer" for money moved between two of the accounts listed below',
  '  (including taking cash out of a machine). Null if it is not clear.',
  'amount: the amount of money, as a plain number. Not a quantity of items.',
  'currency: the ISO 4217 code, only if a currency was named ("dollars" is',
  '  USD, "جنيه" is the local pound). Null if none was said.',
  'account: the account the money came from or went into, from the list below,',
  '  or null. For a transfer, the account it LEFT.',
  'to_account: for a transfer only, the account it went to, from the list below.',
  'category: the single best match from the list below, or null.',
  'note: a few words saying what the money was for, in the language and words',
  '  the speaker used ("lunch with Sara", "بنزين"). Leave out the amount, the',
  '  account and the date. Null if nothing was said about it.',
  'date: yyyy-mm-dd, only if a day was said ("yesterday", "امبارح", "on',
  '  Thursday"), worked out from today\'s date below. Null otherwise.',
].join('\n');

/**
 * The record prompt: how to hear, the contract, the user's rules, the ledger.
 *
 * TODAY IS GIVEN, with its weekday, because "yesterday" and "last Thursday"
 * mean nothing without it and a model left to guess picks its training date.
 * The account and category lists are passed in for the same reason a receipt's
 * are: a name this ledger does not have is worse than none.
 */
export function buildVoicePrompt({
  today,
  accountNames,
  categoryNames,
  homeCurrency,
  guidance = '',
}: {
  today: Date;
  accountNames: string[];
  categoryNames: string[];
  homeCurrency: string;
  guidance?: string;
}): string {
  const accounts = accountNames.length > 0 ? accountNames.join(', ') : 'none';
  const categories = categoryNames.length > 0 ? categoryNames.join(', ') : 'none';
  const mine = guidance.trim();
  return [
    'You are listening to someone describe one record for an expense tracker.',
    'Return only what was actually said. Use null for anything not said or that',
    'you would be guessing at — the person will check the form before saving.',
    '',
    HEARING_RULES,
    '',
    FIELD_RULES,
    ...(mine === '' ? [] : ['', "The account holder's own rules, which override the above:", mine]),
    '',
    `Today is ${weekday(today)}, ${ymd(today)}. Their home currency is ${homeCurrency}.`,
    `My accounts: ${accounts}.`,
    `The categories to choose from: ${categories}.`,
  ].join('\n');
}

export const VOICE_SCHEMA = {
  type: 'object',
  properties: {
    // First, so the model commits to whether anything was said before it is
    // asked what was said.
    speech: { type: 'boolean' },
    transcript: { type: 'string', nullable: true },
    type: { type: 'string', nullable: true },
    amount: { type: 'number', nullable: true },
    currency: { type: 'string', nullable: true },
    account: { type: 'string', nullable: true },
    to_account: { type: 'string', nullable: true },
    category: { type: 'string', nullable: true },
    note: { type: 'string', nullable: true },
    date: { type: 'string', nullable: true },
  },
} as const;

/**
 * Penny's prompt: words only, nothing understood.
 *
 * The transcript lands in the composer for the person to read and correct
 * before it is sent — so this must be what they SAID, not a tidier question
 * the model would rather answer. A cleaned-up version is a model putting words
 * in somebody's mouth one step before another model acts on them.
 */
export function buildTranscribePrompt(): string {
  return [
    'Transcribe this voice message, word for word.',
    '',
    HEARING_RULES,
    '',
    'Write Arabic in Arabic script and English in Latin letters, as spoken. Do',
    'not translate, summarise, answer or correct it. Leave out filler sounds',
    '("umm", "يعني" used as filler).',
  ].join('\n');
}

export const TRANSCRIBE_SCHEMA = {
  type: 'object',
  properties: { speech: { type: 'boolean' }, text: { type: 'string', nullable: true } },
} as const;

/** The transcript out of Penny's reply. Empty means nothing was heard. */
export function parseTranscript(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) {
    throw new VoiceError('The model returned something that was not a transcript.');
  }
  const body = raw as Record<string, unknown>;
  // Only an explicit false: a reply that left the flag out still carries words.
  if (body.speech === false) return '';
  return clean(body.text, 2_000) ?? '';
}

/**
 * Turn the reply into something the record screen can use.
 *
 * NOTHING THROWS ON A BAD FIELD, for the receipt's reason: a clip whose
 * account was mumbled but whose amount was clear still saves the typing.
 */
export function parseVoiceReading(raw: unknown, fallbackCurrency: string, today: Date): VoiceReading {
  if (typeof raw !== 'object' || raw === null) {
    throw new VoiceError('The model returned something that was not a reading.');
  }
  const body = raw as Record<string, unknown>;
  // The model said nobody spoke: whatever else it filled in is invention.
  if (body.speech === false) return { ...EMPTY_VOICE_READING };

  // Tested BEFORE it is shortened, never after — see the receipt reader, where
  // capping "pounds" to three letters manufactured the currency "POU".
  const said = clean(body.currency, 40);
  const currency = said && /^[A-Za-z]{3}$/.test(said) ? said.toUpperCase() : null;
  const type = body.type === 'expense' || body.type === 'income' || body.type === 'transfer' ? body.type : null;
  const date = clean(body.date, 10);

  return {
    transcript: clean(body.transcript, 2_000),
    type,
    amountMinor: parseAmount(body.amount, currency ?? fallbackCurrency),
    currency,
    account: clean(body.account, 60),
    toAccount: type === 'transfer' ? clean(body.to_account, 60) : null,
    category: clean(body.category, 60),
    note: clean(body.note, 200),
    occurredOn: date && isPlausibleDay(date, today) ? date : null,
  };
}

/** Did the clip say anything the form could use? */
export function isEmptyVoiceReading(reading: VoiceReading): boolean {
  return (
    reading.type === null &&
    reading.amountMinor === null &&
    reading.account === null &&
    reading.toAccount === null &&
    reading.category === null &&
    reading.note === null &&
    reading.occurredOn === null
  );
}

/**
 * The note a spoken record ends with: what it was for, then what was SAID.
 *
 * The transcript goes at the foot, like a bank message's own words under the
 * reading of it: the short note is the line the list shows, and the words are
 * the record of what was actually said — the thing to check when a field came
 * out wrong, and the half search can find later. Not repeated when the note
 * already is the whole of it.
 */
export function spokenNote(existing: string, reading: Pick<VoiceReading, 'note' | 'transcript'>): string {
  const parts = [existing.trim(), reading.note?.trim() ?? '', reading.transcript?.trim() ?? ''].filter(
    (part, index, all) => part !== '' && !all.slice(0, index).some((earlier) => earlier.includes(part))
  );
  return parts.join('\n\n');
}

/** "0:07" — the recording timer. */
export function clipClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * The amount, as integer minor units — unsigned, like a receipt's total.
 *
 * Which side of the ledger it lands on is the TYPE's job. Scaled by the said
 * currency's decimals, the float noise trimmed before rounding, and a ceiling
 * that exists to catch a misheard "million", not to doubt a big purchase.
 */
function parseAmount(value: unknown, currency: string): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const magnitude = Math.abs(value);
  if (magnitude === 0 || magnitude >= 1e12) return null;
  const scale = 10 ** decimalsFor(currency);
  return roundHalfAwayFromZero(Number((magnitude * scale).toPrecision(12)));
}

/**
 * A real calendar day, not in the future, and within a year.
 *
 * Speech dates are RELATIVE ("Thursday"), so the failure is a model counting
 * from the wrong week — or year. A record dated next month, or the same day
 * eighteen months ago, is that mistake, and dropping the date leaves today,
 * which is right far more often than either.
 */
function isPlausibleDay(value: string, today: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  if (day.getFullYear() !== y || day.getMonth() !== m - 1 || day.getDate() !== d) return false;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const yearAgo = new Date(start.getFullYear() - 1, start.getMonth(), start.getDate());
  return day <= start && day >= yearAgo;
}

function ymd(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

// Spelled out rather than through Intl: Hermes' ICU data is not Node's, and
// the model needs the English name, whatever language the phone is in.
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function weekday(date: Date): string {
  return WEEKDAYS[date.getDay()];
}
