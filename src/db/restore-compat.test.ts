/**
 * @jest-environment node
 *
 * EVERY VERSION OF PEACE THAT EVER WROTE A BACKUP, RESTORED INTO THIS ONE.
 *
 * A backup is older than the app far more often than it is newer: it is taken
 * once and opened after however long it took for something to go wrong. So the
 * schema a backup was written against is not "the current one minus a column" —
 * it is any of the fifteen schemas this app has had, and the restore has to
 * accept all of them.
 *
 * Tags proved that a hand-maintained rule does not cover this on its own. The
 * two new tables were added to the copy list correctly, which also made them
 * mandatory, and every backup written before that day came back as "This file
 * is not a Peace backup". One test naming tags would have caught that one bug;
 * this file catches its whole family, because it does not name a feature at
 * all. It walks `drizzle/`, builds a database at each point in history, fills
 * every table that existed THEN, and demands the rows back — so the next
 * migration that adds a table is covered by a test written before it.
 *
 * The fixtures are generated from the schema rather than written out, for the
 * same reason: a fixture built by hand describes the tables somebody remembered.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import {
  copyFromBackup,
  countRows,
  REQUIRED_TABLES,
  RESTORE_TABLES,
  tableExists,
  validateBackup,
  type RestoreTable,
} from './restore-core';

const MIGRATIONS = path.resolve(__dirname, '../../drizzle');

const migrationFiles = (): string[] =>
  fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

/** Migrate a database as far as `count` migrations — a build from back then. */
function migrate(sqlite: Database.Database, count = Infinity) {
  sqlite.pragma('foreign_keys = ON');
  const files = migrationFiles().slice(0, count);
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

/** A real database on disk, because ATTACH cannot reach an in-memory one. */
function makeDb(name: string, count = Infinity) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peace-compat-'));
  const file = path.join(dir, name);
  const sqlite = new Database(file);
  migrate(sqlite, count);
  return { sqlite, file };
}

type Column = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};
type ForeignKey = { table: string; from: string; to: string };

const columnsOf = (sqlite: Database.Database, table: string) =>
  sqlite.prepare(`PRAGMA table_info(${table})`).all() as Column[];

const foreignKeysOf = (sqlite: Database.Database, table: string) =>
  sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all() as ForeignKey[];

/**
 * A value for one column, carrying the fixture's MARK.
 *
 * Every text column in a ledger ends up holding the mark, which is what lets
 * the assertions below tell "the backup's rows" from "the rows that were here
 * before" without knowing what any of the columns mean. Numbers carry it too,
 * so a dropped integer column is as visible as a dropped name.
 */
function sample(table: string, column: Column, mark: string, n: number): string | number {
  const type = column.type.toUpperCase();
  if (type.startsWith('INT') || type.startsWith('REAL') || type.startsWith('NUM')) return n;
  return `${mark}:${table}.${column.name}`;
}

/**
 * Put one row in every table this database has, whatever schema it is at.
 *
 * Read out of the schema — `PRAGMA table_info` for the columns, `foreign_key_list`
 * for what points where — so a table added by a future migration is filled by
 * this with no edit here. Parents first, then a second pass for the FKs that
 * point FORWARDS (a transaction naming the recurring rule that made it), which
 * are left null on the way down and filled once the parent exists. Without that
 * pass those columns would be null in every fixture, and a restore that dropped
 * them would look exactly like one that did not.
 */
function fillEveryTable(sqlite: Database.Database, mark: string, n: number): RestoreTable[] {
  const filled: RestoreTable[] = [];
  const parentIds = new Map<string, string | number>();
  const deferred: { table: string; column: string; parent: string }[] = [];

  for (const table of RESTORE_TABLES) {
    if (!tableExists(sqlite, 'main', table)) continue;

    const columns = columnsOf(sqlite, table);
    const fks = new Map(foreignKeysOf(sqlite, table).map((f) => [f.from, f]));
    const values: Record<string, string | number> = {};

    for (const column of columns) {
      const fk = fks.get(column.name);
      if (!fk) {
        values[column.name] = sample(table, column, mark, n);
        continue;
      }
      // A row pointing at its own table (a sub-category's parent, a transfer's
      // other leg) stays null: there is nothing else in the table yet.
      if (fk.table === table) continue;
      const parent = parentIds.get(fk.table);
      if (parent !== undefined) values[column.name] = parent;
      else deferred.push({ table, column: column.name, parent: fk.table });
    }

    const names = Object.keys(values);
    sqlite
      .prepare(
        `INSERT INTO ${table} (${names.map((c) => `"${c}"`).join(', ')}) ` +
          `VALUES (${names.map(() => '?').join(', ')})`
      )
      .run(names.map((c) => values[c]));

    const pk = columns.find((c) => c.pk === 1);
    if (pk && values[pk.name] !== undefined) parentIds.set(table, values[pk.name]);
    filled.push(table);
  }

  for (const { table, column, parent } of deferred) {
    const id = parentIds.get(parent);
    if (id !== undefined) sqlite.prepare(`UPDATE ${table} SET "${column}" = ?`).run(id);
  }

  return filled;
}

/**
 * The columns two schemas have in common — everything a restore can carry.
 *
 * Both directions happen: this build has columns the backup predates, and the
 * backup can have columns this build DROPPED, which `0011` did to
 * `bank_captures`. So "migrations only ever add" is not quite true of this
 * repo's history, and a test that assumed it would compare a column that has
 * nowhere to land.
 */
function sharedColumns(backup: Database.Database, live: Database.Database, table: string) {
  const theirs = new Set(columnsOf(backup, table).map((c) => c.name));
  return columnsOf(live, table)
    .map((c) => c.name)
    .filter((c) => theirs.has(c));
}

/** Every row of a table, through a given list of columns. */
function rowsOf(sqlite: Database.Database, schema: string, table: string, columns: string[]) {
  const list = columns.map((c) => `"${c}"`).join(', ');
  return sqlite.prepare(`SELECT ${list} FROM ${schema}.${table} ORDER BY 1`).all();
}

describe('a backup from every version of Peace there has ever been', () => {
  const files = migrationFiles();

  it('has a fixture generator that actually fills the schema', () => {
    // Guards every case below: if this stopped producing rows they would all
    // pass by restoring nothing into nothing.
    const db = makeDb('probe.db');
    const filled = fillEveryTable(db.sqlite, 'probe', 1);

    expect(filled).toEqual([...RESTORE_TABLES]);
    for (const table of RESTORE_TABLES) {
      expect(countRows(db.sqlite, 'main', table)).toBe(1);
    }
    // And the forward-pointing FKs really do get filled by the second pass,
    // or the columns holding them would be null in every fixture here.
    const linked = db.sqlite
      .prepare('SELECT recurring_rule_id FROM transactions')
      .get() as { recurring_rule_id: string | null };
    expect(linked.recurring_rule_id).not.toBeNull();

    db.sqlite.close();
  });

  /**
   * One case per migration, named by the file, so a failure says WHICH version
   * of the app wrote the backup that this build can no longer open.
   */
  describe.each(files.map((file, i) => [file, i + 1] as const))(
    'a backup written after %s',
    (_file, count) => {
      let old: ReturnType<typeof makeDb>;
      let live: ReturnType<typeof makeDb>;

      beforeEach(() => {
        old = makeDb('old.db', count);
        live = makeDb('live.db');
        fillEveryTable(old.sqlite, 'backup', 7);
        // The live ledger is a DIFFERENT one, at today's schema. A restore that
        // quietly did nothing would leave its mark behind and fail below.
        fillEveryTable(live.sqlite, 'live', 9);
        live.sqlite.exec(`ATTACH DATABASE '${old.file}' AS backup`);
      });

      afterEach(() => {
        old.sqlite.close();
        live.sqlite.close();
      });

      it('is recognised as a Peace backup', () => {
        expect(() => validateBackup(live.sqlite, 'backup')).not.toThrow();
      });

      it('restores every row it holds, column for column', () => {
        validateBackup(live.sqlite, 'backup');
        const copied = copyFromBackup(live.sqlite, 'backup');

        for (const table of RESTORE_TABLES) {
          if (!tableExists(old.sqlite, 'main', table)) {
            // The feature did not exist when this backup was written, so the
            // restored ledger has none of it — and none of the OUTGOING
            // ledger's either, which is the part that would be silent.
            expect(copied[table]).toBe(0);
            expect(countRows(live.sqlite, 'main', table)).toBe(0);
            continue;
          }

          const columns = sharedColumns(old.sqlite, live.sqlite, table);
          expect(copied[table]).toBe(1);
          // Compared through the columns the two schemas SHARE, which is what a
          // restore copies: a column this build added since the backup cannot
          // come back, and one the backup has that this build has DROPPED has
          // nowhere to go (migration 0011 dropped two from `bank_captures`).
          // Every column that exists on both sides has to survive.
          expect(columns.length).toBeGreaterThan(0);
          expect(rowsOf(live.sqlite, 'main', table, columns)).toEqual(
            rowsOf(old.sqlite, 'main', table, columns)
          );
        }
      });

      it('leaves nothing of the ledger it replaced', () => {
        validateBackup(live.sqlite, 'backup');
        copyFromBackup(live.sqlite, 'backup');

        // Every text column in the fixture carries its mark, so one table
        // quietly left alone shows up here whatever the table means.
        for (const table of RESTORE_TABLES) {
          const columns = columnsOf(live.sqlite, table).map((c) => c.name);
          const text = JSON.stringify(rowsOf(live.sqlite, 'main', table, columns));
          expect(text).not.toContain('live:');
        }
      });
    }
  );

  it('refuses a database that is missing a table Peace has always had', () => {
    // The other half of the rule: optional tables do not mean any database at
    // all is a backup. Each original table, checked on its own — a check that
    // only ever ran for one of them would pass while the rest went unguarded.
    for (const table of REQUIRED_TABLES) {
      const stranger = makeDb('stranger.db');
      stranger.sqlite.exec(`DROP TABLE ${table}`);
      stranger.sqlite.close();

      const live = makeDb('live.db');
      live.sqlite.exec(`ATTACH DATABASE '${stranger.file}' AS stranger`);
      expect(() => validateBackup(live.sqlite, 'stranger')).toThrow(
        new RegExp(`not a Peace backup.*${table}`)
      );
      live.sqlite.close();
    }
  });

  it('still refuses a backup from a version NEWER than this build', () => {
    // The one direction that must keep failing: a newer backup can hold rows
    // and columns this build knows nothing about, and restoring it would drop
    // them silently. Older is ordinary; newer is a data loss waiting to happen.
    const newer = makeDb('newer.db');
    newer.sqlite
      .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run('future', 999);
    newer.sqlite.close();

    const live = makeDb('live.db');
    live.sqlite.exec(`ATTACH DATABASE '${newer.file}' AS backup`);
    expect(() => validateBackup(live.sqlite, 'backup')).toThrow(/newer version/);
    live.sqlite.close();
  });
});
