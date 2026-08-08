import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from '../db/schema';

/**
 * An in-memory database built from the REAL migration files in drizzle/.
 *
 * expo-sqlite has no Node implementation, so schema behaviour cannot be tested
 * on the device driver. better-sqlite3 speaks the same SQLite, and by replaying
 * the committed migrations rather than a hand-written CREATE TABLE we are
 * testing the SQL that actually ships — if a migration is wrong, these tests
 * fail rather than passing against a parallel truth.
 */
export function createTestDb() {
  const sqlite = new Database(':memory:');

  // Match the app: without this every onDelete rule in the schema is a no-op,
  // and the cascade tests would pass for the wrong reason.
  sqlite.pragma('foreign_keys = ON');

  const dir = path.resolve(__dirname, '../../drizzle');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No migrations found in ${dir} — run "npm run db:generate"`);
  }

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }

  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export type TestDb = ReturnType<typeof createTestDb>['db'];
