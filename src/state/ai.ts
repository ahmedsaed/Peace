import { useEffect } from 'react';

import { jobBlock, voiceRequirements, type JobBlock } from '@/ai/availability';
import { anyKey, useAiKeysStore } from '@/state/ai-keys';
import { useSettingsStore } from '@/state/settings';

/**
 * Whether each AI feature can ACTUALLY run — the one place that decides.
 *
 * Five things have to be true: Use AI is on, the feature's own switch is on,
 * somebody chose a model for it, that model's provider has a key, and nothing
 * the checks found says the model cannot do what the feature needs. Every
 * screen that shows or hides an AI control asks this rather than reading the
 * settings itself, because the settings alone describe a WISH: Receipts "on"
 * with no key is a switch claiming a feature that cannot run, and that is
 * exactly how Settings came to show it.
 *
 * The settings themselves are never changed here. With no key, every switch
 * shows off and is muted; add a key and each comes back as it was left.
 */
export type AiFeature = 'receipts' | 'voice' | 'bank' | 'penny';

export type AiState = {
  /** Whether ANY provider has a key. Null until the secure store has answered. */
  hasKey: boolean | null;
  /** Some key exists and Use AI is on: features may run if their own setup allows. */
  ready: boolean;
  receipts: boolean;
  penny: boolean;
  /** Speaking a record, or a question to Penny (where Penny is also on). */
  voice: boolean;
  /** Bank READING; capture is native and carries on regardless. */
  bank: boolean;
  /** Why nothing at all can run, when nothing can — for the notice that says so. */
  blocked: 'no-key' | 'ai-off' | null;
  /** Why each feature cannot run, for the line under its row. */
  why: Record<AiFeature, JobBlock | null>;
};

export function useAi(): AiState {
  const keys = useAiKeysStore((s) => s.keys);
  const refresh = useAiKeysStore((s) => s.refresh);
  const s = useSettingsStore((state) => state.settings);

  // The keys live in the secure store, which nothing can subscribe to; the
  // first screen that asks loads them, and `save` keeps them current after.
  useEffect(() => {
    if (keys === null) void refresh();
  }, [keys, refresh]);

  const hasKey = anyKey(keys);
  const present = keys ?? {};
  const aiEnabled = s.aiEnabled;
  const book = s.modelAbilities;
  // What each feature asks of its model. Penny's files model is not here: a
  // Penny who cannot read an attachment can still answer, and says so.
  const why: Record<AiFeature, JobBlock | null> = {
    receipts: jobBlock([{ stored: s.receiptsModel, needs: ['json', 'images'] }], present, book, {
      aiEnabled,
      featureOn: s.receiptsEnabled,
    }),
    voice: jobBlock(voiceRequirements(s.voiceModel, s.voiceReadModel, book), present, book, {
      aiEnabled,
      featureOn: s.voiceEnabled,
    }),
    bank: jobBlock([{ stored: s.bankModel, needs: ['json'] }], present, book, { aiEnabled, featureOn: true }),
    penny: jobBlock([{ stored: s.pennyModel, needs: ['tools'] }], present, book, {
      aiEnabled,
      featureOn: s.assistantEnabled,
    }),
  };

  return {
    hasKey,
    ready: hasKey === true && aiEnabled,
    receipts: why.receipts === null,
    penny: why.penny === null,
    voice: why.voice === null,
    bank: why.bank === null,
    blocked: hasKey === false ? 'no-key' : !aiEnabled ? 'ai-off' : null,
    why,
  };
}
