import { asc, eq } from 'drizzle-orm';
import { alias, type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { decimalsFor, minorToMajor } from '../../lib/money';
import * as schema from '../schema';
import { accounts, categories, transactions } from '../schema';
import { ledgerSide } from './predicates';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/**
 * Column order is part of the file's contract. Appending is safe; reordering or
 * renaming breaks every spreadsheet anyone has already built on an export.
 */
export const CSV_HEADER = [
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
  /**
   * Appended, never inserted — see above.
   *
   * `type` reports a refund as `expense`, because its amount is positive and
   * summing the expense side is then correct. That is the right arithmetic and
   * the wrong place to lose the fact, so the fact goes here.
   */
  'is_refund',
  /**
   * Appended for the same reason, and it carries the same weight as
   * `transfer_pair_id` beside it: without it a refund exports as an ordinary
   * positive expense and a reversal as an ordinary transfer, and nothing in the
   * file says which purchase or which transfer they undid. The relationship is
   * in the ledger; a file that drops it is a lossy copy of it.
   */
  'reverses_id',
] as const;

/** Local date and time, split, because a spreadsheet sorts and filters them separately. */
function localParts(date: Date): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    // Deliberately NOT toISOString(): that converts to UTC, so a record logged
    // at 1am Cairo would export under the previous day and every daily total
    // built on the file would be wrong.
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

/**
 * Every record in the ledger, oldest first, as rows ready for `toCsv`.
 *
 * BOTH LEGS OF A TRANSFER ARE EXPORTED, which is the opposite of what the
 * records list does. The list shows one leg because showing two would look like
 * double spending; an export is a copy of the ledger, and dropping a leg would
 * mean the per-account balances in the file no longer add up. `transfer_pair_id`
 * is there so the two can be recognised as one movement.
 *
 * Amounts are decimal major units with no symbol or grouping — the point is for
 * a spreadsheet to read them as numbers. The sign carries the direction, as it
 * does in the database.
 */
export function exportRows(db: Db): string[][] {
  const counter = alias(accounts, 'counter_account');
  const parent = alias(categories, 'parent_category');

  const rows = db
    .select({
      id: transactions.id,
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
      note: transactions.note,
      occurredAt: transactions.occurredAt,
      transferPairId: transactions.transferPairId,
      isAdjustment: transactions.isAdjustment,
      isRefund: transactions.isRefund,
      reversesId: transactions.reversesId,
      accountName: accounts.name,
      counterAccountName: counter.name,
      categoryName: categories.name,
      parentCategoryName: parent.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(counter, eq(counter.id, transactions.counterAccountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(parent, eq(parent.id, categories.parentId))
    .orderBy(asc(transactions.occurredAt))
    .all();

  return rows.map((row) => {
    const { date, time } = localParts(row.occurredAt);

    return [
      date,
      time,
      // NEVER a bare `amountMinor < 0` — a refund is an expense with a positive
      // amount, and a correction is neither side. See `ledgerSide`.
      ledgerSide(row),
      minorToMajor(row.amountMinor, row.currency).toFixed(decimalsFor(row.currency)),
      row.currency,
      row.accountName,
      row.counterAccountName ?? '',
      row.categoryName ?? '',
      row.parentCategoryName ?? '',
      row.note ?? '',
      row.transferPairId ?? '',
      row.id,
      row.isRefund ? '1' : '',
      row.reversesId ?? '',
    ];
  });
}

/** `peace-2026-08-10.csv` — sorts chronologically in a downloads folder. */
export function exportFilename(now: Date, extension: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `peace-${stamp}.${extension}`;
}
