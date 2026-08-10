/**
 * @jest-environment node
 *
 * Restore is the only code in the app that deletes everything, so it is tested
 * by actually losing data and getting it back — not by asserting that a
 * function was called.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema';
import {
  copyFromBackup,
  countRows,
  RESTORE_TABLES,
  RestoreError,
  validateBackup,
} from './restore-core';
import { accountId, catId, seedDefaults } from './seed';
import { createRecord, createTransfer } from './repo/transactions';

const MIGRATIONS = path.resolve(__dirname, '../../drizzle');

function migrate(sqlite: Database.Database) {
  sqlite.pragma('foreign_keys = ON');
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    for (const statement of fs.readFileSync(path.join(MIGRATIONS, file), 'utf8').split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }
  // Drizzle's own bookkeeping table, which validateBackup compares.
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)'
  );
  for (let i = 0; i < files.length; i++) {
    sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(`m${i}`, i);
  }
}

/** A real database on disk, because ATTACH cannot reach an in-memory one. */
function makeDb(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peace-restore-'));
  const file = path.join(dir, name);
  const sqlite = new Database(file);
  migrate(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }), file };
}

describe('restore', () => {
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

  /** Fill a database with a ledger worth losing. */
  function fill(target: ReturnType<typeof makeDb>, note: string) {
    seedDefaults(target.db);
    createRecord(target.db, {
      type: 'expense',
      accountId: accountId('cash'),
      categoryId: catId('restaurants'),
      amountMinor: 15500,
      currency: 'EGP',
      note,
      occurredAt: new Date('2026-08-09T13:00:00'),
    });
    createTransfer(target.db, {
      fromAccountId: accountId('bank'),
      toAccountId: accountId('cash'),
      amountMinor: 100000,
      currency: 'EGP',
      note: null,
      occurredAt: new Date('2026-08-05T10:00:00'),
    });
  }

  const attach = () => live.sqlite.exec(`ATTACH DATABASE '${backup.file}' AS backup`);

  it('brings back data that was destroyed', () => {
    fill(backup, 'from the backup');

    // The live database has different data, which restoring must replace.
    fill(live, 'about to be lost');
    expect(countRows(live.sqlite, 'main', 'transactions')).toBe(3);

    attach();
    validateBackup(live.sqlite, 'backup');
    const copied = copyFromBackup(live.sqlite, 'backup');

    expect(copied.transactions).toBe(3);
    const notes = live.sqlite
      .prepare('SELECT note FROM transactions WHERE note IS NOT NULL')
      .all() as { note: string }[];
    expect(notes.map((n) => n.note)).toContain('from the backup');
    expect(notes.map((n) => n.note)).not.toContain('about to be lost');
  });

  it('restores into an empty database — the new-phone case', () => {
    fill(backup, 'recovered');
    expect(countRows(live.sqlite, 'main', 'transactions')).toBe(0);

    attach();
    validateBackup(live.sqlite, 'backup');
    copyFromBackup(live.sqlite, 'backup');

    expect(countRows(live.sqlite, 'main', 'transactions')).toBe(3);
    expect(countRows(live.sqlite, 'main', 'accounts')).toBe(
      countRows(backup.sqlite, 'main', 'accounts')
    );
    expect(countRows(live.sqlite, 'main', 'categories')).toBe(
      countRows(backup.sqlite, 'main', 'categories')
    );
  });

  it('carries settings across, which a CSV cannot', () => {
    seedDefaults(backup.db);
    backup.sqlite
      .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
      .run('defaultAccountId', 'seed:acct:bank', Date.now());

    attach();
    copyFromBackup(live.sqlite, 'backup');

    const row = live.sqlite.prepare("SELECT value FROM settings WHERE key='defaultAccountId'").get() as
      | { value: string }
      | undefined;
    expect(row?.value).toBe('seed:acct:bank');
  });

  it('leaves both transfer legs intact and still balancing', () => {
    fill(backup, 'x');
    attach();
    copyFromBackup(live.sqlite, 'backup');

    const legs = live.sqlite
      .prepare('SELECT amount_minor FROM transactions WHERE transfer_pair_id IS NOT NULL')
      .all() as { amount_minor: number }[];
    expect(legs).toHaveLength(2);
    expect(legs.reduce((s, r) => s + r.amount_minor, 0)).toBe(0);
  });

  it('keeps the live database its own migration history', () => {
    fill(backup, 'x');
    const before = countRows(live.sqlite, 'main', '__drizzle_migrations');

    attach();
    copyFromBackup(live.sqlite, 'backup');

    // Copying the backup's history would claim migrations had run that had not,
    // and the next launch would skip them.
    expect(countRows(live.sqlite, 'main', '__drizzle_migrations')).toBe(before);
    expect(RESTORE_TABLES).not.toContain('__drizzle_migrations');
  });
});

describe('restore — refusing rather than half-doing it', () => {
  let live: ReturnType<typeof makeDb>;

  beforeEach(() => {
    live = makeDb('live.db');
  });
  afterEach(() => live.sqlite.close());

  it('rejects a file that is not a Peace backup', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peace-notours-'));
    const file = path.join(dir, 'other.db');
    const other = new Database(file);
    other.exec('CREATE TABLE songs (id INTEGER PRIMARY KEY)');
    other.close();

    live.sqlite.exec(`ATTACH DATABASE '${file}' AS backup`);
    expect(() => validateBackup(live.sqlite, 'backup')).toThrow(RestoreError);
    expect(() => validateBackup(live.sqlite, 'backup')).toThrow(/not a Peace backup/);
  });

  it('rejects a backup from a newer version instead of dropping its data', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peace-newer-'));
    const file = path.join(dir, 'newer.db');
    const newer = new Database(file);
    migrate(newer);
    newer.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run('future', 999);
    newer.close();

    live.sqlite.exec(`ATTACH DATABASE '${file}' AS backup`);
    expect(() => validateBackup(live.sqlite, 'backup')).toThrow(/newer version/);
  });

  /**
   * The property that makes this safe to run at all: a failure part-way through
   * must leave the ledger exactly as it was, not half replaced.
   */
  it('rolls back completely when the copy fails', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peace-broken-'));
    const file = path.join(dir, 'broken.db');
    const broken = new Database(file);
    migrate(broken);
    // Same tables, but transactions has nothing in common with ours, so the
    // copy throws after earlier tables have already been deleted and refilled.
    broken.exec('DROP TABLE transactions');
    broken.exec('CREATE TABLE transactions (nothing_in_common TEXT)');
    broken.close();

    seedDefaults(live.db);
    createRecord(live.db, {
      type: 'expense',
      accountId: accountId('cash'),
      categoryId: null,
      amountMinor: 500,
      currency: 'EGP',
      note: 'must survive',
      occurredAt: new Date('2026-08-09T13:00:00'),
    });
    const accountsBefore = countRows(live.sqlite, 'main', 'accounts');

    live.sqlite.exec(`ATTACH DATABASE '${file}' AS backup`);
    expect(() => copyFromBackup(live.sqlite, 'backup')).toThrow();

    expect(countRows(live.sqlite, 'main', 'transactions')).toBe(1);
    expect(countRows(live.sqlite, 'main', 'accounts')).toBe(accountsBefore);
    const row = live.sqlite.prepare('SELECT note FROM transactions').get() as { note: string };
    expect(row.note).toBe('must survive');
  });
});
