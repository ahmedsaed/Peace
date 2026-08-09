import { View } from 'react-native';

import { EmptyState, StackHeader } from '@/components/screen';

/**
 * Settings, laid out but not wired.
 *
 * The preferences themselves already exist and persist — see
 * src/lib/settings.ts for the definitions and src/db/settings.ts for storage.
 * What is missing is only the UI, which is why this is a placeholder rather
 * than a stub: nothing here has to be invented later, just rendered.
 */
export default function SettingsScreen() {
  return (
    <View className="flex-1 bg-ground" testID="settings-screen">
      <StackHeader title="Settings" />
      <EmptyState
        icon="settings"
        title="Nothing to change yet"
        hint="Home currency, carry-over and the default view arrive with Stage 2. The Gemini API key field comes with Stage 5 — it is stored on the device and never shipped in the build."
      />
    </View>
  );
}
