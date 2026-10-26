import type { StoredAbilities } from './checks';
import { endpointFor } from '../lib/secrets';
import { parseModelRef } from './model-ref';
import { PROVIDERS, type Endpoint } from './providers';
import type { Listener } from './read';

/**
 * The endpoint for one job's stored choice, or the sentence saying why there
 * is none — worded for the screen that asked, naming what fixes it.
 *
 * `doing` finishes "Settings › AI to …": "read receipts", "speak records".
 */
export async function endpointForJob(
  stored: string,
  doing: string
): Promise<{ endpoint: Endpoint } | { problem: string }> {
  const ref = parseModelRef(stored);
  if (ref === null) return { problem: `Choose a model in Settings › AI to ${doing}.` };
  const endpoint = await endpointFor(ref);
  if (endpoint === null) {
    return { problem: `Add a ${PROVIDERS[ref.provider].name} API key in Settings › AI to ${doing}.` };
  }
  return { endpoint };
}

/**
 * What hears a clip, from Voice's two settings: the model that listens, and —
 * when that one only transcribes — the model that reads what it wrote.
 */
export async function listenerFor(
  listen: string,
  read: string,
  abilities: Record<string, StoredAbilities>,
  doing: string
): Promise<{ listener: Listener } | { problem: string }> {
  const heard = await endpointForJob(listen, doing);
  if ('problem' in heard) return heard;
  if (!abilities[listen]?.transcription) return { listener: { kind: 'hears', endpoint: heard.endpoint } };
  const reader = await endpointForJob(read, doing);
  if ('problem' in reader) return reader;
  return { listener: { kind: 'transcribes', endpoint: heard.endpoint, reader: reader.endpoint } };
}
