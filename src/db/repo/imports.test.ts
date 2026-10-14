/**
 * @jest-environment node
 */
import { parseCsv, toCsvFile } from '../../lib/csv';
import { idsInFile, planImport, type ImportPlan } from '../../lib/import-csv';
import { createTestDb, type TestDb } from '../../test/db';
import { augustNoon as on } from '../../test/dates';
import { accountId, catId, seedDefaults } from '../seed';
import { accounts, budgets, categories, tags, transactions } from '../schema';
import { createAccount } from './accounts';
import { reconcileAccount } from './adjust';
import { CSV_HEADER, exportRows } from './export';
import { applyImport, lastImport, ledgerSnapshot, undoImport } from './imports';
import { ensureTag, setRecordTags } from './tags';
import { createRecord, createTransfer } from './transactions';

const HOME = 'EGP';

function plan(db: TestDb, csv: string): ImportPlan {
  const table = parseCsv(csv);
  const result = planImport(table, ledgerSnapshot(db, HOME, idsInFile(table)));
  if ('error' in result) throw new Error(result.error);
  return result;
}

function exported(db: TestDb): string {
  return toCsvFile([[...CSV_HEADER], ...exportRows(db)]);
}

/** A ledger with one of everything an import has to get right. */
function fill(db: TestDb) {
  const usd = createAccount(db, { id: 'acct-usd', name: 'Dollars', currency: 'USD' });
  const lunch = createRecord(db, {
    type: 'expense',
    accountId: accountId('cash'),
    categoryId: catId('restaurants'),
    amountMinor: 15550,
    currency: HOME,
    homeCurrency: HOME,
    note: 'lunch, with "A"\nand B',
    occurredAt: on(3),
  });
  setRecordTags(db, lunch.id, [ensureTag(db, 'Holiday 2026').id, ensureTag(db, 'work').id]);
  createRecord(db, {
    type: 'expense',
    isRefund: true,
    accountId: accountId('bank'),
    categoryId: catId('clothing'),
    amountMinor: 80000,
    currency: HOME,
    homeCurrency: HOME,
    occurredAt: on(5),
  });
  createRecord(db, {
    type: 'income',
    accountId: accountId('bank'),
    categoryId: catId('salary'),
    amountMinor: 2500000,
    currency: HOME,
    homeCurrency: HOME,
    occurredAt: on(1),
  });
  createTransfer(db, {
    fromAccountId: accountId('bank'),
    toAccountId: accountId('cash'),
    amountMinor: 300000,
    currency: HOME,
    homeCurrency: HOME,
    note: '=ATM',
    occurredAt: on(6),
  });
  createRecord(db, {
    type: 'expense',
    accountId: usd.id,
    categoryId: catId('travel'),
    amountMinor: 4999,
    currency: 'USD',
    fxRate: 48.5,
    homeCurrency: HOME,
    occurredAt: on(7),
  });
  reconcileAccount(db, accountId('cash'), 1234, { occurredAt: on(8), note: 'counted the drawer' });
}

describe('importing a Peace export', () => {
  let source: TestDb;
  let target: TestDb;

  beforeEach(() => {
    source = createTestDb().db;
    seedDefaults(source, HOME);
    fill(source);
    target = createTestDb().db;
    seedDefaults(target, HOME);
  });

  // The whole contract in one assertion: what goes out comes back in, row for
  // row — sides, refunds, both legs of a transfer, the correction's sign, the
  // dollar purchase's home value, notes with commas and quotes and newlines,
  // the formula guard, tags and ids.
  it('round-trips: exporting what was imported gives the same file', () => {
    const file = exported(source);
    const p = plan(target, file);
    expect(p.problems).toEqual([]);
    applyImport(target, p, { fileName: 'peace.csv', homeCurrency: HOME });
    expect(exported(target)).toBe(file);
  });

  it('creates the account the file names and the ledger lacks, in its currency', () => {
    const p = plan(target, exported(source));
    expect(p.newAccounts).toEqual([{ key: 'dollars', name: 'Dollars', currency: 'USD' }]);
    applyImport(target, p, { fileName: null, homeCurrency: HOME });
    const created = target.select().from(accounts).all().find((a) => a.name === 'Dollars');
    expect(created?.currency).toBe('USD');
  });

  it('adds nothing the second time, and says how many were already there', () => {
    const file = exported(source);
    applyImport(target, plan(target, file), { fileName: null, homeCurrency: HOME });
    const again = plan(target, file);
    expect(again.rows).toEqual([]);
    // Six movements: the transfer's two legs are one.
    expect(again.alreadyThere).toBe(6);
  });
});

describe('undoing an import', () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb().db;
    seedDefaults(db, HOME);
  });

  const csv = [
    'date,type,amount,account,counter_account,category,parent_category,tags',
    '2026-08-03,expense,50,Wallet,,Snacks,Food,trip',
    '2026-08-04,expense,20,Cash,,Hobbies,,',
    '2026-08-05,transfer,100,Cash,Wallet,,,',
  ].join('\n');

  it('removes every record it wrote, and what it created for them', () => {
    const before = db.select().from(transactions).all().length;
    const id = applyImport(db, plan(db, csv), { fileName: 'mine.csv', homeCurrency: HOME });
    expect(lastImport(db)?.recordCount).toBe(3);
    // Four rows: two records and a transfer's two legs.
    expect(db.select().from(transactions).all()).toHaveLength(before + 4);

    expect(undoImport(db, id)).toBe(4);
    expect(db.select().from(transactions).all()).toHaveLength(before);
    expect(db.select().from(accounts).all().map((a) => a.name)).not.toContain('Wallet');
    const names = db.select().from(categories).all().map((c) => c.name);
    expect(names).not.toContain('Snacks');
    expect(names).not.toContain('Hobbies');
    expect(names).toContain('Food');
    expect(db.select().from(tags).all()).toEqual([]);
    expect(lastImport(db)).toBeUndefined();
  });

  // The undo promised to take the FILE back out — never something typed since.
  it('keeps what has come to be used since', () => {
    const id = applyImport(db, plan(db, csv), { fileName: null, homeCurrency: HOME });
    const wallet = db.select().from(accounts).all().find((a) => a.name === 'Wallet')!;
    const hobbies = db.select().from(categories).all().find((c) => c.name === 'Hobbies')!;
    const mine = createRecord(db, {
      type: 'expense',
      accountId: wallet.id,
      amountMinor: 700,
      currency: HOME,
      occurredAt: on(9),
    });
    db.insert(budgets).values({ id: 'b1', categoryId: hobbies.id, period: '2026-08', amountMinor: 1000 }).run();

    undoImport(db, id);
    expect(db.select().from(transactions).all().map((t) => t.id)).toContain(mine.id);
    expect(db.select().from(accounts).all().map((a) => a.name)).toContain('Wallet');
    expect(db.select().from(categories).all().map((c) => c.name)).toContain('Hobbies');
  });

  it('writes nothing at all when one row cannot be written', () => {
    const before = db.select().from(transactions).all().length;
    const p = plan(db, csv);
    // A plan the writers will refuse: an amount the ledger cannot hold.
    p.rows[1] = { ...p.rows[1], amountMinor: 0 };
    expect(() => applyImport(db, p, { fileName: null, homeCurrency: HOME })).toThrow();
    expect(db.select().from(transactions).all()).toHaveLength(before);
    expect(db.select().from(accounts).all().map((a) => a.name)).not.toContain('Wallet');
    expect(lastImport(db)).toBeUndefined();
  });
});
