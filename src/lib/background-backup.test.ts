/**
 * The decision a background wakeup makes.
 *
 * Registration itself is a native call and cannot be unit tested — but the
 * question "should this wakeup do anything?" is pure, and it is the only place
 * a mistake costs something: every guard here is a reason NOT to touch the
 * network on a wakeup the user did not ask for.
 */

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));
jest.mock('expo-background-task', () => ({
  registerTaskAsync: jest.fn(),
  unregisterTaskAsync: jest.fn(),
  getStatusAsync: jest.fn(async () => 2),
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
}));
jest.mock('@/db/settings', () => ({ getSetting: jest.fn(), setSetting: jest.fn() }));
jest.mock('@/db/drive', () => ({ runBackup: jest.fn() }));

/* eslint-disable import/first */
import {
  shouldBackUp,
  wantsBackgroundBackup,
  WAKEUP_MINUTES,
} from './background-backup';
/* eslint-enable import/first */

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_800_000_000_000;

const state = (over: Partial<Parameters<typeof shouldBackUp>[0]> = {}) => ({
  account: 'ahmed@example.com',
  cadence: 'weekly' as const,
  lastBackupAt: T0 - 8 * DAY,
  ...over,
});

describe('whether a wakeup should back up', () => {
  it('does when one is overdue', () => {
    expect(shouldBackUp(state(), T0)).toBe(true);
  });

  it('does not when the last one was recent', () => {
    expect(shouldBackUp(state({ lastBackupAt: T0 - 2 * DAY }), T0)).toBe(false);
  });

  /**
   * The setting says off. A wakeup that backed up anyway would be the app
   * ignoring an instruction while the phone is in someone's pocket.
   */
  it('never does when the cadence is off', () => {
    expect(shouldBackUp(state({ cadence: 'off' }), T0)).toBe(false);
    expect(shouldBackUp(state({ cadence: 'off', lastBackupAt: 0 }), T0)).toBe(false);
  });

  it('never does when no account is connected', () => {
    expect(shouldBackUp(state({ account: '' }), T0)).toBe(false);
  });

  it('does when connected but never backed up', () => {
    expect(shouldBackUp(state({ lastBackupAt: 0 }), T0)).toBe(true);
  });

  it('respects the cadence rather than a fixed period', () => {
    const monthly = state({ cadence: 'monthly', lastBackupAt: T0 - 20 * DAY });
    expect(shouldBackUp(monthly, T0)).toBe(false);
    expect(shouldBackUp({ ...monthly, cadence: 'weekly' }, T0)).toBe(true);
  });
});

describe('whether the task should be registered at all', () => {
  it('is wanted only when connected and switched on', () => {
    expect(wantsBackgroundBackup('a@b.com', 'weekly')).toBe(true);
    expect(wantsBackgroundBackup('a@b.com', 'off')).toBe(false);
    expect(wantsBackgroundBackup('', 'weekly')).toBe(false);
  });
});

describe('the wakeup interval', () => {
  /**
   * Deliberately more frequent than any cadence. WorkManager gives no
   * guarantee about WHEN it runs, so asking for a wakeup roughly twice a day
   * and doing nothing unless a backup is owed converges far better than asking
   * for one a week and missing it.
   */
  it('is far shorter than the longest cadence', () => {
    const weekInMinutes = 7 * 24 * 60;
    expect(WAKEUP_MINUTES).toBeLessThan(weekInMinutes);
    // And not below Android's floor, which would be silently raised anyway.
    expect(WAKEUP_MINUTES).toBeGreaterThanOrEqual(15);
  });
});
