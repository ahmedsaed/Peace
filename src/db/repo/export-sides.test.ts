/**
 * @jest-environment node
 *
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
import { createTestDb, type TestDb } from '../../test/db';
import { createAccount } from './accounts';
import { reconcileAccount } from './adjust';
import { createCategory } from './categories';
import { CSV_HEADER, exportRows } from './export';
import { ledgerSide } from './predicates';
import { createRecord, createTransfer } from './transactions';

const on = (day: number) => new Date(2026, 7, day, 12, 0);

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

  it('still marks both transfer legs as transfers', () => {
    const legs = exportRows(db).filter((r) => r[TYPE] === 'transfer');
    expect(legs).toHaveLength(2);
  });

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
