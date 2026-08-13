import { Directory, File, Paths } from 'expo-file-system';

import { openBackupPayload, type BackupPayload } from '../lib/backup-payload';
import { packContainer } from '../lib/container';
import { useSettingsStore } from '../state/settings';
import { filesOnDisk, readReferencedFiles, sweepOrphans, writeRestoredFiles } from './attachments';
import { db, sqliteDb, DATABASE_NAME } from './client';
import { missingFiles } from './repo/attachments';
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
  /** Attachment files written back out of the container. */
  filesRestored: number;
  /** Files from the previous ledger that nothing points at any more. */
  filesRemoved: number;
  /**
   * Rows whose file is not on disk once this restore finished.
   *
   * Non-zero after restoring a backup made before attachments existed: the rows
   * describe receipts that were never in the file. The screen says so, because
   * a column of broken thumbnails with no explanation reads as a bug in the app
   * rather than as the age of the backup.
   */
  filesMissing: number;
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
 *
 * A CONTAINER, not a bare database, since records started carrying receipts.
 * A restore sweeps the files the incoming ledger does not mention, which is the
 * right thing to do and would otherwise destroy the outgoing ledger's photos —
 * so "undo" would hand back rows whose files had just been deleted, and the
 * screen would still be calling it undoable. The safety copy has to hold
 * everything the restore is about to replace, files included.
 */
const SAFETY_NAME = 'peace-before-restore.zip';

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
 * would treat as a relative name. Writing into the cache solves both: a real
 * path, and a snapshot that cannot change under us mid-restore.
 *
 * It also unwraps the container. What the user picked may be a zip holding the
 * database and its attachments, or a bare `.db` from before attachments
 * existed; `openBackupPayload` decides which by reading the bytes, and SQLite
 * only ever sees a plain database file either way.
 */
function stageDatabase(database: Uint8Array): File {
  const staged = new File(Paths.cache, 'restore-source.db');
  if (staged.exists) staged.delete();
  staged.create({ overwrite: true });
  staged.write(database);
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
 *
 * ATTACHMENT FILES ARE WRITTEN AFTER THE ROWS, NEVER BEFORE. If the database
 * step throws, nothing on disk has changed and the old ledger still has all of
 * its receipts. Writing first would leave a refused restore having already
 * scattered another backup's files into the directory — where the orphan sweep
 * would eventually collect them, but not before they had been packed into the
 * next backup.
 */
export async function restoreFrom(picked: File): Promise<RestoreResult> {
  const raw = await picked.bytes();
  if (raw.byteLength === 0) {
    throw new RestoreError('That file is empty.');
  }

  let payload: BackupPayload;
  try {
    payload = openBackupPayload(raw);
  } catch (error) {
    // ContainerError and BackupFormatError both already say what is wrong with
    // the FILE in a sentence a person can act on. Rewrapping would bury it.
    throw new RestoreError(error instanceof Error ? error.message : String(error));
  }

  const source = stageDatabase(payload.database);

  // Fold the write-ahead log in first: the safety copy taken below must include
  // everything, and the live database is about to be rewritten.
  sqliteDb.execSync('PRAGMA wal_checkpoint(TRUNCATE);');

  let attached = false;
  try {
    sqliteDb.execSync(`ATTACH DATABASE '${pathOf(source)}' AS ${ALIAS}`);
    attached = true;

    // Throws before anything is deleted.
    validateBackup(sqliteDb, ALIAS);

    /**
     * Park the CURRENT state before replacing it — the whole ledger AND the
     * receipts it refers to, because the sweep below is about to delete every
     * file the incoming ledger does not mention.
     *
     * Safe to overwrite here: the chosen file was already read into memory
     * above, so the source of this restore can never be the file being written.
     */
    const safety = safetyCopy();
    if (safety.exists) safety.delete();
    safety.create({ overwrite: true });
    safety.write(
      packContainer({
        database: await databaseFile().bytes(),
        files: await readReferencedFiles(),
      })
    );
    if (!safety.exists || safety.size <= 0) {
      throw new RestoreError('Could not save a copy of your current data, so nothing was changed.');
    }

    const copied = copyFromBackup(sqliteDb, ALIAS);

    // Past the point of no return: the ledger IS the backup's now. Everything
    // below is about the files that go with it, and none of it may throw — a
    // successful restore reported as a failure would send the user to the undo
    // button to reverse the thing that actually worked.
    const filesRestored = writeRestoredFiles(payload.files);
    const filesRemoved = sweepOrphans();
    const filesMissing = missingFiles(db, filesOnDisk()).length;

    return { copied, safetyBytes: safety.size, filesRestored, filesRemoved, filesMissing };
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
