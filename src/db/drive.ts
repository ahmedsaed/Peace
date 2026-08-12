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
import { backupName, prunable, type Cadence } from '../lib/drive-backup';
import { withDriveToken } from '../lib/google-auth';
import { isSealed, looksLikeSqlite, seal, SealError, unseal } from '../lib/seal';
import { getPassphrase } from '../lib/secrets';
import { databaseBackup } from './backup';
import { sqliteDb } from './client';
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

    const pruned = await withDriveToken(async (token) => {
      const existing = await listBackups(token);
      const doomed = prunable(existing);
      for (const file of doomed) await deleteBackup(token, file.id);
      return doomed.length;
    }, tokenExpired);

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
  /** Size in Drive. */
  bytes: number;
  sealed: boolean;
  /** Rows in the restored-as-read-only copy. */
  records: number;
  accounts: number;
  categories: number;
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
  } else if (!looksLikeSqlite(downloaded)) {
    throw new SealError('That backup is neither sealed nor a Peace database.');
  }

  return { ...inspect(plain), name: newest.name, createdTime: newest.createdTime, bytes: newest.size, sealed: encrypted };
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
