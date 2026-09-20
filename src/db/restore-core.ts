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
 * Every table a restore copies, parent-first, each saying whether a backup
 * without it is a backup at all.
 *
 * Foreign keys are deferred inside the transaction anyway, but inserting
 * parents first means the intermediate state is valid too — which matters if
 * this ever runs without deferral.
 *
 * `required` is the half of this that was missing, and its absence broke every
 * old backup the day tags shipped. The seven original tables are in migration
 * 0000, so every Peace database that has ever existed has them: a file without
 * one is somebody else's database, and refusing it is the point. Every other
 * table arrived in a LATER migration, which means a backup taken before that
 * migration ran is not a foreign file — it is an OLDER Peace backup, and the
 * feature simply did not exist when it was written. Demanding those tables
 * turned "the ledger you are restoring predates tags" into "This file is not a
 * Peace backup — it is missing tags, transaction_tags", on the one day a backup
 * is being used at all.
 *
 * This is the same rule `copyFromBackup` has always applied to COLUMNS one
 * level up: migrations only ever add, so what the backup does not have, it
 * could not have had. A flat list of names cannot say which tables identify a
 * backup and which merely arrived later, so the list says both per table —
 * beside the name, where a new table is added, rather than in a second list
 * that the next migration forgets. `restore-core.test.ts` checks both halves
 * against `drizzle/` itself: a table created by any migration and not named
 * here is copied by NOTHING, and a table flagged `required` that migration 0000
 * did not create would refuse every backup older than it.
 *
 * `__drizzle_migrations` is deliberately absent: the live database keeps its
 * own migration history. Copying the backup's would claim migrations had run
 * that have not, and the next launch would skip them.
 */
export const BACKUP_TABLES = [
  { name: 'accounts', required: true },
  { name: 'categories', required: true },
  { name: 'settings', required: true },
  { name: 'transactions', required: true },
  { name: 'budgets', required: true },
  { name: 'recurring_rules', required: true },
  { name: 'attachments', required: true },
  // The portfolio keeps its own tables and never touches the ledger — but a
  // backup that quietly dropped them would still be a backup that lost data.
  // A table absent from this list is copied by nothing; unlike a new COLUMN,
  // which `copyFromBackup` picks up on its own, a new TABLE has to be added
  // here by hand. That asymmetry is the whole reason restore-fidelity.test.ts
  // asserts figures rather than columns.
  { name: 'recurring_skips', required: false },
  { name: 'asset_classes', required: false },
  { name: 'holdings', required: false },
  { name: 'bank_captures', required: false },
  // Tags before the join that points at them, per the parent-first rule above.
  // Two TABLES, so two lines here: `copyFromBackup` picks up a new column on
  // its own and a new table not at all, which is why restore-fidelity.test.ts
  // asserts figures rather than columns — and why tags needed a case of their
  // own there, since they move no figure at all.
  { name: 'tags', required: false },
  { name: 'transaction_tags', required: false },
] as const;

export type RestoreTable = (typeof BACKUP_TABLES)[number]['name'];

/** Every table copied, in the order they are copied in. */
export const RESTORE_TABLES: readonly RestoreTable[] = BACKUP_TABLES.map((t) => t.name);

/** The tables whose absence means the file is not a Peace backup. */
export const REQUIRED_TABLES: readonly RestoreTable[] = BACKUP_TABLES.filter(
  (t) => t.required
).map((t) => t.name);

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
  const missing = REQUIRED_TABLES.filter((t) => !tableExists(db, alias, t));
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
 * A whole TABLE the backup does not have is the same situation one level up,
 * and gets the same answer: the live rows are deleted like every other table's
 * and nothing is put back, because the feature did not exist when the backup
 * was written. Keeping them would be worse than empty — the restored ledger
 * would be wearing the OUTGOING ledger's tags, on records that are not the
 * records they were attached to.
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
      if (!tableExists(db, alias, table)) {
        // Older than the migration that created it. `validateBackup` has
        // already established this is a Peace backup, so there is nothing to
        // refuse here — there is simply nothing to copy.
        copied[table] = 0;
        continue;
      }

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
