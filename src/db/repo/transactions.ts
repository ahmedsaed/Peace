import { eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { newId } from '../../lib/id';
import * as schema from '../schema';
import { transactions, type Transaction } from '../schema';
import { InvariantError } from './categories';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export type RecordInput = {
  type: 'expense' | 'income';
  accountId: string;
  categoryId?: string | null;
  /** ALWAYS unsigned. The sign is derived from `type` — see below. */
  amountMinor: number;
  currency?: string;
  fxRate?: number;
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
 * Callers pass an unsigned amount plus a type, and the sign is derived here.
 * Letting callers pass a signed amount invites a positive "expense" that
 * quietly inflates income — the kind of bug you only notice at month end.
 */
export function createRecord(db: Db, input: RecordInput): Transaction {
  assertAmount(input.amountMinor);

  const id = input.id ?? newId();
  const signed = input.type === 'expense' ? -input.amountMinor : input.amountMinor;

  db.insert(transactions)
    .values({
      id,
      accountId: input.accountId,
      categoryId: input.categoryId ?? null,
      amountMinor: signed,
      currency: input.currency ?? 'EGP',
      fxRate: input.fxRate ?? 1,
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
  const shared = {
    amountMinor: input.amountMinor,
    currency: input.currency ?? 'EGP',
    fxRate: input.fxRate ?? 1,
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
        },
        {
          ...shared,
          id: inId,
          accountId: input.toAccountId,
          counterAccountId: input.fromAccountId,
          amountMinor: input.amountMinor,
        },
      ])
      .run();
  });

  return {
    out: db.select().from(transactions).where(eq(transactions.id, outId)).get()!,
    in: db.select().from(transactions).where(eq(transactions.id, inId)).get()!,
  };
}

/**
 * Deletes a record — and if it is one leg of a transfer, its partner too.
 * Deleting a single leg would leave money apparently created or destroyed.
 */
export function deleteRecord(db: Db, id: string): number {
  const row = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!row) return 0;

  if (!row.transferPairId) {
    db.delete(transactions).where(eq(transactions.id, id)).run();
    return 1;
  }

  const pairId = row.transferPairId;
  let deleted = 0;
  db.transaction((tx) => {
    const legs = tx
      .select()
      .from(transactions)
      .where(eq(transactions.transferPairId, pairId))
      .all();
    tx.delete(transactions).where(eq(transactions.transferPairId, pairId)).run();
    deleted = legs.length;
  });
  return deleted;
}
