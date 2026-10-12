/**
 * @jest-environment node
 */
import { toCsv } from '../../lib/csv';
import { createTestDb, type TestDb } from '../../test/db';
import { augustNoon as on } from '../../test/dates';
import { accountId, catId, seedDefaults } from '../seed';
import { createAccount } from './accounts';
import { reconcileAccount } from './adjust';
import { createCategory } from './categories';
import { CSV_HEADER, exportFilename, exportRows } from './export';
import { ledgerSide } from './predicates';
import { createRecord, createTransfer } from './transactions';

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
    // Every column present on both legs, so neither row shifts left.
    for (const row of rows) expect(row).toHaveLength(CSV_HEADER.length);

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

/**
 * Which side of the ledger a CSV row claims to be on.
 *
 * THE BUG THIS PINS. The export derived `type` from the SIGN of the amount —
 * `amountMinor < 0 ? 'expense' : 'income'` — which is precisely the rule the
 * rest of the app stopped using when refunds arrived. Every refund therefore
 * left the app labelled `income`, so a spreadsheet built from an export showed
 * more income than was earned AND more expense than was spent. The net came out
 * right, which is why nobody would have caught it by glancing at a total.
 *
 * It was the FOURTH caller to make that mistake, after two initialisers and an
 * update path, and it survived because the fix had only ever been applied to
 * the SQL. `ledgerSide` now answers the question in JavaScript too.
 */

const TYPE = CSV_HEADER.indexOf('type' as never);
const AMOUNT = CSV_HEADER.indexOf('amount' as never);
const IS_REFUND = CSV_HEADER.indexOf('is_refund' as never);
const ID = CSV_HEADER.indexOf('id' as never);

function seed() {
  const { db } = createTestDb();
  createAccount(db, { id: 'bank', name: 'Bank', currency: 'EGP' });
  createAccount(db, { id: 'cash', name: 'Cash', currency: 'EGP' });
  createCategory(db, { id: 'clothing', name: 'Clothing', kind: 'expense', sortOrder: 0 });
  createCategory(db, { id: 'salary', name: 'Salary', kind: 'income', sortOrder: 0 });
  return db;
}

function rowsById(db: TestDb) {
  return new Map(exportRows(db).map((r) => [r[ID], r]));
}

describe('ledgerSide', () => {
  it('reads an ordinary expense and income from the sign', () => {
    expect(ledgerSide({ amountMinor: -100 })).toBe('expense');
    expect(ledgerSide({ amountMinor: 100 })).toBe('income');
  });

  /** The whole reason this function exists. */
  it('puts a refund on the EXPENSE side despite its positive amount', () => {
    expect(ledgerSide({ amountMinor: 800_00, isRefund: true })).toBe('expense');
  });

  it('calls a correction neither, so neither total absorbs it', () => {
    expect(ledgerSide({ amountMinor: -1_500_00, isAdjustment: true })).toBe('correction');
    expect(ledgerSide({ amountMinor: 1_500_00, isAdjustment: true })).toBe('correction');
  });

  it('calls a transfer leg a transfer, whichever way it points', () => {
    expect(ledgerSide({ amountMinor: -100, transferPairId: 'p' })).toBe('transfer');
    expect(ledgerSide({ amountMinor: 100, transferPairId: 'p' })).toBe('transfer');
  });

  /**
   * Order matters: each exclusion has to be taken out of the way before the
   * sign means anything. A transfer leg that was also somehow flagged must
   * still read as a transfer.
   */
  it('prefers the most specific reason a row is not ordinary', () => {
    expect(ledgerSide({ amountMinor: 100, transferPairId: 'p', isAdjustment: true })).toBe(
      'transfer'
    );
    expect(ledgerSide({ amountMinor: 100, isAdjustment: true, isRefund: true })).toBe('correction');
  });
});

describe('the CSV says which side each row is on', () => {
  let db: TestDb;

  beforeEach(() => {
    db = seed();
    createRecord(db, {
      id: 'jacket',
      type: 'expense',
      accountId: 'bank',
      categoryId: 'clothing',
      amountMinor: 800_00,
      occurredAt: on(3),
    });
    createRecord(db, {
      id: 'jacket-back',
      type: 'expense',
      isRefund: true,
      accountId: 'bank',
      categoryId: 'clothing',
      amountMinor: 300_00,
      occurredAt: on(5),
    });
    createRecord(db, {
      id: 'pay',
      type: 'income',
      accountId: 'bank',
      categoryId: 'salary',
      amountMinor: 9_000_00,
      occurredAt: on(1),
    });
    createTransfer(db, {
      fromAccountId: 'bank',
      toAccountId: 'cash',
      amountMinor: 500_00,
      currency: 'EGP',
      note: null,
      occurredAt: on(6),
    });
    reconcileAccount(db, 'cash', 1_000_00, { id: 'fix', occurredAt: on(7) });
  });

  it('never labels a refund as income', () => {
    expect(rowsById(db).get('jacket-back')?.[TYPE]).toBe('expense');
  });

  it('keeps the refund flag, so the fact is not lost in the relabelling', () => {
    const rows = rowsById(db);
    expect(rows.get('jacket-back')?.[IS_REFUND]).toBe('1');
    expect(rows.get('jacket')?.[IS_REFUND]).toBe('');
  });

  /**
   * The arithmetic a person actually does with this file. Summing the expense
   * side must NET the refund, which only works because the refund is on that
   * side carrying a positive amount.
   */
  it('sums the expense side to the true net', () => {
    const expenses = exportRows(db)
      .filter((r) => r[TYPE] === 'expense')
      .reduce((total, r) => total + Number(r[AMOUNT]), 0);
    // -800 spent, +300 back = -500 net.
    expect(expenses).toBeCloseTo(-500, 2);
  });

  it('sums the income side without the refund inflating it', () => {
    const income = exportRows(db)
      .filter((r) => r[TYPE] === 'income')
      .reduce((total, r) => total + Number(r[AMOUNT]), 0);
    expect(income).toBeCloseTo(9000, 2);
  });

  it('marks a correction as its own kind, in neither total', () => {
    expect(rowsById(db).get('fix')?.[TYPE]).toBe('correction');
  });

  // Both transfer legs exporting as `transfer` is asserted under exportRows
  // above, along with their pairing and their zero sum.

  it('appended the new column rather than reordering the contract', () => {
    // Every spreadsheet already built on an export depends on this order.
    expect(CSV_HEADER.slice(0, 12)).toEqual([
      'date',
      'time',
      'type',
      'amount',
      'currency',
      'account',
      'counter_account',
      'category',
      'parent_category',
      'note',
      'transfer_pair_id',
      'id',
    ]);
  });
});
