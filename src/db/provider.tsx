import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { useMemo } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import migrations from '../../drizzle/migrations';
import palette from '../constants/palette';
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
