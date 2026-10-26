import { create } from 'zustand';

import { checkKey } from '@/ai';
import { PROVIDER_IDS, type ProviderId } from '@/ai/providers';
import { getApiKey, setApiKey } from '@/lib/secrets';

/**
 * Which providers have a key, as something every screen can watch.
 *
 * The keys live in the secure store, which nothing can subscribe to, so each
 * card used to read one once on focus. That broke on the one screen where it
 * matters: a key is ADDED in Settings, on the same screen as Penny's card,
 * without any focus change — so Penny kept saying "Add a key above" under a
 * key that had just been saved. Same rule as settings and the bank inbox: the
 * store holds a copy and repaints, the secure store stays the truth, and the
 * only way to change a key is through `save` here so the copy cannot fall
 * behind.
 *
 * SAVING CHECKS THE KEY FIRST, here, so no screen can store one unchecked: a
 * typo accepted at the paste fails weeks later in a receipt or a bank message,
 * which is the wrong place to learn the key was never right. A refused key
 * throws an `AiError` worded for the screen, and the old key stays. An empty
 * value is a removal and is never sent anywhere.
 *
 * Presence only. The keys themselves stay in the secure store and are read at
 * the moment of use; a billable credential has no business sitting in UI state.
 */
export type KeyPresence = Record<ProviderId, boolean>;

type AiKeysStore = {
  /** Null until the first read answers, so nothing flashes "no key". */
  keys: KeyPresence | null;
  refresh: () => Promise<void>;
  save: (provider: ProviderId, key: string | null) => Promise<void>;
};

async function readPresence(): Promise<KeyPresence> {
  const entries = await Promise.all(
    PROVIDER_IDS.map(async (id) => [id, (await getApiKey(id)) !== null] as const)
  );
  return Object.fromEntries(entries) as KeyPresence;
}

export const useAiKeysStore = create<AiKeysStore>((set) => ({
  keys: null,
  refresh: async () => {
    set({ keys: await readPresence() });
  },
  save: async (provider, key) => {
    if (key !== null && key.trim() !== '') await checkKey(provider, key);
    await setApiKey(provider, key);
    set({ keys: await readPresence() });
  },
}));

/** Whether ANY provider has a key — null until known. */
export function anyKey(keys: KeyPresence | null): boolean | null {
  return keys === null ? null : PROVIDER_IDS.some((id) => keys[id]);
}
