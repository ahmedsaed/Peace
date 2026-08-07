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

export const db = drizzle(sqliteDb, { schema });

export type DB = typeof db;
