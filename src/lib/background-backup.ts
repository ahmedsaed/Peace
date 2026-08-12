/**
 * Backing up while the app is closed — as far as Android permits.
 *
 * THE ON-OPEN CATCH-UP REMAINS THE MECHANISM. This is an accelerator, and the
 * distinction is not modesty: WorkManager defers at the OS's discretion, and a
 * force-stop — by the user or by an OEM battery manager helping — cancels
 * pending work until the app is launched again. Anything load-bearing built on
 * that would work on the developer's phone and quietly stop on everyone else's.
 *
 * What it genuinely buys is the week you never open the app. For a weekly
 * cadence the deferral barely matters: the failure mode is LATENESS, not
 * silence, and a backup six hours late is a backup.
 *
 * The wakeup is deliberately more frequent than the cadence. WorkManager gives
 * no guarantee about *when* it runs, so asking to be woken roughly twice a day
 * and doing nothing unless a backup is actually owed converges far better than
 * asking for one wakeup a week and missing it.
 */

import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { getSetting, setSetting } from '@/db/settings';
import { backupDue, type Cadence } from '@/lib/drive-backup';
import { runBackup } from '@/db/drive';

export const BACKUP_TASK = 'peace-drive-backup';

/** Roughly twice a day. The task is a no-op unless something is owed. */
export const WAKEUP_MINUTES = 12 * 60;

/**
 * Should this wakeup do anything?
 *
 * Pure, and separated from the task body because it is the only part with a
 * decision in it — the rest is a native registration that cannot be unit
 * tested. Every guard here is a reason NOT to touch the network on a wakeup the
 * user did not ask for.
 */
export function shouldBackUp(
  state: { account: string; cadence: Cadence; lastBackupAt: number },
  now: number
): boolean {
  if (!state.account) return false;

  // NOT a `cadence === 'off'` check. `backupDue` already owns that rule and has
  // its own test for it — a mutation run proved the guard here did nothing,
  // which is what a duplicated rule looks like before it drifts. "Is a backup
  // due" has one home; this function only adds "is there an account at all".
  return backupDue(
    { cadence: state.cadence, lastBackupAt: state.lastBackupAt > 0 ? state.lastBackupAt : null },
    now
  );
}

/** Whether the task should be registered at all, given the current settings. */
export const wantsBackgroundBackup = (account: string, cadence: Cadence) =>
  account.length > 0 && cadence !== 'off';

/**
 * The task body.
 *
 * Reads settings from SQLITE, not from the zustand store: this runs in a
 * headless JS context with no React tree, so the store was never loaded and
 * would hand back its built-in defaults — `driveCadence: 'off'` — and the
 * backup would never run. A store is a UI cache; the database is the truth.
 */
TaskManager.defineTask(BACKUP_TASK, async () => {
  try {
    const state = {
      account: getSetting('driveAccount'),
      cadence: getSetting('driveCadence'),
      lastBackupAt: getSetting('driveLastBackupAt'),
    };

    if (!shouldBackUp(state, Date.now())) {
      // Nothing owed. Reported as success — the task did exactly its job, and
      // reporting failure would invite the OS to back off from scheduling it.
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    const outcome = await runBackup();
    setSetting('driveLastBackupAt', outcome.at);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    // Never load-bearing: a failed background backup leaves the age line on the
    // settings screen telling the truth, which is the whole reliability story
    // for something that cannot promise it ran.
    console.warn('[drive] background backup failed', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * Keep the registration in step with the settings.
 *
 * Idempotent, and safe to call on every launch and every settings change.
 * Registering an already-registered task is harmless; leaving one registered
 * after the user disconnects means waking the device for nothing, forever.
 */
export async function syncBackgroundBackup(account: string, cadence: Cadence): Promise<void> {
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(BACKUP_TASK);
    const wanted = wantsBackgroundBackup(account, cadence);

    if (wanted && !registered) {
      const status = await BackgroundTask.getStatusAsync();
      if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
        // Battery optimisation, or a device that simply does not allow it. The
        // on-open catch-up covers this completely; there is nothing to tell the
        // user that would not read as an error about a feature still working.
        console.warn('[drive] background tasks are restricted on this device');
        return;
      }
      await BackgroundTask.registerTaskAsync(BACKUP_TASK, {
        minimumInterval: WAKEUP_MINUTES,
      });
      return;
    }

    if (!wanted && registered) {
      await BackgroundTask.unregisterTaskAsync(BACKUP_TASK);
    }
  } catch (error) {
    // A registration that fails must not stop the app starting.
    console.warn('[drive] could not update the background backup schedule', error);
  }
}
