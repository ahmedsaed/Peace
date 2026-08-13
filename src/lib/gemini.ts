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

export class GeminiError extends Error {}

export function endpoint(model: string): string {
  // The model id is user-editable in Settings, so it is encoded rather than
  // interpolated raw — a stray slash would otherwise rewrite the path.
  return `${BASE_URL}/${encodeURIComponent(model)}:generateContent`;
}

export function buildRequest(
  base64Image: string,
  mimeType: string,
  categoryNames: string[]
): unknown {
  return {
    contents: [
      {
        parts: [
          { text: buildPrompt(categoryNames) },
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

/** HTTP failures, in words a person can act on. */
function describeStatus(status: number): string {
  if (status === 400) return 'Gemini rejected the request. Check the model name in Settings.';
  if (status === 401 || status === 403) {
    return 'That Gemini API key was refused. Check it in Settings.';
  }
  if (status === 404) return 'That Gemini model does not exist. Check the name in Settings.';
  if (status === 429) return 'Gemini is rate-limiting this key. Try again in a minute.';
  if (status >= 500) return 'Gemini is unavailable right now. Enter the record by hand.';
  return `Gemini refused the request (${status}).`;
}

export type ReadOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** The user's own category names, so the model picks from them. */
  categoryNames?: string[];
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
  }: ReadOptions = {}
): Promise<ReadReceipt> {
  if (apiKey.trim() === '') {
    throw new GeminiError('No Gemini API key is saved. Add one in Settings.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(endpoint(model), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey.trim(),
      },
      body: JSON.stringify(buildRequest(base64Image, mimeType, categoryNames)),
      signal: controller.signal,
    });

    if (!response.ok) throw new GeminiError(describeStatus(response.status));

    return parseReading(extractJson(await response.json()), fallbackCurrency);
  } catch (error) {
    if (error instanceof GeminiError) throw error;
    if (error instanceof ReceiptError) throw new GeminiError(error.message);

    /**
     * Offline, DNS failure, timeout, malformed JSON — all the same to the USER,
     * and all recoverable by typing the amount. NOT all the same to whoever has
     * to work out why it is failing: the friendly sentence goes to the screen
     * and the real error goes to the log. The first version of the rate fetch
     * collapsed the two and cost an hour the first time it failed on a device
     * that plainly had a working network.
     *
     * The URL is logged; the key is not, because it is in a header.
     */
    console.warn('[gemini] receipt read failed', endpoint(model), error);
    throw new GeminiError('Could not reach Gemini. Enter the record by hand.');
  } finally {
    clearTimeout(timer);
  }
}
