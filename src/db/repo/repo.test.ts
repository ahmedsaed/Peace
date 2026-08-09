/**
 * @jest-environment node
 */
import { eq, sql } from 'drizzle-orm';

import { createTestDb, type TestDb } from '../../test/db';
import { accounts, categories, transactions } from '../schema';
import { accountId, catId, seedDefaults } from '../seed';
import {
  createAccount,
  deleteAccount,
  getAccount,
  listAccountsWithBalance,
  totalBalance,
  updateAccount,
} from './accounts';
import {
  buildCategoryTree,
  createCategory,
  deleteCategory,
  getCategory,
  InvariantError,
  updateCategory,
} from './categories';
import {
  createRecord,
  createTransfer,
  deleteRecord,
  restoreRecords,
  updateRecord,
  updateTransfer,
} from './transactions';

const sqlDeleteAccount = (id: string) => sql`delete from accounts where id = ${id}`;

const CASH = accountId('cash');
const BANK = accountId('bank');

describe('category invariants', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb().db;
    seedDefaults(db);
  });

  it('creates a sub-category under a top-level parent', () => {
    const c = createCategory(db, {
      id: 'c1',
      name: 'Snacks',
      kind: 'expense',
      parentId: catId('food'),
    });
    expect(c.parentId).toBe(catId('food'));
  });

  it('refuses a third level', () => {
    // Groceries is already a child of Food.
    expect(() =>
      createCategory(db, {
        id: 'c1',
        name: 'Fruit',
        kind: 'expense',
        parentId: catId('groceries'),
      })
    ).toThrow(/two levels deep/i);
  });

  it('refuses a child whose kind differs from its parent', () => {
    expect(() =>
      createCategory(db, {
        id: 'c1',
        name: 'Cashback',
        kind: 'income',
        parentId: catId('food'),
      })
    ).toThrow(/cannot sit under/i);
  });

  it('refuses a parent that does not exist', () => {
    expect(() =>
      createCategory(db, { id: 'c1', name: 'Ghost', kind: 'expense', parentId: 'nope' })
    ).toThrow(/does not exist/i);
  });

  it('refuses a blank name', () => {
    expect(() => createCategory(db, { id: 'c1', name: '   ', kind: 'expense' })).toThrow(
      /needs a name/i
    );
  });

  it('trims the name it stores', () => {
    const c = createCategory(db, { id: 'c1', name: '  Tips  ', kind: 'expense' });
    expect(c.name).toBe('Tips');
  });

  it('refuses to make a category its own parent', () => {
    expect(() => updateCategory(db, catId('food'), { parentId: catId('food') })).toThrow(
      /its own parent/i
    );
  });

  it('refuses to demote a category that has children', () => {
    // Food has Groceries/Restaurants/Coffee; nesting it would make them depth 3.
    expect(() => updateCategory(db, catId('food'), { parentId: catId('bills') })).toThrow(
      /sub-categories/i
    );
  });

  it('carries children along when a parent changes kind', () => {
    updateCategory(db, catId('food'), { kind: 'income' });

    const children = db
      .select()
      .from(categories)
      .where(eq(categories.parentId, catId('food')))
      .all();

    expect(children.length).toBeGreaterThan(0);
    // Otherwise they would be income children of an expense parent.
    expect(children.every((c) => c.kind === 'income')).toBe(true);
  });

  it('allows a leaf to be re-parented', () => {
    const moved = updateCategory(db, catId('coffee'), { parentId: catId('shopping') });
    expect(moved.parentId).toBe(catId('shopping'));
  });
});

describe('buildCategoryTree', () => {
  it('nests children under parents and keeps sort order', () => {
    const db = createTestDb().db;
    seedDefaults(db);

    const tree = buildCategoryTree(db.select().from(categories).all(), 'expense');
    const food = tree.find((n) => n.id === catId('food'))!;

    expect(food.children.map((c) => c.name)).toEqual(['Groceries', 'Restaurants', 'Coffee']);
    expect(tree.every((n) => !n.parentId)).toBe(true);
  });

  it('promotes an orphan rather than hiding it', () => {
    const db = createTestDb().db;
    seedDefaults(db);

    // Simulate the parent being archived out of the visible set.
    db.update(categories).set({ archived: true }).where(eq(categories.id, catId('food'))).run();

    const tree = buildCategoryTree(db.select().from(categories).all(), 'expense');
    // Losing a category from the picker is worse than showing it top level.
    expect(tree.some((n) => n.id === catId('groceries'))).toBe(true);
  });

  it('never mixes kinds', () => {
    const db = createTestDb().db;
    seedDefaults(db);
    const tree = buildCategoryTree(db.select().from(categories).all(), 'income');
    expect(tree.every((n) => n.kind === 'income')).toBe(true);
  });
});

describe('records', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb().db;
    seedDefaults(db);
  });

  it('signs an expense negative and income positive from an unsigned amount', () => {
    const spend = createRecord(db, {
      type: 'expense',
      accountId: CASH,
      categoryId: catId('food'),
      amountMinor: 8000,
    });
    const earn = createRecord(db, {
      type: 'income',
      accountId: BANK,
      categoryId: catId('salary'),
      amountMinor: 1_250_000,
    });

    expect(spend.amountMinor).toBe(-8000);
    expect(earn.amountMinor).toBe(1_250_000);
  });

  it('rejects amounts that would corrupt the ledger', () => {
    const base = { type: 'expense' as const, accountId: CASH };
    expect(() => createRecord(db, { ...base, amountMinor: 0 })).toThrow(/greater than zero/i);
    expect(() => createRecord(db, { ...base, amountMinor: -5 })).toThrow(/greater than zero/i);
    expect(() => createRecord(db, { ...base, amountMinor: 12.5 })).toThrow(/integer/i);
  });
});

describe('transfers', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb().db;
    seedDefaults(db);
  });

  it('writes two legs sharing one pair id', () => {
    const { out, in: incoming } = createTransfer(db, {
      fromAccountId: BANK,
      toAccountId: CASH,
      amountMinor: 1_075_300,
    });

    expect(out.amountMinor).toBe(-1_075_300);
    expect(incoming.amountMinor).toBe(1_075_300);
    expect(out.transferPairId).toBe(incoming.transferPairId);
    expect(out.counterAccountId).toBe(CASH);
    expect(incoming.counterAccountId).toBe(BANK);
    // A transfer is not spending, so it must never carry a category.
    expect(out.categoryId).toBeNull();
    expect(incoming.categoryId).toBeNull();
  });

  it('moves money between accounts without changing the total', () => {
    const before = totalBalance(db);
    createTransfer(db, { fromAccountId: BANK, toAccountId: CASH, amountMinor: 500_00 });

    const byId = new Map(listAccountsWithBalance(db).map((a) => [a.id, a.balanceMinor]));
    expect(byId.get(BANK)).toBe(-50_000);
    expect(byId.get(CASH)).toBe(50_000);
    expect(totalBalance(db)).toBe(before);
  });

  it('refuses a transfer to the same account', () => {
    expect(() =>
      createTransfer(db, { fromAccountId: CASH, toAccountId: CASH, amountMinor: 100 })
    ).toThrow(/two different accounts/i);
  });

  it('writes nothing at all when one leg is invalid', () => {
    // Atomicity is the reason both legs go in one SQL transaction: a half-written
    // transfer reads as money created or destroyed.
    expect(() =>
      createTransfer(db, {
        fromAccountId: BANK,
        toAccountId: 'does-not-exist',
        amountMinor: 100,
      })
    ).toThrow();

    expect(db.select().from(transactions).all()).toHaveLength(0);
  });

  it('deletes both legs when either is deleted', () => {
    const { out } = createTransfer(db, {
      fromAccountId: BANK,
      toAccountId: CASH,
      amountMinor: 100,
    });

    expect(deleteRecord(db, out.id)).toHaveLength(2);
    expect(db.select().from(transactions).all()).toHaveLength(0);
    expect(totalBalance(db)).toBe(0);
  });

  it('deletes only the one row for a normal record', () => {
    const a = createRecord(db, { type: 'expense', accountId: CASH, amountMinor: 100 });
    createRecord(db, { type: 'expense', accountId: CASH, amountMinor: 200 });

    expect(deleteRecord(db, a.id)).toHaveLength(1);
    expect(db.select().from(transactions).all()).toHaveLength(1);
  });

  it('reports nothing deleted for an unknown id', () => {
    expect(deleteRecord(db, 'nope')).toHaveLength(0);
  });
});

describe('account balances', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb().db;
    seedDefaults(db);
  });

  it('derives balance from opening balance plus transactions', () => {
    db.update(accounts).set({ openingBalance: 100_000 }).where(eq(accounts.id, CASH)).run();

    createRecord(db, { type: 'expense', accountId: CASH, amountMinor: 8000 });
    createRecord(db, { type: 'income', accountId: CASH, amountMinor: 3000 });

    const cash = listAccountsWithBalance(db).find((a) => a.id === CASH)!;
    expect(cash.balanceMinor).toBe(100_000 - 8000 + 3000);
  });

  it('reports zero for an account with no activity', () => {
    const bank = listAccountsWithBalance(db).find((a) => a.id === BANK)!;
    expect(bank.balanceMinor).toBe(0);
  });
});

describe('InvariantError', () => {
  it('is distinguishable from a database error', () => {
    const db = createTestDb().db;
    seedDefaults(db);
    // Callers need to tell "you typed something invalid" apart from "the disk
    // is broken", because only one of those is worth showing to the user.
    try {
      createCategory(db, { id: 'x', name: '', kind: 'expense' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InvariantError);
    }
  });
});

describe('editing records', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb().db;
    seedDefaults(db);
  });

  it('changes fields without touching the ones left alone', () => {
    const r = createRecord(db, {
      type: 'expense',
      accountId: CASH,
      categoryId: catId('food'),
      amountMinor: 8000,
      note: 'lunch',
      occurredAt: new Date(2026, 7, 5),
    });

    const updated = updateRecord(db, r.id, { amountMinor: 9500 });
    expect(updated.amountMinor).toBe(-9500);
    expect(updated.note).toBe('lunch');
    expect(updated.categoryId).toBe(catId('food'));
  });

  it('flips the sign when an expense is corrected to income', () => {
    // The caller passes a type and an unsigned amount; sign is never their job.
    const r = createRecord(db, { type: 'expense', accountId: CASH, amountMinor: 8000 });
    expect(updateRecord(db, r.id, { type: 'income' }).amountMinor).toBe(8000);
  });

  it('can clear the category', () => {
    const r = createRecord(db, {
      type: 'expense',
      accountId: CASH,
      categoryId: catId('food'),
      amountMinor: 100,
    });
    expect(updateRecord(db, r.id, { categoryId: null }).categoryId).toBeNull();
  });

  it('still rejects a zero amount', () => {
    const r = createRecord(db, { type: 'expense', accountId: CASH, amountMinor: 100 });
    expect(() => updateRecord(db, r.id, { amountMinor: 0 })).toThrow(/greater than zero/i);
  });

  it('refuses to edit a transfer leg as if it were a record', () => {
    const { out } = createTransfer(db, {
      fromAccountId: BANK,
      toAccountId: CASH,
      amountMinor: 500,
    });
    expect(() => updateRecord(db, out.id, { amountMinor: 600 })).toThrow(/edit it as a transfer/i);
  });
});

describe('editing transfers', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb().db;
    seedDefaults(db);
  });

  it('rewrites both legs so the pair still nets to zero', () => {
    const { out } = createTransfer(db, {
      fromAccountId: BANK,
      toAccountId: CASH,
      amountMinor: 500_00,
    });

    const updated = updateTransfer(db, out.id, { amountMinor: 750_00 });
    expect(updated.out.amountMinor).toBe(-75_000);
    expect(updated.in.amountMinor).toBe(75_000);
    expect(totalBalance(db)).toBe(0);
  });

  it('can be edited from either leg', () => {
    const { in: incoming } = createTransfer(db, {
      fromAccountId: BANK,
      toAccountId: CASH,
      amountMinor: 100,
    });
    expect(updateTransfer(db, incoming.id, { amountMinor: 200 }).out.amountMinor).toBe(-200);
  });

  it('swaps direction and keeps counterAccountId consistent on both legs', () => {
    const { out } = createTransfer(db, {
      fromAccountId: BANK,
      toAccountId: CASH,
      amountMinor: 100,
    });

    const updated = updateTransfer(db, out.id, { fromAccountId: CASH, toAccountId: BANK });
    expect(updated.out.accountId).toBe(CASH);
    expect(updated.out.counterAccountId).toBe(BANK);
    expect(updated.in.accountId).toBe(BANK);
    expect(updated.in.counterAccountId).toBe(CASH);
  });

  it('refuses to point a transfer at a single account', () => {
    const { out } = createTransfer(db, {
      fromAccountId: BANK,
      toAccountId: CASH,
      amountMinor: 100,
    });
    expect(() => updateTransfer(db, out.id, { toAccountId: BANK })).toThrow(
      /two different accounts/i
    );
  });

  it('refuses to edit a normal record as a transfer', () => {
    const r = createRecord(db, { type: 'expense', accountId: CASH, amountMinor: 100 });
    expect(() => updateTransfer(db, r.id, { amountMinor: 200 })).toThrow(/not a transfer/i);
  });
});

describe('delete and restore', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb().db;
    seedDefaults(db);
  });

  it('puts a deleted record back exactly as it was', () => {
    const original = createRecord(db, {
      type: 'expense',
      accountId: CASH,
      categoryId: catId('food'),
      amountMinor: 8000,
      note: 'lunch',
      occurredAt: new Date(2026, 7, 5, 13, 30),
    });

    const removed = deleteRecord(db, original.id);
    expect(db.select().from(transactions).all()).toHaveLength(0);

    expect(restoreRecords(db, removed)).toBe(1);
    const back = db.select().from(transactions).all();
    expect(back).toHaveLength(1);
    // Same id, so anything referencing it still points at the right row.
    expect(back[0]).toEqual(original);
  });

  it('restores both legs of a transfer together', () => {
    createTransfer(db, { fromAccountId: BANK, toAccountId: CASH, amountMinor: 50_000 });
    const [leg] = db.select().from(transactions).all();

    const removed = deleteRecord(db, leg.id);
    expect(removed).toHaveLength(2);
    expect(totalBalance(db)).toBe(0);

    restoreRecords(db, removed);
    expect(db.select().from(transactions).all()).toHaveLength(2);
    // A half-restored transfer would leave money created or destroyed.
    expect(totalBalance(db)).toBe(0);
    expect(listAccountsWithBalance(db).find((a) => a.id === BANK)!.balanceMinor).toBe(-50_000);
  });

  it('restores nothing for an empty list', () => {
    expect(restoreRecords(db, [])).toBe(0);
  });

  it('throws rather than half-restoring when the account is gone', () => {
    const r = createRecord(db, { type: 'expense', accountId: CASH, amountMinor: 100 });
    const removed = deleteRecord(db, r.id);
    db.run(sqlDeleteAccount(CASH));

    // Undo must fail loudly; silently dropping the row would look like success.
    expect(() => restoreRecords(db, removed)).toThrow();
    expect(db.select().from(transactions).all()).toHaveLength(0);
  });
});

describe('account CRUD', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb().db;
    seedDefaults(db);
  });

  it('creates an account with sensible defaults', () => {
    const a = createAccount(db, { name: '  Savings  ' });
    expect(a.name).toBe('Savings');
    expect(a.currency).toBe('EGP');
    expect(a.openingBalance).toBe(0);
    expect(a.archived).toBe(false);
  });

  it('refuses a blank name', () => {
    expect(() => createAccount(db, { name: '   ' })).toThrow(/needs a name/i);
    expect(() => updateAccount(db, CASH, { name: '' })).toThrow(/needs a name/i);
  });

  it('appends new accounts after the existing ones', () => {
    const a = createAccount(db, { name: 'Third' });
    expect(a.sortOrder).toBeGreaterThan(1);
  });

  it('counts the opening balance toward the balance', () => {
    const a = createAccount(db, { name: 'Savings', openingBalance: 500_00 });
    expect(listAccountsWithBalance(db).find((x) => x.id === a.id)!.balanceMinor).toBe(50_000);
  });

  it('hides archived accounts from pickers but keeps them retrievable', () => {
    updateAccount(db, CASH, { archived: true });
    expect(listAccountsWithBalance(db).some((a) => a.id === CASH)).toBe(false);
    expect(listAccountsWithBalance(db, true).some((a) => a.id === CASH)).toBe(true);
  });

  it('deletes an account that has no records', () => {
    const a = createAccount(db, { name: 'Scratch' });
    deleteAccount(db, a.id);
    expect(getAccount(db, a.id)).toBeUndefined();
  });

  it('REFUSES to delete an account that has records', () => {
    // account_id cascades, so this would silently delete the history too.
    createRecord(db, { type: 'expense', accountId: CASH, amountMinor: 100 });
    expect(() => deleteAccount(db, CASH)).toThrow(/Archive it instead/i);
    expect(getAccount(db, CASH)).toBeDefined();
    expect(db.select().from(transactions).all()).toHaveLength(1);
  });

  it('counts a transfer leg as a record for that guard', () => {
    createTransfer(db, { fromAccountId: BANK, toAccountId: CASH, amountMinor: 100 });
    expect(() => deleteAccount(db, BANK)).toThrow(/Archive it instead/i);
    expect(() => deleteAccount(db, CASH)).toThrow(/Archive it instead/i);
  });
});

describe('category delete', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb().db;
    seedDefaults(db);
  });

  it('leaves records uncategorised rather than deleting them', () => {
    createRecord(db, {
      type: 'expense',
      accountId: CASH,
      categoryId: catId('food'),
      amountMinor: 100,
    });

    expect(deleteCategory(db, catId('food'))).toEqual({ orphanedRecords: 1 });
    const rows = db.select().from(transactions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].categoryId).toBeNull();
  });

  it('promotes children instead of deleting them', () => {
    deleteCategory(db, catId('food'));
    const groceries = getCategory(db, catId('groceries'));
    expect(groceries).toBeDefined();
    expect(groceries!.parentId).toBeNull();
  });

  it('reports zero for a category nothing uses', () => {
    expect(deleteCategory(db, catId('pets'))).toEqual({ orphanedRecords: 0 });
  });
});
