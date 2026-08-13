/**
 * What a backup file turned out to be, once it is bytes.
 *
 * There are now two shapes of Peace backup and there will always be two:
 *
 *   a CONTAINER  — a zip holding `peace.db` and the attachment files, which is
 *                  what this version writes
 *   a PLAIN `.db` — what every version before attachments existed wrote, and
 *                  what an old backup in someone's Drive folder still is
 *
 * A restore that only understood the new shape would refuse the backups made
 * during the entire life of the app up to now, which is a strange way to treat
 * a safety net. Both are opened here, in ONE place, so the file restore, the
 * Drive restore and the "check my latest backup" screen cannot drift into
 * disagreeing about what a given file is.
 *
 * THE DECISION IS MADE ON BYTES, NEVER ON THE FILENAME — the same rule
 * `isSealed` follows. A backup renamed on the way through a file manager is
 * still the file it was.
 *
 * Pure, so all of that is tested in Node against real bytes.
 */

import { looksLikeZip, readContainer, type ContainerFile } from './container';
import { looksLikeSqlite } from './seal';

export type BackupPayload = {
  database: Uint8Array;
  files: ContainerFile[];
  /**
   * True for a plain `.db` from before attachments existed.
   *
   * The caller needs this to tell two situations apart that look identical
   * afterwards: a backup with no attachments in it, and a backup that could not
   * have had any. Restoring the second leaves rows pointing at files that were
   * never in the file, and the screen should say so rather than showing a
   * column of broken thumbnails.
   */
  legacy: boolean;
};

export class BackupFormatError extends Error {}

export function openBackupPayload(bytes: Uint8Array): BackupPayload {
  if (looksLikeZip(bytes)) {
    const container = readContainer(bytes);
    return { ...container, legacy: false };
  }

  if (looksLikeSqlite(bytes)) {
    return { database: bytes, files: [], legacy: true };
  }

  throw new BackupFormatError(
    'That file is not a Peace backup — it is neither a backup container nor a database.'
  );
}

/** Does this look like a Peace backup at all, before anything is decrypted? */
export function isBackupPayload(bytes: Uint8Array): boolean {
  return looksLikeZip(bytes) || looksLikeSqlite(bytes);
}
