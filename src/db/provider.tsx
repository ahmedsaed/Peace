import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { useMemo } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import migrations from '../../drizzle/migrations';
import palette from '../constants/palette';
import { useSettingsStore } from '../state/settings';
import { sweepOrphans } from './attachments';
import { db } from './client';
import { seedDefaults } from './seed';
import { getSetting } from './settings';

/**
 * Runs pending migrations, then tops up default categories and accounts,
 * before any screen touches the database.
 *
 * Both steps gate rendering. A screen that queries a table which does not exist
 * yet will throw, and one that mounts before seeding shows an empty category
 * picker on first launch.
 */
export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const { success, error } = useMigrations(db, migrations);

  /**
   * Seeding is synchronous and idempotent, so it runs during render rather than
   * in an effect. An effect would need setState to report its outcome, which
   * costs an extra render pass and trips react-hooks/set-state-in-effect for
   * good reason. Idempotency is what makes this safe: if React discards the
   * render or double-invokes in StrictMode, the second pass inserts nothing.
   */
  const seedError = useMemo(() => {
    if (!success) return null;
    try {
      seedDefaults(db, getSetting('homeCurrency'));
      // Loaded here, behind the same gate, so no screen ever renders with the
      // built-in defaults and then flicks to the stored values a frame later.
      useSettingsStore.getState().load();

      /**
       * Collect attachment files nothing points at any more.
       *
       * Backing out of the record screen after photographing a receipt leaves
       * one behind — the bytes are written when the camera returns, because the
       * cache they land in is not somewhere a photo can be left. Deleting a
       * record leaves its files too, since a file may be shared with another
       * record and only the database knows.
       *
       * Here rather than at either of those moments because it is cheap, exact
       * and needs no bookkeeping: it asks the ledger what it still refers to.
       * Deliberately not allowed to fail the launch — a file that will not
       * delete is worth a line in the log and nothing more.
       */
      try {
        sweepOrphans();
      } catch (e) {
        console.warn('[attachments] orphan sweep failed', e);
      }
      return null;
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  }, [success]);

  const failure = error ?? seedError;
  if (failure) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-ground p-6">
        <Text className="text-lg font-semibold text-expense">Could not open your data</Text>
        <Text className="text-center text-sm text-muted">{failure.message}</Text>
      </View>
    );
  }

  if (!success) {
    return (
      <View className="flex-1 items-center justify-center bg-ground">
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  return <>{children}</>;
}
