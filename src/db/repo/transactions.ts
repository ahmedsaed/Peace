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
  /**
   * Money coming back on the expense side — a return, or a friend settling
   * their share. Stored as a POSITIVE amount on an expense-kind row so it nets
   * against the category it reverses.
   *
   * Only meaningful with `type: 'expense'`. A refund of income is not a thing;
   * that is just an expense.
   */
  isRefund?: boolean;
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
  /**
   * The rule that generated this record, when one did.
   *
   * Kept so a generated row can be traced back to its schedule — and so
   * deleting a rule can leave its history alone (the column is `set null`).
   */
  recurringRuleId?: string | null;
  note?: string | null;
  occurredAt?: Date;
  id?: string;
  /**
   * The record this one UNDOES — the purchase a refund hands back, or the
   * outgoing leg of the transfer a reversal cancels.
   *
   * Provenance only. Nothing about the amounts or the totals depends on it, so
   * a pointer at a record that has since been deleted is harmless and simply
   * resolves to nothing. See the column comment in schema.ts for why it is not
   * a foreign key.
   */
  reversesId?: string | null;
};

export type TransferInput = {
  fromAccountId: string;
  toAccountId: string;
  /** Unsigned. */
  amountMinor: number;
  currency?: string;
  fxRate?: number;
  homeCurrency?: string;
  /**
   * The rule that generated this record, when one did.
   *
   * Kept so a generated row can be traced back to its schedule — and so
   * deleting a rule can leave its history alone (the column is `set null`).
   */
  recurringRuleId?: string | null;
  note?: string | null;
  occurredAt?: Date;
  /**
   * The record this one UNDOES — the purchase a refund hands back, or the
   * outgoing leg of the transfer a reversal cancels.
   *
   * Provenance only. Nothing about the amounts or the totals depends on it, so
   * a pointer at a record that has since been deleted is harmless and simply
   * resolves to nothing. See the column comment in schema.ts for why it is not
   * a foreign key.
   */
  reversesId?: string | null;
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
  // A refund is the one expense that is positive. Everything downstream decides
  // sides through predicates.ts rather than by testing this sign, which is what
  // makes that safe.
  const refund = input.type === 'expense' && !!input.isRefund;
  const signed = input.type === 'expense' && !refund ? -input.amountMinor : input.amountMinor;
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
      isRefund: refund,
      note: input.note ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      recurringRuleId: input.recurringRuleId ?? null,
      reversesId: input.reversesId ?? null,
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
    recurringRuleId: input.recurringRuleId ?? null,
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
          // THE OUTGOING LEG ONLY. Both legs exist, but every list renders the
          // negative one and every id a screen holds is that leg's — so writing
          // the pointer on both would make "what reverses this transfer?"
          // answer with the same transfer twice.
          reversesId: input.reversesId ?? null,
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
  /** Carried over from the existing row when not given. */
  isRefund?: boolean;
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

  // NOT `existing.amountMinor < 0`. A refund is the one expense with a positive
  // amount, so inferring the side from the sign would silently turn an edited
  // refund into income — the very bug this feature exists to remove.
  const refund = patch.isRefund ?? existing.isRefund;
  const type = patch.type ?? (refund || existing.amountMinor < 0 ? 'expense' : 'income');
  const unsigned = patch.amountMinor ?? Math.abs(existing.amountMinor);
  assertAmount(unsigned);

  // Recomputed, never carried over: the stored home amount describes a specific
  // amount at a specific rate, so leaving it untouched while the amount changes
  // would leave every total quoting the old value.
  const signedNew = type === 'expense' && !refund ? -unsigned : unsigned;
  const currencyNew = patch.currency ?? existing.currency;
  const fxRateNew = patch.fxRate ?? existing.fxRate;

  db.update(transactions)
    .set({
      accountId: patch.accountId ?? existing.accountId,
      categoryId: patch.categoryId === undefined ? existing.categoryId : patch.categoryId,
      amountMinor: signedNew,
      isRefund: refund,
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

  /**
   * A REVERSAL IS ITS DIRECTION, so redirecting one stops it being that.
   *
   * The claim is not harmless if it goes stale: it marks the ORIGINAL transfer
   * as undone and takes its Reverse action away, while this money now moves
   * between two accounts that have nothing to do with it. Cleared here rather
   * than re-checked, because a transfer cannot BECOME a reversal by being
   * edited into the mirror of one by coincidence.
   *
   * The amount is deliberately not part of this — sending part of it back is a
   * real reversal of part, and the sheet reports how much actually went.
   */
  const redirected = from !== outLeg.accountId || to !== inLeg.accountId;

  db.transaction((tx) => {
    tx.update(transactions)
      .set({
        ...shared,
        accountId: from,
        counterAccountId: to,
        amountMinor: -unsigned,
        ...homeAmount(-unsigned, currencyNew, patch.homeCurrency, fxRateNew),
        ...(redirected ? { reversesId: null } : {}),
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
