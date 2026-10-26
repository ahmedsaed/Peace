/**
 * Talking to every provider that speaks OpenAI's Chat Completions format:
 * OpenAI itself, DeepSeek, Mistral and OpenRouter.
 *
 * Same discipline as the Gemini transport, deliberately: the key in a header
 * and never in a URL, a timeout on everything so a captive portal cannot leave
 * a spinner forever, a friendly sentence for the screen and the real error in
 * the log, and every failure marked transient or not — because "busy" and
 * "your key is wrong" must not be retried alike.
 *
 * READ THE ERROR BODY, NOT JUST THE STATUS. The same 429 means "slow down" or
 * "you have no credit left" depending on one field, and only one of those
 * clears by waiting. Retrying a billing failure just spends the user's
 * patience on a request that will never work.
 */

import type { ChatRequest, Content, Part, Schema } from '../content';
import { base64ToBytes } from '../../lib/attachment';
import { devAbilities, modelsDev } from '../models-dev';
import { AiError } from '../error';
import type { Abilities, ModelInfo } from '../providers';
import { parseEvent, SseParser } from '../sse';
import type { Flavor } from './flavors';
import { checkFinish, parseJsonReply, StreamFold, toJsonSchema, toMessages, toTools, turnFromMessage, userContent } from './translate';

type ErrorBody = { error?: { message?: unknown; code?: unknown; type?: unknown; param?: unknown }; message?: unknown; detail?: unknown };

function errorMessage(body: unknown): string | null {
  const b = (body ?? {}) as ErrorBody;
  const message = b.error?.message ?? b.message ?? b.detail;
  return typeof message === 'string' && message.trim() !== '' ? message.trim() : null;
}

function errorCode(body: unknown): string {
  const e = ((body ?? {}) as ErrorBody).error;
  return [e?.code, e?.type].filter((v) => typeof v === 'string').join(' ');
}

/** The wait a provider asked for, from `Retry-After` (seconds). */
export function retryAfterOf(headers: Headers | undefined): number | null {
  const raw = headers?.get?.('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
}

/** Money, not traffic: a key with nothing left to spend. Waiting never fixes it. */
function outOfCredit(status: number, body: unknown): boolean {
  return status === 402 || /insufficient_quota|insufficient.balance|credits?/i.test(`${errorCode(body)} ${errorMessage(body) ?? ''}`);
}

export function isTransient(status: number, body: unknown): boolean {
  if (outOfCredit(status, body)) return false;
  return status === 408 || status === 429 || status >= 500;
}

/**
 * HTTP failures, in words naming the thing the user can actually change.
 * `meanwhile` is what to do while the provider is down, which depends on who is
 * asking: a record can be typed by hand, a question can only be asked again.
 */
export function describeFailure(flavor: Flavor, status: number, body: unknown, meanwhile: string): string {
  const name = flavor.name;
  if (status === 401) return `That ${name} API key was refused. Check it in Settings › AI.`;
  if (outOfCredit(status, body)) {
    return `${name} says this key has no credit left. Top it up at ${flavor.console}.`;
  }
  if (status === 403) {
    const said = errorMessage(body);
    return said ? `${name} refused the request: ${said}` : `${name} refused the request. Check the key in Settings › AI.`;
  }
  if (status === 404) {
    const said = errorMessage(body);
    return said ? `${name} could not run that model: ${said}` : `That ${name} model does not exist. Choose another in Settings › AI.`;
  }
  if (status === 429) return `${name} is rate-limiting this key. Try again in a minute.`;
  if (status >= 500) return `${name} is unavailable right now. ${meanwhile}`;
  // A 400 or 422. The provider's own sentence names the fix far better than
  // anything invented here, so it is passed through.
  const said = errorMessage(body);
  return said ? `${name} refused the request: ${said}` : `${name} refused the request (${status}).`;
}

/** A 400 about `temperature`: a reasoning model that only takes its default. */
function refusedTemperature(status: number, body: unknown): boolean {
  if (status !== 400) return false;
  const e = ((body ?? {}) as ErrorBody).error;
  return e?.param === 'temperature' || /temperature/i.test(errorMessage(body) ?? '');
}

type PostOptions = {
  timeoutMs: number;
  fetchImpl: typeof fetch;
  label: string;
  meanwhile: string;
  signal?: AbortSignal;
};

/**
 * One POST to `/chat/completions`, returning the response once it is OK.
 *
 * TEMPERATURE IS ASKED FOR, NOT ASSUMED. Zero is right for reading a receipt,
 * but OpenAI's reasoning models refuse any temperature but their own with a
 * 400. Rather than keep a list of which models those are, a refusal that names
 * temperature is answered once by asking again without it.
 */
async function postChat(
  flavor: Flavor,
  apiKey: string,
  body: Record<string, unknown>,
  { timeoutMs, fetchImpl, label, meanwhile, signal }: PostOptions,
  /** For a streamed body: the idle timer, and how to let it go once read. */
  onTimer?: (watch: { arm: () => void; release: () => void }) => void
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), timeoutMs);
  };
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  arm();
  const release = () => {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  };
  onTimer?.({ arm, release });
  const url = `${flavor.baseUrl}/chat/completions`;

  const send = (payload: Record<string, unknown>) =>
    fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({ ...payload, ...flavor.extraBody }),
      signal: controller.signal,
    });

  try {
    let response = await send(body);
    if (!response.ok) {
      let errorBody = await response.json().catch(() => null);
      if ('temperature' in body && refusedTemperature(response.status, errorBody)) {
        const { temperature: _dropped, ...rest } = body;
        response = await send(rest);
        if (response.ok) return response;
        errorBody = await response.json().catch(() => null);
      }
      console.warn(`[${flavor.provider}] ${label} refused`, response.status, errorCode(errorBody), errorMessage(errorBody));
      throw new AiError(
        describeFailure(flavor, response.status, errorBody, meanwhile),
        isTransient(response.status, errorBody),
        retryAfterOf(response.headers)
      );
    }
    return response;
  } catch (error) {
    release();
    if (error instanceof AiError) throw error;
    if (signal?.aborted) throw new AiError('Stopped.', true);
    // Offline, DNS, a timeout — the same to the user, all worth another try.
    // The URL is logged; the key is not, because it is in a header.
    console.warn(`[${flavor.provider}] ${label} failed`, url, error);
    throw new AiError(`Could not reach ${flavor.name}. ${meanwhile}`, true);
  } finally {
    // A streamed body keeps the timer as its idle watch, and releases it itself.
    if (!onTimer) release();
  }
}

/** A structured-output request: one prompt in, one JSON object out. */
export async function generateJson(
  flavor: Flavor,
  apiKey: string,
  model: string,
  parts: Part[],
  schema: Schema,
  { timeoutMs, fetchImpl, label, meanwhile = 'Enter the record by hand.' }: { timeoutMs: number; fetchImpl: typeof fetch; label: string; meanwhile?: string }
): Promise<unknown> {
  const prompt: Part[] =
    flavor.json === 'object'
      ? [...parts, { text: `Answer with one JSON object and nothing else, matching this JSON Schema:\n${JSON.stringify(toJsonSchema(schema, true))}` }]
      : parts;
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: userContent(prompt, flavor) }],
    response_format:
      flavor.json === 'schema'
        ? { type: 'json_schema', json_schema: { name: 'reading', strict: true, schema: toJsonSchema(schema, true) } }
        : { type: 'json_object' },
    // One right answer. The same input read twice must not give two amounts.
    temperature: 0,
  };
  const response = await postChat(flavor, apiKey, body, { timeoutMs, fetchImpl, label, meanwhile });
  const reply = await response.json().catch(() => null);
  const choice = (reply as { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[] } | null)?.choices?.[0];
  if (!choice) throw new AiError(`${flavor.name} returned no reading.`);
  checkFinish(choice.finish_reason, flavor, 'reading');
  return parseJsonReply(choice.message?.content, flavor);
}

function chatBody(model: string, request: ChatRequest, flavor: Flavor): Record<string, unknown> {
  return {
    model,
    messages: toMessages(request.system, request.contents, flavor),
    ...(request.tools.length > 0 ? { tools: toTools(request.tools), tool_choice: 'auto' } : {}),
    // Low rather than zero: this writes prose, and zero makes it repeat itself.
    temperature: 0.3,
  };
}

export async function chatStep(
  flavor: Flavor,
  apiKey: string,
  model: string,
  request: ChatRequest,
  { fetchImpl = fetch, timeoutMs = 90_000, signal }: { fetchImpl?: typeof fetch; timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<Content> {
  const response = await postChat(flavor, apiKey, chatBody(model, request, flavor), {
    timeoutMs,
    fetchImpl,
    label: 'assistant turn',
    meanwhile: 'Try again in a minute.',
    signal,
  });
  const reply = await response.json().catch(() => null);
  const choice = (reply as { choices?: { message?: unknown; finish_reason?: unknown }[] } | null)?.choices?.[0];
  return turnFromMessage(choice?.message as never, choice?.finish_reason, flavor);
}

/**
 * One step, streamed. The timeout is an IDLE timeout — a long answer that
 * keeps arriving is fine; a stream that goes quiet is a stalled connection.
 * Needs a fetch with a readable body (`expo/fetch` on a device).
 */
export async function chatStepStreaming(
  flavor: Flavor,
  apiKey: string,
  model: string,
  request: ChatRequest,
  {
    fetchImpl = fetch,
    idleMs = 45_000,
    signal,
    onText,
  }: { fetchImpl?: typeof fetch; idleMs?: number; signal?: AbortSignal; onText?: (soFar: string) => void } = {}
): Promise<Content> {
  let watch = { arm: () => {}, release: () => {} };
  const response = await postChat(
    flavor,
    apiKey,
    { ...chatBody(model, request, flavor), stream: true },
    { timeoutMs: idleMs, fetchImpl, label: 'assistant turn (streamed)', meanwhile: 'Try again in a minute.', signal },
    (w) => (watch = w)
  );
  const fold = new StreamFold(flavor);
  let shown = '';
  const take = (data: string) => {
    if (data.trim() === '[DONE]') return;
    const event = parseEvent(data, flavor.provider) as { error?: unknown } | null;
    // A failure after the 200: the provider reports it as an event.
    if (event && event.error) {
      console.warn(`[${flavor.provider}] stream reported an error`, event.error);
      throw new AiError(`${flavor.name} stopped partway: ${errorMessage(event) ?? 'try again'}.`, true);
    }
    const text = fold.push(event).trim();
    if (text !== shown) {
      shown = text;
      onText?.(text);
    }
  };
  try {
    if (!response.body) throw new Error('the response has no readable body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const sse = new SseParser();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      watch.arm();
      for (const data of sse.push(decoder.decode(value, { stream: true }))) take(data);
    }
    for (const data of sse.push(decoder.decode() + '\n\n')) take(data);
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (signal?.aborted) throw new AiError('Stopped.', true);
    console.warn(`[${flavor.provider}] streamed turn failed`, error);
    throw new AiError(`Could not reach ${flavor.name}. Try again in a minute.`, true);
  } finally {
    watch.release();
  }
  return fold.turn();
}

// ---------------------------------------------------------------------------
// Keys and models
// ---------------------------------------------------------------------------

async function getJson(
  flavor: Flavor,
  path: string,
  apiKey: string | null,
  { timeoutMs = 15_000, fetchImpl = fetch }: { timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<{ response: Response; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${flavor.baseUrl}${path}`, {
      headers: apiKey ? { authorization: `Bearer ${apiKey.trim()}` } : {},
      signal: controller.signal,
    });
    return { response, body: await response.json().catch(() => null) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Prove a key works before it is kept — an authenticated GET that costs
 * nothing. A rate-limited key is a valid key. Anything that is not an answer
 * says the CHECK failed rather than the key: saving something unverified is
 * exactly the trap this exists to close.
 */
export async function checkKey(
  flavor: Flavor,
  apiKey: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<void> {
  if (apiKey.trim() === '') throw new AiError('Paste a key first.');
  let result: { response: Response; body: unknown };
  try {
    result = await getJson(flavor, flavor.keyCheckPath, apiKey, options);
  } catch (error) {
    console.warn(`[${flavor.provider}] checking the key failed`, error);
    throw new AiError(`Could not reach ${flavor.name} to check the key. Check your connection and try again.`, true);
  }
  const { response, body } = result;
  if (response.ok || response.status === 429) return;
  console.warn(`[${flavor.provider}] key refused`, response.status, errorCode(body));
  if (response.status >= 500) {
    throw new AiError(`${flavor.name} could not check the key just now. Try again in a minute.`, true);
  }
  throw new AiError(`${flavor.name} did not accept that key. Check that you copied all of it.`);
}

/**
 * What each provider's listing declares about a model, where it declares it.
 * OpenRouter and DeepSeek name input modalities; Mistral names capabilities;
 * OpenAI says nothing, and the checks answer for it.
 */
function abilitiesOf(raw: Record<string, unknown>): Abilities | undefined {
  const arch = raw.architecture as { input_modalities?: unknown } | undefined;
  const inputs = (Array.isArray(arch?.input_modalities) ? arch.input_modalities : raw.input_modalities) as unknown;
  const params = raw.supported_parameters as unknown;
  const caps = raw.capabilities as Record<string, unknown> | undefined;
  const out: Abilities = {};
  if (Array.isArray(inputs)) {
    out.images = inputs.includes('image');
    out.audio = inputs.includes('audio');
    if (inputs.includes('file')) out.pdf = true;
  }
  if (Array.isArray(params)) {
    out.tools = params.includes('tools');
    out.json = params.includes('structured_outputs') || params.includes('response_format');
  }
  if (caps && typeof caps === 'object') {
    if (typeof caps.vision === 'boolean') out.images = caps.vision;
    if (typeof caps.function_calling === 'boolean') out.tools = caps.function_calling;
    if (typeof caps.audio === 'boolean') out.audio = caps.audio;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function parseModelList(body: unknown): ModelInfo[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: ModelInfo[] = [];
  for (const entry of data) {
    const raw = (entry ?? {}) as Record<string, unknown>;
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (id === '') continue;
    // Mistral lists embedding and moderation models beside chat ones and says
    // which is which; one that cannot chat can do nothing here.
    const caps = raw.capabilities as { completion_chat?: unknown } | undefined;
    if (caps && caps.completion_chat === false) continue;
    // OpenRouter lists image generators too; a model that cannot write text
    // cannot fill in a record.
    const outputs = (raw.architecture as { output_modalities?: unknown } | undefined)?.output_modalities;
    if (Array.isArray(outputs) && !outputs.includes('text')) continue;
    const abilities = abilitiesOf(raw);
    out.push({
      id,
      label: typeof raw.name === 'string' && raw.name ? raw.name : id,
      description: typeof raw.description === 'string' ? raw.description : '',
      ...(abilities ? { abilities } : {}),
    });
  }
  return out;
}

export async function listModels(
  flavor: Flavor,
  apiKey: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<ModelInfo[]> {
  let result: { response: Response; body: unknown };
  try {
    result = await getJson(flavor, '/models', flavor.modelsNeedKey ? apiKey : null, options);
  } catch (error) {
    console.warn(`[${flavor.provider}] listing models failed`, error);
    throw new AiError(`Could not reach ${flavor.name} to list its models.`);
  }
  const { response, body } = result;
  if (!response.ok) {
    throw new AiError(describeFailure(flavor, response.status, body, ''), isTransient(response.status, body));
  }
  let models = parseModelList(body);
  if (flavor.provider === 'openai') models = await sortOpenAi(models, options.fetchImpl);
  if (models.length === 0) throw new AiError(`That key can reach ${flavor.name} but has no usable models.`);
  return models;
}

/**
 * OpenAI's speech-to-text models, by name — its listing says nothing about
 * what any id does, and these are the ones `/audio/transcriptions` takes.
 */
export function isOpenAiTranscription(id: string): boolean {
  return /transcribe|whisper/i.test(id);
}

/**
 * OpenAI's list, narrowed to what can write text, with what models.dev knows
 * about each. Its transcription models stay — voice can listen with one.
 */
async function sortOpenAi(models: ModelInfo[], fetchImpl?: typeof fetch): Promise<ModelInfo[]> {
  const marked = models.map((m) => (isOpenAiTranscription(m.id) ? { ...m, transcription: true } : m));
  const table = await modelsDev(fetchImpl);
  if (!table) return marked;
  return marked.flatMap((model) => {
    if (model.transcription) return [model];
    const entry = table[`openai/${model.id}`];
    if (!entry) return [];
    const { abilities, writesText } = devAbilities(entry);
    if (!writesText) return [];
    return [{ ...model, abilities: { ...abilities, ...model.abilities } }];
  });
}

// ---------------------------------------------------------------------------
// Speech to text
// ---------------------------------------------------------------------------

/**
 * A `multipart/form-data` body, built by hand as bytes.
 *
 * React Native's FormData wants a file URI, and the clip is already in hand
 * as base64 — read once and about to be deleted. Writing the parts out
 * directly works the same under Hermes and Node, and is testable.
 */
export function multipart(
  fields: Record<string, string>,
  file: { field: string; name: string; mimeType: string; bytes: Uint8Array }
): { body: Uint8Array; contentType: string } {
  const boundary = `peace${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const encoder = new TextEncoder();
  const head = Object.entries(fields)
    .map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
    .join('');
  const before = encoder.encode(
    `${head}--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`
  );
  const after = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(before.length + file.bytes.length + after.length);
  body.set(before, 0);
  body.set(file.bytes, before.length);
  body.set(after, before.length + file.bytes.length);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/**
 * Write a clip down as words, with a speech-to-text model.
 *
 * The first of TWO requests for a provider whose chat models cannot hear:
 * this one writes the words, and an ordinary text model reads them into a
 * record. `prompt` carries the ledger's own names, which is what makes a
 * transcription spell "CIB" and "Vodafone Cash" the way the accounts do.
 * No language is named: people here say one sentence in two.
 */
export async function transcribeAudio(
  flavor: Flavor,
  apiKey: string,
  model: string,
  clip: { base64: string; mimeType: string },
  {
    prompt = '',
    timeoutMs = 30_000,
    fetchImpl = fetch,
    meanwhile = 'Try again, or type it.',
  }: { prompt?: string; timeoutMs?: number; fetchImpl?: typeof fetch; meanwhile?: string } = {}
): Promise<string> {
  const extension = clip.mimeType.split('/')[1] ?? 'm4a';
  const { body, contentType } = multipart(
    { model, ...(prompt ? { prompt } : {}), response_format: 'json' },
    { field: 'file', name: `clip.${extension}`, mimeType: clip.mimeType, bytes: base64ToBytes(clip.base64) }
  );
  const url = `${flavor.baseUrl}/audio/transcriptions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': contentType, authorization: `Bearer ${apiKey.trim()}` },
      body: body as unknown as BodyInit,
      signal: controller.signal,
    });
    const reply = await response.json().catch(() => null);
    if (!response.ok) {
      console.warn(`[${flavor.provider}] transcription refused`, response.status, errorCode(reply), errorMessage(reply));
      throw new AiError(
        describeFailure(flavor, response.status, reply, meanwhile),
        isTransient(response.status, reply),
        retryAfterOf(response.headers)
      );
    }
    const text = (reply as { text?: unknown } | null)?.text;
    return typeof text === 'string' ? text.trim() : '';
  } catch (error) {
    if (error instanceof AiError) throw error;
    console.warn(`[${flavor.provider}] transcription failed`, url, error);
    throw new AiError(`Could not reach ${flavor.name}. ${meanwhile}`, true);
  } finally {
    clearTimeout(timer);
  }
}
