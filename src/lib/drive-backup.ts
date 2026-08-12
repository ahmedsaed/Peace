/**
 * When to back up to Drive, and what to keep once it is there.
 *
 * Pure decisions only — no network, no filesystem — because these are the parts
 * that are easy to get wrong and impossible to check by looking at a phone. The
 * uploading lives in `drive-api.ts` and the wiring in `state/drive.ts`.
 */

import { exportFilename } from '@/db/repo/export';

export const CADENCES = ['off', 'daily', 'weekly', 'monthly'] as const;
export type Cadence = (typeof CADENCES)[number];

/**
 * Elapsed time, NOT calendar boundaries.
 *
 * Calendar days are the right answer for grouping a ledger — an 11pm purchase
 * belongs to the day it happened on — and the wrong one here. A backup taken at
 * 23:50 followed by the app opening at 00:05 crosses a calendar boundary and
 * would fire a second upload fifteen minutes later, every night the user
 * happens to be up. What "daily" means to a person is "about once a day".
 */
const INTERVAL_MS: Record<Cadence, number> = {
  off: Infinity,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export type BackupState = {
  /** Epoch ms of the last SUCCESSFUL upload; null if there has never been one. */
  lastBackupAt: number | null;
  cadence: Cadence;
};

/**
 * Is an automatic backup owed?
 *
 * Never true for `off` — including the first run, where "there has never been a
 * backup" would otherwise read as maximally overdue and upload the ledger of
 * someone who had switched the feature off.
 */
export function backupDue(state: BackupState, now: number): boolean {
  if (state.cadence === 'off') return false;
  if (state.lastBackupAt === null) return true;
  // A clock that moved backwards (timezone change, manual set) must not make a
  // backup permanently "not due" — treat any future timestamp as due now.
  if (state.lastBackupAt > now) return true;
  return now - state.lastBackupAt >= INTERVAL_MS[state.cadence];
}

/** For the settings row: "Daily · last backed up 2 hours ago". */
export function describeCadence(cadence: Cadence): string {
  switch (cadence) {
    case 'off':
      return 'Off';
    case 'daily':
      return 'Daily';
    case 'weekly':
      return 'Weekly';
    case 'monthly':
      return 'Monthly';
  }
}

/**
 * A name that sorts and reads correctly, and is unique within a day.
 *
 * `exportFilename` gives one file per DAY, which is right for a share sheet —
 * you export once and send it. Drive keeps a history, so two backups on the
 * same day must not present as the same thing.
 */
export function backupName(now: Date, sealed: boolean): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  const base = exportFilename(now, 'db').replace(/\.db$/, `-${time}.db`);
  // The suffix is a HINT for a human reading the file list. Restore never
  // trusts it — whether a file is sealed is decided by its header, because a
  // name is the one part of a file anybody can change.
  return sealed ? `${base}.enc` : base;
}

/** How many backups to keep in Drive before the oldest are removed. */
export const DEFAULT_KEEP = 5;

/**
 * Which files to delete, given the newest-first list Drive returned.
 *
 * Two rules, both learned the hard way in other people's backup systems:
 *
 *   Prune AFTER a successful upload, never before. Pruning first means a failed
 *   upload leaves the user with fewer backups than they started with — the
 *   system actively destroying its own safety margin at the exact moment it is
 *   failing.
 *
 *   Never prune to nothing. `keep` below 1 is clamped, so a bad setting cannot
 *   empty the folder.
 */
export function prunable(files: { id: string }[], keep: number = DEFAULT_KEEP): { id: string }[] {
  return files.slice(Math.max(1, keep));
}

/**
 * "2 hours ago" — deliberately coarse.
 *
 * A backup screen exists to answer "am I covered?", and a to-the-minute
 * timestamp invites the reader to audit the scheduler instead.
 */
export function describeAge(lastBackupAt: number | null, now: number): string {
  if (lastBackupAt === null) return 'Never backed up';
  const ms = Math.max(0, now - lastBackupAt);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'Backed up just now';
  if (minutes < 60) return `Backed up ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Backed up ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `Backed up ${days} day${days === 1 ? '' : 's'} ago`;
}
