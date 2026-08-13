/**
 * @jest-environment node
 */
import { createTestDb, type TestDb } from '../../test/db';
import { createAccount } from './accounts';
import { createCategory } from './categories';
import { createRecord, deleteRecord } from './transactions';
import {
  addAttachment,
  attachmentCounts,
  attachmentTotalBytes,
  listAttachments,
  missingFiles,
  orphanedFiles,
  referencedFiles,
  removeAttachment,
  syncAttachments,
} from './attachments';

const on = (day: number) => new Date(2026, 7, day, 12, 0);

const hash = (seed: string) => seed.padEnd(64, '0');

function seed() {
  const { db } = createTestDb();
  createAccount(db, { id: 'bank', name: 'Bank', currency: 'EGP' });
  createCategory(db, { id: 'food', name: 'Food', kind: 'expense', sortOrder: 0 });
  return db;
}

const buy = (db: TestDb, id: string, day = 1) =>
  createRecord(db, {
    id,
    accountId: 'bank',
    categoryId: 'food',
    type: 'expense',
    amountMinor: 5_000,
    occurredAt: on(day),
  });

const attach = (db: TestDb, transactionId: string, seedText: string, byteSize = 1000) =>
  addAttachment(db, {
    transactionId,
    fileName: `${hash(seedText)}.jpg`,
    mimeType: 'image/jpeg',
    byteSize,
    sha256: hash(seedText),
  });

describe('attaching a file to a record', () => {
  it('stores it and lists it back', () => {
    const db = seed();
    buy(db, 'r1');
    attach(db, 'r1', 'a');

    const rows = listAttachments(db, 'r1');
    expect(rows).toHaveLength(1);
    expect(rows[0].mimeType).toBe('image/jpeg');
    expect(rows[0].fileName).toBe(`${hash('a')}.jpg`);
  });

  it('keeps the original name for a file that has no thumbnail', () => {
    const db = seed();
    buy(db, 'r1');
    const row = addAttachment(db, {
      transactionId: 'r1',
      fileName: `${hash('p')}.pdf`,
      originalName: 'invoice-march.pdf',
      mimeType: 'application/pdf',
      byteSize: 2048,
      sha256: hash('p'),
    });
    expect(row.originalName).toBe('invoice-march.pdf');
  });

  /**
   * "Did that photo take?" followed by a second tap is how a camera button
   * actually gets used. Two identical thumbnails under one record read as a bug
   * in the app rather than as a double tap.
   */
  it('is idempotent — the same bytes twice on one record is one row', () => {
    const db = seed();
    buy(db, 'r1');
    const first = attach(db, 'r1', 'a');
    const second = attach(db, 'r1', 'a');

    expect(second.id).toBe(first.id);
    expect(listAttachments(db, 'r1')).toHaveLength(1);
  });

  it('still lets two DIFFERENT records carry the same receipt', () => {
    // A purchase and its refund, or one invoice split across two categories.
    const db = seed();
    buy(db, 'r1');
    buy(db, 'r2', 2);
    attach(db, 'r1', 'shared');
    attach(db, 'r2', 'shared');

    expect(listAttachments(db, 'r1')).toHaveLength(1);
    expect(listAttachments(db, 'r2')).toHaveLength(1);
    // One file, two rows.
    expect(referencedFiles(db).size).toBe(1);
  });

  it('deletes with its record — the schema cascade is real', () => {
    const db = seed();
    buy(db, 'r1');
    attach(db, 'r1', 'a');

    deleteRecord(db, 'r1');

    expect(listAttachments(db, 'r1')).toEqual([]);
  });
});

/**
 * What the save button calls.
 *
 * The record screen holds attachments in component state and writes nothing
 * until the record is saved — which is what makes backing out of the screen
 * leave the ledger untouched, exactly like every other field on it.
 */
describe('making a record match what the screen is holding', () => {
  const wanted = (seedText: string) => ({
    fileName: `${hash(seedText)}.jpg`,
    mimeType: 'image/jpeg',
    byteSize: 1000,
    sha256: hash(seedText),
  });

  it('adds what is new', () => {
    const db = seed();
    buy(db, 'r1');

    expect(syncAttachments(db, 'r1', [wanted('a'), wanted('b')])).toEqual({ added: 2, removed: 0 });
    expect(listAttachments(db, 'r1')).toHaveLength(2);
  });

  it('removes what the user took off', () => {
    const db = seed();
    buy(db, 'r1');
    syncAttachments(db, 'r1', [wanted('a'), wanted('b')]);

    expect(syncAttachments(db, 'r1', [wanted('a')])).toEqual({ added: 0, removed: 1 });
    expect(listAttachments(db, 'r1').map((r) => r.fileName)).toEqual([`${hash('a')}.jpg`]);
  });

  it('changes nothing when nothing changed', () => {
    // Opening a record and saving it without touching the receipts must not
    // churn rows — a new id every save would break nothing visibly and would
    // make every diff of the table meaningless.
    const db = seed();
    buy(db, 'r1');
    syncAttachments(db, 'r1', [wanted('a')]);
    const before = listAttachments(db, 'r1')[0].id;

    expect(syncAttachments(db, 'r1', [wanted('a')])).toEqual({ added: 0, removed: 0 });
    expect(listAttachments(db, 'r1')[0].id).toBe(before);
  });

  it('clears them all when the last one is taken off', () => {
    const db = seed();
    buy(db, 'r1');
    syncAttachments(db, 'r1', [wanted('a')]);

    expect(syncAttachments(db, 'r1', [])).toEqual({ added: 0, removed: 1 });
    expect(listAttachments(db, 'r1')).toEqual([]);
  });

  it('leaves the other record alone', () => {
    const db = seed();
    buy(db, 'r1');
    buy(db, 'r2', 2);
    syncAttachments(db, 'r1', [wanted('a')]);
    syncAttachments(db, 'r2', [wanted('b')]);

    syncAttachments(db, 'r1', []);

    expect(listAttachments(db, 'r2').map((r) => r.fileName)).toEqual([`${hash('b')}.jpg`]);
  });
});

/**
 * THE RULE THIS FILE EXISTS FOR.
 *
 * A row and its file are not one thing. Deleting a row must never delete a file
 * another row still points at, or removing a receipt from one record silently
 * blanks it on the other — and nothing on screen would explain why.
 */
describe('deciding when a file can go', () => {
  it('does not orphan a file another record still uses', () => {
    const db = seed();
    buy(db, 'r1');
    buy(db, 'r2', 2);
    const a = attach(db, 'r1', 'shared');
    attach(db, 'r2', 'shared');

    removeAttachment(db, a.id);

    // The row is gone from r1, the file is still needed by r2.
    expect(listAttachments(db, 'r1')).toEqual([]);
    expect(orphanedFiles(db, [`${hash('shared')}.jpg`])).toEqual([]);
  });

  it('orphans it once the last row goes', () => {
    const db = seed();
    buy(db, 'r1');
    const a = attach(db, 'r1', 'lonely');

    expect(orphanedFiles(db, [`${hash('lonely')}.jpg`])).toEqual([]);
    removeAttachment(db, a.id);
    expect(orphanedFiles(db, [`${hash('lonely')}.jpg`])).toEqual([`${hash('lonely')}.jpg`]);
  });

  /**
   * The restore case, which is the one that actually accumulates rubbish:
   * replacing the ledger swaps in a completely different set of rows, and the
   * old ledger's photos would otherwise sit in the sandbox forever, counted in
   * no total and shown on no screen.
   */
  it('orphans everything the restored ledger does not mention', () => {
    const db = seed();
    buy(db, 'r1');
    attach(db, 'r1', 'kept');

    const onDisk = [`${hash('kept')}.jpg`, `${hash('old1')}.jpg`, `${hash('old2')}.jpg`];
    expect(orphanedFiles(db, onDisk).sort()).toEqual([`${hash('old1')}.jpg`, `${hash('old2')}.jpg`]);
  });

  it('orphans nothing when the disk is empty', () => {
    const db = seed();
    expect(orphanedFiles(db, [])).toEqual([]);
  });
});

/**
 * The opposite direction, and it is what restoring an OLD `.db` backup produces
 * — rows describing receipts that were never in the file. Showing those as
 * missing rather than as a broken image is the difference between the app
 * explaining itself and the app looking broken.
 */
describe('rows whose file is not there', () => {
  it('finds them', () => {
    const db = seed();
    buy(db, 'r1');
    attach(db, 'r1', 'gone');

    expect(missingFiles(db, []).map((r) => r.fileName)).toEqual([`${hash('gone')}.jpg`]);
    expect(missingFiles(db, [`${hash('gone')}.jpg`])).toEqual([]);
  });
});

describe('what the screens ask for', () => {
  it('counts receipts per record for the list indicator', () => {
    const db = seed();
    buy(db, 'r1');
    buy(db, 'r2', 2);
    buy(db, 'r3', 3);
    attach(db, 'r1', 'a');
    attach(db, 'r1', 'b');
    attach(db, 'r2', 'c');

    const counts = attachmentCounts(db, ['r1', 'r2', 'r3']);
    expect(counts.get('r1')).toBe(2);
    expect(counts.get('r2')).toBe(1);
    // Absent rather than zero — the caller renders nothing for a record with none.
    expect(counts.has('r3')).toBe(false);
  });

  it('asks for nothing when given nothing', () => {
    // An empty IN () is a SQL syntax error in SQLite, and the records list
    // calls this on every empty month.
    const db = seed();
    expect(attachmentCounts(db, [])).toEqual(new Map());
  });

  /**
   * DISTINCT on the file, not a sum over rows. Two records sharing one receipt
   * store one file, and counting it twice tells the user their backup is bigger
   * than it is.
   */
  it('counts a shared file once towards the backup size', () => {
    const db = seed();
    buy(db, 'r1');
    buy(db, 'r2', 2);
    attach(db, 'r1', 'shared', 4000);
    attach(db, 'r2', 'shared', 4000);
    attach(db, 'r1', 'other', 1000);

    expect(attachmentTotalBytes(db)).toEqual({ files: 2, bytes: 5000 });
  });

  it('reports nothing for a ledger with no attachments', () => {
    expect(attachmentTotalBytes(seed())).toEqual({ files: 0, bytes: 0 });
  });
});
