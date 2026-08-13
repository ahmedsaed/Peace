/**
 * Attachment rows.
 *
 * The bytes live on disk and are dealt with in `src/db/attachments.ts`; this
 * file is pure database and is tested against real SQLite in Node.
 *
 * THE ONE RULE WORTH STATING UP FRONT: a row and its file are not one thing.
 * Files are content-addressed, so two records that carry the same receipt —
 * a purchase and its refund, the same invoice split across two categories —
 * share ONE file on disk under two rows. Deleting a row therefore must not
 * delete the file, or removing a receipt from one record silently blanks it on
 * the other. `orphanedFiles` answers "which files are now referenced by
 * nothing", and it is the only thing allowed to decide a file can go.
 */

import { and, count, eq, sql } from 'drizzle-orm';
import { type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { newId } from '../../lib/id';
import * as schema from '../schema';
import { attachments } from '../schema';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export type NewAttachmentInput = {
  transactionId: string;
  fileName: string;
  originalName?: string | null;
  mimeType: string;
  byteSize: number;
  sha256: string;
  width?: number | null;
  height?: number | null;
};

export function listAttachments(db: Db, transactionId: string): schema.Attachment[] {
  return db
    .select()
    .from(attachments)
    .where(eq(attachments.transactionId, transactionId))
    .orderBy(attachments.createdAt)
    .all();
}

/**
 * Attach a file to a record.
 *
 * Idempotent per record: attaching the same bytes to the SAME transaction twice
 * returns the existing row rather than adding a duplicate. That is not a
 * theoretical nicety — "did that photo take?" followed by a second tap is how
 * people actually use a camera button, and two identical thumbnails under one
 * record look like a bug in the app rather than a double tap.
 */
export function addAttachment(db: Db, input: NewAttachmentInput): schema.Attachment {
  const existing = db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.transactionId, input.transactionId),
        eq(attachments.sha256, input.sha256)
      )
    )
    .get();
  if (existing) return existing;

  const row: schema.NewAttachment = {
    id: newId(),
    transactionId: input.transactionId,
    fileName: input.fileName,
    originalName: input.originalName ?? null,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    sha256: input.sha256,
    width: input.width ?? null,
    height: input.height ?? null,
  };

  return db.insert(attachments).values(row).returning().get();
}

/** Detach a file from ONE record. The file stays until nothing references it. */
export function removeAttachment(db: Db, id: string): void {
  db.delete(attachments).where(eq(attachments.id, id)).run();
}

/** How many receipts each of these records carries, for the list's indicator. */
export function attachmentCounts(db: Db, transactionIds: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  if (transactionIds.length === 0) return counts;

  const rows = db
    .select({ transactionId: attachments.transactionId, n: count() })
    .from(attachments)
    .where(sql`${attachments.transactionId} IN ${transactionIds}`)
    .groupBy(attachments.transactionId)
    .all();

  for (const row of rows) counts.set(row.transactionId, row.n);
  return counts;
}

/** Every file the database still expects to find on disk. */
export function referencedFiles(db: Db): Set<string> {
  return new Set(
    db.selectDistinct({ fileName: attachments.fileName }).from(attachments).all().map((r) => r.fileName)
  );
}

/**
 * Which files on disk nothing points at any more.
 *
 * Called after a delete and after a restore. The restore case is the one that
 * matters: replacing the ledger swaps in a completely different set of rows,
 * and without this the old ledger's photos would sit in the sandbox forever,
 * counted in no total and shown on no screen.
 *
 * Takes the disk listing as an argument rather than reading the filesystem, so
 * the rule is testable without one.
 */
export function orphanedFiles(db: Db, onDisk: string[]): string[] {
  const referenced = referencedFiles(db);
  return onDisk.filter((name) => !referenced.has(name));
}

/**
 * Rows whose file is NOT on disk.
 *
 * The opposite direction, and it exists because it is what a restore from an
 * old `.db` backup produces: rows describing receipts that were never in the
 * file. The UI shows those as missing rather than as a broken image, which is
 * the difference between the app explaining itself and the app looking broken.
 */
export function missingFiles(db: Db, onDisk: string[]): schema.Attachment[] {
  const present = new Set(onDisk);
  return db
    .select()
    .from(attachments)
    .all()
    .filter((row) => !present.has(row.fileName));
}

/** Total bytes, so Settings can say what attachments are adding to a backup. */
export function attachmentTotalBytes(db: Db): { files: number; bytes: number } {
  // DISTINCT on the file, not a sum over rows: two records sharing one receipt
  // store one file, and counting it twice would tell the user their backup is
  // bigger than it is.
  const rows = db
    .selectDistinct({ fileName: attachments.fileName, byteSize: attachments.byteSize })
    .from(attachments)
    .all();

  return {
    files: rows.length,
    bytes: rows.reduce((total, row) => total + row.byteSize, 0),
  };
}
