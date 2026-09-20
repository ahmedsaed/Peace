/**
 * Deleting something that has been put away.
 *
 * Archiving is reversible and deleting is not, so the two live at opposite
 * ends of the same row in Settings — and the difference between them is what
 * this module exists to make concrete.
 *
 * AN ACCOUNT OR A CATEGORY IS NOT DELETABLE WHILE RECORDS POINT AT IT. Not
 * because SQLite cannot — `transactions.account_id` cascades, which is exactly
 * the problem: deleting an account with history would silently take every
 * record on it, a month that suddenly balances differently with nothing to say
 * why. A category is quieter still, since `deleteCategory` leaves its records
 * UNCATEGORISED: the money survives and the history stops saying what it went
 * on, which cannot be reconstructed afterwards. So the answer is not a refusal
 * with an apology — it is the list of records standing in the way, which is
 * `SearchQuery`'s whole job. `blockingFilter` returns the search that shows
 * them, and the screen hands it to the search page rather than describing it.
 *
 * A TAG IS DIFFERENT, and deliberately so. Its rows cascade through
 * `transaction_tags`, which touches no money and no category — the records keep
 * everything that makes them records and lose a label. Nothing blocks it; the
 * count travels with the answer so the sheet can say what is about to forget.
 *
 * THE COUNT AND THE SEARCH MUST AGREE. Counting one way and filtering another
 * is how a screen comes to say "4 records" over a list of three, so both come
 * from `searchRecords` with the same query — except for the one case search
 * cannot express, which is documented on `blockingFilter` below.
 */

import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { EMPTY_QUERY, type SearchQuery } from '../../lib/search-query';
import * as schema from '../schema';
import { accountRecordCount, deleteAccount, getAccount } from './accounts';
import { deleteCategory, getCategory, InvariantError } from './categories';
import { searchRecords } from './search';
import { deleteTag, tagUsage } from './tags';
import { tags } from '../schema';
import { eq } from 'drizzle-orm';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export type ArchivedKind = 'account' | 'category' | 'tag';
export type ArchivedTarget = { kind: ArchivedKind; id: string };

/** The subset of a search that finds what is in the way. */
export type BlockingFilter = Partial<
  Pick<SearchQuery, 'accountId' | 'counterAccountId' | 'categoryId'>
>;

export type DeletionCheck = {
  /** Records that must move before this can go — always 0 for a tag. */
  blocking: number;
  /** Records that mention it at all. For a tag, what would forget it. */
  records: number;
  /** The search showing what is in the way, or null when nothing is. */
  filter: BlockingFilter | null;
};

const query = (over: BlockingFilter): SearchQuery => ({ ...EMPTY_QUERY, ...over });

/**
 * Which search shows the records holding an ACCOUNT back.
 *
 * The one case the count and the list disagree about. Search lists a transfer
 * ONCE, as its outgoing leg, so an account that has only ever RECEIVED
 * transfers holds rows that `accountId` cannot find — and sending someone to
 * an empty search under a banner about records they have to move is worse than
 * saying nothing. `counter_account_id` is how those rows are reachable: the
 * same transfer, seen from the account it left. So ask the visible question
 * first, and fall back to the one that finds the rest.
 */
function accountFilter(db: Db, id: string): BlockingFilter {
  const onIt = searchRecords(db, query({ accountId: id }), { limit: 1 }).matchCount;
  return onIt > 0 ? { accountId: id } : { counterAccountId: id };
}

/**
 * What stands between this and being deleted.
 *
 * `limit: 1` throughout: these are aggregate counts over a whole match, and
 * `searchRecords` computes them separately from the rows precisely so that a
 * total never means "the first 300 of them".
 */
export function checkDeletion(db: Db, target: ArchivedTarget): DeletionCheck {
  switch (target.kind) {
    case 'account': {
      // Counted from the LEDGER, not from search: the delete cascades over
      // every row on the account, including the incoming transfer legs search
      // hides, and a count that missed them would offer a delete that then
      // threw.
      const blocking = accountRecordCount(db, target.id);
      return {
        blocking,
        records: blocking,
        filter: blocking > 0 ? accountFilter(db, target.id) : null,
      };
    }
    case 'category': {
      // A parent also matches its children here, exactly as the search page
      // does — the records under "Groceries" are records standing between
      // "Food" and being deleted, and the user has to be shown all of them.
      const blocking = searchRecords(db, query({ categoryId: target.id }), {
        limit: 1,
      }).matchCount;
      return {
        blocking,
        records: blocking,
        filter: blocking > 0 ? { categoryId: target.id } : null,
      };
    }
    case 'tag': {
      // Nothing blocks a tag. The count is what the sheet says out loud before
      // the second tap, because this is the one delete here that reaches
      // records and still goes ahead.
      const records = tagUsage(db, [target.id]).get(target.id) ?? 0;
      return { blocking: 0, records, filter: null };
    }
  }
}

/** The name to put in a sentence about it, or null if it is already gone. */
export function archivedName(db: Db, target: ArchivedTarget): string | null {
  switch (target.kind) {
    case 'account':
      return getAccount(db, target.id)?.name ?? null;
    case 'category':
      return getCategory(db, target.id)?.name ?? null;
    case 'tag':
      return db.select().from(tags).where(eq(tags.id, target.id)).get()?.name ?? null;
  }
}

/**
 * Delete it, or refuse with the count that says why.
 *
 * The guard lives HERE rather than in the screen that draws the button. A
 * screen deciding whether a delete is safe is a rule kept next to a Pressable,
 * and the next caller — a bulk tidy-up, a flow, whatever comes — would not
 * inherit it.
 */
export function deleteArchived(db: Db, target: ArchivedTarget): void {
  const check = checkDeletion(db, target);
  if (check.blocking > 0) {
    throw new InvariantError(
      `${check.blocking} record${check.blocking === 1 ? '' : 's'} still ` +
        `${check.blocking === 1 ? 'points' : 'point'} at this. Move them first.`
    );
  }

  switch (target.kind) {
    case 'account':
      deleteAccount(db, target.id);
      return;
    case 'category':
      deleteCategory(db, target.id);
      return;
    case 'tag':
      deleteTag(db, target.id);
  }
}
