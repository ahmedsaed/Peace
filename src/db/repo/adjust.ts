import { eq, sql } from 'drizzle-orm';
import { type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { newId } from '../../lib/id';
import * as schema from '../schema';
import { accounts, transactions, type Transaction } from '../schema';
import { InvariantError } from './categories';
import { movesAccountBalance } from './predicates';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/**
 * What one account is currently holding, in ITS OWN currency.
 *
 * Deliberately not converted: this is the number the bank shows you, and the
 * whole point of reconciling is to compare like with like. Conversion belongs
 * to the reporting screens.
 */
export function accountBalance(db: Db, accountId: string): number {
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) throw new InvariantError(`Account "${accountId}" does not exist.`);

  const row = db
    .select({ moved: sql<number>`coalesce(sum(${transactions.amountMinor}), 0)` })
    .from(transactions)
    .where(sql`${transactions.accountId} = ${accountId} and ${movesAccountBalance()}`)
    .get();

  return account.openingBalance + Number(row?.moved ?? 0);
}

export type Reconciliation = {
  /** What the ledger currently believes, in the account's currency. */
  currentMinor: number;
  /** What the user says it should be. */
  targetMinor: number;
  /** Signed. What an adjustment would have to move to close the gap. */
  differenceMinor: number;
};

/**
 * Work out the correction without writing anything.
 *
 * Separate from `reconcileAccount` so the screen can show the difference before
 * the user commits to it. A reconciliation that writes the moment you finish
 * typing is one you cannot check first.
 */
export function previewReconcile(db: Db, accountId: string, targetMinor: number): Reconciliation {
  const currentMinor = accountBalance(db, accountId);
  return {
    currentMinor,
    targetMinor,
    differenceMinor: targetMinor - currentMinor,
  };
}

/**
 * Move an account to the balance the bank actually shows.
 *
 * THIS IS NOT SPENDING, and the whole design turns on that. A card drifts — the
 * bank's rate differs from the estimate, a fee posts that was not anticipated, a
 * record is forgotten — and the fix has to move the balance without inventing a
 * purchase. Counting a correction as expense would drop a category's worth of
 * phantom spending into whichever month you happened to reconcile in, which is
 * the exact failure this feature exists to stop.
 *
 * It IS money, though, so it moves the running position. See predicates.ts.
 *
 * A dated row rather than an edit to `openingBalance`: a correction you can see
 * in the list, question later, and delete is a correction you can trust. An
 * undated number silently changing under the account name is not.
 */
export function reconcileAccount(
  db: Db,
  accountId: string,
  targetMinor: number,
  { note, occurredAt, id }: { note?: string | null; occurredAt?: Date; id?: string } = {}
): Transaction | null {
  if (!Number.isInteger(targetMinor)) {
    throw new InvariantError('A balance must be an integer number of minor units.');
  }

  const { differenceMinor } = previewReconcile(db, accountId, targetMinor);

  // Already correct. Writing a zero-value row would be a permanent entry in the
  // list saying nothing happened, which is worse than no entry at all.
  if (differenceMinor === 0) return null;

  const rowId = id ?? newId();

  db.insert(transactions)
    .values({
      id: rowId,
      accountId,
      // No category, by construction. A correction is not spending, so filing it
      // under one would put it in a breakdown that must never contain it — and
      // every category query would then need to know about adjustments.
      categoryId: null,
      amountMinor: differenceMinor,
      currency: db.select().from(accounts).where(eq(accounts.id, accountId)).get()!.currency,
      isAdjustment: true,
      note: note ?? null,
      occurredAt: occurredAt ?? new Date(),
    })
    .run();

  return db.select().from(transactions).where(eq(transactions.id, rowId)).get()!;
}
