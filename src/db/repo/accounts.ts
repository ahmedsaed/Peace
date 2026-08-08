import { eq, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import * as schema from '../schema';
import { accounts, transactions, type Account } from '../schema';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export type AccountWithBalance = Account & { balanceMinor: number };

/**
 * Balance is DERIVED, never stored: opening balance plus the sum of every
 * transaction on the account. A stored running balance is one missed update
 * away from disagreeing with the ledger, and there is no way to tell which is
 * right after the fact.
 *
 * Transfers need no special handling here — each leg is a real row on its own
 * account, which is exactly why the paired-row shape was chosen.
 */
export function listAccountsWithBalance(db: Db): AccountWithBalance[] {
  const rows = db
    .select({
      account: accounts,
      moved: sql<number>`coalesce(sum(${transactions.amountMinor}), 0)`,
    })
    .from(accounts)
    .leftJoin(transactions, eq(transactions.accountId, accounts.id))
    .groupBy(accounts.id)
    .all();

  return rows
    .map(({ account, moved }) => ({
      ...account,
      balanceMinor: account.openingBalance + Number(moved),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export function totalBalance(db: Db): number {
  return listAccountsWithBalance(db)
    .filter((a) => !a.archived)
    .reduce((sum, a) => sum + a.balanceMinor, 0);
}
