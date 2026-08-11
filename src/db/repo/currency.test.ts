/**
 * @jest-environment node
 *
 * Mixed currencies. Every assertion here fails against the code as it was
 * before multi-currency — the totals silently added dollars to pounds.
 */
import { createTestDb, type TestDb } from '../../test/db';
import { balanceByCurrency, createAccount, listAccountsWithBalance } from './accounts';
import { periodSummary } from './records';
import { accountId, catId, seedDefaults } from '../seed';
import { createRecord, createTransfer, getRecord, updateRecord } from './transactions';

const AUG = '2026-08';
const at = (day: string) => new Date(`2026-08-${day}T12:00:00`);

describe('mixed currencies', () => {
  let db: TestDb;
  let usdAccount: string;

  beforeEach(() => {
    db = createTestDb().db;
    seedDefaults(db);
    usdAccount = createAccount(db, {
      name: 'Travel card',
      type: 'card',
      currency: 'USD',
      openingBalance: 0,
    }).id;
  });

  it('stores the converted amount alongside the original', () => {
    const record = createRecord(db, {
      type: 'expense',
      accountId: usdAccount,
      categoryId: catId('restaurants'),
      amountMinor: 2599, // $25.99
      currency: 'USD',
      fxRate: 50,
      homeCurrency: 'EGP',
      occurredAt: at('09'),
    });

    // The account moved by what the account actually spent...
    expect(record.amountMinor).toBe(-2599);
    expect(record.currency).toBe('USD');
    // ...and the ledger knows what that was worth: $25.99 x 50 = E£1,299.50
    expect(record.homeAmountMinor).toBe(-129950);
    expect(record.fxRate).toBe(50);
  });

  /**
   * Recorded even when the currencies match. "Converted to pounds" and "not
   * converted at all" have to stay distinguishable, or changing the home
   * currency later relabels history instead of excluding it.
   */
  it('stamps the home currency even on a same-currency record', () => {
    const record = createRecord(db, {
      type: 'expense',
      accountId: accountId('cash'),
      categoryId: null,
      amountMinor: 15500,
      currency: 'EGP',
      homeCurrency: 'EGP',
      occurredAt: at('09'),
    });

    expect(record.homeAmountMinor).toBe(-15500);
    expect(record.homeCurrency).toBe('EGP');
  });

  /**
   * Rows written before multi-currency existed carry neither, and must still
   * count — they were in the home currency by definition.
   */
  it('still values a record that predates conversion', () => {
    const record = createRecord(db, {
      type: 'expense',
      accountId: accountId('cash'),
      categoryId: null,
      amountMinor: 15500,
      currency: 'EGP',
      occurredAt: at('09'),
    });

    expect(record.homeAmountMinor).toBeNull();
    expect(record.homeCurrency).toBeNull();
    expect(periodSummary(db, AUG, 'EGP').expenseMinor).toBe(-15500);
    expect(periodSummary(db, AUG, 'EGP').unvaluedCount).toBe(0);
  });

  /**
   * THE BUG THIS EXISTS TO FIX. Before conversion, the month total added the
   * raw minor units together: $25.99 became 2599 and was summed with piastres,
   * so a month with one dollar purchase reported nonsense.
   */
  it('reports the month in home currency, not by adding raw amounts', () => {
    createRecord(db, {
      type: 'expense',
      accountId: accountId('cash'),
      categoryId: null,
      amountMinor: 10000, // E£100.00
      currency: 'EGP',
      homeCurrency: 'EGP',
      occurredAt: at('09'),
    });
    createRecord(db, {
      type: 'expense',
      accountId: usdAccount,
      categoryId: null,
      amountMinor: 2000, // $20.00 at 50 = E£1,000.00
      currency: 'USD',
      fxRate: 50,
      homeCurrency: 'EGP',
      occurredAt: at('09'),
    });

    const summary = periodSummary(db, AUG, 'EGP');
    // E£100 + E£1,000 = E£1,100. Adding the raw units would have given
    // 10000 + 2000 = 12000, i.e. E£120 — an order of magnitude out.
    expect(summary.expenseMinor).toBe(-110000);
    expect(summary.balanceMinor).toBe(-110000);
  });

  it('converts income too, and the balance nets correctly', () => {
    createRecord(db, {
      type: 'income',
      accountId: usdAccount,
      categoryId: catId('salary'),
      amountMinor: 10000, // $100 at 50 = E£5,000
      currency: 'USD',
      fxRate: 50,
      homeCurrency: 'EGP',
      occurredAt: at('01'),
    });
    createRecord(db, {
      type: 'expense',
      accountId: accountId('cash'),
      categoryId: null,
      amountMinor: 200000, // E£2,000
      currency: 'EGP',
      homeCurrency: 'EGP',
      occurredAt: at('02'),
    });

    const summary = periodSummary(db, AUG, 'EGP');
    expect(summary.incomeMinor).toBe(500000);
    expect(summary.expenseMinor).toBe(-200000);
    expect(summary.balanceMinor).toBe(300000);
  });

  it('keeps each account balance in its own currency', () => {
    createRecord(db, {
      type: 'expense',
      accountId: usdAccount,
      categoryId: null,
      amountMinor: 2500,
      currency: 'USD',
      fxRate: 50,
      homeCurrency: 'EGP',
      occurredAt: at('09'),
    });

    const usd = listAccountsWithBalance(db).find((a) => a.id === usdAccount)!;
    // The card holds dollars. Showing it converted would misstate what is on it.
    expect(usd.balanceMinor).toBe(-2500);
    expect(usd.currency).toBe('USD');
  });

  /**
   * Deliberately NOT one converted number: valuing a whole balance needs a rate
   * for today, and the only rates here belong to individual past records.
   */
  it('groups balances by currency instead of inventing a single total', () => {
    createRecord(db, {
      type: 'expense',
      accountId: usdAccount,
      categoryId: null,
      amountMinor: 2500,
      currency: 'USD',
      fxRate: 50,
      homeCurrency: 'EGP',
      occurredAt: at('09'),
    });
    createRecord(db, {
      type: 'expense',
      accountId: accountId('cash'),
      categoryId: null,
      amountMinor: 10000,
      currency: 'EGP',
      homeCurrency: 'EGP',
      occurredAt: at('09'),
    });

    const totals = balanceByCurrency(db);
    expect(totals).toEqual([
      { currency: 'EGP', balanceMinor: -10000 },
      { currency: 'USD', balanceMinor: -2500 },
    ]);
  });

  it('reads as a single total when everything is in one currency', () => {
    createRecord(db, {
      type: 'expense',
      accountId: accountId('cash'),
      categoryId: null,
      amountMinor: 10000,
      currency: 'EGP',
      homeCurrency: 'EGP',
      occurredAt: at('09'),
    });

    // The normal case has to stay simple: one row, which the screen shows the
    // way it always did.
    const totals = balanceByCurrency(db).filter((t) => t.currency !== 'USD');
    expect(totals).toEqual([{ currency: 'EGP', balanceMinor: -10000 }]);
  });

  it('converts both legs of a foreign transfer', () => {
    const second = createAccount(db, {
      name: 'Travel cash',
      type: 'cash',
      currency: 'USD',
      openingBalance: 0,
    }).id;

    const { out, in: incoming } = createTransfer(db, {
      fromAccountId: usdAccount,
      toAccountId: second,
      amountMinor: 5000, // $50 at 50 = E£2,500
      currency: 'USD',
      fxRate: 50,
      homeCurrency: 'EGP',
      occurredAt: at('05'),
    });

    expect(out.homeAmountMinor).toBe(-250000);
    expect(incoming.homeAmountMinor).toBe(250000);
    // Still nets to zero after conversion — a transfer moves money in any
    // currency, it never creates it.
    expect(out.homeAmountMinor! + incoming.homeAmountMinor!).toBe(0);
  });

  /**
   * The converted amount describes a specific amount at a specific rate. Left
   * untouched while the amount changes, every total would keep quoting the old
   * value — and nothing on screen would show it.
   */
  it('recomputes the converted amount when a record is edited', () => {
    const record = createRecord(db, {
      type: 'expense',
      accountId: usdAccount,
      categoryId: null,
      amountMinor: 1000, // $10 at 50 = E£500
      currency: 'USD',
      fxRate: 50,
      homeCurrency: 'EGP',
      occurredAt: at('09'),
    });
    expect(record.homeAmountMinor).toBe(-50000);

    updateRecord(db, record.id, {
      amountMinor: 2000, // $20
      currency: 'USD',
      fxRate: 50,
      homeCurrency: 'EGP',
    });

    expect(getRecord(db, record.id)!.homeAmountMinor).toBe(-100000);
  });

  it('recomputes when only the rate changes', () => {
    const record = createRecord(db, {
      type: 'expense',
      accountId: usdAccount,
      categoryId: null,
      amountMinor: 1000,
      currency: 'USD',
      fxRate: 50,
      homeCurrency: 'EGP',
      occurredAt: at('09'),
    });

    updateRecord(db, record.id, { currency: 'USD', fxRate: 48, homeCurrency: 'EGP' });
    expect(getRecord(db, record.id)!.homeAmountMinor).toBe(-48000);
  });
  /**
   * Caught by the settings E2E rather than by reasoning: changing the home
   * currency after records exist would otherwise sum pounds into a dollar total
   * and print a dollar sign in front of it.
   */
  it('excludes and counts records it cannot value in the new home currency', () => {
    createRecord(db, {
      type: 'expense',
      accountId: accountId('cash'),
      categoryId: null,
      amountMinor: 10000, // E£100, converted for an EGP home
      currency: 'EGP',
      homeCurrency: 'EGP',
      occurredAt: at('09'),
    });

    // The user switches home currency to USD. That E£100 has no dollar value
    // anyone has supplied, so it must not appear in a dollar total.
    const summary = periodSummary(db, AUG, 'USD');
    expect(summary.expenseMinor).toBe(0);
    expect(summary.unvaluedCount).toBe(1);
  });

  it('keeps valuing records that were converted to the current home currency', () => {
    createRecord(db, {
      type: 'expense',
      accountId: usdAccount,
      categoryId: null,
      amountMinor: 2000,
      currency: 'USD',
      fxRate: 50,
      homeCurrency: 'EGP',
      occurredAt: at('09'),
    });

    expect(periodSummary(db, AUG, 'EGP').expenseMinor).toBe(-100000);
    expect(periodSummary(db, AUG, 'EGP').unvaluedCount).toBe(0);
  });
});
