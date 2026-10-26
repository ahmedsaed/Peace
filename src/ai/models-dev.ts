/**
 * models.dev — an open database of what each model takes in and can do.
 *
 * Asked for ONE provider only: OpenAI, whose own `/models` lists every id the
 * key may call — image generators, speech, embeddings — with nothing saying
 * which of them can read a receipt. Fetched when the model list is opened,
 * exactly like the provider's own list, and kept for the rest of the session.
 *
 * NEVER LOAD-BEARING. If it cannot be reached the picker shows the provider's
 * whole list, and the checks run on choosing a model answer what this would
 * have. The request carries nothing about the person or their ledger.
 */

import type { Abilities } from './providers';

const URL = 'https://models.dev/models.json';

type DevModel = { modalities?: { input?: unknown; output?: unknown }; tool_call?: unknown; structured_output?: unknown };

/** What one entry declares, in the app's terms. */
export function devAbilities(entry: DevModel): { abilities: Abilities; writesText: boolean } {
  const input = Array.isArray(entry.modalities?.input) ? (entry.modalities!.input as unknown[]) : [];
  const output = Array.isArray(entry.modalities?.output) ? (entry.modalities!.output as unknown[]) : [];
  const abilities: Abilities = { images: input.includes('image'), audio: input.includes('audio') };
  if (input.includes('pdf')) abilities.pdf = true;
  if (typeof entry.tool_call === 'boolean') abilities.tools = entry.tool_call;
  if (typeof entry.structured_output === 'boolean') abilities.json = entry.structured_output;
  return { abilities, writesText: output.includes('text') };
}

let cached: Promise<Record<string, DevModel> | null> | null = null;

/** The whole table, keyed `provider/model`, or null when it cannot be had. */
export function modelsDev(fetchImpl: typeof fetch = fetch, timeoutMs = 15_000): Promise<Record<string, DevModel> | null> {
  cached ??= (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(URL, { signal: controller.signal });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const body = (await response.json()) as unknown;
      if (typeof body !== 'object' || body === null) throw new Error('not a table');
      return body as Record<string, DevModel>;
    } catch (error) {
      console.warn('[models.dev] could not be read; listing everything', error);
      // Not cached as a failure: the next opening of the list asks again.
      cached = null;
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();
  return cached;
}

/** For tests: forget what this session fetched. */
export function forgetModelsDev(): void {
  cached = null;
}
