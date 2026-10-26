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

import { AiError } from '../error';
import type { ModelInfo } from '../providers';
import { parseEvent, SseParser } from '../sse';

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

/**
 * Dig the payload out of the envelope.
 *
 * Separated from the request so every shape of disappointing reply can be
 * tested without a network: a blocked prompt, an empty candidate list, a
 * truncated answer. All three are real and all three arrive as HTTP 200.
 */
export function extractJson(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) {
    throw new AiError('Gemini returned something unexpected.');
  }

  const envelope = body as Record<string, unknown>;

  // Safety filters answer 200 with no candidates and a reason at the top level.
  const feedback = envelope.promptFeedback as Record<string, unknown> | undefined;
  if (feedback?.blockReason) {
    throw new AiError(`Gemini refused to read that image (${String(feedback.blockReason)}).`);
  }

  const candidates = envelope.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new AiError('Gemini returned no reading for that image.');
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
    throw new AiError(`Gemini stopped early (${finish}) and the reading is incomplete.`);
  }

  const content = first.content as Record<string, unknown> | undefined;
  const parts = content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new AiError('Gemini returned an empty reading.');
  }

  const text = (parts[0] as Record<string, unknown>).text;
  if (typeof text !== 'string' || text.trim() === '') {
    throw new AiError('Gemini returned an empty reading.');
  }

  try {
    return JSON.parse(text);
  } catch {
    // Should be impossible with a responseSchema, which is exactly why it is
    // worth saying so rather than reporting a generic failure.
    console.warn('[gemini] structured output was not valid JSON', text.slice(0, 200));
    throw new AiError('Gemini returned a reading that could not be read.');
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
      return 'That Gemini API key was refused. Check it in Settings › AI.';
    case 'SERVICE_DISABLED':
      return 'The Gemini API is not enabled for that key. Check it in Settings › AI.';
    case 'RATE_LIMIT_EXCEEDED':
    case 'RESOURCE_EXHAUSTED':
      return 'Gemini is rate-limiting this key. Try again in a minute.';
    default:
      break;
  }

  if (status === 401 || status === 403) {
    return 'That Gemini API key was refused. Check it in Settings › AI.';
  }
  if (status === 404) return 'That Gemini model does not exist. Check the name in Settings › AI.';
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
export function parseModelList(body: unknown): ModelInfo[] {
  const models = (body as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return [];

  const out: ModelInfo[] = [];
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
): Promise<ModelInfo[]> {
  if (apiKey.trim() === '') {
    throw new AiError('No Gemini API key is saved. Add one in Settings › AI.');
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
      throw new AiError(
        describeFailure(response.status, body),
        isTransientStatus(response.status, body)
      );
    }

    const models = parseModelList(await response.json());
    if (models.length === 0) {
      throw new AiError('That key can reach Gemini but has no usable models.');
    }
    return models;
  } catch (error) {
    if (error instanceof AiError) throw error;
    console.warn('[gemini] listing models failed', error);
    throw new AiError('Could not reach Gemini to list its models.');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Prove a key works before it is kept.
 *
 * A key is saved once and used weeks later, from a receipt or a bank message,
 * so a typo accepted here surfaces as a failure in some OTHER feature, long
 * after anyone remembers pasting it. Listing models costs nothing and needs
 * only the key, which makes it the cheapest question Google will answer about
 * one.
 *
 * Every refusal is worded about the KEY, because that is what the person is
 * holding: `describeFailure` says "check it in Settings", which is useless to
 * somebody standing in Settings with the key in their hand.
 *
 * A rate-limited key is a valid key, so 429 passes. Anything that is not an
 * answer — offline, a timeout, Google down — refuses too, but says it is the
 * CHECK that failed rather than the key: saving something unverified is
 * exactly the trap this exists to close.
 */
export async function checkKey(
  apiKey: string,
  { timeoutMs = 15_000, fetchImpl = fetch }: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<void> {
  const key = apiKey.trim();
  if (key === '') throw new AiError('Paste a key first.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(`${BASE_URL}?pageSize=1`, {
      headers: { 'x-goog-api-key': key },
      signal: controller.signal,
    });
  } catch (error) {
    console.warn('[gemini] checking the key failed', error);
    throw new AiError(
      'Could not reach Google to check the key. Check your connection and try again.',
      true
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.ok || response.status === 429) return;

  const body = await response.json().catch(() => null);
  console.warn('[gemini] key refused', response.status, reasonOf(body));
  if (reasonOf(body) === 'SERVICE_DISABLED') {
    throw new AiError(
      'Google knows that key, but the Gemini API is not turned on for its project.'
    );
  }
  if (response.status >= 500) {
    throw new AiError('Google could not check the key just now. Try again in a minute.', true);
  }
  throw new AiError('Google did not accept that key. Check that you copied all of it.');
}

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
 * `AiError` carrying a sentence for the screen.
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
    throw new AiError('No Gemini API key is saved. Add one in Settings › AI.');
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
      throw new AiError(
        describeFailure(response.status, errorBody, meanwhile),
        isTransientStatus(response.status, errorBody),
        retryDelayOf(errorBody)
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof AiError) throw error;

    if (signal?.aborted) throw new AiError('Stopped.', true);

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
    throw new AiError(`Could not reach Gemini. ${meanwhile}`, true);
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
    throw new AiError('No Gemini API key is saved. Add one in Settings › AI.');
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
      throw new AiError(
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
        onEvent(parseEvent(data, 'gemini'));
      }
    }
    for (const data of sse.push(decoder.decode() + '\n\n')) onEvent(parseEvent(data, 'gemini'));
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (signal?.aborted) throw new AiError('Stopped.', true);
    console.warn(`[gemini] ${label} failed`, endpoint(model, 'streamGenerateContent'), error);
    throw new AiError(`Could not reach Gemini. ${meanwhile}`, true);
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** A structured-output request: one prompt in, one JSON object out. */
export async function generateJson(
  apiKey: string,
  model: string,
  parts: unknown[],
  responseSchema: unknown,
  {
    timeoutMs,
    fetchImpl,
    label,
    meanwhile,
  }: { timeoutMs: number; fetchImpl: typeof fetch; label: string; meanwhile?: string }
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
    { timeoutMs, fetchImpl, label, meanwhile }
  );
  return extractJson(body);
}
