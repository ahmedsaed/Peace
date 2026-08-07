import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { ActivityIndicator, Text, View } from 'react-native';

import migrations from '../../drizzle/migrations';
import { db } from './client';

/**
 * Runs pending migrations before any screen touches the database.
 * Migrations are bundled at build time, so this is fast (milliseconds) after
 * the first launch — but it must still gate rendering, because a screen that
 * queries a table that does not exist yet will throw.
 */
export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const { success, error } = useMigrations(db, migrations);

  if (error) {
    return (
      <View className="flex-1 items-center justify-center gap-2 p-6">
        <Text className="text-lg font-semibold text-expense">
          Could not open your data
        </Text>
        <Text className="text-center text-sm opacity-70">{error.message}</Text>
      </View>
    );
  }

  if (!success) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  return <>{children}</>;
}
