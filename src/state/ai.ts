import { useEffect } from 'react';

import { useGeminiKeyStore } from '@/state/gemini-key';
import { useSettingsStore } from '@/state/settings';

/**
 * Whether each AI feature can ACTUALLY run — the one place that decides.
 *
 * Three things have to be true: there is a Gemini key, Use AI is on, and the
 * feature's own switch is on. Every screen that shows or hides an AI control
 * asks this rather than reading the settings itself, because the settings
 * alone describe a WISH: Receipts "on" with no key is a switch claiming a
 * feature that cannot run, and that is exactly how Settings came to show it.
 *
 * The settings themselves are never changed here. With no key, every switch
 * shows off and is muted; add a key and each comes back as it was left.
 */
export type AiState = {
  /** Null until the secure store has answered — show nothing yet, not "no key". */
  hasKey: boolean | null;
  /** A key exists and Use AI is on: features may run if their own switch allows. */
  ready: boolean;
  receipts: boolean;
  penny: boolean;
  /** Bank READING; capture is native and carries on regardless. */
  bank: boolean;
  /** Why nothing can run, when nothing can — for the notice that says so. */
  blocked: 'no-key' | 'ai-off' | null;
};

export function useAi(): AiState {
  const hasKey = useGeminiKeyStore((s) => s.hasKey);
  const refresh = useGeminiKeyStore((s) => s.refresh);
  const aiEnabled = useSettingsStore((s) => s.settings.aiEnabled);
  const receiptsEnabled = useSettingsStore((s) => s.settings.receiptsEnabled);
  const assistantEnabled = useSettingsStore((s) => s.settings.assistantEnabled);

  // The key lives in the secure store, which nothing can subscribe to; the
  // first screen that asks loads it, and `save` keeps it current after that.
  useEffect(() => {
    if (hasKey === null) void refresh();
  }, [hasKey, refresh]);

  const ready = hasKey === true && aiEnabled;
  return {
    hasKey,
    ready,
    receipts: ready && receiptsEnabled,
    penny: ready && assistantEnabled,
    bank: ready,
    blocked: hasKey === false ? 'no-key' : !aiEnabled ? 'ai-off' : null,
  };
}
