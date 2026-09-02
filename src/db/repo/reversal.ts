import { desc, eq } from 'drizzle-orm';
import { alias, type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import * as schema from '../schema';
import { accounts, categories, transactions } from '../schema';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/**
 * One end of an "undoes" relationship, as much of it as a sheet needs to show.
 *
 * Enough to NAME the record — what it was, how much, and when — because opening
 * one to find out which it was is the interaction this exists to avoid.
 */
export type ReversalLink = {
  id: string;
  /** Signed, as stored. Rendered unsigned: the label already says which way. */
  amountMinor: number;
  currency: string;
  occurredAt: Date;
  /** 'refund' on the expense side, 'reversal' for a transfer. */
  kind: 'refund' | 'reversal';
  /** The category for a refund, "Bank → Cash" for a transfer. */
  label: string;
};

/**
 * How many links to resolve for one row.
 *
 * A purchase refunded four times is already unusual, and the sheet this feeds
 * opens over the list rather than scrolling — one that grows without bound
 * stops fitting. The COUNT is reported separately and is never capped, so
 * "+2 more" can be said truthfully instead of the list quietly ending.
 */
export const LINK_LIMIT = 4;

const counter = alias(accounts, 'counter_account');

const SELECTION = {
  id: transactions.id,
  amountMinor: transactions.amountMinor,
  currency: transactions.currency,
  occurredAt: transactions.occurredAt,
  transferPairId: transactions.transferPairId,
  categoryName: categories.name,
  accountName: accounts.name,
  counterAccountName: counter.name,
};

type Selected = {
  id: string;
  amountMinor: number;
  currency: string;
  occurredAt: Date;
  transferPairId: string | null;
  categoryName: string | null;
  accountName: string;
  counterAccountName: string | null;
};

function toLink(row: Selected): ReversalLink {
  const isTransfer = row.transferPairId !== null;
  return {
    id: row.id,
    amountMinor: row.amountMinor,
    currency: row.currency,
    occurredAt: row.occurredAt,
    kind: isTransfer ? 'reversal' : 'refund',
    // The same subtitle each row already wears in the list, so the sheet names
    // the record the way the user last saw it rather than in its own dialect.
    label: isTransfer
      ? `${row.accountName} → ${row.counterAccountName ?? '—'}`
      : (row.categoryName ?? row.accountName),
  };
}

/** The shared shape of both lookups — one row is one link. */
const linkQuery = (db: Db) =>
  db
    .select(SELECTION)
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(counter, eq(counter.id, transactions.counterAccountId));

/** Resolve one id to a link, or null when it is no longer in the ledger. */
export function linkById(db: Db, id: string): ReversalLink | null {
  const found = linkQuery(db).where(eq(transactions.id, id)).get();
  return found ? toLink(found) : null;
}

/**
 * What this row exists to undo, or null.
 *
 * Null covers two situations on purpose — the row undoes nothing, and the row
 * it undid has since been deleted — because the screen says the same thing in
 * both cases: there is nothing to open. Delete is UNDOABLE, so the pointer is
 * left dangling rather than nulled, and this resolves again the moment the
 * original comes back.
 */
export function reverses(db: Db, id: string): ReversalLink | null {
  const row = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!row?.reversesId) return null;
  return linkById(db, row.reversesId);
}

/**
 * What undoes this row: its refunds, or the transfer that reversed it.
 *
 * Ordered newest first, like every other list in the app.
 */
export function reversedBy(
  db: Db,
  id: string
): { links: ReversalLink[]; count: number; totalMinor: number } {
  const rows = linkQuery(db)
    .where(eq(transactions.reversesId, id))
    .orderBy(desc(transactions.occurredAt), desc(transactions.createdAt))
    .all();

  return {
    links: rows.slice(0, LINK_LIMIT).map(toLink),
    count: rows.length,
    // Summed over EVERY match, not over the capped list. A total computed from
    // the rows on screen silently means "the first four of them", which is
    // worse than showing no total at all — the same rule search's totals follow.
    totalMinor: rows.reduce((sum, row) => sum + row.amountMinor, 0),
  };
}
