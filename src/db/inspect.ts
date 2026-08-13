/**
 * Open a candidate backup read-only and count what is in it.
 *
 * ITS OWN MODULE ON PURPOSE. This used to be a private function inside
 * `drive.ts`, which describes itself as composition only — and it was the one
 * thing in there that was not: it stages a file, attaches a second database and
 * runs SQL. That made `checkLatestBackup` untestable, because there is no way to
 * reach past a module-private function to the network orchestration around it.
 * A seam here is what lets the ORDER of the check be tested separately from the
 * SQLite work, which is the same split every other part of the Drive path has.
 *
 * The live ledger is never written to. This is the whole restore except the part
 * that replaces anything.
 */

import { File, Paths } from 'expo-file-system';

import { sqliteDb } from './client';
import { countRows, validateBackup } from './restore-core';

export type BackupContents = {
  records: number;
  accounts: number;
  categories: number;
};

const ALIAS = 'drivecheck';

/**
 * ATTACH takes a filesystem PATH, not a URI.
 *
 * A `file://` prefix makes SQLite treat it as a relative name and fail in a way
 * that reads like a corrupt file. The same trap is documented in `restore.ts`.
 */
export function inspectBackup(database: Uint8Array): BackupContents {
  const staged = new File(Paths.cache, 'drive-check.db');
  if (staged.exists) staged.delete();
  staged.create();
  staged.write(database);

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
    // A decrypted copy of the whole ledger, sitting in the cache. It has served
    // its purpose the moment this returns, either way.
    if (staged.exists) staged.delete();
  }
}
