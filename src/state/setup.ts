import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { isCapturing, isPermitted } from '@/db/bank-inbox';
import { markDone, type SetupFacts, type SetupStep } from '@/lib/setup';
import { useGeminiKeyStore } from '@/state/gemini-key';
import { useSettingsStore } from '@/state/settings';

/**
 * Notification access, read so that a build without the native module reports
 * "not granted" rather than taking the screen down — same guard as the
 * Settings card.
 */
export function bankAccess(): { permitted: boolean; capturing: boolean } {
  try {
    return { permitted: isPermitted(), capturing: isCapturing() };
  } catch {
    return { permitted: false, capturing: false };
  }
}

/**
 * Everything `setupProgress` needs, kept current.
 *
 * Notification access is granted on a SYSTEM screen, so it changes while this
 * app is in the background; it is re-read on every return to the foreground or
 * the setup card would go on listing a step the user had just finished.
 */
export function useSetupFacts(): SetupFacts {
  const done = useSettingsStore((s) => s.settings.setupDone);
  const remindersOn = useSettingsStore((s) => s.settings.remindersOn);
  const senders = useSettingsStore((s) => s.settings.bankSenders);
  const driveAccount = useSettingsStore((s) => s.settings.driveAccount);
  const hasKey = useGeminiKeyStore((s) => s.hasKey);
  const refreshKey = useGeminiKeyStore((s) => s.refresh);
  const [access, setAccess] = useState(bankAccess);

  useEffect(() => {
    if (hasKey === null) void refreshKey();
  }, [hasKey, refreshKey]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setAccess(bankAccess());
    });
    return () => subscription.remove();
  }, []);

  return {
    done,
    remindersOn,
    hasKey: hasKey === true,
    bankReady: access.permitted && access.capturing && senders.length > 0,
    driveConnected: driveAccount !== '',
  };
}

/** Record a step as finished on purpose. */
export function useCompleteStep(): (step: SetupStep) => void {
  const update = useSettingsStore((s) => s.update);
  return useCallback(
    (step) => update('setupDone', markDone(useSettingsStore.getState().settings.setupDone, step)),
    [update]
  );
}
