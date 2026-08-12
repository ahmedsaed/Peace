/**
 * The part of restore that touches data — kept free of React Native so it can
 * be tested against real SQLite in Node.
 *
 * This is the only code in the app that deletes everything. It gets tested by
 * actually losing data and getting it back, not by asserting that a function
 * was called.
 */

/**
 * A minimal SQLite handle that both better-sqlite3 and expo-sqlite satisfy.
 *
 * Only no-argument statements are described. Every query here is built from
 * table names taken from RESTORE_TABLES — never from user input — so there is
 * nothing to bind, and describing the two libraries' very different parameter
 * overloads would be a lot of type gymnastics for an API this code never uses.
 */
export type RawDb = {
  execSync?: (sql: string) => void;
  exec?: (sql: string) => unknown;
  getAllSync?: <T>(sql: string) => T[];
  prepare?: (sql: string) => { all: () => unknown[] };
};

/**
 * Restore order is parent-first. Foreign keys are deferred inside the
 * transaction anyway, but inserting parents first means the intermediate state
 * is valid too — which matters if this ever runs without deferral.
 *
 * `__drizzle_migrations` is deliberately absent: the live database keeps its
 * own migration history. Copying the backup's would claim migrations had run
 * that have not, and the next launch would skip them.
 */
export const RESTORE_TABLES = [
  'accounts',
  'categories',
  'settings',
  'transactions',
  'budgets',
  'recurring_rules',
  'attachments',
  // The portfolio keeps its own tables and never touches the ledger — but a
  // backup that quietly dropped them would still be a backup that lost data.
  // A table absent from this list is copied by nothing; unlike a new COLUMN,
  // which `copyFromBackup` picks up on its own, a new TABLE has to be added
  // here by hand. That asymmetry is the whole reason restore-fidelity.test.ts
  // asserts figures rather than columns.
  'recurring_skips',
  'asset_classes',
  'holdings',
] as const;

export type RestoreTable = (typeof RESTORE_TABLES)[number];

function run(db: RawDb, sql: string): void {
  if (db.execSync) db.execSync(sql);
  else if (db.exec) db.exec(sql);
  else throw new Error('No exec method on database handle');
}

function query<T>(db: RawDb, sql: string): T[] {
  if (db.getAllSync) return db.getAllSync<T>(sql);
  if (db.prepare) return db.prepare(sql).all() as T[];
  throw new Error('No query method on database handle');
}

/** Column names of a table in a given schema (`main` or the attached alias). */
export function columnsOf(db: RawDb, schema: string, table: string): string[] {
  const rows = query<{ name: string }>(db, `PRAGMA ${schema}.table_info(${table})`);
  return rows.map((r) => r.name);
}

export function tableExists(db: RawDb, schema: string, table: string): boolean {
  const rows = query<{ n: number }>(
    db,
    `SELECT count(*) AS n FROM ${schema}.sqlite_master WHERE type='table' AND name='${table}'`
  );
  return (rows[0]?.n ?? 0) > 0;
}

export function countRows(db: RawDb, schema: string, table: string): number {
  if (!tableExists(db, schema, table)) return 0;
  const rows = query<{ n: number }>(db, `SELECT count(*) AS n FROM ${schema}.${table}`);
  return rows[0]?.n ?? 0;
}

export class RestoreError extends Error {}

/**
 * Check a backup before anything is deleted.
 *
 * Refusing is always better than a partial restore: the user still has both the
 * backup and their current data, and can be told why.
 */
export function validateBackup(db: RawDb, alias: string): void {
  const missing = RESTORE_TABLES.filter((t) => !tableExists(db, alias, t));
  if (missing.length > 0) {
    throw new RestoreError(
      `This file is not a Peace backup — it is missing ${missing.join(', ')}.`
    );
  }

  // A backup from a LATER version of the app can contain columns and rows this
  // build knows nothing about, and restoring it would silently drop them.
  // Refuse rather than quietly lose data the user believes they still have.
  const theirs = countRows(db, alias, '__drizzle_migrations');
  const ours = countRows(db, 'main', '__drizzle_migrations');
  if (theirs > ours) {
    throw new RestoreError(
      `This backup was made by a newer version of Peace (${theirs} migrations against ${ours}). Update the app first.`
    );
  }
}

/**
 * Replace every row in the live database with the backup's.
 *
 * Only columns present in BOTH schemas are copied. Migrations in this project
 * only ever add columns (see AGENTS.md), so an older backup simply leaves the
 * newer columns at their defaults — which is the correct outcome, and far
 * better than refusing every backup taken before the last schema change.
 *
 * One transaction: either the whole ledger is replaced or none of it is. There
 * is no state in which half the records are the backup's and half are yours.
 */
export function copyFromBackup(db: RawDb, alias: string): Record<RestoreTable, number> {
  const copied = {} as Record<RestoreTable, number>;

  run(db, 'PRAGMA defer_foreign_keys = ON');
  run(db, 'BEGIN IMMEDIATE');
  try {
    // Delete children first so the intermediate state stays referentially sane.
    for (const table of [...RESTORE_TABLES].reverse()) {
      run(db, `DELETE FROM main.${table}`);
    }

    for (const table of RESTORE_TABLES) {
      const mine = columnsOf(db, 'main', table);
      const theirs = new Set(columnsOf(db, alias, table));
      const shared = mine.filter((c) => theirs.has(c));

      if (shared.length === 0) {
        throw new RestoreError(`Backup table ${table} has no columns in common with this version.`);
      }

      const list = shared.map((c) => `"${c}"`).join(', ');
      run(db, `INSERT INTO main.${table} (${list}) SELECT ${list} FROM ${alias}.${table}`);
      copied[table] = countRows(db, 'main', table);
    }

    run(db, 'COMMIT');
  } catch (error) {
    run(db, 'ROLLBACK');
    throw error;
  }

  return copied;
}
