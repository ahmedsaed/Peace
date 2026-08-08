import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import migrations from '../../drizzle/migrations';
import { db } from './client';
import { seedDefaults } from './seed';
import { getSetting } from './settings';

/**
 * Runs pending migrations before any screen touches the database.
 * Migrations are bundled at build time, so this is fast (milliseconds) after
 * the first launch — but it must still gate rendering, because a screen that
 * queries a table that does not exist yet will throw.
 */
export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const { success, error } = useMigrations(db, migrations);
  const [seedError, setSeedError] = useState<Error | null>(null);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!success || seeded) return;
    try {
      // Runs on every launch, not just the first. Seeding is an insert-or-ignore
      // keyed on deterministic ids, so this tops up defaults added in a later
      // release without touching anything the user has since edited.
      seedDefaults(db, getSetting('homeCurrency'));
    } catch (e) {
      setSeedError(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    setSeeded(true);
  }, [success, seeded]);

  const failure = error ?? seedError;
  if (failure) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-ground p-6">
        <Text className="text-lg font-semibold text-expense">Could not open your data</Text>
        <Text className="text-center text-sm text-muted">{failure.message}</Text>
      </View>
    );
  }

  // Gate on seeding too, not just migrations — a screen that renders before the
  // default categories exist would show an empty picker on first launch.
  if (!success || !seeded) {
    return (
      <View className="flex-1 items-center justify-center bg-ground">
        <ActivityIndicator color="#E3A33C" />
      </View>
    );
  }

  return <>{children}</>;
}
