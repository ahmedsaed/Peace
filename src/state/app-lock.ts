import * as LocalAuthentication from 'expo-local-authentication';
import { create } from 'zustand';

import { deviceLockFromLevel, type DeviceLock } from '@/lib/app-lock';

/**
 * Whether Peace is locked right now, and what the phone can check.
 *
 * A store rather than component state because three places need the same
 * answer: the lock screen over everything, the Settings page that turns it on,
 * and the Settings index line that describes it.
 */
type LockStore = {
  locked: boolean;
  /**
   * True while Android's prompt is up. The prompt can pause the activity, and
   * a lock that read that as "the app went away" would lock again the moment
   * it was unlocked.
   */
  prompting: boolean;
  /** What Android can check. `null` until asked. */
  device: DeviceLock | null;
  /** The last refusal worth showing, or null. */
  problem: string | null;
  setLocked: (locked: boolean) => void;
};

export const useLockStore = create<LockStore>(() => ({
  locked: false,
  prompting: false,
  device: null,
  problem: null,
  setLocked: (locked) => useLockStore.setState({ locked, problem: null }),
}));

/**
 * Ask Android what the phone has. Re-read whenever it matters, never cached
 * for long: a screen lock can be added or removed in system settings while
 * Peace sits in the background.
 */
export async function readDeviceLock(): Promise<DeviceLock> {
  let device: DeviceLock = 'none';
  try {
    device = deviceLockFromLevel(await LocalAuthentication.getEnrolledLevelAsync());
  } catch (e) {
    console.warn('[lock] could not read the device lock', e);
  }
  useLockStore.setState({ device });
  return device;
}

/** What a refusal means to the person holding the phone. Null: say nothing. */
function explain(error: string): string | null {
  switch (error) {
    case 'user_cancel':
    case 'system_cancel':
    case 'app_cancel':
      return null;
    case 'lockout':
      return 'Too many attempts. Wait a moment, or unlock with your screen lock.';
    default:
      return 'That did not work. Try again.';
  }
}

/**
 * Show Android's prompt. Resolves true once the person has proved it is them.
 *
 * A phone with no screen lock resolves TRUE — see "fails open" in
 * `lib/app-lock.ts`: a restored setting must never lock somebody out for good.
 */
export async function confirmOwner(reason: string): Promise<boolean> {
  if (useLockStore.getState().prompting) return false;
  useLockStore.setState({ prompting: true, problem: null });
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      // Android's own fallback to the PIN, pattern or password — the phone's
      // way back, not one Peace would have to invent.
      disableDeviceFallback: false,
    });
    if (result.success) return true;
    if (result.error === 'not_enrolled' || result.error === 'passcode_not_set') {
      await readDeviceLock();
      return true;
    }
    console.warn('[lock] prompt refused', result.error, result.warning);
    useLockStore.setState({ problem: explain(result.error) });
    return false;
  } catch (e) {
    console.warn('[lock] prompt failed', e);
    useLockStore.setState({ problem: 'That did not work. Try again.' });
    return false;
  } finally {
    useLockStore.setState({ prompting: false });
  }
}

/** Unlock from the lock screen. */
export async function unlock(): Promise<void> {
  if (await confirmOwner('Unlock Peace')) useLockStore.getState().setLocked(false);
}
