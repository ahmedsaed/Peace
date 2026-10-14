import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Choice, Section, SettingsPage, Toggle } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';
import { LOCK_AFTER, type LockAfter } from '@/lib/app-lock';
import { confirmOwner, readDeviceLock, useLockStore } from '@/state/app-lock';
import { useSettingsStore } from '@/state/settings';
import { useTheme } from '@/state/theme';

/**
 * Settings › App lock.
 *
 * Turning it on AND off both ask for the phone's lock. On, because a lock
 * switched on without proving the prompt works is a lock that might not open;
 * off, because otherwise anyone holding the unlocked phone for a minute could
 * quietly disable it for next time.
 */
export default function LockSettings() {
  const palette = useTheme();
  const enabled = useSettingsStore((state) => state.settings.lockEnabled);
  const after = useSettingsStore((state) => state.settings.lockAfter);
  const update = useSettingsStore((state) => state.update);
  const device = useLockStore((state) => state.device);
  const problem = useLockStore((state) => state.problem);
  const [busy, setBusy] = useState(false);

  // A screen lock is added in Android's settings, so look again on return.
  useFocusEffect(
    useCallback(() => {
      void readDeviceLock();
    }, [])
  );

  const none = device === 'none';
  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      const ok = await confirmOwner(next ? 'Turn on the app lock' : 'Turn off the app lock');
      if (ok) update('lockEnabled', next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsPage
      title="App lock"
      {...SECTIONS.lock}
      intro="Ask for your fingerprint, face or phone PIN when Peace opens, so a phone handed to somebody else does not hand over your ledger."
      testID="settings-lock">
      {none ? (
        <View className="flex-row items-center gap-3 rounded-xl border border-line px-4 py-3" testID="lock-notice">
          <Icon name="lock" size={18} color={palette.muted} />
          <Text className="flex-1 text-sm leading-5 text-muted">
            {enabled
              ? 'Paused: this phone has no screen lock, so there is nothing to ask for. Set one and the lock comes back on its own.'
              : 'This phone has no screen lock. Peace uses the phone’s own, so set one first.'}
          </Text>
          <Pressable
            onPress={() => void Linking.sendIntent('android.settings.SECURITY_SETTINGS')}
            testID="lock-notice-open"
            accessibilityRole="button"
            className="rounded-full bg-accent px-4 py-2 active:opacity-80">
            <Text className="text-sm font-semibold text-accent-ink">Set one</Text>
          </Pressable>
        </View>
      ) : null}

      <Section>
        <Toggle
          label="Lock Peace"
          // Named after what THIS phone has — never "your PIN" on a phone
          // whose notice above says it has none.
          hint={
            device === 'biometric'
              ? 'Your fingerprint or face, or the PIN, pattern or password behind them.'
              : device === 'secret'
                ? 'Your phone’s PIN, pattern or password.'
                : 'Needs a screen lock on this phone.'
          }
          // Shown off while it cannot do anything: a switch reading "on" above
          // a phone with no lock would be claiming something untrue.
          value={enabled && !none}
          disabled={none || busy || device === null}
          onChange={(next) => void toggle(next)}
          testID="setting-lock"
          last={!enabled}
        />
        {enabled && !none ? (
          <Choice<LockAfter>
            label="Lock after"
            hint="How long Peace can be in the background before it asks again. A minute is enough to take a receipt photo without unlocking twice."
            options={LOCK_AFTER.map(({ value, label }) => ({ value, label }))}
            value={after}
            onChange={(next) => update('lockAfter', next)}
            testIDPrefix="lock-after"
            last
          />
        ) : null}
      </Section>

      {problem && busy === false ? (
        <Text className="px-1 text-sm text-expense" testID="lock-problem">
          {problem}
        </Text>
      ) : null}

      <Text className="px-1 text-xs leading-5 text-muted opacity-70">
        The lock covers the screen; it does not encrypt your ledger. While it is on, the recent-apps
        preview is blank on Android 13 and later. Bank messages are still captured and your reminder
        still arrives while Peace is locked. Backups are not locked — give Drive backups a passphrase
        in Backup &amp; export.
      </Text>
    </SettingsPage>
  );
}
