/**
 * Backing the ledger up to Google Drive, end to end.
 *
 * Composition only — the decisions live elsewhere and are tested there:
 * `google-auth` gets a token, `drive-api` talks to Drive, `seal` encrypts,
 * `drive-backup` decides when and what to keep. This file's job is the ORDER,
 * and the order is where the sharp edges are.
 *
 * Nothing here is load-bearing for using the app. Every failure path ends with
 * the ledger untouched and a message; a dead network, a full Drive or a revoked
 * grant must never stop a record being saved.
 */

import { File, Paths } from 'expo-file-system';

import {
  deleteBackup,
  downloadBackup,
  DriveError,
  listBackups,
  uploadBackup,
  type DriveFile,
} from '../lib/drive-api';
import { isBackupPayload, openBackupPayload } from '../lib/backup-payload';
import { backupName, prunable, type Cadence } from '../lib/drive-backup';
import { withDriveToken } from '../lib/google-auth';
import { isSealed, seal, SealError, unseal } from '../lib/seal';
import { getPassphrase } from '../lib/secrets';
import { databaseBackup } from './backup';
import { sqliteDb } from './client';
import { restoreFrom, type RestoreResult } from './restore';
import { countRows, validateBackup } from './restore-core';

/** A 401 means the cached token aged out; anything else is a real failure. */
const tokenExpired = (error: unknown) => error instanceof DriveError && error.unauthorized;

export type BackupOutcome = {
  name: string;
  /** Bytes actually uploaded — sealed size when sealed. */
  bytes: number;
  sealed: boolean;
  /** Old backups removed after this one landed. */
  pruned: number;
  at: number;
};

/**
 * Take a backup and put it in Drive.
 *
 * Deliberate order, each step earning its place:
 *
 *   1. `databaseBackup` checkpoints the WAL and copies the file. Without the
 *      checkpoint the copy silently omits the newest records — the ones you
 *      would notice missing. It also refuses a 0-byte result.
 *   2. Seal, if a passphrase is set.
 *   3. Upload, and verify Drive stored the size we sent.
 *   4. Prune — LAST, and only after a successful upload. Pruning first would
 *      mean a failed upload leaves fewer backups than we started with: the
 *      system destroying its own safety margin at the moment it is failing.
 *
 * Returns the outcome rather than recording it. The caller owns the settings
 * write, so the write-through store repaints every screen instead of this
 * module reaching into UI state.
 */
export async function runBackup(now = new Date()): Promise<BackupOutcome> {
  const staged = await databaseBackup(now);

  try {
    const plain = await staged.file.bytes();
    const passphrase = await getPassphrase();
    const sealed = passphrase !== null;
    const payload = sealed ? await seal(plain, passphrase) : plain;

    const name = backupName(now, sealed);
    await withDriveToken((token) => uploadBackup(token, name, payload), tokenExpired);

    /**
     * Housekeeping, and NOT allowed to fail the backup.
     *
     * Once the upload has landed, the backup exists — that is the whole point
     * of the operation, and it is already safe. Letting a failed delete throw
     * from here would report a successful backup as a failure, and the caller
     * would then never record it: the app would believe it had never backed up,
     * consider one due at every launch, re-upload every time, and never reach
     * this pruning step to clean any of it up. Exactly that happened on a real
     * device, from a misread `size` field.
     */
    let pruned = 0;
    try {
      pruned = await withDriveToken(async (token) => {
        const existing = await listBackups(token);
        const doomed = prunable(existing);
        for (const file of doomed) await deleteBackup(token, file.id);
        return doomed.length;
      }, tokenExpired);
    } catch (error) {
      console.warn('[drive] backup uploaded but pruning failed', error);
    }

    return { name, bytes: payload.byteLength, sealed, pruned, at: now.getTime() };
  } finally {
    // The staging copy is a whole second copy of the ledger sitting in the
    // cache. Leaving it there doubles the app's footprint for no benefit.
    if (staged.file.exists) staged.file.delete();
  }
}

export type BackupCheck = {
  name: string;
  createdTime: string;
  /** Size in Drive, or null when Drive did not report one. */
  bytes: number | null;
  sealed: boolean;
  /** Rows in the restored-as-read-only copy. */
  records: number;
  accounts: number;
  categories: number;
  /**
   * Attachment files inside the container.
   *
   * Reported because "43 records" was never the whole answer once records could
   * carry receipts — a backup that checks out on rows and holds none of the
   * photos is exactly the silent failure this screen exists to catch.
   */
  attachments: number;
};

/**
 * Prove the newest backup can actually be restored.
 *
 * A backup nobody has ever opened is a promise, not a safety net — and the
 * failure modes here are all silent: an upload that was really 0 bytes, a
 * passphrase that was changed after the last backup, a file truncated in
 * transit. Every one of them looks exactly like a working setup until the day
 * it matters.
 *
 * So this does the whole restore EXCEPT the part that overwrites anything: it
 * downloads, decrypts, attaches the result as a second database, runs the same
 * `validateBackup` a real restore runs, and counts what is inside. The live
 * ledger is never written to.
 */
export async function checkLatestBackup(): Promise<BackupCheck> {
  const newest = await withDriveToken(async (token) => {
    const files = await listBackups(token);
    if (files.length === 0) throw new DriveError('There are no backups in Drive yet.', 0);
    return files[0] as DriveFile;
  }, tokenExpired);

  const downloaded = await withDriveToken(
    (token) => downloadBackup(token, newest.id),
    tokenExpired
  );

  if (downloaded.byteLength === 0) {
    throw new DriveError('That backup is empty. It cannot be restored.', 0);
  }

  const encrypted = isSealed(downloaded);
  let plain = downloaded;

  if (encrypted) {
    const passphrase = await getPassphrase();
    if (passphrase === null) {
      // Worth its own message: the backup is fine, the passphrase is missing.
      throw new SealError('That backup is sealed, but no passphrase is saved on this device.');
    }
    plain = await unseal(downloaded, passphrase);
  } else if (!isBackupPayload(downloaded)) {
    throw new SealError('That backup is neither sealed nor a Peace backup.');
  }

  // Unwrap the container before SQLite sees it. A backup made since attachments
  // existed is a zip; one made before is the bare database.
  const payload = openBackupPayload(plain);

  return {
    ...inspect(payload.database),
    name: newest.name,
    createdTime: newest.createdTime,
    bytes: newest.size,
    sealed: encrypted,
    attachments: payload.files.length,
  };
}

const ALIAS = 'drivecheck';

/**
 * Open a candidate database read-only and count what is in it.
 *
 * ATTACH takes a filesystem PATH, not a URI — a `file://` prefix makes SQLite
 * treat it as a relative name and fail in a way that reads like a corrupt file.
 * The same trap is documented in `restore.ts`.
 */
function inspect(plain: Uint8Array): { records: number; accounts: number; categories: number } {
  const staged = new File(Paths.cache, 'drive-check.db');
  if (staged.exists) staged.delete();
  staged.create();
  staged.write(plain);

  try {
    sqliteDb.execSync(`ATTACH DATABASE '${staged.uri.replace(/^file:\/\//, '')}' AS ${ALIAS}`);
    // The same check a real restore runs, so a backup that passes here is one
    // that would actually go in.
    validateBackup(sqliteDb, ALIAS);

    return {
      records: countRows(sqliteDb, ALIAS, 'transactions'),
      accounts: countRows(sqliteDb, ALIAS, 'accounts'),
      categories: countRows(sqliteDb, ALIAS, 'categories'),
    };
  } finally {
    try {
      sqliteDb.execSync(`DETACH DATABASE ${ALIAS}`);
    } catch {
      // Already detached, or never attached because ATTACH itself threw.
    }
    if (staged.exists) staged.delete();
  }
}

/** For the settings row: is this cadence one that runs by itself? */
export const isAutomatic = (cadence: Cadence) => cadence !== 'off';

/** What is in Drive, newest first, for the restore picker. */
export async function listDriveBackups(): Promise<DriveFile[]> {
  return withDriveToken((token) => listBackups(token), tokenExpired);
}

/**
 * Restore from Drive.
 *
 * Without this the feature has a hole exactly where it matters: `appdata` is
 * unreachable from any browser, so a backup in there can ONLY be read by this
 * app — and until now this app could only restore from a file the user picked
 * off the filesystem. Backups readable by nothing at all are not backups.
 *
 * Everything after the decryption is the existing restore path, deliberately:
 * `restoreFrom` validates before deleting anything, parks the current database
 * as a safety copy, and replaces the ledger inside one transaction. Reusing it
 * means Drive restores are undoable by the same button as file restores, rather
 * than being a second implementation that has to be kept in step.
 */
export async function restoreFromDrive(id: string): Promise<RestoreResult> {
  const downloaded = await withDriveToken((token) => downloadBackup(token, id), tokenExpired);

  if (downloaded.byteLength === 0) {
    throw new DriveError('That backup is empty, so there is nothing to restore.', 0);
  }

  let plain = downloaded;
  if (isSealed(downloaded)) {
    const passphrase = await getPassphrase();
    if (passphrase === null) {
      throw new SealError('That backup is sealed. Set its passphrase before restoring.');
    }
    plain = await unseal(downloaded, passphrase);
  } else if (!isBackupPayload(downloaded)) {
    throw new SealError('That backup is neither sealed nor a Peace backup.');
  }

  /**
   * Handed to `restoreFrom` still wrapped, deliberately.
   *
   * That function is the ONE place a backup is opened, validated and applied,
   * and it already understands both shapes. Unwrapping here would make this the
   * second implementation of the same decision — and the two would drift, which
   * is precisely how the ledger-side rules ended up written out in four places.
   */
  const staged = new File(Paths.cache, 'drive-restore.bin');
  if (staged.exists) staged.delete();
  staged.create();
  staged.write(plain);

  try {
    return await restoreFrom(staged);
  } finally {
    // A decrypted copy of the whole ledger, sitting in the cache. It has served
    // its purpose the moment the restore returns either way.
    if (staged.exists) staged.delete();
  }
}
