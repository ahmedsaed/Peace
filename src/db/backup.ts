import { count } from 'drizzle-orm';
import { Directory, File, Paths } from 'expo-file-system';
import { defaultDatabaseDirectory } from 'expo-sqlite';

import { toCsvFile } from '../lib/csv';
import { DATABASE_NAME, db, sqliteDb } from './client';
import { CSV_HEADER, exportFilename, exportRows } from './repo/export';
import { transactions } from './schema';

/**
 * Getting the data out.
 *
 * Two artefacts with different jobs, and it matters that they are not confused:
 *
 *   CSV     readable anywhere, for a spreadsheet. LOSSY — no settings, and it
 *           cannot be imported back.
 *   Backup  a byte copy of the SQLite file. Complete, restorable, and openable
 *           with any SQLite tool if this app ever stops existing.
 *
 * Files are written to the CACHE directory, not documents. The share sheet
 * copies the bytes wherever they are going, so the local copy is rubbish the
 * moment sharing finishes — and the cache is the one place Android is allowed
 * to reclaim on its own.
 */

export type Exported = { file: File; bytes: number };

/**
 * An empty file is the failure that looks like success.
 *
 * The first version of this returned before the copy had run — `copy()` is
 * async and was called synchronously — so the share sheet offered a 0-byte
 * backup under a perfectly correct filename. Nothing downstream could tell.
 * Every export goes through here, and the size is surfaced in the UI so the
 * check is visible rather than merely internal.
 */
function verify(file: File): Exported {
  const bytes = file.size;
  if (!file.exists || bytes <= 0) {
    throw new Error(`Wrote an empty file (${file.name}). Nothing was exported.`);
  }
  return { file, bytes };
}

/** A fresh destination. Two exports on the same day share a name, and silently
 *  sharing yesterday's file instead of today's is the worst kind of stale. */
function stagingFile(name: string): File {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  return file;
}

export function csvExport(now = new Date()): Exported {
  const file = stagingFile(exportFilename(now, 'csv'));
  file.create();
  file.write(toCsvFile([[...CSV_HEADER], ...exportRows(db)]));
  return verify(file);
}

/**
 * Locate the SQLite file.
 *
 * `defaultDatabaseDirectory` is a bare filesystem path
 * (`/data/user/0/<pkg>/files/SQLite`), while the SDK 54+ `File`/`Directory` API
 * takes an absolute URI — handing it the raw value throws
 * "URI is not absolute" from deep inside the native module, which reads like a
 * broken export rather than a mismatched path format. Both forms are tried, and
 * the failure lists what was looked at rather than just saying "not found".
 */
function databaseFile(): File {
  const raw = String(defaultDatabaseDirectory ?? '');
  const candidates = [
    raw && new File(new Directory(raw.startsWith('file://') ? raw : `file://${raw}`), DATABASE_NAME),
    // expo-sqlite's default is <documentDirectory>/SQLite, so this is the same
    // place by another route — and it survives the constant changing shape.
    new File(Paths.document, 'SQLite', DATABASE_NAME),
  ].filter(Boolean) as File[];

  const found = candidates.find((file) => file.exists);
  if (!found) {
    throw new Error(
      `Database file not found. Looked in: ${candidates.map((c) => c.uri).join(', ')}`
    );
  }
  return found;
}

/**
 * A copy of the database file.
 *
 * THE CHECKPOINT IS NOT OPTIONAL. The connection runs in WAL mode, so recent
 * commits live in `peace.db-wal` rather than in `peace.db` itself. Copying the
 * main file alone would produce a backup that silently omits everything since
 * the last automatic checkpoint — the newest records, which are exactly the
 * ones you would notice missing. `TRUNCATE` folds the WAL back into the main
 * file and empties it, so a single-file copy is complete.
 *
 * `copy` is ASYNC and the destination must not already exist, which is why this
 * returns a promise and why the staging file is deleted rather than created.
 */
export async function databaseBackup(now = new Date()): Promise<Exported> {
  sqliteDb.execSync('PRAGMA wal_checkpoint(TRUNCATE);');

  const destination = stagingFile(exportFilename(now, 'db'));
  await databaseFile().copy(destination);
  return verify(destination);
}

/**
 * Rows in the ledger, so the screen can say what is about to be exported.
 *
 * A real COUNT rather than `exportRows(db).length`: that would build every
 * formatted row, on every render of the screen, to arrive at a number.
 */
export function recordCount(): number {
  return db.select({ n: count() }).from(transactions).get()?.n ?? 0;
}

/** Human-readable size, so "it worked" is a number rather than a claim. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
