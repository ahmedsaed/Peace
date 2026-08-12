import { eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { newId } from '../../lib/id';
import { convertMinor } from '../../lib/money';
import * as schema from '../schema';
import { transactions, type Transaction } from '../schema';
import { withFeeRows } from './card';
import { InvariantError } from './categories';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export type RecordInput = {
  type: 'expense' | 'income';
  accountId: string;
  categoryId?: string | null;
  /** ALWAYS unsigned. The sign is derived from `type` — see below. */
  amountMinor: number;
  currency?: string;
  /** Home-currency major units per one major unit of `currency`. */
  fxRate?: number;
  /**
   * Needed to convert. Omitting it means "the record is already in the home
   * currency", which is the overwhelmingly common case and keeps every existing
   * caller working unchanged.
   */
  homeCurrency?: string;
  note?: string | null;
  occurredAt?: Date;
  id?: string;
};

export type TransferInput = {
  fromAccountId: string;
  toAccountId: string;
  /** Unsigned. */
  amountMinor: number;
  currency?: string;
  fxRate?: number;
  homeCurrency?: string;
  note?: string | null;
  occurredAt?: Date;
};

function assertAmount(amountMinor: number): void {
  if (!Number.isInteger(amountMinor)) {
    throw new InvariantError('Amount must be an integer number of minor units.');
  }
  if (amountMinor <= 0) {
    throw new InvariantError('Amount must be greater than zero.');
  }
}


/**
 * The signed amount expressed in the home currency, or NULL when no conversion
 * applies.
 *
 * NULL rather than a copy of the amount: it is what lets the column be read as
 * `COALESCE(home_amount_minor, amount_minor)`, so every record written before
 * multi-currency existed is already correct without being touched.
 */
function homeAmount(
  signedMinor: number,
  currency: string,
  homeCurrency: string | undefined,
  fxRate: number
): { homeAmountMinor: number | null; homeCurrency: string | null } {
  if (!homeCurrency) return { homeAmountMinor: null, homeCurrency: null };
  return {
    homeAmountMinor: convertMinor(signedMinor, currency, homeCurrency, fxRate),
    // Stored even when the currencies match, because "converted to EGP" and
    // "not converted at all" have to stay distinguishable after the home
    // currency changes.
    homeCurrency: homeCurrency.toUpperCase(),
  };
}

/**
 * Callers pass an unsigned amount plus a type, and the sign is derived here.
 * Letting callers pass a signed amount invites a positive "expense" that
 * quietly inflates income — the kind of bug you only notice at month end.
 */
export function createRecord(db: Db, input: RecordInput): Transaction {
  assertAmount(input.amountMinor);

  const id = input.id ?? newId();
  const signed = input.type === 'expense' ? -input.amountMinor : input.amountMinor;
  const currency = input.currency ?? 'EGP';
  const fxRate = input.fxRate ?? 1;

  db.insert(transactions)
    .values({
      id,
      accountId: input.accountId,
      categoryId: input.categoryId ?? null,
      amountMinor: signed,
      currency,
      fxRate,
      ...homeAmount(signed, currency, input.homeCurrency, fxRate),
      note: input.note ?? null,
      occurredAt: input.occurredAt ?? new Date(),
    })
    .run();

  return db.select().from(transactions).where(eq(transactions.id, id)).get()!;
}

/**
 * Writes BOTH legs of a transfer inside one SQL transaction.
 *
 * Atomicity is the whole point: a crash between the two inserts would leave a
 * negative row with no matching positive one, which reads as an expense that
 * never happened and silently changes net worth. Nothing outside this function
 * may write a `transfer_pair_id`.
 */
export function createTransfer(db: Db, input: TransferInput): { out: Transaction; in: Transaction } {
  assertAmount(input.amountMinor);

  if (input.fromAccountId === input.toAccountId) {
    throw new InvariantError('A transfer needs two different accounts.');
  }

  const pairId = newId();
  const outId = newId();
  const inId = newId();
  const occurredAt = input.occurredAt ?? new Date();
  const currency = input.currency ?? 'EGP';
  const fxRate = input.fxRate ?? 1;
  const shared = {
    amountMinor: input.amountMinor,
    currency,
    fxRate,
    note: input.note ?? null,
    occurredAt,
    transferPairId: pairId,
    // A transfer has no category by definition — it is not spending.
    categoryId: null,
  };

  db.transaction((tx) => {
    tx.insert(transactions)
      .values([
        {
          ...shared,
          id: outId,
          accountId: input.fromAccountId,
          counterAccountId: input.toAccountId,
          amountMinor: -input.amountMinor,
          ...homeAmount(-input.amountMinor, currency, input.homeCurrency, fxRate),
        },
        {
          ...shared,
          id: inId,
          accountId: input.toAccountId,
          counterAccountId: input.fromAccountId,
          amountMinor: input.amountMinor,
          ...homeAmount(input.amountMinor, currency, input.homeCurrency, fxRate),
        },
      ])
      .run();
  });

  return {
    out: db.select().from(transactions).where(eq(transactions.id, outId)).get()!,
    in: db.select().from(transactions).where(eq(transactions.id, inId)).get()!,
  };
}

export function getRecord(db: Db, id: string): Transaction | undefined {
  return db.select().from(transactions).where(eq(transactions.id, id)).get();
}

export type RecordPatch = {
  type?: 'expense' | 'income';
  accountId?: string;
  categoryId?: string | null;
  /** Unsigned, like createRecord. */
  amountMinor?: number;
  currency?: string;
  fxRate?: number;
  homeCurrency?: string;
  note?: string | null;
  occurredAt?: Date;
};

/**
 * Edit a normal record.
 *
 * Type and amount are resolved together: the stored sign always follows the
 * type, so correcting an expense to income flips it without the caller having
 * to think about signs at all.
 *
 * A transfer cannot be edited here — its two legs must stay consistent, which
 * is `updateTransfer`'s job. Converting between a record and a transfer is
 * deliberately not supported: it changes how many rows exist, and "delete and
 * re-add" is clearer than a silent restructure.
 */
export function updateRecord(db: Db, id: string, patch: RecordPatch): Transaction {
  const existing = getRecord(db, id);
  if (!existing) throw new InvariantError(`Record "${id}" does not exist.`);
  if (existing.transferPairId) {
    throw new InvariantError('This is a transfer — edit it as a transfer, not as a record.');
  }

  const type = patch.type ?? (existing.amountMinor < 0 ? 'expense' : 'income');
  const unsigned = patch.amountMinor ?? Math.abs(existing.amountMinor);
  assertAmount(unsigned);

  // Recomputed, never carried over: the stored home amount describes a specific
  // amount at a specific rate, so leaving it untouched while the amount changes
  // would leave every total quoting the old value.
  const signedNew = type === 'expense' ? -unsigned : unsigned;
  const currencyNew = patch.currency ?? existing.currency;
  const fxRateNew = patch.fxRate ?? existing.fxRate;

  db.update(transactions)
    .set({
      accountId: patch.accountId ?? existing.accountId,
      categoryId: patch.categoryId === undefined ? existing.categoryId : patch.categoryId,
      amountMinor: signedNew,
      currency: currencyNew,
      fxRate: fxRateNew,
      ...homeAmount(signedNew, currencyNew, patch.homeCurrency, fxRateNew),
      note: patch.note === undefined ? existing.note : patch.note,
      occurredAt: patch.occurredAt ?? existing.occurredAt,
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, id))
    .run();

  return getRecord(db, id)!;
}

export type TransferPatch = {
  fromAccountId?: string;
  toAccountId?: string;
  amountMinor?: number;
  currency?: string;
  fxRate?: number;
  homeCurrency?: string;
  note?: string | null;
  occurredAt?: Date;
};

/**
 * Edit a transfer, given either of its legs.
 *
 * Both rows are rewritten inside one SQL transaction. Updating one leg alone
 * would break the invariant that a transfer nets to zero — the ledger would
 * quietly gain or lose money.
 */
export function updateTransfer(
  db: Db,
  id: string,
  patch: TransferPatch
): { out: Transaction; in: Transaction } {
  const leg = getRecord(db, id);
  if (!leg) throw new InvariantError(`Record "${id}" does not exist.`);
  if (!leg.transferPairId) {
    throw new InvariantError('This is not a transfer.');
  }

  const legs = db
    .select()
    .from(transactions)
    .where(eq(transactions.transferPairId, leg.transferPairId))
    .all();
  const outLeg = legs.find((l) => l.amountMinor < 0);
  const inLeg = legs.find((l) => l.amountMinor > 0);
  if (!outLeg || !inLeg) {
    throw new InvariantError('This transfer is missing a leg and cannot be edited.');
  }

  const from = patch.fromAccountId ?? outLeg.accountId;
  const to = patch.toAccountId ?? inLeg.accountId;
  if (from === to) throw new InvariantError('A transfer needs two different accounts.');

  const unsigned = patch.amountMinor ?? Math.abs(outLeg.amountMinor);
  assertAmount(unsigned);

  const currencyNew = patch.currency ?? outLeg.currency;
  const fxRateNew = patch.fxRate ?? outLeg.fxRate;
  const shared = {
    currency: currencyNew,
    fxRate: fxRateNew,
    note: patch.note === undefined ? outLeg.note : patch.note,
    occurredAt: patch.occurredAt ?? outLeg.occurredAt,
    updatedAt: new Date(),
  };

  db.transaction((tx) => {
    tx.update(transactions)
      .set({
        ...shared,
        accountId: from,
        counterAccountId: to,
        amountMinor: -unsigned,
        ...homeAmount(-unsigned, currencyNew, patch.homeCurrency, fxRateNew),
      })
      .where(eq(transactions.id, outLeg.id))
      .run();
    tx.update(transactions)
      .set({
        ...shared,
        accountId: to,
        counterAccountId: from,
        amountMinor: unsigned,
        ...homeAmount(unsigned, currencyNew, patch.homeCurrency, fxRateNew),
      })
      .where(eq(transactions.id, inLeg.id))
      .run();
  });

  return { out: getRecord(db, outLeg.id)!, in: getRecord(db, inLeg.id)! };
}

/**
 * Deletes a record — and if it is one leg of a transfer, its partner too.
 * Deleting a single leg would leave money apparently created or destroyed.
 *
 * Returns the rows that were removed, which is what makes undo possible without
 * a soft-delete column: the caller holds them and can hand them straight back
 * to `restoreRecords`.
 */
export function deleteRecord(db: Db, id: string): Transaction[] {
  const row = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!row) return [];

  if (!row.transferPairId) {
    // A card fee belongs to the purchase that incurred it, so the two are
    // deleted and restored as one. Returning only the purchase would put half
    // of it back on Undo and leave the commission gone for good.
    let removed: Transaction[] = [];
    db.transaction((tx) => {
      removed = withFeeRows(tx as Db, id);
      tx.delete(transactions).where(eq(transactions.feeForId, id)).run();
      tx.delete(transactions).where(eq(transactions.id, id)).run();
    });
    return removed;
  }

  const pairId = row.transferPairId;
  let removed: Transaction[] = [];
  db.transaction((tx) => {
    removed = tx
      .select()
      .from(transactions)
      .where(eq(transactions.transferPairId, pairId))
      .all();
    tx.delete(transactions).where(eq(transactions.transferPairId, pairId)).run();
  });
  return removed;
}

/**
 * Puts deleted rows back, ids and all, so undo restores the original record
 * rather than a copy of it. Both legs of a transfer go back together or neither
 * does — a half-restored transfer is worse than none.
 *
 * Re-inserting a row whose account or category has since been deleted would
 * violate a foreign key; that throws, and the caller should treat undo as no
 * longer available rather than swallow it.
 */
export function restoreRecords(db: Db, rows: Transaction[]): number {
  if (rows.length === 0) return 0;
  db.transaction((tx) => {
    tx.insert(transactions).values(rows).run();
  });
  return rows.length;
}
