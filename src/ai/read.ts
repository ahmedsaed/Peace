/**
 * Reading things into the fields of a record: a receipt, a bank message, a
 * voice clip — and a spoken question into text for Penny's composer.
 *
 * STRUCTURED OUTPUT, NOT PROSE. Every request here carries a schema and asks
 * for JSON, so the model answers with the fields themselves rather than a
 * sentence about them. The alternative — asking in English and pulling numbers
 * out with a regex — works on the receipts you test with and eventually reads
 * the wrong figure off one you did not. What comes back is still treated as
 * text somebody typed badly: `receipt.ts`, `voice.ts` and `bank-sms.ts` own
 * the prompts, the schemas and the checking, and this file only asks.
 *
 * NOTHING HERE IS LOAD-BEARING. Every failure ends with a message and a form
 * the user can still fill in by hand. The API key never enters the `settings`
 * table — that table is copied into every backup. See `secrets.ts`.
 */

import { base64ToText, isTextMime } from '../lib/attachment';
import { buildPrompt, parseReading, ReceiptError, RESPONSE_SCHEMA, type ReadReceipt } from '../lib/receipt';
import {
  buildTranscribePrompt,
  buildVoicePrompt,
  parseTranscript,
  parseVoiceReading,
  TRANSCRIBE_SCHEMA,
  VOICE_SCHEMA,
  VoiceError,
  type VoiceReading,
} from '../lib/voice';
import type { Schema } from './content';
import { AiError } from './error';
import { generateJson, READ_TIMEOUT_MS, transcribeAudio } from './index';
import type { Endpoint } from './providers';

type Transport = { timeoutMs?: number; fetchImpl?: typeof fetch };

export type ReadOptions = Transport & {
  /** The user's own category names, so the model picks from them. */
  categoryNames?: string[];
  /** The editable half of the prompt. Empty falls back to the shipped default. */
  guidance?: string;
  /** Decides the decimal places when the receipt names no currency. */
  fallbackCurrency?: string;
};

/**
 * Read a receipt or invoice: a photo, a PDF, or a text file.
 *
 * Photos and PDFs go as inline files, which the model reads directly. TEXT goes
 * as text, fenced, after the instructions: it is the one input every model
 * reads, and a fence is what keeps a line in somebody's e-receipt from being
 * taken as an instruction rather than as the document.
 */
export async function readReceipt(
  endpoint: Endpoint,
  base64: string,
  mimeType: string,
  {
    timeoutMs = READ_TIMEOUT_MS,
    fetchImpl = fetch,
    categoryNames = [],
    fallbackCurrency = 'USD',
    guidance = '',
  }: ReadOptions = {}
): Promise<ReadReceipt> {
  const raw = await generateJson(
    endpoint,
    [
      { text: buildPrompt(categoryNames, guidance.trim() || undefined) },
      isTextMime(mimeType)
        ? { text: `The document, as plain text, between the markers:\n<<<\n${base64ToText(base64)}\n>>>` }
        : { inlineData: { mimeType, data: base64 } },
    ],
    RESPONSE_SCHEMA,
    { timeoutMs, fetchImpl, label: 'receipt read' }
  );

  try {
    return parseReading(raw, fallbackCurrency);
  } catch (error) {
    if (error instanceof ReceiptError) throw new AiError(error.message);
    throw error;
  }
}

/**
 * Read a bank message into the fields of a record.
 *
 * Text, not an image, and otherwise the same discipline: structured output, a
 * temperature of zero, and everything that comes back treated as text somebody
 * typed badly. `lib/bank-sms.ts` owns the prompt, the schema and the checking.
 */
export async function readBankMessage(
  endpoint: Endpoint,
  prompt: string,
  responseSchema: Schema,
  { timeoutMs = READ_TIMEOUT_MS, fetchImpl = fetch }: Transport = {}
): Promise<unknown> {
  return generateJson(endpoint, [{ text: prompt }], responseSchema, {
    timeoutMs,
    fetchImpl,
    label: 'bank message read',
  });
}

/**
 * Write out what a file says, for a model that cannot see it.
 *
 * Penny can talk through one model and read attachments with another; this is
 * the second one's whole job. Everything somebody might ask about goes into
 * the text — afterwards it is all Penny will ever have of the file.
 */
export async function readDocument(
  endpoint: Endpoint,
  base64: string,
  mimeType: string,
  { timeoutMs = READ_TIMEOUT_MS, fetchImpl = fetch }: Transport = {}
): Promise<string> {
  const raw = (await generateJson(
    endpoint,
    [
      {
        text: [
          'Write out what this file says, for someone who cannot see it.',
          'Say what kind of document it is and who issued it, then every date, every line item with its',
          'amount, discounts, taxes, fees, totals, the currency and how it was paid. Copy names and figures',
          'exactly as printed. Plain text, no commentary. If it is not a document, describe what it shows.',
        ].join('\n'),
      },
      { inlineData: { mimeType, data: base64 } },
    ],
    { type: 'object', properties: { text: { type: 'string' } } },
    { timeoutMs, fetchImpl, label: 'attachment read', meanwhile: 'Try attaching it again.' }
  )) as { text?: unknown } | null;
  return typeof raw?.text === 'string' ? raw.text.trim().slice(0, 8_000) : '';
}

/** A recorded clip, as the recorder hands it over. */
export type VoiceClip = { base64: string; mimeType: string };

/**
 * What hears a clip: a model that listens, or a transcription model that only
 * writes the words down — in which case `reader` is the model that reads them.
 */
export type Listener =
  | { kind: 'hears'; endpoint: Endpoint }
  | { kind: 'transcribes'; endpoint: Endpoint; reader: Endpoint };

type VoiceContext = {
  today: Date;
  accountNames: string[];
  categoryNames: string[];
  homeCurrency: string;
  /** Decides the decimal places when no currency was said: the account's. */
  fallbackCurrency: string;
  guidance?: string;
};

/** The names a transcription model should spell the way the ledger does. */
function vocabulary({ accountNames, categoryNames }: Pick<VoiceContext, 'accountNames' | 'categoryNames'>): string {
  return [...accountNames, ...categoryNames].join(', ').slice(0, 800);
}

/**
 * Hear a spoken record, whichever way this listener hears.
 *
 * One request when the model hears; two when it only transcribes — the words
 * first, then an ordinary model reads them exactly as it would have read the
 * clip, with the same prompt, schema and checks.
 */
export async function hearRecord(
  listener: Listener,
  clip: VoiceClip,
  context: VoiceContext & Transport
): Promise<VoiceReading> {
  if (listener.kind === 'hears') return readVoice(listener.endpoint, clip, context);
  const words = await transcribeAudio(listener.endpoint, clip, {
    prompt: vocabulary(context),
    timeoutMs: context.timeoutMs,
    fetchImpl: context.fetchImpl,
  });
  if (words === '') return parseVoiceReading({ speech: false }, context.fallbackCurrency, context.today);
  return readSpokenText(listener.reader, words, context);
}

/** Write a spoken question down for Penny's composer, whichever way this listener hears. */
export async function writeDown(listener: Listener, clip: VoiceClip, transport: Transport = {}): Promise<string> {
  if (listener.kind === 'hears') return transcribe(listener.endpoint, clip, transport);
  return transcribeAudio(listener.endpoint, clip, { ...transport, meanwhile: 'Type the question instead.' });
}

/**
 * Read a record out of words already written down.
 *
 * The same prompt as a clip, with the words fenced after it — a fence is what
 * keeps somebody's sentence from being taken as an instruction — and a note
 * that a machine wrote them, so a misheard name is matched, not trusted.
 */
export async function readSpokenText(
  endpoint: Endpoint,
  words: string,
  {
    today,
    accountNames,
    categoryNames,
    homeCurrency,
    fallbackCurrency,
    guidance = '',
    timeoutMs = READ_TIMEOUT_MS,
    fetchImpl = fetch,
  }: VoiceContext & Transport
): Promise<VoiceReading> {
  const raw = await generateJson(
    endpoint,
    [
      { text: buildVoicePrompt({ today, accountNames, categoryNames, homeCurrency, guidance }) },
      {
        text: `There is no audio: a speech-to-text model already wrote down what was said, and may have misheard a name. What was said, between the markers:\n<<<\n${words}\n>>>`,
      },
    ],
    VOICE_SCHEMA,
    { timeoutMs, fetchImpl, label: 'voice read (transcript)' }
  );
  try {
    return parseVoiceReading(raw, fallbackCurrency, today);
  } catch (error) {
    if (error instanceof VoiceError) throw new AiError(error.message);
    throw error;
  }
}

/**
 * Hear a spoken record and return its fields.
 *
 * The clip goes INLINE, after the instructions, exactly as a receipt photo
 * does — a few seconds of 16kHz mono AAC is tens of kilobytes, far inside the
 * inline limit, and a file upload would be a second request and a file left on
 * the provider's side for something heard once.
 */
export async function readVoice(
  endpoint: Endpoint,
  clip: VoiceClip,
  {
    today,
    accountNames,
    categoryNames,
    homeCurrency,
    fallbackCurrency,
    guidance = '',
    timeoutMs = READ_TIMEOUT_MS,
    fetchImpl = fetch,
  }: Transport & {
    today: Date;
    accountNames: string[];
    categoryNames: string[];
    homeCurrency: string;
    /** Decides the decimal places when no currency was said: the account's. */
    fallbackCurrency: string;
    guidance?: string;
  }
): Promise<VoiceReading> {
  const raw = await generateJson(
    endpoint,
    [
      { text: buildVoicePrompt({ today, accountNames, categoryNames, homeCurrency, guidance }) },
      { inlineData: { mimeType: clip.mimeType, data: clip.base64 } },
    ],
    VOICE_SCHEMA,
    { timeoutMs, fetchImpl, label: 'voice read' }
  );
  try {
    return parseVoiceReading(raw, fallbackCurrency, today);
  } catch (error) {
    if (error instanceof VoiceError) throw new AiError(error.message);
    throw error;
  }
}

/**
 * Turn a spoken question into text for Penny's composer.
 *
 * TEXT, NOT THE AUDIO, goes into the conversation. Penny's history is replayed
 * to the model verbatim on every turn, so a clip sent as a message would be
 * sent again with every question after it — and stored, and backed up. As
 * text it costs nothing further, and the person reads and corrects it before
 * anything acts on it.
 */
export async function transcribe(
  endpoint: Endpoint,
  clip: VoiceClip,
  { timeoutMs = READ_TIMEOUT_MS, fetchImpl = fetch }: Transport = {}
): Promise<string> {
  const raw = await generateJson(
    endpoint,
    [{ text: buildTranscribePrompt() }, { inlineData: { mimeType: clip.mimeType, data: clip.base64 } }],
    TRANSCRIBE_SCHEMA,
    { timeoutMs, fetchImpl, label: 'transcription', meanwhile: 'Type the question instead.' }
  );
  try {
    return parseTranscript(raw);
  } catch (error) {
    if (error instanceof VoiceError) throw new AiError(error.message);
    throw error;
  }
}
