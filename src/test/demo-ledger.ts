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
 * in it. Amounts come from a seeded generator, so the same file comes out every
 * time and a screenshot taken today matches one taken next month.
 */
import { createAccount } from '../db/repo/accounts';
import { accountBalance } from '../db/repo/adjust';
import { setBudget } from '../db/repo/budgets';
import { createRule } from '../db/repo/recurring';
import { ensureTag, setRecordTags } from '../db/repo/tags';
import { createRecord, createTransfer } from '../db/repo/transactions';
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

export function buildDemoLedger(db: TestDb, now: Date): DemoSummary {
  seedDefaults(db, 'EGP');
  const rand = generator(20261007);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  /** Whole pounds, in minor units — receipts rarely carry piastres. */
  const pounds = (lo: number, hi: number) => Math.round(between(lo, hi)) * 100;
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];

  const CASH = accountId('cash');
  const BANK = accountId('bank');
  const VISA = createAccount(db, { name: 'Visa', type: 'card', creditLimit: 5_000_000, statementDay: 25, dueDay: 10, icon: 'wallet', color: '#3B4E9E' }).id;
  const SAVINGS = createAccount(db, { name: 'Savings', type: 'savings', openingBalance: 12_000_000, icon: 'bank', color: '#2E7D46' }).id;

  // Opening balances on the seeded accounts, so "Now" starts from something.
  db.$client.prepare('update accounts set opening_balance = ? where id = ?').run(4_500_000, BANK);
  db.$client.prepare('update accounts set opening_balance = ? where id = ?').run(150_000, CASH);

  const trip = ensureTag(db, 'Trip');
  const work = ensureTag(db, 'Work');
  const wedding = ensureTag(db, 'Wedding');

  let records = 0;
  const at = (y: number, m: number, d: number, hour = 12, minute = 0) => new Date(y, m, d, hour, minute);
  const past = (date: Date) => date.getTime() <= now.getTime();

  const spend = (account: string, category: string, minor: number, when: Date, note: string | null = null, tags: string[] = []) => {
    if (!past(when)) return;
    const row = createRecord(db, { type: 'expense', accountId: account, categoryId: catId(category), amountMinor: minor, homeCurrency: 'EGP', occurredAt: when, note });
    if (tags.length > 0) setRecordTags(db, row.id, tags);
    records++;
  };
  const earn = (account: string, category: string, minor: number, when: Date, note: string | null = null, ruleId: string | null = null) => {
    if (!past(when)) return;
    createRecord(db, { type: 'income', accountId: account, categoryId: catId(category), amountMinor: minor, homeCurrency: 'EGP', occurredAt: when, note, recurringRuleId: ruleId });
    records++;
  };
  const move = (from: string, to: string, minor: number, when: Date, note: string, ruleId: string | null = null) => {
    if (!past(when)) return;
    createTransfer(db, { fromAccountId: from, toAccountId: to, amountMinor: minor, homeCurrency: 'EGP', occurredAt: when, note, recurringRuleId: ruleId });
    records++;
  };

  // --- standing orders, a year back, each occurrence posted against its rule ---
  const first = addMonths(periodOf(now), -11);
  const startsOn = (day: number) => `${first}-${String(day).padStart(2, '0')}`;
  const salaryRule = createRule(db, { name: 'Salary', type: 'income', accountId: BANK, categoryId: catId('salary'), amountMinor: 3_200_000, frequency: 'monthly', startsOn: startsOn(1) }).id;
  const rentRule = createRule(db, { name: 'Rent', type: 'expense', accountId: BANK, categoryId: catId('home'), amountMinor: 950_000, frequency: 'monthly', startsOn: startsOn(3) }).id;
  const netflixRule = createRule(db, { name: 'Netflix', type: 'expense', accountId: VISA, categoryId: catId('entertainment'), amountMinor: 25_000, frequency: 'monthly', startsOn: startsOn(12) }).id;
  const savingsRule = createRule(db, { name: 'To savings', type: 'transfer', accountId: BANK, counterAccountId: SAVINGS, amountMinor: 500_000, frequency: 'monthly', startsOn: startsOn(2) }).id;

  for (let i = 11; i >= 0; i--) {
    const period = addMonths(periodOf(now), -i);
    const y = Number(period.slice(0, 4));
    const m = Number(period.slice(5)) - 1;
    const days = new Date(y, m + 1, 0).getDate();
    const day = (lo = 1, hi = days) => Math.floor(between(lo, hi + 1));
    const summer = m >= 5 && m <= 8;

    // Income
    earn(BANK, 'salary', 3_200_000, at(y, m, 1, 9), 'Payroll', salaryRule);
    if (m === 11 || m === 5) earn(BANK, 'bonus', 800_000, at(y, m, 20, 10), 'Half-year bonus');
    if (rand() < 0.3) earn(SAVINGS, 'interest', pounds(600, 900), at(y, m, days, 8), 'Savings interest');

    // Standing orders (rent and Netflix by rule; utilities by hand)
    if (past(at(y, m, 3, 10))) {
      createRecord(db, { type: 'expense', accountId: BANK, categoryId: catId('home'), amountMinor: 950_000, homeCurrency: 'EGP', occurredAt: at(y, m, 3, 10), note: 'Rent', recurringRuleId: rentRule });
      records++;
    }
    if (past(at(y, m, 12, 7))) {
      createRecord(db, { type: 'expense', accountId: VISA, categoryId: catId('entertainment'), amountMinor: 25_000, homeCurrency: 'EGP', occurredAt: at(y, m, 12, 7), note: 'Netflix', recurringRuleId: netflixRule });
      records++;
    }
    move(BANK, SAVINGS, 500_000, at(y, m, 2, 11), 'Monthly saving', savingsRule);
    spend(BANK, 'electricity', pounds(summer ? 850 : 420, summer ? 1300 : 650), at(y, m, day(5, 9), 18), 'Electricity bill');
    spend(BANK, 'internet', 55_000, at(y, m, 6, 18), 'Home internet');
    spend(BANK, 'telephone', pounds(280, 360), at(y, m, 8, 18), 'Mobile plan');

    // Cash out of the machine — a transfer, not spending
    move(BANK, CASH, 200_000, at(y, m, day(1, 6), 13), 'ATM');
    move(BANK, CASH, 200_000, at(y, m, day(14, 19), 13), 'ATM');

    // Groceries: a weekly shop on the card, top-ups in cash
    for (let w = 0; w < 4; w++) spend(VISA, 'groceries', pounds(650, 1400), at(y, m, Math.min(days, 3 + w * 7 + day(0, 2)), 19), pick(['Carrefour', 'Spinneys', 'Gourmet', 'Metro']));
    for (let k = 0; k < 3; k++) spend(CASH, 'groceries', pounds(60, 240), at(y, m, day(), 20), pick(['Bakery', 'Fruit stand', 'Kiosk']));

    // Coffee — creeping up over the year, so month-to-month has a story
    const coffees = Math.round(between(6, 9) + (11 - i) * 0.6);
    for (let k = 0; k < coffees; k++) spend(CASH, 'coffee', pounds(55, 115), at(y, m, day(), 9, day(0, 50)), pick(['Flat white', 'Espresso', 'Iced latte', 'Cappuccino']), rand() < 0.35 ? [work.id] : []);

    // Restaurants
    for (let k = 0; k < Math.round(between(2, 5)); k++) spend(VISA, 'restaurants', pounds(350, 1100), at(y, m, day(), 21), pick(['Zooba', 'Sachi', 'Kazoku', 'Abou El Sid', 'Lunch out']));

    // Fuel: two or three fills, the price stepping up in spring
    const fuelPrice = m >= 2 && m <= 9 ? 1.18 : 1;
    for (let k = 0; k < (rand() < 0.5 ? 2 : 3); k++) spend(VISA, 'fuel', Math.round(between(700, 1050) * fuelPrice) * 100, at(y, m, day(), 17), pick(['Shell', 'Total', 'Wataniya']));

    // Taxis, some of them for work
    for (let k = 0; k < Math.round(between(3, 8)); k++) spend(CASH, 'taxi', pounds(70, 260), at(y, m, day(), 22), 'Uber', rand() < 0.4 ? [work.id] : []);

    // The occasional
    if (rand() < 0.6) spend(VISA, 'shopping', pounds(400, 2600), at(y, m, day(), 16), pick(['Amazon', 'IKEA', 'Electronics', 'Books']));
    if (rand() < 0.4) spend(CASH, 'health', pounds(150, 900), at(y, m, day(), 11), pick(['Pharmacy', 'Dentist', 'Checkup']));
    if (rand() < 0.5) spend(VISA, 'entertainment', pounds(200, 700), at(y, m, day(), 20), pick(['Cinema', 'Concert', 'Bowling']));
    if (rand() < 0.3) spend(CASH, 'car', pounds(300, 1500), at(y, m, day(), 12), pick(['Car wash', 'Oil change', 'Parking']));

    // Clothing, with one return
    if (rand() < 0.45 || m === 3) {
      const when = at(y, m, day(1, 20), 15);
      spend(VISA, 'clothing', pounds(900, 2400), when, pick(['Shoes', 'Jacket', 'Shirts']));
      if (m === 3 && past(at(y, m, when.getDate() + 5, 15))) {
        createRecord(db, { type: 'expense', isRefund: true, accountId: VISA, categoryId: catId('clothing'), amountMinor: 60_000, homeCurrency: 'EGP', occurredAt: at(y, m, when.getDate() + 5, 15), note: 'Returned one pair' });
        records++;
      }
    }

    // December gifts, a summer trip, a spring wedding
    if (m === 11) for (let k = 0; k < 4; k++) spend(VISA, 'gifts', pounds(400, 1500), at(y, m, day(10, 24), 18), pick(['Gift for Mum', 'Gift for Omar', 'Secret Santa', 'Flowers']));
    if (m === 7) {
      spend(VISA, 'travel', 1_450_000, at(y, m, 9, 10), 'Hotel — Dahab, 5 nights', [trip.id]);
      spend(VISA, 'fuel', 120_000, at(y, m, 9, 7), 'Fuel on the road', [trip.id]);
      for (let k = 0; k < 5; k++) spend(CASH, 'restaurants', pounds(300, 800), at(y, m, 10 + k, 20), 'Dinner in Dahab', [trip.id]);
      spend(CASH, 'entertainment', 180_000, at(y, m, 12, 9), 'Diving trip', [trip.id]);
    }
    if (m === 2) {
      spend(VISA, 'clothing', 320_000, at(y, m, 14, 16), 'Suit for the wedding', [wedding.id]);
      spend(VISA, 'gifts', 500_000, at(y, m, 21, 12), 'Wedding gift', [wedding.id]);
      spend(CASH, 'beauty', 60_000, at(y, m, 22, 14), 'Barber', [wedding.id]);
    }

    // Pay the card off in full on statement day. This month's statement has
    // not come yet, so the current month leaves a balance owing — as it would.
    const owed = -accountBalance(db, VISA);
    if (owed > 0) move(BANK, VISA, owed, at(y, m, 25, 12), 'Card payment');
  }

  // Budgets for this month and last, set so the screen shows every state.
  for (const period of [addMonths(periodOf(now), -1), periodOf(now)]) {
    setBudget(db, catId('food'), period, 900_000);
    setBudget(db, catId('transport'), period, 150_000);
    setBudget(db, catId('car'), period, 300_000);
    setBudget(db, catId('shopping'), period, 200_000);
    setBudget(db, catId('entertainment'), period, 100_000);
    setBudget(db, catId('bills'), period, 180_000);
  }

  return { records, months: 12, rules: 4 };
}
