/**
 * @jest-environment node
 *
 * Correcting the detected currency during setup. The starter accounts were
 * seeded in the guess, so they have to follow the correction — and nothing
 * that already holds money may be relabelled.
 */
import { createTestDb, type TestDb } from '../../test/db';
import { accountId, catId, seedDefaults } from '../seed';
import { adoptCurrency, createAccount, getAccount, updateAccount } from './accounts';
import { createRecord } from './transactions';

describe('adoptCurrency', () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb().db;
    seedDefaults(db, 'USD');
  });

  it('moves the untouched starter accounts', () => {
    expect(adoptCurrency(db, 'USD', 'EUR')).toBe(2);
    expect(getAccount(db, accountId('cash'))?.currency).toBe('EUR');
    expect(getAccount(db, accountId('bank'))?.currency).toBe('EUR');
  });

  it('leaves an account with records in the currency its records are in', () => {
    createRecord(db, {
      type: 'expense',
      accountId: accountId('cash'),
      categoryId: catId('restaurants'),
      amountMinor: 1250,
      currency: 'USD',
      homeCurrency: 'USD',
      occurredAt: new Date('2026-08-09T12:00:00'),
    });
    expect(adoptCurrency(db, 'USD', 'EUR')).toBe(1);
    expect(getAccount(db, accountId('cash'))?.currency).toBe('USD');
  });

  it('never relabels an opening balance', () => {
    updateAccount(db, accountId('bank'), { openingBalance: 500000 });
    adoptCurrency(db, 'USD', 'KWD');
    expect(getAccount(db, accountId('bank'))?.currency).toBe('USD');
  });

  it('only touches accounts in the old currency', () => {
    const yen = createAccount(db, { name: 'Tokyo', currency: 'JPY' }).id;
    adoptCurrency(db, 'USD', 'EUR');
    expect(getAccount(db, yen)?.currency).toBe('JPY');
  });

  it('does nothing when the currency did not change', () => {
    expect(adoptCurrency(db, 'USD', 'USD')).toBe(0);
  });
});
