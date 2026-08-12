import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { runBackup } from '@/db/drive';
import { backupDue } from '@/lib/drive-backup';
import { useSetting, useSettingsStore } from '@/state/settings';

/**
 * Automatic backup, such as Android permits.
 *
 * THE MECHANISM IS THE APP BEING OPENED, not a scheduler. Android will not
 * honour a sideloaded app's daily alarm — background work is deferred at the
 * OS's discretion and cancelled outright when the app is force-stopped or an
 * OEM battery manager decides to help. Building on that would produce a feature
 * that works on the developer's phone and silently stops on everyone else's.
 *
 * What makes this fine rather than a compromise is the cadence. A weekly backup
 * needs the app opened once a week, and this is an expense tracker — it is
 * opened to log things. The catch-up is not a fallback behind a scheduler; it
 * IS the scheduler, and it is reliable for exactly the reason the app exists.
 *
 * Two consequences are designed for rather than hoped away:
 *
 *   It cannot promise it ran, so the settings row reports the AGE of the last
 *   backup and marks it overdue. A silent stop nobody notices for a month is
 *   the only genuinely bad outcome, and visibility is what removes it.
 *
 *   It must never be load-bearing. Every failure here ends in a console warning
 *   and nothing else — no alert, no blocked screen, no retry storm. A dead
 *   network cannot stop a record being saved.
 */

/**
 * Module-level, not component state.
 *
 * The guard has to outlive re-renders AND cover the manual "Back up now"
 * button, because two uploads racing would each prune against a list the other
 * was still changing — and the loser deletes a backup the winner had just
 * counted as safe.
 */
let running = false;

export async function backupOnce(record: (at: number) => void): Promise<void> {
  if (running) return;
  running = true;
  try {
    const outcome = await runBackup();
    record(outcome.at);
  } catch (error) {
    // Friendly nothing for the user — the age line already tells the truth —
    // and the real error for whoever has to work out why it stopped.
    console.warn('[drive] automatic backup failed', error);
  } finally {
    running = false;
  }
}

/**
 * Renders nothing; exists so the hook can sit INSIDE `DatabaseProvider`.
 *
 * That placement is load-bearing: the provider gates on migrations and loads
 * the settings store behind the same gate, so a catch-up mounted above it would
 * read `driveCadence` as its built-in default of `off` and decide a backup was
 * never due.
 */
export function DriveCatchUp(): null {
  useDriveCatchUp();
  return null;
}

export function useDriveCatchUp(): void {
  const account = useSetting('driveAccount');
  const cadence = useSetting('driveCadence');
  const lastBackupAt = useSetting('driveLastBackupAt');
  const update = useSettingsStore((state) => state.update);

  // Read through a ref inside the listener so the subscription is created once
  // rather than torn down and rebuilt every time a setting changes. Written in
  // an effect, never during render — a ref mutated mid-render is invisible to
  // React and is what `react-hooks/refs` exists to catch.
  const state = useRef({ account, cadence, lastBackupAt, update });
  useEffect(() => {
    state.current = { account, cadence, lastBackupAt, update };
  });

  useEffect(() => {
    const attempt = () => {
      const { account: email, cadence: how, lastBackupAt: last, update: write } = state.current;
      if (!email || how === 'off') return;
      if (!backupDue({ cadence: how, lastBackupAt: last > 0 ? last : null }, Date.now())) return;
      void backupOnce((at) => write('driveLastBackupAt', at));
    };

    attempt();

    // Also on return to the foreground: the app can sit in memory for days, and
    // a launch-only check would then never fire for someone who never fully
    // closes it.
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') attempt();
    });
    return () => subscription.remove();
  }, []);
}
