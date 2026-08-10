/**
 * @jest-environment node
 */
import { toCsv } from '../../lib/csv';
import { createTestDb, type TestDb } from '../../test/db';
import { accountId, catId, seedDefaults } from '../seed';
import { createRecord, createTransfer } from './transactions';
import { CSV_HEADER, exportFilename, exportRows } from './export';

describe('exportRows', () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb().db;
    seedDefaults(db);
  });

  const at = (iso: string) => new Date(iso);

  it('exports a record with its account and category', () => {
    createRecord(db, {
      type: 'expense',
      accountId: accountId('cash'),
      categoryId: catId('restaurants'),
      amountMinor: 15500,
      currency: 'EGP',
      note: 'lunch',
      occurredAt: at('2026-08-09T13:30:00'),
    });

    const [row] = exportRows(db);
    const column = (name: (typeof CSV_HEADER)[number]) => row[CSV_HEADER.indexOf(name)];

    expect(column('date')).toBe('2026-08-09');
    expect(column('time')).toBe('13:30');
    expect(column('type')).toBe('expense');
    expect(column('amount')).toBe('-155.00');
    expect(column('currency')).toBe('EGP');
    expect(column('account')).toBe('Cash');
    expect(column('category')).toBe('Restaurants');
    // Restaurants sits under Food, and the parent is worth a column of its own:
    // grouping a spreadsheet by top-level category is the first thing anyone
    // does with an export.
    expect(column('parent_category')).toBe('Food');
    expect(column('note')).toBe('lunch');
  });

  it('writes income as a positive amount', () => {
    createRecord(db, {
      type: 'income',
      accountId: accountId('bank'),
      categoryId: catId('salary'),
      amountMinor: 5000000,
      currency: 'EGP',
      note: null,
      occurredAt: at('2026-08-01T09:00:00'),
    });

    const [row] = exportRows(db);
    expect(row[CSV_HEADER.indexOf('amount')]).toBe('50000.00');
    expect(row[CSV_HEADER.indexOf('type')]).toBe('income');
  });

  /**
   * The opposite of what the records list does, and deliberately so: the list
   * hides one leg to avoid looking like double spending, but an export is a
   * copy of the ledger. Drop a leg and the per-account balances in the file
   * stop adding up.
   */
  it('exports BOTH legs of a transfer, paired by transfer_pair_id', () => {
    createTransfer(db, {
      fromAccountId: accountId('bank'),
      toAccountId: accountId('cash'),
      amountMinor: 100000,
      currency: 'EGP',
      note: 'cash out',
      occurredAt: at('2026-08-05T10:00:00'),
    });

    const rows = exportRows(db);
    expect(rows).toHaveLength(2);

    const amounts = rows.map((r) => r[CSV_HEADER.indexOf('amount')]).sort();
    expect(amounts).toEqual(['-1000.00', '1000.00']);

    for (const row of rows) expect(row[CSV_HEADER.indexOf('type')]).toBe('transfer');

    const pairIds = rows.map((r) => r[CSV_HEADER.indexOf('transfer_pair_id')]);
    expect(pairIds[0]).toBeTruthy();
    expect(pairIds[0]).toBe(pairIds[1]);

    // Summing the amount column must come to zero — a transfer moves money, it
    // does not create or destroy it, and that is the property a spreadsheet
    // built on this file relies on.
    const total = rows.reduce((sum, r) => sum + Number(r[CSV_HEADER.indexOf('amount')]), 0);
    expect(total).toBe(0);
  });

  it('orders oldest first', () => {
    for (const day of ['2026-08-09', '2026-08-01', '2026-08-05']) {
      createRecord(db, {
        type: 'expense',
        accountId: accountId('cash'),
        categoryId: null,
        amountMinor: 100,
        currency: 'EGP',
        note: null,
        occurredAt: at(`${day}T12:00:00`),
      });
    }
    expect(exportRows(db).map((r) => r[0])).toEqual(['2026-08-01', '2026-08-05', '2026-08-09']);
  });

  /**
   * toISOString() converts to UTC, so a record logged at 1am Cairo would land
   * on the previous day and every daily total built on the file would be wrong.
   */
  it('uses the local date, not UTC', () => {
    createRecord(db, {
      type: 'expense',
      accountId: accountId('cash'),
      categoryId: null,
      amountMinor: 100,
      currency: 'EGP',
      note: null,
      occurredAt: at('2026-08-09T01:00:00'),
    });
    expect(exportRows(db)[0][0]).toBe('2026-08-09');
  });

  it('survives an uncategorised record and an empty note', () => {
    createRecord(db, {
      type: 'expense',
      accountId: accountId('cash'),
      categoryId: null,
      amountMinor: 100,
      currency: 'EGP',
      note: null,
      occurredAt: at('2026-08-09T12:00:00'),
    });

    const [row] = exportRows(db);
    expect(row[CSV_HEADER.indexOf('category')]).toBe('');
    expect(row[CSV_HEADER.indexOf('note')]).toBe('');
    // Every column is still present, so the row does not shift left.
    expect(row).toHaveLength(CSV_HEADER.length);
  });

  it('produces a row of the right width for every record', () => {
    createTransfer(db, {
      fromAccountId: accountId('bank'),
      toAccountId: accountId('cash'),
      amountMinor: 100,
      currency: 'EGP',
      note: null,
      occurredAt: at('2026-08-05T10:00:00'),
    });
    for (const row of exportRows(db)) expect(row).toHaveLength(CSV_HEADER.length);
  });

  it('round-trips a note containing a comma through the CSV writer', () => {
    createRecord(db, {
      type: 'expense',
      accountId: accountId('cash'),
      categoryId: null,
      amountMinor: 100,
      currency: 'EGP',
      note: 'lunch, then coffee',
      occurredAt: at('2026-08-09T12:00:00'),
    });

    const csv = toCsv([[...CSV_HEADER], ...exportRows(db)]);
    expect(csv).toContain('"lunch, then coffee"');
    // Two rows, so exactly one line break — the comma must not have split it.
    expect(csv.split('\r\n')).toHaveLength(2);
  });
});

describe('exportFilename', () => {
  it('sorts chronologically in a downloads folder', () => {
    expect(exportFilename(new Date('2026-08-10T22:00:00'), 'csv')).toBe('peace-2026-08-10.csv');
    expect(exportFilename(new Date('2026-01-05T09:00:00'), 'db')).toBe('peace-2026-01-05.db');
  });
});
