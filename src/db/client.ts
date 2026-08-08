import { drizzle } from 'drizzle-orm/expo-sqlite';
import * as SQLite from 'expo-sqlite';

import * as schema from './schema';

export const DATABASE_NAME = 'peace.db';

/**
 * Opened synchronously so the Drizzle instance is available at module scope.
 * `enableChangeListener` powers drizzle's useLiveQuery hook — without it,
 * queries will not re-run when rows change.
 */
export const sqliteDb = SQLite.openDatabaseSync(DATABASE_NAME, {
  enableChangeListener: true,
});

// Foreign keys are OFF by default in SQLite; our cascade rules depend on them.
sqliteDb.execSync('PRAGMA foreign_keys = ON;');
// WAL gives us concurrent reads during writes, which keeps the list smooth.
sqliteDb.execSync('PRAGMA journal_mode = WAL;');

/**
 * `foreign_keys` is a PER-CONNECTION pragma, not a property of the file — so it
 * cannot be verified with the sqlite3 CLI, and it silently reverts to OFF on any
 * connection that did not set it. With it off, every `onDelete` rule in the
 * schema becomes a no-op and deleting an account leaves orphaned transactions.
 * Assert it here rather than discovering it as corrupted data later.
 */
const fkState = sqliteDb.getFirstSync<{ foreign_keys: number }>('PRAGMA foreign_keys');
if (fkState?.foreign_keys !== 1) {
  console.error(
    `[db] FOREIGN KEYS ARE OFF (got ${JSON.stringify(fkState)}). ` +
      'Cascade and set-null rules will not fire on this connection.'
  );
} else {
  console.log('[db] foreign_keys=ON, journal_mode=WAL');
}

export const db = drizzle(sqliteDb, { schema });

export type DB = typeof db;
