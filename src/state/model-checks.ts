import { create } from 'zustand';

import { runChecks, type StoredAbilities } from '@/ai/checks';
import { parseModelRef } from '@/ai/model-ref';
import type { ModelInfo } from '@/ai/providers';
import { endpointFor } from '@/lib/secrets';
import { useSettingsStore } from '@/state/settings';

/**
 * Running the checks on a model, and keeping what they found.
 *
 * The answer goes into settings (`modelAbilities`), so every screen that asks
 * "can this feature run" repaints the moment it lands — and a model checked
 * from Penny's page is already known on the Receipts page. Only WHICH checks
 * are running lives here, because that is the one thing nobody needs after a
 * restart.
 */
type ModelChecksStore = {
  running: Record<string, boolean>;
  /** What the listing said, kept on choosing — before any check has run. */
  remember: (stored: string, info: ModelInfo | undefined) => void;
  check: (stored: string) => Promise<void>;
};

function write(stored: string, change: (before: StoredAbilities) => StoredAbilities): void {
  const { settings, update } = useSettingsStore.getState();
  update('modelAbilities', { ...settings.modelAbilities, [stored]: change(settings.modelAbilities[stored] ?? {}) });
}

export const useModelChecks = create<ModelChecksStore>((set, get) => ({
  running: {},
  remember: (stored, info) => {
    if (!info) return;
    write(stored, (before) => ({
      ...before,
      ...(info.abilities ? { declared: info.abilities } : {}),
      ...(info.transcription ? { transcription: true } : {}),
    }));
  },
  check: async (stored) => {
    if (get().running[stored]) return;
    const ref = parseModelRef(stored);
    if (ref === null) return;
    const endpoint = await endpointFor(ref);
    if (endpoint === null) return;
    set((s) => ({ running: { ...s.running, [stored]: true } }));
    try {
      const checked = await runChecks(endpoint);
      write(stored, (before) => ({ ...before, checked }));
    } catch (error) {
      console.warn('[checks] could not run', stored, error);
    } finally {
      set((s) => {
        const running = { ...s.running };
        delete running[stored];
        return { running };
      });
    }
  },
}));
