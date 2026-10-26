/**
 * What a model can actually do, asked of the model itself.
 *
 * A listing says what a provider CLAIMS — OpenRouter and DeepSeek declare
 * input types, Mistral declares capabilities, OpenAI says nothing — and a
 * claim is not an answer: a routed host can drop a parameter, a preview model
 * can refuse an image it is listed as taking. So choosing a model runs four
 * tiny requests, one per thing a feature needs, and what came back is kept
 * per model (settings › `modelAbilities`) and decides which features it can
 * run. Each costs a fraction of a cent; the screen says so before it spends.
 *
 * ACCEPTED IS NOT SEEN. DeepSeek's text-only model takes an image, replaces it
 * with "[Unsupported Image]" and answers 200 — so the image and audio checks
 * ask something only a model that really took the file can answer.
 *
 * Three answers, not two. "No" is the provider refusing that one thing;
 * "unknown" is a check that could not be asked — offline, rate-limited, out
 * of credit — and must never be shown as the model lacking anything.
 */

import { callsOf, textOf } from './content';
import { AiError } from './error';
import { chatStep, generateJson } from './index';
import type { Abilities, Endpoint } from './providers';

export const CHECKS = ['json', 'tools', 'images', 'audio'] as const;
export type CheckName = (typeof CHECKS)[number];

export type CheckOutcome = { result: 'yes' | 'no' | 'unknown'; message?: string };
export type CheckResults = { at: number } & Record<CheckName, CheckOutcome>;

/** What is kept per model: the listing's claim, and the checks' answer. */
export type StoredAbilities = {
  declared?: Abilities;
  checked?: CheckResults;
  /** A speech-to-text model: it writes words down and does nothing else. */
  transcription?: boolean;
};

/** A 16px red square — enough for a model to prove it took an image. */
const PROBE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGO4pqFBEmIY1TCqYfhqAAD7biYQ1ugR+gAAAABJRU5ErkJggg==';
/** 0.6s of a 440Hz tone, 16kHz mono AAC in .m4a — the recorder's own format. */
const PROBE_M4A = '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';

const CHECK_TIMEOUT_MS = 45_000;

async function ask(name: CheckName, endpoint: Endpoint, fetchImpl: typeof fetch): Promise<void> {
  const options = { label: `check: ${name}`, meanwhile: 'Try the check again later.', fetchImpl, timeoutMs: CHECK_TIMEOUT_MS };
  switch (name) {
    case 'json':
      await generateJson(endpoint, [{ text: 'Reply with ok set to true.' }], {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
      }, options);
      return;
    case 'images': {
      const seen = (await generateJson(
        endpoint,
        [
          { text: 'What colour is this square? One word, in English.' },
          { inlineData: { mimeType: 'image/png', data: PROBE_PNG } },
        ],
        { type: 'object', properties: { colour: { type: 'string', nullable: true } } },
        options
      )) as { colour?: unknown } | null;
      if (!/red/i.test(String(seen?.colour ?? ''))) throw new AiError('It took the image but could not see it.');
      return;
    }
    case 'audio': {
      const heard = (await generateJson(
        endpoint,
        [
          { text: 'This clip is a steady tone. Is there a sound in it?' },
          { inlineData: { mimeType: 'audio/m4a', data: PROBE_M4A } },
        ],
        { type: 'object', properties: { heard: { type: 'boolean', nullable: true } } },
        options
      )) as { heard?: unknown } | null;
      if (heard?.heard !== true) throw new AiError('It took the clip but could not hear it.');
      return;
    }
    case 'tools': {
      const turn = await chatStep(
        endpoint,
        {
          system: 'Answer by calling the tool.',
          contents: [{ role: 'user', parts: [{ text: 'What time is it? Use the tool.' }] }],
          tools: [{ name: 'get_time', description: 'The current time.', parameters: { type: 'object', properties: {} } }],
        },
        { fetchImpl }
      );
      // Answering in prose is not a refusal — but it is not calling a tool
      // either, and Penny is nothing without that.
      if (callsOf(turn).length === 0) {
        throw new AiError(textOf(turn) ? 'It answered without calling the tool.' : 'It did not call the tool.');
      }
      return;
    }
  }
}

function outcomeOf(settled: PromiseSettledResult<void>): CheckOutcome {
  if (settled.status === 'fulfilled') return { result: 'yes' };
  const error = settled.reason;
  if (error instanceof AiError) return { result: error.transient ? 'unknown' : 'no', message: error.message };
  console.warn('[checks] a check failed unexpectedly', error);
  return { result: 'unknown', message: 'The check could not be run.' };
}

/**
 * Ask all four. When every one is refused in the SAME words, it is not the
 * model lacking four things — it is a key with no credit, or a model that
 * does not exist — and all four are "unknown" with that sentence.
 */
export async function runChecks(
  endpoint: Endpoint,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}
): Promise<CheckResults> {
  const settled = await Promise.allSettled(CHECKS.map((name) => ask(name, endpoint, fetchImpl)));
  const outcomes = settled.map(outcomeOf);
  const refusals = new Set(outcomes.map((o) => (o.result === 'no' ? o.message : null)));
  if (refusals.size === 1 && !refusals.has(null)) {
    for (const o of outcomes) o.result = 'unknown';
  }
  return { at: Date.now(), json: outcomes[0], tools: outcomes[1], images: outcomes[2], audio: outcomes[3] };
}

/**
 * Whether a model can do one thing: what the checks found, else what the
 * listing claimed, else undefined — and undefined lets a feature run, since a
 * request it cannot serve fails in words of its own.
 */
export function can(stored: StoredAbilities | undefined, need: CheckName | 'pdf'): boolean | undefined {
  if (need !== 'pdf') {
    const checked = stored?.checked?.[need]?.result;
    if (checked === 'yes') return true;
    if (checked === 'no') return false;
  }
  return stored?.declared?.[need];
}
