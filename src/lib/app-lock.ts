/**
 * App lock — the decisions, kept apart from Android so they can be tested.
 *
 * THE PHONE'S OWN LOCK, NEVER A PEACE PIN. Unlocking goes through Android's
 * prompt, which takes whatever the phone already uses — fingerprint, face, or
 * the PIN, pattern or password behind them. A separate Peace PIN would be one
 * more secret to forget, and forgetting it here has no "reset by email": there
 * is no account and no server, so a forgotten PIN would lock somebody out of
 * the only copy of their ledger. The phone's own lock has a way back that
 * Android owns.
 *
 * IT FAILS OPEN WHEN THE PHONE HAS NO LOCK AT ALL. The setting travels in a
 * backup like every other, so a ledger restored onto a phone with no screen
 * lock arrives with the lock "on" and nothing that could ever satisfy it.
 * Locking anyway would brick the app over a setting. Failing open costs no
 * security worth having: removing a phone's screen lock takes the very
 * credential the prompt asks for, and Settings says plainly that the lock is
 * paused and why.
 */

/** How long the app may be away before it asks again. */
export type LockAfter = 'now' | '1min' | '5min' | '15min';

export const LOCK_AFTER: { value: LockAfter; label: string; seconds: number }[] = [
  { value: 'now', label: 'Immediately', seconds: 0 },
  { value: '1min', label: '1 min', seconds: 60 },
  { value: '5min', label: '5 min', seconds: 300 },
  { value: '15min', label: '15 min', seconds: 900 },
];

export function lockAfterSeconds(choice: LockAfter): number {
  return LOCK_AFTER.find((option) => option.value === choice)?.seconds ?? 0;
}

/**
 * What Android can check, from `getEnrolledLevelAsync`: nothing, a PIN /
 * pattern / password, or a biometric on top of one.
 */
export type DeviceLock = 'none' | 'secret' | 'biometric';

export function deviceLockFromLevel(level: number): DeviceLock {
  // SecurityLevel: NONE 0, SECRET 1, BIOMETRIC_WEAK 2, BIOMETRIC_STRONG 3.
  if (level >= 2) return 'biometric';
  if (level === 1) return 'secret';
  return 'none';
}

/** Whether the lock can do anything at all: on, and something to check. */
export function lockActive(enabled: boolean, device: DeviceLock): boolean {
  return enabled && device !== 'none';
}

/**
 * Should coming back to the app ask again?
 *
 * `awayAt` is when the app left the foreground, or null if it never did — a
 * return with no recorded departure (the unlock prompt itself, say) asks
 * nothing. Exactly the grace period counts as away: "after 1 minute" means a
 * minute is enough.
 */
export function lockDue({
  awayAt,
  now,
  after,
}: {
  awayAt: number | null;
  now: number;
  after: LockAfter;
}): boolean {
  if (awayAt === null) return false;
  return now - awayAt >= lockAfterSeconds(after) * 1000;
}

/** The Settings index line: what the lock does now, in a few words. */
export function describeLock(enabled: boolean, device: DeviceLock, after: LockAfter): string {
  if (!enabled) return 'Off';
  if (device === 'none') return 'Paused — this phone has no screen lock';
  const how = device === 'biometric' ? 'Fingerprint or screen lock' : 'Screen lock';
  const when =
    after === 'now' ? 'every time' : `after ${LOCK_AFTER.find((o) => o.value === after)?.label ?? ''} away`;
  return `${how} · ${when}`;
}
