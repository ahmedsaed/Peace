import { eq, or } from 'drizzle-orm';
import { type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { foreignPurchase } from '../../lib/fees';
import { newId } from '../../lib/id';
import { convertMinor } from '../../lib/money';
import * as schema from '../schema';
import { accounts, transactions, type Transaction } from '../schema';
import { InvariantError } from './categories';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/** The seeded category a card's commission is filed under. */
export const BANK_FEES_CATEGORY = 'seed:cat:bank-fees';

export type CardPurchaseInput = {
  accountId: string;
  categoryId?: string | null;
  /** UNSIGNED, in the currency actually handed over. */
  amountMinor: number;
  /** What was handed over — EUR in Rome. Omit for an ordinary purchase. */
  originalCurrency?: string | null;
  /** Card-currency units per one unit of `originalCurrency`. */
  fxRate?: number;
  homeCurrency?: string;
  note?: string | null;
  occurredAt?: Date;
  /** Where the commission is filed. Defaults to the seeded Bank fees category. */
  feeCategoryId?: string | null;
  id?: string;
  feeId?: string;
};

export type CardPurchaseResult = {
  purchase: Transaction;
  /** Null when the card charges no foreign fee. */
  fee: Transaction | null;
};

/**
 * A purchase abroad on a card, with the card's commission as its own record.
 *
 * TWO ROWS, DELIBERATELY. The commission is a real, permanent cost — unlike a
 * provisional Murabaha booking, which reverses on settlement and is not
 * spending at all. Folded into the purchase it would be invisible for ever, and
 * it would overstate whatever category the purchase was filed under: a 3%
 * charge is a bank charge, not food.
 *
 * WHAT MOVES THE CARD IS THE SETTLED AMOUNT IN THE CARD'S CURRENCY. Storing the
 * euros as the account movement would mean the card balance could never agree
 * with the statement — a permanent, guaranteed drift. The euros survive as
 * metadata on the row so "what did this cost in euros" stays answerable.
 *
 * Everything is one transaction: a crash between the purchase and its fee would
 * leave a charge with no commission, understating the card by exactly the
 * amount nobody would think to look for.
 */
export function createCardPurchase(db: Db, input: CardPurchaseInput): CardPurchaseResult {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new InvariantError('A purchase must be a positive integer number of minor units.');
  }

  const account = db.select().from(accounts).where(eq(accounts.id, input.accountId)).get();
  if (!account) throw new InvariantError(`Account "${input.accountId}" does not exist.`);

  const cardCurrency = account.currency;
  const original = input.originalCurrency?.toUpperCase() ?? null;
  const isForeign = original !== null && original !== cardCurrency.toUpperCase();
  const rate = input.fxRate ?? 1;

  // Convert into the card's currency, which is what the bank will charge. The
  // scale term matters even when it looks like it cannot: yen has no minor
  // unit and dinars have three, so the conversion is not just a multiply.
  const settledMinor = isForeign
    ? convertMinor(input.amountMinor, original, cardCurrency, rate)
    : input.amountMinor;

  const { feeMinor } = foreignPurchase(settledMinor, isForeign ? account.foreignFeeBp : null);

  const purchaseId = input.id ?? newId();
  const feeId = input.feeId ?? newId();
  const occurredAt = input.occurredAt ?? new Date();
  const home = input.homeCurrency;

  const homeFor = (signedMinor: number) =>
    home
      ? {
          homeAmountMinor: convertMinor(signedMinor, cardCurrency, home, 1),
          homeCurrency: home.toUpperCase(),
        }
      : { homeAmountMinor: null, homeCurrency: null };

  db.transaction((tx) => {
    tx.insert(transactions)
      .values({
        id: purchaseId,
        accountId: input.accountId,
        categoryId: input.categoryId ?? null,
        amountMinor: -settledMinor,
        currency: cardCurrency,
        fxRate: 1,
        ...homeFor(-settledMinor),
        // Metadata only, never summed — see the schema comment.
        originalAmountMinor: isForeign ? input.amountMinor : null,
        originalCurrency: isForeign ? original : null,
        note: input.note ?? null,
        occurredAt,
      })
      .run();

    if (feeMinor > 0) {
      tx.insert(transactions)
        .values({
          id: feeId,
          accountId: input.accountId,
          categoryId: input.feeCategoryId ?? BANK_FEES_CATEGORY,
          amountMinor: -feeMinor,
          currency: cardCurrency,
          fxRate: 1,
          ...homeFor(-feeMinor),
          feeForId: purchaseId,
          note: `${account.foreignFeeBp! / 100}% foreign commission`,
          occurredAt,
        })
        .run();
    }
  });

  return {
    purchase: db.select().from(transactions).where(eq(transactions.id, purchaseId)).get()!,
    fee:
      feeMinor > 0
        ? db.select().from(transactions).where(eq(transactions.id, feeId)).get()!
        : null,
  };
}

/**
 * A record and any fee charged for it.
 *
 * Used by delete so the two go together. The foreign key cascades, but a
 * cascade the undo buffer does not know about is silent data loss the moment
 * someone taps Undo — it would put the purchase back and leave the fee gone.
 */
export function withFeeRows(db: Db, id: string): Transaction[] {
  return db
    .select()
    .from(transactions)
    .where(or(eq(transactions.id, id), eq(transactions.feeForId, id)))
    .all();
}
