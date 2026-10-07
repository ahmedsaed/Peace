/**
 * A small, realistic ledger for the assistant's tests.
 *
 * Built through the same repository calls the screens use, on a database
 * replayed from the real migrations, so every rule the tools lean on —
 * transfers excluded, refunds netting, corrections apart — is the shipped one.
 *
 * Not a `.test.ts` itself; imported by them.
 */
import { createTestDb, type TestDb } from '../test/db';
import { accountId, catId, seedDefaults } from '../db/seed';
import { ensureTag, setRecordTags } from '../db/repo/tags';
import { createAccount } from '../db/repo/accounts';
import { reconcileAccount } from '../db/repo/adjust';
import { createRecord, createTransfer } from '../db/repo/transactions';
import { decimalsFor } from '../lib/money';
import { FigureBook } from './figures';
import type { ToolContext } from './tools/types';

export const CASH = accountId('cash');
export const BANK = accountId('bank');
export const FUEL = catId('fuel');
export const COFFEE = catId('coffee');
export const FOOD = catId('food');
export const SALARY = catId('salary');
export const CLOTHING = catId('clothing');

export const NOW = new Date(2026, 9, 7, 15, 0); // Wed 7 Oct 2026, the app's "today"

const on = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

export type Ledger = { db: TestDb; ids: Record<string, string> };

export function buildLedger(): Ledger {
  const { db } = createTestDb();
  seedDefaults(db, 'EGP');
  const ids: Record<string, string> = {};

  const spend = (key: string, minor: number, category: string, when: Date, note: string | null = null, account = CASH) => {
    ids[key] = createRecord(db, {
      type: 'expense',
      accountId: account,
      categoryId: category,
      amountMinor: minor,
      homeCurrency: 'EGP',
      occurredAt: when,
      note,
    }).id;
  };

  // Fuel: two fills in December 2025, one in November.
  spend('fuelNov', 80000, FUEL, on(2025, 11, 20), 'Shell');
  spend('fuelDec1', 90000, FUEL, on(2025, 12, 3), 'Shell');
  spend('fuelDec2', 60000, FUEL, on(2025, 12, 28), 'Total');

  // Coffee in Aug and Oct 2026 — September has none.
  spend('coffeeAug', 12000, COFFEE, on(2026, 8, 5), 'Flat white');
  spend('coffeeOct', 15000, COFFEE, on(2026, 10, 2), 'Coffee beans 50% off');

  // Clothing with a refund: E£800 out, E£300 back. Clothing cost E£500.
  spend('shoes', 80000, CLOTHING, on(2026, 10, 1), 'Shoes');
  ids.refund = createRecord(db, {
    type: 'expense',
    isRefund: true,
    accountId: CASH,
    categoryId: CLOTHING,
    amountMinor: 30000,
    homeCurrency: 'EGP',
    occurredAt: on(2026, 10, 3),
    note: 'Returned one pair',
  }).id;

  // Income.
  ids.salary = createRecord(db, {
    type: 'income',
    accountId: BANK,
    categoryId: SALARY,
    amountMinor: 2000000,
    homeCurrency: 'EGP',
    occurredAt: on(2026, 10, 1),
  }).id;

  // A transfer — neither spending nor income.
  ids.atm = createTransfer(db, {
    fromAccountId: BANK,
    toAccountId: CASH,
    amountMinor: 500000,
    homeCurrency: 'EGP',
    occurredAt: on(2026, 10, 4),
    note: 'ATM',
  }).out.id;

  // A balance correction — moves the position, is not spending.
  reconcileAccount(db, CASH, 4_000_000, { occurredAt: on(2026, 10, 5) });

  // Tags.
  const trip = ensureTag(db, 'Trip');
  setRecordTags(db, ids.fuelDec1, [trip.id]);
  setRecordTags(db, ids.coffeeAug, [trip.id]);
  ids.trip = trip.id;

  // A dollar account, for the exchange-rate refusals.
  ids.usd = createAccount(db, { name: 'Dollar card', type: 'card', currency: 'USD' }).id;

  return { db, ids };
}

export function ctxFor(db: TestDb, prefix = 't1'): ToolContext {
  return { db, homeCurrency: 'EGP', now: NOW, figures: new FigureBook(prefix, decimalsFor), attachments: [] };
}
