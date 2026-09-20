/**
 * @jest-environment node
 *
 * What stands between something put away and being deleted for good.
 *
 * The two halves have to agree: the number the sheet prints and the list the
 * search page then shows come from the same query, or the screen says "4
 * records" over a list of three and the user is left looking for one that is
 * not there.
 */
import { createTestDb, type TestDb } from '../../test/db';
import { createAccount, getAccount, listAccountsWithBalance } from './accounts';
import { archivedName, checkDeletion, deleteArchived } from './archive';
import { createCategory, getCategory, InvariantError } from './categories';
import { searchRecords } from './search';
import { ensureTag, listTags, setRecordTags, tagsForRecord } from './tags';
import { createRecord, createTransfer } from './transactions';
import { EMPTY_QUERY, type SearchQuery } from '../../lib/search-query';

const on = (day: number) => new Date(2026, 7, day, 12, 0);
const q = (over: Partial<SearchQuery>): SearchQuery => ({ ...EMPTY_QUERY, ...over });

function seed() {
  const { db } = createTestDb();
  createAccount(db, { id: 'bank', name: 'Bank', currency: 'EGP' });
  createAccount(db, { id: 'wallet', name: 'Old wallet', currency: 'EGP' });
  createCategory(db, { id: 'food', name: 'Food', kind: 'expense', sortOrder: 0 });
  createCategory(db, {
    id: 'groceries',
    name: 'Groceries',
    kind: 'expense',
    parentId: 'food',
    sortOrder: 0,
  });
  return db;
}

const spend = (db: TestDb, id: string, accountId: string, categoryId: string | null, day: number) =>
  createRecord(db, {
    id,
    accountId,
    categoryId,
    type: 'expense',
    amountMinor: 5_000,
    occurredAt: on(day),
  });

describe('an account still holding records', () => {
  it('counts them, and points at the search that lists them', () => {
    const db = seed();
    spend(db, 'e1', 'wallet', 'groceries', 3);
    spend(db, 'e2', 'wallet', null, 4);

    const check = checkDeletion(db, { kind: 'account', id: 'wallet' });

    expect(check.blocking).toBe(2);
    expect(check.filter).toEqual({ accountId: 'wallet' });
    // The number and the list agree, which is the whole point of deriving one
    // from the other rather than writing the count out by hand.
    expect(searchRecords(db, q(check.filter!)).matchCount).toBe(2);
  });

  it('refuses the delete rather than taking the history with it', () => {
    const db = seed();
    spend(db, 'e1', 'wallet', 'groceries', 3);

    // `transactions.account_id` CASCADES: without this guard the delete would
    // succeed and quietly take the record with it.
    expect(() => deleteArchived(db, { kind: 'account', id: 'wallet' })).toThrow(InvariantError);
    expect(getAccount(db, 'wallet')).toBeDefined();
  });

  /**
   * The case where the count and the obvious search disagree.
   *
   * Search lists a transfer once, as the leg the money LEFT on, so an account
   * that has only ever received transfers holds rows that `accountId` cannot
   * find. Sending someone to an empty list under a banner about records they
   * must move would be worse than saying nothing at all.
   */
  it('finds an account that has only ever received transfers', () => {
    const db = seed();
    createTransfer(db, {
      fromAccountId: 'bank',
      toAccountId: 'wallet',
      amountMinor: 20_000,
      currency: 'EGP',
      note: null,
      occurredAt: on(5),
    });

    const check = checkDeletion(db, { kind: 'account', id: 'wallet' });

    // One row on the account by the ledger's count — the incoming leg.
    expect(check.blocking).toBe(1);
    expect(check.filter).toEqual({ counterAccountId: 'wallet' });
    expect(searchRecords(db, q({ accountId: 'wallet' })).matchCount).toBe(0);
    expect(searchRecords(db, q(check.filter!)).matchCount).toBe(1);
  });

  it('deletes one that nothing points at', () => {
    const db = seed();

    expect(checkDeletion(db, { kind: 'account', id: 'wallet' })).toEqual({
      blocking: 0,
      records: 0,
      filter: null,
    });

    deleteArchived(db, { kind: 'account', id: 'wallet' });
    expect(listAccountsWithBalance(db, true).map((a) => a.id)).not.toContain('wallet');
  });
});

describe('a category still on records', () => {
  it("counts its CHILDREN's records too, as the search page does", () => {
    const db = seed();
    spend(db, 'e1', 'bank', 'groceries', 3);

    // Nothing is filed directly under Food, and it is still blocked: the
    // records under Groceries are what the search page shows for Food, and a
    // count that disagreed would send someone to a list of records the sheet
    // said were not there.
    const check = checkDeletion(db, { kind: 'category', id: 'food' });

    expect(check.blocking).toBe(1);
    expect(check.filter).toEqual({ categoryId: 'food' });
    expect(searchRecords(db, q(check.filter!)).matchCount).toBe(1);
    expect(() => deleteArchived(db, { kind: 'category', id: 'food' })).toThrow(InvariantError);
  });

  it('deletes one nothing is filed under', () => {
    const db = seed();
    spend(db, 'e1', 'bank', null, 3);

    deleteArchived(db, { kind: 'category', id: 'groceries' });
    expect(getCategory(db, 'groceries')).toBeUndefined();
    // Deleting a category leaves its records UNCATEGORISED, which is why one
    // with records is refused above — here there were none to lose.
    expect(searchRecords(db, q({ text: '' , accountId: 'bank' })).matchCount).toBe(1);
  });
});

describe('a tag is never blocked', () => {
  it('reports what would forget it rather than refusing', () => {
    const db = seed();
    const tag = ensureTag(db, 'Kitchen');
    spend(db, 'e1', 'bank', 'groceries', 3);
    spend(db, 'e2', 'bank', 'groceries', 4);
    setRecordTags(db, 'e1', [tag.id]);
    setRecordTags(db, 'e2', [tag.id]);

    expect(checkDeletion(db, { kind: 'tag', id: tag.id })).toEqual({
      blocking: 0,
      records: 2,
      filter: null,
    });
  });

  it('takes the label and leaves the records', () => {
    const db = seed();
    const tag = ensureTag(db, 'Kitchen');
    spend(db, 'e1', 'bank', 'groceries', 3);
    setRecordTags(db, 'e1', [tag.id]);

    deleteArchived(db, { kind: 'tag', id: tag.id });

    expect(listTags(db, { includeArchived: true })).toEqual([]);
    expect(tagsForRecord(db, 'e1')).toEqual([]);
    // The record itself is untouched: a tag owns none of its money, its
    // category or its note.
    expect(searchRecords(db, q({ accountId: 'bank' })).matchCount).toBe(1);
  });
});

describe('naming what is about to go', () => {
  it('answers for each kind, and says nothing for what is already gone', () => {
    const db = seed();
    const tag = ensureTag(db, 'Kitchen');

    expect(archivedName(db, { kind: 'account', id: 'wallet' })).toBe('Old wallet');
    expect(archivedName(db, { kind: 'category', id: 'groceries' })).toBe('Groceries');
    expect(archivedName(db, { kind: 'tag', id: tag.id })).toBe('Kitchen');
    expect(archivedName(db, { kind: 'account', id: 'nope' })).toBeNull();
  });
});
