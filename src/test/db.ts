import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from '../db/schema';

export const MIGRATIONS_DIR = path.resolve(__dirname, '../../drizzle');

/** The committed migration files, oldest first — the order the app applies them in. */
export function migrationFiles(): string[] {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

/** Read once per worker: the files cannot change while a test run is going. */
let statementCache: Map<string, string[]> | undefined;

function statementsOf(file: string): string[] {
  statementCache ??= new Map();
  let statements = statementCache.get(file);
  if (!statements) {
    statements = fs
      .readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    statementCache.set(file, statements);
  }
  return statements;
}

/**
 * Replay the REAL migration files in drizzle/ onto a database.
 *
 * `upTo` stops partway, which is how a test builds the schema of an older
 * release. `bookkeeping` also writes drizzle's own `__drizzle_migrations`
 * table, one row per file applied — what `validateBackup` compares to tell a
 * newer backup from an older one.
 */
export function migrate(
  sqlite: Database.Database,
  { upTo = Infinity, bookkeeping = false }: { upTo?: number; bookkeeping?: boolean } = {}
) {
  // Match the app: without this every onDelete rule in the schema is a no-op,
  // and the cascade tests would pass for the wrong reason.
  sqlite.pragma('foreign_keys = ON');

  const files = migrationFiles().slice(0, upTo);
  if (files.length === 0 && upTo > 0) {
    throw new Error(`No migrations found in ${MIGRATIONS_DIR} — run "npm run db:generate"`);
  }
  for (const file of files) {
    for (const statement of statementsOf(file)) sqlite.exec(statement);
  }

  if (bookkeeping) {
    sqlite.exec(
      'CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)'
    );
    const insert = sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)');
    for (let i = 0; i < files.length; i++) insert.run(`m${i}`, i);
  }
}

/** The fully-migrated schema, built once per worker and copied for each test. */
let template: Buffer | undefined;

/**
 * An in-memory database built from the REAL migration files in drizzle/.
 *
 * expo-sqlite has no Node implementation, so schema behaviour cannot be tested
 * on the device driver. better-sqlite3 speaks the same SQLite, and by replaying
 * the committed migrations rather than a hand-written CREATE TABLE we are
 * testing the SQL that actually ships — if a migration is wrong, these tests
 * fail rather than passing against a parallel truth.
 *
 * The migrations run ONCE per worker; every call after that deserialises a
 * byte-for-byte copy of that database, which is the same schema at a fraction
 * of the cost. Each call still gets its own independent database.
 */
export function createTestDb() {
  if (!template) {
    const scratch = new Database(':memory:');
    migrate(scratch);
    template = scratch.serialize();
    scratch.close();
  }

  const sqlite = new Database(template);
  // A connection setting, not part of the file — so it is set on every copy.
  sqlite.pragma('foreign_keys = ON');

  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export type TestDb = ReturnType<typeof createTestDb>['db'];

/**
 * A temporary directory that is removed when the test file finishes.
 *
 * Restore tests need real files — ATTACH cannot reach an in-memory database —
 * and every one of them used to leave its directory behind in /tmp.
 */
const tempDirs: string[] = [];

// Registered when a test file imports this module — hooks cannot be added from
// inside a running test, which is where `tempDir` is usually first called.
if (typeof afterAll === 'function') {
  afterAll(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
}

export function tempDir(prefix = 'peace-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/**
 * A migrated database ON DISK, optionally stopped partway to stand in for an
 * older build. Carries drizzle's bookkeeping table, as a real install does.
 */
export function createFileDb(name: string, { upTo = Infinity, prefix = 'peace-restore-' } = {}) {
  const file = path.join(tempDir(prefix), name);

  // Same trick as `createTestDb`: migrate once per schema version, then write
  // that image to disk. A serialised database IS the file SQLite would have
  // written, so what gets ATTACHed is indistinguishable from a migrated one.
  let image = fileTemplates.get(upTo);
  if (!image) {
    const scratch = new Database(':memory:');
    migrate(scratch, { upTo, bookkeeping: true });
    image = scratch.serialize();
    scratch.close();
    fileTemplates.set(upTo, image);
  }
  fs.writeFileSync(file, image);

  const sqlite = new Database(file);
  sqlite.pragma('foreign_keys = ON');
  return { sqlite, db: drizzle(sqlite, { schema }), file };
}

const fileTemplates = new Map<number, Buffer>();

export type FileDb = ReturnType<typeof createFileDb>;
