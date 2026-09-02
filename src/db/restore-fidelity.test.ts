/**
 * @jest-environment node
 *
 * Does a restored ledger still MEAN the same thing?
 *
 * `copyFromBackup` intersects the columns of the two schemas at run time, so a
 * column added by a later migration copies itself with no code change. That is
 * the right design — and it is also the reason nobody notices when it stops
 * being true, because there is no list to review and nothing to forget to
 * update. Every feature added since restore was written has quietly relied on
 * it: credit limits, per-card fee rates, refunds, balance corrections, fee rows
 * linked to their purchase, foreign-currency metadata, budgets.
 *
 * So this file does not assert that columns exist. It builds a ledger using
 * every one of those features, records the numbers the SCREENS would show, puts
 * the whole thing through a restore, and demands the same numbers back. A
 * column silently dropped shows up here as a total that changed — which is what
 * the user would actually notice, three weeks later, with no way to tell which
 * screen was lying.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { openBackupPayload } from '../lib/backup-payload';
import { packContainer } from '../lib/container';
import * as schema from './schema';
import { copyFromBackup, validateBackup } from './restore-core';
import { addAttachment, listAttachments, missingFiles } from './repo/attachments';
import { accountId, catId, seedDefaults } from './seed';
import { createAccount, getAccount, listAccountsWithBalance } from './repo/accounts';
import { accountBalance, reconcileAccount } from './repo/adjust';
import { categoryBreakdown } from './repo/analysis';
import { listBudgets, setBudget } from './repo/budgets';
import { createCardPurchase, withFeeRows } from './repo/card';
import { broughtForward, totalHeld } from './repo/carry';
import { reversedBy, reverses } from './repo/reversal';
import { ensureTag, setRecordTags, tagBreakdown, tagsForRecord } from './repo/tags';
import {
  createAssetClass,
  createHolding,
  portfolioSnapshot,
} from './repo/portfolio';
import { periodSummary } from './repo/records';
import { createRecord, createTransfer } from './repo/transactions';

const MIGRATIONS = path.resolve(__dirname, '../../drizzle');
const PERIOD = '2026-08';
const CARD = 'acct-kenana';

function migrate(sqlite: Database.Database) {
  sqlite.pragma('foreign_keys = ON');
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    for (const statement of fs
      .readFileSync(path.join(MIGRATIONS, file), 'utf8')
      .split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)'
  );
  for (let i = 0; i < files.length; i++) {
    sqlite
      .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run(`m${i}`, i);
  }
}

function makeDb(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peace-fidelity-'));
  const file = path.join(dir, name);
  const sqlite = new Database(file);
  migrate(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }), file };
}

type Db = ReturnType<typeof makeDb>['db'];

/**
 * A ledger that uses every feature added after restore was written.
 *
 * Deliberately not tidy: a card with a limit and two different fee rates, a
 * foreign purchase that generates its own commission row, a refund, a
 * correction that must not count as spending, and a budget over the top of it.
 */
function buildLedger(db: Db) {
  seedDefaults(db);

  createAccount(db, {
    id: CARD,
    name: 'Kenana',
    type: 'card',
    currency: 'EGP',
    creditLimit: 50_000_00,
    foreignFeeBp: 300,
    cashFeeBp: 500,
    statementDay: 25,
    dueDay: 15,
  });

  // A foreign purchase: original amount and currency are metadata, and the
  // commission is written as its own row linked back to the purchase.
  // €100 at 50 EGP/€ is 5,000.00 on the card, plus 3% = 150.00 commission.
  createCardPurchase(db, {
    id: 'txn-rome',
    feeId: 'txn-rome-fee',
    accountId: CARD,
    categoryId: catId('restaurants'),
    amountMinor: 100_00,
    originalCurrency: 'EUR',
    fxRate: 50,
    occurredAt: new Date('2026-08-04T19:00:00'),
  });

  // An ordinary purchase, later partly refunded.
  createRecord(db, {
    id: 'txn-jacket',
    type: 'expense',
    accountId: accountId('bank'),
    categoryId: catId('clothing'),
    amountMinor: 800_00,
    currency: 'EGP',
    occurredAt: new Date('2026-08-06T12:00:00'),
  });
  createRecord(db, {
    id: 'txn-jacket-refund',
    type: 'expense',
    isRefund: true,
    accountId: accountId('bank'),
    categoryId: catId('clothing'),
    amountMinor: 300_00,
    currency: 'EGP',
    occurredAt: new Date('2026-08-09T12:00:00'),
    // Which purchase it hands back. Pure provenance — it moves no total, which
    // is exactly why the snapshot has to name it explicitly.
    reversesId: 'txn-jacket',
  });

  // A label on two records in DIFFERENT categories — the thing a category
  // cannot express, and the reason tags exist. It moves no total, which is why
  // the snapshot has to name it.
  const kitchen = ensureTag(db, 'Kitchen reno');
  setRecordTags(db, 'txn-jacket', [kitchen.id]);
  setRecordTags(db, 'txn-rome', [kitchen.id]);

  createTransfer(db, {
    fromAccountId: accountId('bank'),
    toAccountId: accountId('cash'),
    amountMinor: 1_000_00,
    currency: 'EGP',
    note: null,
    occurredAt: new Date('2026-08-05T10:00:00'),
  });

  // The card drifted; correcting it moves money without being spending.
  reconcileAccount(db, CARD, -1_500_00, {
    id: 'txn-correction',
    occurredAt: new Date('2026-08-10T09:00:00'),
  });

  // Budgets sit on TOP-LEVEL categories; Restaurants rolls up into Food.
  setBudget(db, catId('food'), PERIOD, 8_000_00);
  setBudget(db, catId('clothing'), PERIOD, 1_000_00);

  // The portfolio keeps its own tables and never touches the ledger — which is
  // exactly why it is easy to forget in a restore. `copyFromBackup` picks up a
  // new COLUMN on its own; a new TABLE has to be listed in RESTORE_TABLES by
  // hand, so it is the one thing here with no automatic safety net.
  createAssetClass(db, { id: 'pf-stocks', name: 'Stocks', targetBp: 6_000 });
  createAssetClass(db, { id: 'pf-bonds', name: 'Bonds', targetBp: 4_000 });
  createHolding(db, {
    id: 'pf-fund',
    name: 'Index fund',
    assetClassId: 'pf-stocks',
    unitsMicro: 12_347_000,
    priceMinor: 4_183,
  });

  // A receipt on the jacket. The ROW is ordinary data; what makes attachments
  // different is that it names a file which has to travel separately.
  addAttachment(db, {
    transactionId: 'txn-jacket',
    fileName: `${RECEIPT_HASH}.jpg`,
    originalName: 'jacket-receipt.jpg',
    mimeType: 'image/jpeg',
    byteSize: RECEIPT_BYTES.byteLength,
    sha256: RECEIPT_HASH,
  });
}

const RECEIPT_HASH = 'c0ffee'.padEnd(64, '0');
const RECEIPT_BYTES = new Uint8Array([...'a receipt photo'].map((c) => c.charCodeAt(0)));

/**
 * Every number a screen would show, in one object.
 *
 * Comparing these wholesale rather than field by field means a column dropped
 * by a future migration fails this test without anyone having remembered to add
 * an assertion for it.
 */
function snapshot(db: Db) {
  const card = getAccount(db, CARD);
  return {
    summary: periodSummary(db, PERIOD),
    expenseByCategory: categoryBreakdown(db, PERIOD, 'expense'),
    incomeByCategory: categoryBreakdown(db, PERIOD, 'income'),
    budgets: listBudgets(db, PERIOD),
    broughtForward: broughtForward(db, PERIOD),
    totalHeld: totalHeld(db),
    accounts: listAccountsWithBalance(db),
    cardBalance: accountBalance(db, CARD),
    // The card PROFILE never reaches a total, so a dropped column here would
    // be invisible to every figure above — and would silently stop computing
    // commission on the next foreign purchase.
    cardProfile: {
      creditLimit: card?.creditLimit,
      foreignFeeBp: card?.foreignFeeBp,
      cashFeeBp: card?.cashFeeBp,
      statementDay: card?.statementDay,
      dueDay: card?.dueDay,
    },
    feeRowsForPurchase: withFeeRows(db, 'txn-rome')
      .map((r) => r.id)
      .sort(),
    // WHAT UNDOES WHAT. `reverses_id` reaches no total either, so losing it in
    // a restore would be invisible to every figure above — and the refund would
    // silently stop naming the purchase it handed back, on the one day a backup
    // is being used at all.
    reversal: {
      refunds: reverses(db, 'txn-jacket-refund')?.id,
      refundedBy: reversedBy(db, 'txn-jacket').links.map((l) => l.id),
    },
    // TWO TABLES, and a new table is copied by NOTHING unless it is listed in
    // RESTORE_TABLES by hand. Tags move no figure above them either, so without
    // this a restore could drop every label in the ledger and every other
    // assertion in this file would still pass.
    tags: {
      onJacket: tagsForRecord(db, 'txn-jacket').map((t) => t.name),
      breakdown: tagBreakdown(db, PERIOD, 'expense'),
    },
    portfolio: portfolioSnapshot(db),
    // Attachment rows travel in the database like any others; the FILES they
    // name travel in the container, which the round-trip test below proves.
    attachments: listAttachments(db, 'txn-jacket').map((a) => a.fileName),
  };
}

describe('a restored ledger still means the same thing', () => {
  let live: ReturnType<typeof makeDb>;
  let backup: ReturnType<typeof makeDb>;

  beforeEach(() => {
    live = makeDb('live.db');
    backup = makeDb('backup.db');
  });

  afterEach(() => {
    live.sqlite.close();
    backup.sqlite.close();
  });

  const restore = () => {
    live.sqlite.exec(`ATTACH DATABASE '${backup.file}' AS backup`);
    validateBackup(live.sqlite, 'backup');
    return copyFromBackup(live.sqlite, 'backup');
  };

  it('is not a trivially empty ledger', () => {
    // Guards the whole file: if the fixture ever stopped producing records,
    // every comparison below would pass by comparing nothing to nothing.
    buildLedger(backup.db);
    const before = snapshot(backup.db);

    expect(before.summary.expenseMinor).not.toBe(0);
    expect(before.expenseByCategory.slices.length).toBeGreaterThan(1);
    expect(before.budgets.budgeted.length).toBeGreaterThan(1);
    expect(before.feeRowsForPurchase.length).toBeGreaterThan(1);
    expect(before.cardBalance).not.toBe(0);
  });

  it('gives back every figure a screen would show', () => {
    buildLedger(backup.db);
    const before = snapshot(backup.db);

    // The live database holds a DIFFERENT ledger, so a restore that quietly
    // did nothing would fail here rather than pass by coincidence. It has no
    // card at all, which is why it is compared by its own figures rather than
    // by `snapshot` — that would throw on the missing account.
    seedDefaults(live.db);
    createRecord(live.db, {
      type: 'expense',
      accountId: accountId('cash'),
      categoryId: catId('groceries'),
      amountMinor: 42_00,
      currency: 'EGP',
      occurredAt: new Date('2026-08-02T10:00:00'),
    });
    expect(periodSummary(live.db, PERIOD).expenseMinor).toBe(-42_00);
    expect(getAccount(live.db, CARD)).toBeUndefined();

    restore();

    expect(snapshot(live.db)).toEqual(before);
  });

  it('restores onto a fresh install — the new-phone case', () => {
    // No seed, nothing at all: this is the path a Drive restore takes.
    buildLedger(backup.db);
    const before = snapshot(backup.db);

    restore();

    expect(snapshot(live.db)).toEqual(before);
  });

  /**
   * The individually-nameable guarantees, spelled out so a failure says WHICH
   * feature broke rather than "some object differed".
   */
  describe('feature by feature', () => {
    beforeEach(() => {
      buildLedger(backup.db);
      restore();
    });

    it('keeps a refund on the expense side rather than turning it into income', () => {
      // 800 spent less 300 refunded, plus the Rome purchase and its commission.
      expect(periodSummary(live.db, PERIOD).incomeMinor).toBe(0);
      const clothing = categoryBreakdown(live.db, PERIOD, 'expense').slices.find(
        (s) => s.id === catId('clothing')
      );
      expect(clothing?.amountMinor).toBe(500_00);
    });

    it('keeps a balance correction out of spending while it still moves the card', () => {
      // The correction took the card to exactly -1,500.00 …
      expect(accountBalance(live.db, CARD)).toBe(-1_500_00);
      // … and spending is the four real rows only: 5,000.00 in Rome, 150.00
      // commission, 800.00 for the jacket, less 300.00 refunded. If the
      // correction leaked in, this jumps by thousands.
      expect(periodSummary(live.db, PERIOD).expenseMinor).toBe(-5_650_00);
    });

    it('keeps the card profile, which no total would reveal', () => {
      const card = getAccount(live.db, CARD);
      expect(card?.creditLimit).toBe(50_000_00);
      expect(card?.foreignFeeBp).toBe(300);
      expect(card?.cashFeeBp).toBe(500);
      expect(card?.statementDay).toBe(25);
      expect(card?.dueDay).toBe(15);
    });

    it('keeps a commission row linked to the purchase it came from', () => {
      // Losing `fee_for_id` would orphan the fee: deleting the purchase would
      // leave its commission behind as an unexplained expense.
      expect(withFeeRows(live.db, 'txn-rome').map((r) => r.id)).toContain('txn-rome-fee');
    });

    it('keeps the tags, which are two whole TABLES', () => {
      // `copyFromBackup` picks up a new COLUMN on its own and a new TABLE not
      // at all — it has to be named in RESTORE_TABLES. Tags move no figure, so
      // every other assertion in this file would pass with the labels gone.
      expect(tagsForRecord(live.db, 'txn-jacket').map((t) => t.name)).toEqual(['Kitchen reno']);
      // The join too, not just the tag rows: half of it restored is a ledger
      // full of labels attached to nothing.
      const kitchen = tagBreakdown(live.db, PERIOD, 'expense').find(
        (t) => t.name === 'Kitchen reno'
      );
      expect(kitchen?.recordCount).toBe(2);
    });

    it('keeps a refund pointing at the purchase it hands back', () => {
      // Losing `reverses_id` moves no total, so nothing else in this file would
      // notice — the refund would simply stop naming what it refunded, and the
      // purchase would stop knowing anything came back. On the one day a backup
      // is being used at all.
      expect(reverses(live.db, 'txn-jacket-refund')?.id).toBe('txn-jacket');
      expect(reversedBy(live.db, 'txn-jacket').links.map((l) => l.id)).toEqual([
        'txn-jacket-refund',
      ]);
    });

    it('keeps what a foreign purchase was originally in', () => {
      const rome = live.sqlite
        .prepare('SELECT original_amount_minor AS amt, original_currency AS cur FROM transactions WHERE id = ?')
        .get('txn-rome') as { amt: number | null; cur: string | null };
      expect(rome.cur).toBe('EUR');
      expect(rome.amt).toBe(100_00);
    });

    it('keeps budgets and what has been spent against them', () => {
      const food = listBudgets(live.db, PERIOD).budgeted.find(
        (b) => b.categoryId === catId('food')
      );
      expect(food?.budgetMinor).toBe(8_000_00);
      // Restaurants rolls up into Food, so the Rome purchase counts here.
      expect(food?.spentMinor).toBe(5_000_00);
    });

    it('keeps both transfer legs, so the accounts still balance', () => {
      expect(totalHeld(live.db)).toBe(totalHeld(backup.db));
    });

    /**
     * The portfolio has no automatic safety net. A new COLUMN copies itself,
     * because the column set is intersected at run time — a new TABLE does not,
     * and is simply not copied by anything until someone adds it to
     * RESTORE_TABLES. Losing an entire feature's data is the quietest failure
     * available here.
     */
    it('keeps the portfolio, which no other total would reveal', () => {
      const portfolio = portfolioSnapshot(live.db);
      expect(portfolio.classes.map((c) => c.name)).toEqual(['Stocks', 'Bonds']);
      expect(portfolio.targetsComplete).toBe(true);
      // 12.347 units at 41.83 = 516.48
      expect(portfolio.totalValueMinor).toBe(51_648);
      expect(portfolio.holdings[0].unitsMicro).toBe(12_347_000);
    });
  });

  /**
   * THE CONTAINER, AGAINST A REAL DATABASE FILE.
   *
   * Every other test of the zip format uses bytes that stand in for a database.
   * This one packs the actual SQLite file this fixture wrote — pages, indexes,
   * B-trees and all — puts it through fflate, opens it the way a restore does,
   * and demands every screen figure back.
   *
   * A binary that survives a synthetic round trip and not a real one is exactly
   * the failure that reaches a user: their backup is the real one.
   */
  describe('through the backup container', () => {
    const roundTrip = (files: { name: string; bytes: Uint8Array }[]) => {
      // The file on disk, as `databaseBackup` would read it.
      const database = new Uint8Array(fs.readFileSync(backup.file));
      const packed = packContainer({ database, files });

      const payload = openBackupPayload(packed);

      // Restore stages the unwrapped database and attaches THAT — so this is
      // the same path, not a shortcut around it.
      const staged = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'peace-container-')), 'r.db');
      fs.writeFileSync(staged, payload.database);

      live.sqlite.exec(`ATTACH DATABASE '${staged}' AS backup`);
      validateBackup(live.sqlite, 'backup');
      copyFromBackup(live.sqlite, 'backup');
      live.sqlite.exec('DETACH DATABASE backup');
      return payload;
    };

    it('gives back every figure after a real database has been zipped', () => {
      buildLedger(backup.db);
      const before = snapshot(backup.db);

      roundTrip([{ name: `${RECEIPT_HASH}.jpg`, bytes: RECEIPT_BYTES }]);

      expect(snapshot(live.db)).toEqual(before);
    });

    it('carries the receipt file itself, byte for byte', () => {
      buildLedger(backup.db);

      const payload = roundTrip([{ name: `${RECEIPT_HASH}.jpg`, bytes: RECEIPT_BYTES }]);

      // The row names a file; the container has to actually contain it, or the
      // restored ledger shows a receipt that is not there.
      const named = listAttachments(live.db, 'txn-jacket')[0].fileName;
      const carried = payload.files.find((f) => f.name === named);
      expect(carried).toBeDefined();
      expect(Array.from(carried!.bytes)).toEqual(Array.from(RECEIPT_BYTES));
      expect(payload.legacy).toBe(false);
    });

    /**
     * The backup every user already has. Refusing it would mean shipping a
     * version of the app that cannot restore its own history.
     */
    it('still restores a bare .db from before attachments existed', () => {
      buildLedger(backup.db);
      const before = snapshot(backup.db);

      const database = new Uint8Array(fs.readFileSync(backup.file));
      const payload = openBackupPayload(database);
      expect(payload.legacy).toBe(true);
      expect(payload.files).toEqual([]);

      live.sqlite.exec(`ATTACH DATABASE '${backup.file}' AS backup`);
      validateBackup(live.sqlite, 'backup');
      copyFromBackup(live.sqlite, 'backup');

      // The ledger comes back whole — including the attachment ROW. Its file is
      // simply not there, which is what `missingFiles` reports and what the
      // restore summary tells the user rather than leaving them to guess.
      expect(snapshot(live.db)).toEqual(before);
      expect(missingFiles(live.db, []).map((a) => a.fileName)).toEqual([`${RECEIPT_HASH}.jpg`]);
    });
  });
});
