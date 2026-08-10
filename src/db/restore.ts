import { Directory, File, Paths } from 'expo-file-system';

import { useSettingsStore } from '../state/settings';
import { sqliteDb, DATABASE_NAME } from './client';
import {
  copyFromBackup,
  countRows,
  RestoreError,
  validateBackup,
  type RestoreTable,
} from './restore-core';

export { RestoreError } from './restore-core';

export type RestoreResult = {
  copied: Record<RestoreTable, number>;
  /** Bytes parked in the safety copy, so the screen can prove it exists. */
  safetyBytes: number;
};

const ALIAS = 'peace_backup';

/**
 * Where the pre-restore state is parked.
 *
 * A FIXED name, deliberately not the dated one exports use. The first version
 * reused `peace-<date>.db`, which meant tapping "Back up everything" on the
 * same day deleted the safety copy — the staging code clears a file of the same
 * name before writing. The screen said a restore was undoable while the only
 * thing that made it undoable was one tap from being destroyed.
 */
const SAFETY_NAME = 'peace-before-restore.db';

export const safetyCopy = () => new File(Paths.cache, SAFETY_NAME);

/** True when a restore has happened and its "before" state is still around. */
export function hasSafetyCopy(): boolean {
  const file = safetyCopy();
  return file.exists && file.size > 0;
}

/**
 * ATTACH takes a filesystem path, not a URI.
 *
 * The picker hands back `content://…` for a file the user chose, which SQLite
 * cannot open at all, and even a local file arrives as `file:///…` which it
 * would treat as a relative name. Copying into the cache solves both: a real
 * path, and a snapshot that cannot change under us mid-restore.
 */
function localCopyOf(picked: File): File {
  const staged = new File(Paths.cache, 'restore-source.db');
  if (staged.exists) staged.delete();
  picked.copySync(staged);
  return staged;
}

const pathOf = (file: File) => file.uri.replace(/^file:\/\//, '');

/**
 * Replace everything in the ledger with the contents of a backup file.
 *
 * The order matters and is the whole safety argument:
 *
 *   1. copy the chosen file somewhere SQLite can open
 *   2. VALIDATE it before touching anything — a refusal leaves the user holding
 *      both their data and their backup
 *   3. back up the CURRENT database first, so a restore that turns out to be a
 *      mistake is itself undoable
 *   4. replace the data in one transaction
 *
 * Step 3 is not decoration. A recovery tool that can destroy the thing it is
 * meant to protect is worse than no recovery tool, because it gets used
 * confidently.
 *
 * Data is copied table by table rather than by swapping the database FILE.
 * Swapping would need the live connection closed and the app restarted, and
 * would carry the backup's migration history with it; copying keeps the
 * connection valid, keeps this build's schema, and is atomic.
 */
export async function restoreFrom(picked: File): Promise<RestoreResult> {
  const source = localCopyOf(picked);
  if (!source.exists || source.size <= 0) {
    throw new RestoreError('That file is empty.');
  }

  // Fold the write-ahead log in first: the safety copy taken below must include
  // everything, and the live database is about to be rewritten.
  sqliteDb.execSync('PRAGMA wal_checkpoint(TRUNCATE);');

  let attached = false;
  try {
    sqliteDb.execSync(`ATTACH DATABASE '${pathOf(source)}' AS ${ALIAS}`);
    attached = true;

    // Throws before anything is deleted.
    validateBackup(sqliteDb, ALIAS);

    // Park the CURRENT state before replacing it. Safe to overwrite here: the
    // chosen file was already staged to its own name above, so the source of
    // this restore is never the file being written.
    const safety = safetyCopy();
    if (safety.exists) safety.delete();
    databaseFile().copySync(safety);
    if (!safety.exists || safety.size <= 0) {
      throw new RestoreError('Could not save a copy of your current data, so nothing was changed.');
    }

    const copied = copyFromBackup(sqliteDb, ALIAS);
    return { copied, safetyBytes: safety.size };
  } catch (error) {
    if (error instanceof RestoreError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new RestoreError(`Could not restore this file. ${message}`);
  } finally {
    if (attached) {
      try {
        sqliteDb.execSync(`DETACH DATABASE ${ALIAS}`);
      } catch {
        // A failed detach must not mask the real error above.
      }
    }
    if (source.exists) source.delete();
  }
}

/**
 * The live SQLite file. Duplicated from backup.ts rather than imported to keep
 * restore independent of the export path — see that file for why both URI
 * shapes are tried.
 */
function databaseFile(): File {
  const candidates = [
    new File(Paths.document, 'SQLite', DATABASE_NAME),
    new File(new Directory(`${Paths.document.uri}SQLite`), DATABASE_NAME),
  ];
  const found = candidates.find((f) => f.exists);
  if (!found) throw new RestoreError('Could not find the database file to back up.');
  return found;
}

/** Pick a backup file. Returns null when the user backs out. */
export async function pickBackup(): Promise<File | null> {
  // Deliberately unfiltered: Android frequently reports a `.db` as
  // `application/octet-stream` or gives it no type at all, and a mime filter
  // would hide the user's own backup from them.
  const result = await File.pickFileAsync();
  return result.canceled ? null : result.result;
}

/** Ledger size, for the confirmation that says what is about to be replaced. */
export function currentCounts(): { transactions: number; accounts: number } {
  return {
    transactions: countRows(sqliteDb, 'main', 'transactions'),
    accounts: countRows(sqliteDb, 'main', 'accounts'),
  };
}

/**
 * Re-read anything cached in memory after the tables underneath it changed.
 *
 * The settings store is a write-through cache, so after a restore it still
 * holds the OLD home currency and default account while the database holds the
 * backup's — and it would keep serving them until the app restarted. Every
 * screen re-queries on focus, so this is the only in-memory copy that needs
 * telling.
 */
export function refreshAfterRestore(): void {
  useSettingsStore.getState().load();
}
