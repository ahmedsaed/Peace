/**
 * A year of invented, plausible spending — for looking at the app with
 * something in it, not for asserting exact figures.
 *
 * Built through the SAME repository calls the screens use, on a database
 * replayed from the real migrations, so every row is shaped exactly like one a
 * person entered: home values set, transfers paired, refunds on the expense
 * side, standing orders posted against their rules so none of them shows up as
 * "due". Written out as a bare `.db`, which Restore accepts as a backup.
 *
 *   npm run demo:ledger      → .demo/peace-demo.db, pushed to the device's Download
 *
 * THE LEDGER IS INVENTED. The repository is public and real records do not go
 * in it. It is in US DOLLARS with no country's shops or places in it, because
 * what it renders becomes the README, the website and the Play listing. Amounts come from a seeded generator, so the same file comes out every
 * time and a screenshot taken today matches one taken next month.
 */
import { createAccount } from '../db/repo/accounts';
import { accountBalance } from '../db/repo/adjust';
import { setBudget } from '../db/repo/budgets';
import { createRule } from '../db/repo/recurring';
import { ensureTag, setRecordTags } from '../db/repo/tags';
import { createRecord, createTransfer } from '../db/repo/transactions';
import { settings } from '../db/schema';
import { accountId, catId, seedDefaults } from '../db/seed';
import { addMonths, periodOf } from '../lib/period';
import type { TestDb } from './db';

/** mulberry32 — tiny, seeded, and the same on every machine. */
function generator(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type DemoSummary = { records: number; months: number; rules: number };

/** The ledger's home currency — and the `homeCurrency` setting a restore brings with it. */
export const DEMO_CURRENCY = 'USD';

export function buildDemoLedger(db: TestDb, now: Date): DemoSummary {
  seedDefaults(db, DEMO_CURRENCY);
  // Written INTO the file, because Restore replaces the settings table: without
  // this row a restored ledger falls back to the built-in default currency and
  // every dollar on screen is labelled as something else.
  db.insert(settings).values({ key: 'homeCurrency', value: DEMO_CURRENCY, updatedAt: new Date() }).run();
  const rand = generator(20261007);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  /** Dollars and cents, in minor units. */
  const dollars = (lo: number, hi: number) => Math.round(between(lo, hi) * 100);
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];

  const CASH = accountId('cash');
  const BANK = accountId('bank');
  const VISA = createAccount(db, { name: 'Visa', type: 'card', currency: DEMO_CURRENCY, creditLimit: 500_000, statementDay: 25, dueDay: 10, icon: 'wallet', color: '#3B4E9E' }).id;
  const SAVINGS = createAccount(db, { name: 'Savings', type: 'savings', currency: DEMO_CURRENCY, openingBalance: 900_000, icon: 'bank', color: '#2E7D46' }).id;

  // Opening balances on the seeded accounts, so "Now" starts from something.
  db.$client.prepare('update accounts set opening_balance = ? where id = ?').run(400_000, BANK);
  db.$client.prepare('update accounts set opening_balance = ? where id = ?').run(12_000, CASH);

  const trip = ensureTag(db, 'Trip');
  const work = ensureTag(db, 'Work');
  const wedding = ensureTag(db, 'Wedding');

  let records = 0;
  const at = (y: number, m: number, d: number, hour = 12, minute = 0) => new Date(y, m, d, hour, minute);
  const past = (date: Date) => date.getTime() <= now.getTime();

  const spend = (account: string, category: string, minor: number, when: Date, note: string | null = null, tags: string[] = []) => {
    if (!past(when)) return;
    const row = createRecord(db, { type: 'expense', accountId: account, categoryId: catId(category), amountMinor: minor, currency: DEMO_CURRENCY, homeCurrency: DEMO_CURRENCY, occurredAt: when, note });
    if (tags.length > 0) setRecordTags(db, row.id, tags);
    records++;
  };
  const earn = (account: string, category: string, minor: number, when: Date, note: string | null = null, ruleId: string | null = null) => {
    if (!past(when)) return;
    createRecord(db, { type: 'income', accountId: account, categoryId: catId(category), amountMinor: minor, currency: DEMO_CURRENCY, homeCurrency: DEMO_CURRENCY, occurredAt: when, note, recurringRuleId: ruleId });
    records++;
  };
  const move = (from: string, to: string, minor: number, when: Date, note: string, ruleId: string | null = null) => {
    if (!past(when)) return;
    createTransfer(db, { fromAccountId: from, toAccountId: to, amountMinor: minor, currency: DEMO_CURRENCY, homeCurrency: DEMO_CURRENCY, occurredAt: when, note, recurringRuleId: ruleId });
    records++;
  };

  // --- standing orders, a year back, each occurrence posted against its rule ---
  const first = addMonths(periodOf(now), -11);
  const startsOn = (day: number) => `${first}-${String(day).padStart(2, '0')}`;
  const salaryRule = createRule(db, { name: 'Salary', type: 'income', accountId: BANK, categoryId: catId('salary'), amountMinor: 520_000, frequency: 'monthly', startsOn: startsOn(1), currency: DEMO_CURRENCY }).id;
  const rentRule = createRule(db, { name: 'Rent', type: 'expense', accountId: BANK, categoryId: catId('home'), amountMinor: 160_000, frequency: 'monthly', startsOn: startsOn(3), currency: DEMO_CURRENCY }).id;
  const netflixRule = createRule(db, { name: 'Netflix', type: 'expense', accountId: VISA, categoryId: catId('entertainment'), amountMinor: 1_549, frequency: 'monthly', startsOn: startsOn(12), currency: DEMO_CURRENCY }).id;
  const savingsRule = createRule(db, { name: 'To savings', type: 'transfer', accountId: BANK, counterAccountId: SAVINGS, amountMinor: 60_000, frequency: 'monthly', startsOn: startsOn(2), currency: DEMO_CURRENCY }).id;

  for (let i = 11; i >= 0; i--) {
    const period = addMonths(periodOf(now), -i);
    const y = Number(period.slice(0, 4));
    const m = Number(period.slice(5)) - 1;
    const days = new Date(y, m + 1, 0).getDate();
    const day = (lo = 1, hi = days) => Math.floor(between(lo, hi + 1));
    const summer = m >= 5 && m <= 8;

    // Income
    earn(BANK, 'salary', 520_000, at(y, m, 1, 9), 'Payroll', salaryRule);
    if (m === 11 || m === 5) earn(BANK, 'bonus', 150_000, at(y, m, 20, 10), 'Half-year bonus');
    if (rand() < 0.3) earn(SAVINGS, 'interest', dollars(12, 25), at(y, m, days, 8), 'Savings interest');

    // Standing orders (rent and Netflix by rule; utilities by hand)
    if (past(at(y, m, 3, 10))) {
      createRecord(db, { type: 'expense', accountId: BANK, categoryId: catId('home'), amountMinor: 160_000, currency: DEMO_CURRENCY, homeCurrency: DEMO_CURRENCY, occurredAt: at(y, m, 3, 10), note: 'Rent', recurringRuleId: rentRule });
      records++;
    }
    if (past(at(y, m, 12, 7))) {
      createRecord(db, { type: 'expense', accountId: VISA, categoryId: catId('entertainment'), amountMinor: 1_549, currency: DEMO_CURRENCY, homeCurrency: DEMO_CURRENCY, occurredAt: at(y, m, 12, 7), note: 'Netflix', recurringRuleId: netflixRule });
      records++;
    }
    move(BANK, SAVINGS, 60_000, at(y, m, 2, 11), 'Monthly saving', savingsRule);
    spend(BANK, 'electricity', dollars(summer ? 120 : 70, summer ? 180 : 105), at(y, m, day(5, 9), 18), 'Electricity bill');
    spend(BANK, 'internet', 6_000, at(y, m, 6, 18), 'Home internet');
    spend(BANK, 'telephone', dollars(35, 45), at(y, m, 8, 18), 'Mobile plan');

    // Cash out of the machine — a transfer, not spending
    move(BANK, CASH, 20_000, at(y, m, day(1, 6), 13), 'ATM');
    move(BANK, CASH, 20_000, at(y, m, day(14, 19), 13), 'ATM');

    // Groceries: a weekly shop on the card, top-ups in cash
    for (let w = 0; w < 4; w++) spend(VISA, 'groceries', dollars(60, 140), at(y, m, Math.min(days, 3 + w * 7 + day(0, 2)), 19), pick(['Supermarket', 'Farmers market', 'Wholesale club', 'Organic shop']));
    for (let k = 0; k < 3; k++) spend(CASH, 'groceries', dollars(5, 22), at(y, m, day(), 20), pick(['Bakery', 'Fruit stand', 'Corner shop']));

    // Coffee — creeping up over the year, so month-to-month has a story
    const coffees = Math.round(between(6, 9) + (11 - i) * 0.6);
    for (let k = 0; k < coffees; k++) spend(CASH, 'coffee', dollars(3.5, 6.5), at(y, m, day(), 9, day(0, 50)), pick(['Flat white', 'Espresso', 'Iced latte', 'Cappuccino']), rand() < 0.35 ? [work.id] : []);

    // Restaurants
    for (let k = 0; k < Math.round(between(2, 5)); k++) spend(VISA, 'restaurants', dollars(25, 85), at(y, m, day(), 21), pick(['Thai place', 'Pizza night', 'Sushi bar', 'Burger joint', 'Lunch out']));

    // Fuel: two or three fills, the price stepping up in spring
    const fuelPrice = m >= 2 && m <= 9 ? 1.18 : 1;
    for (let k = 0; k < (rand() < 0.5 ? 2 : 3); k++) spend(VISA, 'fuel', Math.round(between(45, 65) * fuelPrice * 100), at(y, m, day(), 17), pick(['Gas station', 'Fill-up', 'Fuel']));

    // Taxis, some of them for work
    for (let k = 0; k < Math.round(between(3, 8)); k++) spend(CASH, 'taxi', dollars(9, 30), at(y, m, day(), 22), 'Ride home', rand() < 0.4 ? [work.id] : []);

    // The occasional
    if (rand() < 0.6) spend(VISA, 'shopping', dollars(30, 200), at(y, m, day(), 16), pick(['Online order', 'Furniture', 'Electronics', 'Books']));
    if (rand() < 0.4) spend(CASH, 'health', dollars(15, 90), at(y, m, day(), 11), pick(['Pharmacy', 'Dentist', 'Checkup']));
    if (rand() < 0.5) spend(VISA, 'entertainment', dollars(15, 50), at(y, m, day(), 20), pick(['Cinema', 'Concert', 'Bowling']));
    if (rand() < 0.3) spend(CASH, 'car', dollars(20, 120), at(y, m, day(), 12), pick(['Car wash', 'Oil change', 'Parking']));

    // Clothing, with one return
    if (rand() < 0.45 || m === 3) {
      const when = at(y, m, day(1, 20), 15);
      spend(VISA, 'clothing', dollars(40, 150), when, pick(['Shoes', 'Jacket', 'Shirts']));
      if (m === 3 && past(at(y, m, when.getDate() + 5, 15))) {
        createRecord(db, { type: 'expense', isRefund: true, accountId: VISA, categoryId: catId('clothing'), amountMinor: 4_500, currency: DEMO_CURRENCY, homeCurrency: DEMO_CURRENCY, occurredAt: at(y, m, when.getDate() + 5, 15), note: 'Returned one pair' });
        records++;
      }
    }

    // December gifts, a summer trip, a spring wedding
    if (m === 11) for (let k = 0; k < 4; k++) spend(VISA, 'gifts', dollars(25, 90), at(y, m, day(10, 24), 18), pick(['Gift for Mum', 'Gift for Sam', 'Secret Santa', 'Flowers']));
    if (m === 7) {
      spend(VISA, 'travel', 115_000, at(y, m, 9, 10), 'Hotel by the sea, 5 nights', [trip.id]);
      spend(VISA, 'fuel', 8_500, at(y, m, 9, 7), 'Fuel on the road', [trip.id]);
      for (let k = 0; k < 5; k++) spend(CASH, 'restaurants', dollars(30, 70), at(y, m, 10 + k, 20), 'Dinner on the trip', [trip.id]);
      spend(CASH, 'entertainment', 14_000, at(y, m, 12, 9), 'Diving trip', [trip.id]);
    }
    if (m === 2) {
      spend(VISA, 'clothing', 32_000, at(y, m, 14, 16), 'Suit for the wedding', [wedding.id]);
      spend(VISA, 'gifts', 20_000, at(y, m, 21, 12), 'Wedding gift', [wedding.id]);
      spend(CASH, 'beauty', 3_500, at(y, m, 22, 14), 'Barber', [wedding.id]);
    }

    // Pay the card off in full on statement day. This month's statement has
    // not come yet, so the current month leaves a balance owing — as it would.
    const owed = -accountBalance(db, VISA);
    if (owed > 0) move(BANK, VISA, owed, at(y, m, 25, 12), 'Card payment');
  }

  // Budgets for this month and last, set so the screen shows every state.
  for (const period of [addMonths(periodOf(now), -1), periodOf(now)]) {
    setBudget(db, catId('food'), period, 70_000, DEMO_CURRENCY);
    setBudget(db, catId('transport'), period, 12_000, DEMO_CURRENCY);
    setBudget(db, catId('car'), period, 25_000, DEMO_CURRENCY);
    setBudget(db, catId('shopping'), period, 15_000, DEMO_CURRENCY);
    setBudget(db, catId('entertainment'), period, 8_000, DEMO_CURRENCY);
    setBudget(db, catId('bills'), period, 25_000, DEMO_CURRENCY);
  }

  return { records, months: 12, rules: 4 };
}
