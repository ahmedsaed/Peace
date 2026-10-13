import { create } from 'zustand';

import { checkGeminiKey } from '@/lib/gemini';
import { getGeminiKey, setGeminiKey } from '@/lib/secrets';

/**
 * Whether a Gemini key exists, as something every screen can watch.
 *
 * The key lives in the secure store, which nothing can subscribe to, so each
 * card used to read it once on focus. That broke on the one screen where it
 * matters: the key is ADDED in Settings, on the same screen as Penny's card,
 * without any focus change — so Penny kept saying "Add a Gemini key above"
 * under a key that had just been saved, until the switch was flipped off and
 * on. Same rule as settings and the bank inbox: the store holds a copy and
 * repaints, the secure store stays the truth, and the only way to change the
 * key is through `save` here so the copy cannot fall behind.
 *
 * SAVING CHECKS THE KEY FIRST, here, so no screen can store one unchecked: a
 * typo accepted at the paste fails weeks later in a receipt or a bank message,
 * which is the wrong place to learn the key was never right. A refused key
 * throws a `GeminiError` worded for the screen, and the old key stays. An
 * empty value is a removal and is never sent anywhere.
 *
 * Presence only. The key itself stays in the secure store and is read at the
 * moment of use; a billable credential has no business sitting in UI state.
 */
type GeminiKeyStore = {
  /** Null until the first read answers, so nothing flashes "no key". */
  hasKey: boolean | null;
  refresh: () => Promise<void>;
  save: (key: string | null) => Promise<void>;
};

export const useGeminiKeyStore = create<GeminiKeyStore>((set) => ({
  hasKey: null,
  refresh: async () => {
    set({ hasKey: (await getGeminiKey()) !== null });
  },
  save: async (key) => {
    if (key !== null && key.trim() !== '') await checkGeminiKey(key);
    await setGeminiKey(key);
    set({ hasKey: (await getGeminiKey()) !== null });
  },
}));
