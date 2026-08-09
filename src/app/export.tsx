import { View } from 'react-native';

import { EmptyState, StackHeader } from '@/components/screen';

/**
 * Export and backup, laid out but not wired.
 *
 * Worth building early in Stage 2 rather than late: until the data can be got
 * back out, "switch off the other app" is a one-way door.
 */
export default function ExportScreen() {
  return (
    <View className="flex-1 bg-ground" testID="export-screen">
      <StackHeader title="Export & backup" />
      <EmptyState
        icon="export"
        title="No way out yet"
        hint="CSV export and a full database backup and restore arrive in Stage 2."
      />
    </View>
  );
}
