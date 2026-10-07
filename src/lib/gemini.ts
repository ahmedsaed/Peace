/**
 * Talking to Gemini.
 *
 * STRUCTURED OUTPUT, NOT PROSE. The request carries a `responseSchema` and asks
 * for `application/json`, so the model answers with the fields themselves
 * rather than a sentence about them. The alternative — asking in English and
 * pulling numbers out with a regex — works on the receipts you test with and
 * eventually reads the wrong figure off one you did not.
 *
 * The reply is still delivered as a JSON *string* inside `parts[0].text`; that
 * is the transport, and it is one `JSON.parse`. What the schema buys is that
 * the thing inside is an object with the fields asked for, so `parseReading`
 * only has to defend against wrong VALUES rather than against arbitrary text.
 *
 * NOTHING HERE IS LOAD-BEARING. Every failure ends with a message and a form
 * the user can still fill in by hand. The API key never leaves the device
 * except to Google, and never enters the `settings` table — that table is
 * copied into every backup. See `secrets.ts`.
 */

import { buildPrompt, parseReading, ReceiptError, RESPONSE_SCHEMA, type ReadReceipt } from './receipt';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Long enough for a model to read a photograph, short enough to give up on.
 *
 * The rate fetch uses 8s because it asks for one number. Vision over a 300KB
 * JPEG is genuinely slower, and a user who has just photographed a receipt is
 * watching the screen — but without a ceiling a captive portal leaves the
 * button spinning and they cannot tell whether to wait or to type.
 */
export const READ_TIMEOUT_MS = 30_000;

/**
 * A failure talking to Gemini.
 *
 * `transient` is the whole reason this is not a plain Error. "The model is busy"
 * and "your key is wrong" both stop a reading, and treating them the same is how
 * a message that would have worked thirty seconds later gets parked forever with
 * an error beside it. One is worth retrying and the other never will be.
 */
export class GeminiError extends Error {
  readonly transient: boolean;
  /** How long Google asked us to wait before trying again, when it said. */
  readonly retryAfterMs: number | null;

  constructor(message: string, transient = false, retryAfterMs: number | null = null) {
    super(message);
    this.transient = transient;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * The wait Google asks for, from `error.details[].retryDelay` ("23s", "1.5s").
 *
 * A rate-limited reply often says exactly when the quota frees up; retrying
 * sooner just spends another request on another refusal.
 */
export function retryDelayOf(body: unknown): number | null {
  const details = (body as { error?: { details?: unknown } } | null)?.error?.details;
  if (!Array.isArray(details)) return null;
  for (const detail of details) {
    const delay = (detail as { retryDelay?: unknown })?.retryDelay;
    if (typeof delay !== 'string') continue;
    const match = /^(\d+(?:\.\d+)?)s$/.exec(delay.trim());
    if (match) return Math.round(Number(match[1]) * 1000);
  }
  return null;
}

export function endpoint(model: string, method: 'generateContent' | 'streamGenerateContent' = 'generateContent'): string {
  // The model id is user-editable in Settings, so it is encoded rather than
  // interpolated raw — a stray slash would otherwise rewrite the path.
  const base = `${BASE_URL}/${encodeURIComponent(model)}:${method}`;
  // `alt=sse` makes the stream Server-Sent Events — one complete JSON object
  // per `data:` line — rather than one JSON array delivered in pieces, which
  // cannot be parsed until it has all arrived and so would not stream at all.
  return method === 'streamGenerateContent' ? `${base}?alt=sse` : base;
}

export function buildRequest(
  base64Image: string,
  mimeType: string,
  categoryNames: string[],
  guidance?: string
): unknown {
  return {
    contents: [
      {
        parts: [
          { text: buildPrompt(categoryNames, guidance) },
          { inline_data: { mime_type: mimeType, data: base64Image } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      // Reading a receipt has one right answer. Sampling variety is exactly
      // what is not wanted: the same photo read twice should not produce two
      // different totals.
      temperature: 0,
    },
  };
}

/**
 * Dig the payload out of the envelope.
 *
 * Separated from the request so every shape of disappointing reply can be
 * tested without a network: a blocked prompt, an empty candidate list, a
 * truncated answer. All three are real and all three arrive as HTTP 200.
 */
export function extractJson(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) {
    throw new GeminiError('Gemini returned something unexpected.');
  }

  const envelope = body as Record<string, unknown>;

  // Safety filters answer 200 with no candidates and a reason at the top level.
  const feedback = envelope.promptFeedback as Record<string, unknown> | undefined;
  if (feedback?.blockReason) {
    throw new GeminiError(`Gemini refused to read that image (${String(feedback.blockReason)}).`);
  }

  const candidates = envelope.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new GeminiError('Gemini returned no reading for that image.');
  }

  const first = candidates[0] as Record<string, unknown>;

  /**
   * A truncated answer is WORSE THAN NO ANSWER and must not be parsed.
   *
   * `MAX_TOKENS` cuts the JSON off mid-string, which either fails to parse or —
   * far worse — parses into an object missing its later fields, so a receipt
   * silently arrives with no date. Named explicitly rather than falling through
   * to "unexpected reply".
   */
  const finish = first.finishReason;
  if (typeof finish === 'string' && finish !== 'STOP' && finish !== 'FINISH_REASON_UNSPECIFIED') {
    throw new GeminiError(`Gemini stopped early (${finish}) and the reading is incomplete.`);
  }

  const content = first.content as Record<string, unknown> | undefined;
  const parts = content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new GeminiError('Gemini returned an empty reading.');
  }

  const text = (parts[0] as Record<string, unknown>).text;
  if (typeof text !== 'string' || text.trim() === '') {
    throw new GeminiError('Gemini returned an empty reading.');
  }

  try {
    return JSON.parse(text);
  } catch {
    // Should be impossible with a responseSchema, which is exactly why it is
    // worth saying so rather than reporting a generic failure.
    console.warn('[gemini] structured output was not valid JSON', text.slice(0, 200));
    throw new GeminiError('Gemini returned a reading that could not be read.');
  }
}

/**
 * Pull the machine-readable reason out of an error body.
 *
 * THE STATUS CODE IS NOT ENOUGH, and finding that out cost a device run: an
 * invalid API key comes back as **400 INVALID_ARGUMENT**, not the 401 or 403
 * every instinct expects. Mapping on the status alone sent someone whose key
 * was wrong off to check their model name — the single most useless thing this
 * could tell them, because the model name is fine.
 *
 * Google puts the truth in `error.details[].reason`, so that is what gets read.
 */
export function reasonOf(body: unknown): string | null {
  const error = (body as { error?: { details?: unknown } } | null)?.error;
  if (!error || !Array.isArray(error.details)) return null;

  for (const detail of error.details) {
    const reason = (detail as { reason?: unknown })?.reason;
    if (typeof reason === 'string' && reason !== '') return reason;
  }
  return null;
}

/** Which HTTP failures are worth trying again. */
export function isTransientStatus(status: number, body: unknown): boolean {
  switch (reasonOf(body)) {
    // A quota or a rate limit clears on its own; a bad key never does.
    case 'RATE_LIMIT_EXCEEDED':
    case 'RESOURCE_EXHAUSTED':
      return true;
    case 'API_KEY_INVALID':
    case 'API_KEY_SERVICE_BLOCKED':
    case 'SERVICE_DISABLED':
      return false;
    default:
      break;
  }
  // 429 is rate limiting; 5xx is Google having a bad minute. `gemini-flash-latest`
  // answers 503 "high demand" often enough that this is the common path, not an
  // edge case.
  return status === 429 || status >= 500;
}

/**
 * HTTP failures, in words that name the thing the user can actually change.
 *
 * `meanwhile` is what to do while Gemini is down, which depends on who is
 * asking: a record can be typed by hand, a question can only be asked again.
 */
export function describeFailure(
  status: number,
  body: unknown,
  meanwhile = 'Enter the record by hand.'
): string {
  switch (reasonOf(body)) {
    case 'API_KEY_INVALID':
    case 'API_KEY_SERVICE_BLOCKED':
    case 'ACCESS_TOKEN_EXPIRED':
      return 'That Gemini API key was refused. Check it in Settings.';
    case 'SERVICE_DISABLED':
      return 'The Gemini API is not enabled for that key. Check it in Settings.';
    case 'RATE_LIMIT_EXCEEDED':
    case 'RESOURCE_EXHAUSTED':
      return 'Gemini is rate-limiting this key. Try again in a minute.';
    default:
      break;
  }

  if (status === 401 || status === 403) {
    return 'That Gemini API key was refused. Check it in Settings.';
  }
  if (status === 404) return 'That Gemini model does not exist. Check the name in Settings.';
  if (status === 429) return 'Gemini is rate-limiting this key. Try again in a minute.';
  if (status >= 500) return `Gemini is unavailable right now. ${meanwhile}`;

  /**
   * A 400 with no reason we recognise. Google's own sentence is far more useful
   * than anything that could be invented here — "Unable to submit request
   * because it has an empty model name" names the fix exactly — so it is passed
   * through rather than flattened into a generic apology.
   */
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  if (typeof message === 'string' && message.trim() !== '') {
    return `Gemini refused the request: ${message.trim()}`;
  }
  return `Gemini refused the request (${status}).`;
}

export type GeminiModel = {
  /** The bare id, with the `models/` prefix stripped — what `endpoint` wants. */
  id: string;
  label: string;
  description: string;
};

/**
 * Which models a key may actually call.
 *
 * Filtered on `generateContent` and nothing else. That is the API's OWN
 * declaration of what a model can do, so it stays right as Google adds and
 * retires them — where a hand-kept list of names to exclude is a parallel rule
 * that goes stale the first week nobody updates it. An embedding model does not
 * advertise `generateContent` and so never appears; a model that advertises it
 * and then cannot read a photo answers with Google's own error, which this
 * module now passes through verbatim.
 */
export function parseModelList(body: unknown): GeminiModel[] {
  const models = (body as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return [];

  const out: GeminiModel[] = [];
  for (const raw of models) {
    const model = (raw ?? {}) as Record<string, unknown>;
    const name = typeof model.name === 'string' ? model.name : '';
    const methods = model.supportedGenerationMethods;

    if (name === '') continue;
    if (!Array.isArray(methods) || !methods.includes('generateContent')) continue;

    const id = name.replace(/^models\//, '');
    if (id === '') continue;

    out.push({
      id,
      // The display name is nicer to read but the ID is what actually gets
      // called, so a row that shows only the pretty name would leave you
      // unable to tell which of two similar entries you had chosen.
      label: typeof model.displayName === 'string' && model.displayName ? model.displayName : id,
      description: typeof model.description === 'string' ? model.description : '',
    });
  }
  return out;
}

/**
 * Ask Google what this key can call.
 *
 * Same failure discipline as a read: a friendly sentence out, the real error to
 * the log, and a short timeout so a captive portal cannot leave the sheet
 * spinning. The caller keeps whatever model is already set if this fails.
 */
export async function listModels(
  apiKey: string,
  { timeoutMs = 15_000, fetchImpl = fetch }: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<GeminiModel[]> {
  if (apiKey.trim() === '') {
    throw new GeminiError('No Gemini API key is saved. Add one in Settings.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${BASE_URL}?pageSize=200`, {
      headers: { 'x-goog-api-key': apiKey.trim() },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new GeminiError(
        describeFailure(response.status, body),
        isTransientStatus(response.status, body)
      );
    }

    const models = parseModelList(await response.json());
    if (models.length === 0) {
      throw new GeminiError('That key can reach Gemini but has no usable models.');
    }
    return models;
  } catch (error) {
    if (error instanceof GeminiError) throw error;
    console.warn('[gemini] listing models failed', error);
    throw new GeminiError('Could not reach Gemini to list its models.');
  } finally {
    clearTimeout(timer);
  }
}

export type ReadOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** The user's own category names, so the model picks from them. */
  categoryNames?: string[];
  /** The editable half of the prompt. Empty falls back to the shipped default. */
  guidance?: string;
  /** Decides the decimal places when the receipt names no currency. */
  fallbackCurrency?: string;
};

/**
 * Read one receipt.
 *
 * The key goes in the `x-goog-api-key` HEADER rather than the query string.
 * A key in a URL is the one that ends up in a proxy log, a crash report or a
 * console line — and this app writes the URL to the console on failure.
 */
/**
 * One request, whatever is being asked.
 *
 * The transport, the timeout, the header the key travels in and the mapping of
 * every failure into a sentence are identical for a photographed receipt, a
 * bank message and a turn of the assistant's conversation — only the body
 * differs. Three copies of this would be three places for the error handling
 * to drift, and the error handling is the part that took a device run against
 * the real API to get right.
 *
 * Returns the parsed envelope of a 2xx reply; everything else throws a
 * `GeminiError` carrying a sentence for the screen.
 */
export async function postGenerate(
  apiKey: string,
  model: string,
  body: unknown,
  {
    timeoutMs,
    fetchImpl,
    label,
    meanwhile = 'Enter the record by hand.',
    signal,
  }: {
    timeoutMs: number;
    fetchImpl: typeof fetch;
    label: string;
    meanwhile?: string;
    /** Lets a caller stop waiting — the assistant's Stop button. */
    signal?: AbortSignal;
  }
): Promise<unknown> {
  if (apiKey.trim() === '') {
    throw new GeminiError('No Gemini API key is saved. Add one in Settings.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetchImpl(endpoint(model), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey.trim(),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      // The body carries the reason the status cannot. Its own parsing must not
      // throw over the top of the real failure, so a body that will not read
      // simply leaves the status to speak for itself.
      const errorBody = await response.json().catch(() => null);
      throw new GeminiError(
        describeFailure(response.status, errorBody, meanwhile),
        isTransientStatus(response.status, errorBody),
        retryDelayOf(errorBody)
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof GeminiError) throw error;

    if (signal?.aborted) throw new GeminiError('Stopped.', true);

    /**
     * Offline, DNS failure, timeout, malformed JSON — all the same to the USER,
     * and all recoverable by typing the amount. NOT all the same to whoever has
     * to work out why it is failing: the friendly sentence goes to the screen
     * and the real error goes to the log. The first version of the rate fetch
     * collapsed the two and cost an hour the first time it failed on a device
     * that plainly had a working network.
     *
     * The URL is logged; the key is not, because it is in a header.
     *
     * TRANSIENT BY DEFINITION. Offline, a dead signal, a stalled connection that
     * hit the timeout — every one of these is a thing that is true now and may
     * not be in a minute. This is also what an overloaded model looks like when
     * it stalls rather than answering 503, which is how a busy `flash-latest`
     * usually presents.
     */
    console.warn(`[gemini] ${label} failed`, endpoint(model), error);
    throw new GeminiError(`Could not reach Gemini. ${meanwhile}`, true);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * The same request, answered as a STREAM of partial responses.
 *
 * Every response the server sends is handed to `onEvent` as it arrives, and
 * the transport stays identical to `postGenerate` — the key in a header, the
 * same failures in the same words — because a second copy of that is exactly
 * what `postGenerate` exists to prevent.
 *
 * The timeout is an IDLE timeout. A long answer that keeps arriving is fine;
 * a stream that goes quiet for `idleMs` is a stalled connection, and leaving
 * it open is the captive-portal spinner again in a new place.
 *
 * Needs a `fetch` whose response has a readable `body` — `expo/fetch` on a
 * device. React Native's built-in fetch buffers the whole body, which would
 * deliver every chunk at once at the end: correct, and not streaming.
 */
export async function postStream(
  apiKey: string,
  model: string,
  body: unknown,
  {
    idleMs,
    fetchImpl,
    label,
    meanwhile,
    signal,
    onEvent,
  }: {
    idleMs: number;
    fetchImpl: typeof fetch;
    label: string;
    meanwhile: string;
    signal?: AbortSignal;
    onEvent: (event: unknown) => void;
  }
): Promise<void> {
  if (apiKey.trim() === '') {
    throw new GeminiError('No Gemini API key is saved. Add one in Settings.');
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), idleMs);
  };
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  arm();

  try {
    const response = await fetchImpl(endpoint(model, 'streamGenerateContent'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey.trim() },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new GeminiError(
        describeFailure(response.status, errorBody, meanwhile),
        isTransientStatus(response.status, errorBody),
        retryDelayOf(errorBody)
      );
    }
    if (!response.body) throw new Error('the response has no readable body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const sse = new SseParser();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm();
      for (const data of sse.push(decoder.decode(value, { stream: true }))) {
        onEvent(parseEvent(data));
      }
    }
    for (const data of sse.push(decoder.decode() + '\n\n')) onEvent(parseEvent(data));
  } catch (error) {
    if (error instanceof GeminiError) throw error;
    if (signal?.aborted) throw new GeminiError('Stopped.', true);
    console.warn(`[gemini] ${label} failed`, endpoint(model, 'streamGenerateContent'), error);
    throw new GeminiError(`Could not reach Gemini. ${meanwhile}`, true);
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function parseEvent(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    // One mangled event must not be mistaken for a network failure — but it
    // is worth knowing about, so it is logged and handed on as nothing.
    console.warn('[gemini] a streamed event was not JSON', data.slice(0, 200));
    return null;
  }
}

/**
 * Server-Sent Events, fed in arbitrary pieces.
 *
 * A network read can end anywhere — mid-line, mid-word, between the `\r` and
 * the `\n` — so text is buffered until a blank line closes an event, and only
 * then are its `data:` lines joined and handed back.
 */
export class SseParser {
  private buffer = '';
  /** A `\r` that ended the last piece — it may be half of a `\r\n`. */
  private held = '';

  push(text: string): string[] {
    let raw = this.held + text;
    this.held = '';
    // Normalising "\r" to "\n" here and its partner "\n" in the next piece
    // would make one line break into two — a blank line, which ENDS an event
    // early and splits its JSON in half.
    if (raw.endsWith('\r')) {
      this.held = '\r';
      raw = raw.slice(0, -1);
    }
    this.buffer += raw.replace(/\r\n?/g, '\n');
    const events: string[] = [];
    let end: number;
    while ((end = this.buffer.indexOf('\n\n')) >= 0) {
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''));
      if (data.length > 0) events.push(data.join('\n'));
    }
    return events;
  }
}

/** A structured-output request: one prompt in, one JSON object out. */
async function generateJson(
  apiKey: string,
  model: string,
  parts: unknown[],
  responseSchema: unknown,
  { timeoutMs, fetchImpl, label }: { timeoutMs: number; fetchImpl: typeof fetch; label: string }
): Promise<unknown> {
  const body = await postGenerate(
    apiKey,
    model,
    {
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema,
        // One right answer. The same input read twice must not give two
        // different amounts.
        temperature: 0,
      },
    },
    { timeoutMs, fetchImpl, label }
  );
  return extractJson(body);
}

export async function readReceipt(
  apiKey: string,
  model: string,
  base64Image: string,
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
    apiKey,
    model,
    [
      { text: buildPrompt(categoryNames, guidance.trim() || undefined) },
      { inline_data: { mime_type: mimeType, data: base64Image } },
    ],
    RESPONSE_SCHEMA,
    { timeoutMs, fetchImpl, label: 'receipt read' }
  );

  try {
    return parseReading(raw, fallbackCurrency);
  } catch (error) {
    if (error instanceof ReceiptError) throw new GeminiError(error.message);
    throw error;
  }
}

/**
 * Read a bank message into the fields of a record.
 *
 * Text, not an image, and otherwise the same discipline: structured output, a
 * temperature of zero, and everything that comes back treated as text somebody
 * typed badly. `lib/bank-sms.ts` owns the prompt, the schema and the checking,
 * so this file stays the transport.
 */
export async function readBankMessage(
  apiKey: string,
  model: string,
  prompt: string,
  responseSchema: unknown,
  { timeoutMs = READ_TIMEOUT_MS, fetchImpl = fetch }: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<unknown> {
  return generateJson(apiKey, model, [{ text: prompt }], responseSchema, {
    timeoutMs,
    fetchImpl,
    label: 'bank message read',
  });
}
