import { useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Image, Modal, Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Wordmark } from '@/components/wordmark';
import { lockActive, lockDue } from '@/lib/app-lock';
import { readDeviceLock, unlock, useLockStore } from '@/state/app-lock';
import { useSettingsStore } from '@/state/settings';
import { useTheme } from '@/state/theme';

import { hideFromRecents } from '../../modules/recents-privacy/src/RecentsPrivacyModule';

/**
 * The app lock, over everything.
 *
 * Rendered BESIDE the navigator rather than as a route, so locking never
 * unmounts a screen: a half-typed record is exactly where it was after
 * unlocking. It is drawn twice on purpose. A plain curtain in the same tree as
 * the screens covers them from the very first frame — a Modal is a separate
 * window that attaches a moment after it mounts — and the Modal, being a
 * window, covers what the curtain cannot: a bottom sheet that was open when the
 * phone was put down is a window too, and would sit over a curtain in the tree.
 *
 * WHILE AWAY, ALWAYS COVERED. Android draws the last frame the instant the
 * app returns, before any JavaScript can decide whether the grace period is
 * up, so a lock decided on return shows a flash of the ledger first. The
 * curtain goes up as the app leaves and comes down on return if no lock is
 * due. A blink of the logo on a quick switch is the price of never showing a
 * frame of somebody's spending to whoever picked the phone up.
 */
export function AppLockGate() {
  const palette = useTheme();
  const enabled = useSettingsStore((state) => state.settings.lockEnabled);
  const after = useSettingsStore((state) => state.settings.lockAfter);
  const locked = useLockStore((state) => state.locked);
  const device = useLockStore((state) => state.device);
  const [away, setAway] = useState(false);

  // Read in the AppState handler, which is registered once.
  const latest = useRef({ enabled, after, device });
  useEffect(() => {
    latest.current = { enabled, after, device };
  });
  const awayAt = useRef<number | null>(null);

  // What the phone can check, once at launch. A lock restored onto a phone
  // with nothing to check opens again rather than staying shut for good.
  useEffect(() => {
    void readDeviceLock().then((found) => {
      if (found === 'none') useLockStore.getState().setLocked(false);
    });
  }, []);

  // The recent-apps preview: blank while the lock can do anything.
  useEffect(() => {
    hideFromRecents(lockActive(enabled, device ?? 'secret'));
  }, [enabled, device]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const { enabled: on, after: grace, device: known } = latest.current;
      const store = useLockStore.getState();
      if (next === 'active') {
        setAway(false);
        if (on && awayAt.current !== null) {
          // The last thing Android said; corrected below if the screen lock
          // has been removed since, so the decision costs no round trip.
          if (lockActive(on, known ?? 'secret') && lockDue({ awayAt: awayAt.current, now: Date.now(), after: grace })) {
            store.setLocked(true);
          }
        }
        awayAt.current = null;
        void readDeviceLock().then((found) => {
          hideFromRecents(lockActive(latest.current.enabled, found));
          if (found === 'none') useLockStore.getState().setLocked(false);
        });
        return;
      }
      // Android's own prompt pauses the activity. That is not leaving.
      if (store.prompting || store.locked || !on) return;
      awayAt.current ??= Date.now();
      setAway(true);
    });
    return () => subscription.remove();
  }, []);

  // Ask as soon as the lock goes up, once. Cancelling leaves the button.
  useEffect(() => {
    if (locked && AppState.currentState === 'active') void unlock();
  }, [locked]);

  if (!locked && !away) return null;
  return (
    <>
      <View
        pointerEvents="auto"
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: palette.ground }}
      />
      <Modal
        visible
        transparent={false}
        animationType="none"
        statusBarTranslucent
        navigationBarTranslucent
        // Back from the lock leaves the app; it never reaches the screens
        // underneath.
        onRequestClose={() => BackHandler.exitApp()}>
        {locked ? <LockScreen /> : <View className="flex-1 bg-ground" />}
      </Modal>
    </>
  );
}

function LockScreen() {
  const palette = useTheme();
  const prompting = useLockStore((state) => state.prompting);
  const problem = useLockStore((state) => state.problem);
  return (
    <View className="flex-1 items-center justify-center bg-ground px-8" testID="app-lock">
      <Image
        source={require('../../assets/images/logo-mark.png')}
        style={{ width: 72, height: 72 }}
        accessibilityIgnoresInvertColors
      />
      <Wordmark size={44} />
      <View className="mt-6 flex-row items-center gap-2">
        <Icon name="lock" size={14} color={palette.muted} />
        <Text className="text-sm text-muted">Locked</Text>
      </View>
      {problem ? (
        <Text className="mt-3 text-center text-sm leading-5 text-expense" testID="app-lock-problem">
          {problem}
        </Text>
      ) : null}
      <Pressable
        onPress={() => void unlock()}
        disabled={prompting}
        testID="app-lock-unlock"
        accessibilityRole="button"
        className={`mt-10 rounded-full bg-accent px-8 py-3 active:opacity-80 ${prompting ? 'opacity-50' : ''}`}>
        <Text className="text-base font-semibold text-accent-ink">Unlock</Text>
      </Pressable>
    </View>
  );
}
