/**
 * @jest-environment node
 */
import { createTestDb, type TestDb } from '../../test/db';
import { accountBalance } from './adjust';
import { createAccount } from './accounts';
import { categoryBreakdown } from './analysis';
import { BANK_FEES_CATEGORY, createCardPurchase } from './card';
import { InvariantError } from './categories';
import { periodSummary } from './records';
import { deleteRecord, restoreRecords } from './transactions';
import { seedDefaults } from '../seed';

const on = (year: number, month: number, day: number) => new Date(year, month - 1, day, 12, 0);

function seed({ feeBp = 300 }: { feeBp?: number | null } = {}) {
  const { db } = createTestDb();
  seedDefaults(db);
  createAccount(db, {
    id: 'card',
    name: 'Kenana',
    type: 'card',
    currency: 'EGP',
    creditLimit: 5_000_000,
    foreignFeeBp: feeBp,
  });
  createAccount(db, { id: 'plain', name: 'Plain card', type: 'card', currency: 'EGP' });
  return db;
}

describe('a purchase abroad', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
  });

  /**
   * $25 at 49.873 is E£1,246.83; the card's 3% is E£37.40; the statement shows
   * E£1,284.23. Every number on the screen comes from this.
   */
  it('charges the card the settled amount plus the commission', () => {
    const { purchase, fee } = createCardPurchase(db, {
      accountId: 'card',
      categoryId: 'seed:cat:restaurants',
      amountMinor: 2_500,
      originalCurrency: 'USD',
      fxRate: 49.873,
      occurredAt: on(2026, 8, 3),
    });

    expect(purchase.amountMinor).toBe(-124_683);
    expect(fee!.amountMinor).toBe(-3_740);
    expect(accountBalance(db, 'card')).toBe(-128_423);
  });

  /**
   * Store the euros as the account movement and the card balance can never
   * agree with the statement — a permanent, guaranteed drift.
   */
  it('moves the card in the CARD currency, not the one handed over', () => {
    const { purchase } = createCardPurchase(db, {
      accountId: 'card',
      amountMinor: 2_500,
      originalCurrency: 'USD',
      fxRate: 49.873,
      occurredAt: on(2026, 8, 3),
    });
    expect(purchase.currency).toBe('EGP');
  });

  it('keeps what was handed over as metadata', () => {
    const { purchase } = createCardPurchase(db, {
      accountId: 'card',
      amountMinor: 2_500,
      originalCurrency: 'USD',
      fxRate: 49.873,
      occurredAt: on(2026, 8, 3),
    });
    // So "what did this cost in dollars" stays answerable.
    expect(purchase.originalAmountMinor).toBe(2_500);
    expect(purchase.originalCurrency).toBe('USD');
  });

  it('files the commission under Bank fees, not the purchase category', () => {
    // A 3% charge is a bank charge, not food.
    const { fee } = createCardPurchase(db, {
      accountId: 'card',
      categoryId: 'seed:cat:restaurants',
      amountMinor: 2_500,
      originalCurrency: 'USD',
      fxRate: 49.873,
      occurredAt: on(2026, 8, 3),
    });
    expect(fee!.categoryId).toBe(BANK_FEES_CATEGORY);
    expect(fee!.feeForId).toBeTruthy();
  });

  it('says what the commission was for', () => {
    const { fee } = createCardPurchase(db, {
      accountId: 'card',
      amountMinor: 2_500,
      originalCurrency: 'USD',
      fxRate: 49.873,
      occurredAt: on(2026, 8, 3),
    });
    expect(fee!.note).toBe('3% foreign commission');
  });
});

describe('when no fee applies', () => {
  it('writes no fee row for a card with no profile', () => {
    const db = seed();
    const { fee } = createCardPurchase(db, {
      accountId: 'plain',
      amountMinor: 2_500,
      originalCurrency: 'USD',
      fxRate: 49.873,
      occurredAt: on(2026, 8, 3),
    });
    // A card with no fee profile behaves exactly like any other account.
    expect(fee).toBeNull();
  });

  it('writes no fee for a purchase in the card currency', () => {
    const db = seed();
    const { purchase, fee } = createCardPurchase(db, {
      accountId: 'card',
      amountMinor: 50_000,
      occurredAt: on(2026, 8, 3),
    });
    expect(fee).toBeNull();
    expect(purchase.amountMinor).toBe(-50_000);
    // Nothing was handed over in another currency, so there is nothing to note.
    expect(purchase.originalCurrency).toBeNull();
  });

  it('writes no fee when the purchase currency IS the card currency', () => {
    const db = seed();
    const { fee } = createCardPurchase(db, {
      accountId: 'card',
      amountMinor: 50_000,
      originalCurrency: 'egp',
      fxRate: 1,
      occurredAt: on(2026, 8, 3),
    });
    expect(fee).toBeNull();
  });
});

describe('what the totals see', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
    createCardPurchase(db, {
      accountId: 'card',
      categoryId: 'seed:cat:restaurants',
      amountMinor: 2_500,
      originalCurrency: 'USD',
      fxRate: 49.873,
      homeCurrency: 'EGP',
      occurredAt: on(2026, 8, 3),
    });
  });

  it('counts both the purchase and the commission as spending', () => {
    // The commission is real money that left. It is not a correction.
    expect(periodSummary(db, '2026-08').expenseMinor).toBe(-128_423);
  });

  /**
   * The whole reason for two rows: the commission is separately visible, so
   * "what did FX cost me this year" is answerable — and Restaurants is not
   * overstated by a bank charge.
   */
  it('keeps the commission out of the purchase category', () => {
    const breakdown = categoryBreakdown(db, '2026-08', 'expense');
    const byLabel = Object.fromEntries(breakdown.slices.map((s) => [s.label, s.amountMinor]));
    expect(byLabel.Food).toBe(124_683);
    expect(byLabel['Bank fees']).toBe(3_740);
  });
});

/**
 * A cascade the undo buffer does not know about is silent data loss: Undo would
 * put the purchase back and leave the commission gone for good.
 */
describe('deleting a purchase', () => {
  let db: TestDb;
  let purchaseId: string;
  beforeEach(() => {
    db = seed();
    purchaseId = createCardPurchase(db, {
      accountId: 'card',
      categoryId: 'seed:cat:restaurants',
      amountMinor: 2_500,
      originalCurrency: 'USD',
      fxRate: 49.873,
      occurredAt: on(2026, 8, 3),
    }).purchase.id;
  });

  it('takes its commission with it', () => {
    const removed = deleteRecord(db, purchaseId);
    expect(removed).toHaveLength(2);
    expect(accountBalance(db, 'card')).toBe(0);
  });

  it('puts both back on undo', () => {
    const removed = deleteRecord(db, purchaseId);
    restoreRecords(db, removed);
    expect(accountBalance(db, 'card')).toBe(-128_423);
    expect(periodSummary(db, '2026-08').expenseMinor).toBe(-128_423);
  });
});

describe('guards', () => {
  it('refuses a non-positive amount', () => {
    const db = seed();
    for (const amount of [0, -100]) {
      expect(() =>
        createCardPurchase(db, { accountId: 'card', amountMinor: amount })
      ).toThrow(InvariantError);
    }
  });

  it('refuses a fractional amount', () => {
    const db = seed();
    expect(() => createCardPurchase(db, { accountId: 'card', amountMinor: 10.5 })).toThrow(
      InvariantError
    );
  });

  it('refuses an account that does not exist', () => {
    expect(() => createCardPurchase(seed(), { accountId: 'nope', amountMinor: 100 })).toThrow(
      InvariantError
    );
  });
});
