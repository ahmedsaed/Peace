import { eq, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { newId } from '../../lib/id';
import * as schema from '../schema';
import { accounts, transactions, type Account } from '../schema';
import { InvariantError } from './categories';

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
export function listAccountsWithBalance(db: Db, includeArchived = false): AccountWithBalance[] {
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
    .filter((a) => includeArchived || !a.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export type CurrencyTotal = { currency: string; balanceMinor: number };

/**
 * Balances grouped by the currency they are actually held in.
 *
 * NOT one converted number. Adding a dollar account to a pound account needs a
 * rate for the whole balance as it stands today, and the only rates this app
 * has are the ones attached to individual records — captured on the day each
 * was entered, for an amount, not for a balance. Picking one of them to value
 * everything else would invent a number that looks authoritative and is not.
 *
 * An opening balance has no rate attached at all, which is the same problem in
 * its clearest form.
 *
 * So the screen shows what is true: how much sits in each currency. With a
 * single currency — the normal case — that is exactly one row and reads as the
 * total it always was.
 */
export function balanceByCurrency(db: Db): CurrencyTotal[] {
  const totals = new Map<string, number>();
  for (const account of listAccountsWithBalance(db)) {
    if (account.archived) continue;
    const key = account.currency.toUpperCase();
    totals.set(key, (totals.get(key) ?? 0) + account.balanceMinor);
  }
  return [...totals.entries()]
    .map(([currency, balanceMinor]) => ({ currency, balanceMinor }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Thrown when a write would break a documented invariant. Re-exported for convenience. */
export { InvariantError } from './categories';

export type AccountInput = {
  id?: string;
  name: string;
  type?: Account['type'];
  currency?: string;
  openingBalance?: number;
  interestRate?: number | null;
  icon?: string | null;
  color?: string | null;
};

export function getAccount(db: Db, id: string): Account | undefined {
  return db.select().from(accounts).where(eq(accounts.id, id)).get();
}

export function createAccount(db: Db, input: AccountInput): Account {
  const name = input.name?.trim();
  if (!name) throw new InvariantError('An account needs a name.');

  const id = input.id ?? newId();
  const highest = db
    .select({ max: sql<number>`coalesce(max(${accounts.sortOrder}), -1)` })
    .from(accounts)
    .get();

  db.insert(accounts)
    .values({
      id,
      name,
      type: input.type ?? 'cash',
      currency: input.currency ?? 'EGP',
      openingBalance: input.openingBalance ?? 0,
      interestRate: input.interestRate ?? null,
      icon: input.icon ?? 'wallet',
      color: input.color ?? '#6B5B4A',
      sortOrder: Number(highest?.max ?? -1) + 1,
    })
    .run();

  return getAccount(db, id)!;
}

export function updateAccount(
  db: Db,
  id: string,
  patch: Partial<Omit<AccountInput, 'id'>> & { archived?: boolean }
): Account {
  const existing = getAccount(db, id);
  if (!existing) throw new InvariantError(`Account "${id}" does not exist.`);

  const name = patch.name === undefined ? existing.name : patch.name.trim();
  if (!name) throw new InvariantError('An account needs a name.');

  db.update(accounts)
    .set({ ...patch, name, updatedAt: new Date() })
    .where(eq(accounts.id, id))
    .run();

  return getAccount(db, id)!;
}

export function accountRecordCount(db: Db, id: string): number {
  return db.select().from(transactions).where(eq(transactions.accountId, id)).all().length;
}

/**
 * Delete an account — ONLY if nothing points at it.
 *
 * `transactions.account_id` cascades, so deleting an account with history would
 * silently take every record on it too. That is unrecoverable and would show up
 * as a month that suddenly balances differently, with no hint why.
 *
 * An account you have finished with should be ARCHIVED: the history stays, and
 * the account stops appearing in pickers.
 */
export function deleteAccount(db: Db, id: string): void {
  const existing = getAccount(db, id);
  if (!existing) throw new InvariantError(`Account "${id}" does not exist.`);

  const count = accountRecordCount(db, id);
  if (count > 0) {
    throw new InvariantError(
      `"${existing.name}" has ${count} record${count === 1 ? '' : 's'}. ` +
        'Archive it instead — deleting would take its history with it.'
    );
  }

  db.delete(accounts).where(eq(accounts.id, id)).run();
}
