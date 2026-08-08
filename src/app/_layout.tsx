import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import palette from '@/constants/palette';
import { DatabaseProvider } from '@/db/provider';

import '@/global.css';

/**
 * Root stack. The tab bar lives inside the `(tabs)` group, so anything declared
 * here sits *over* it — which is what the add-record screen needs: a full-screen
 * form with no tab bar competing for the thumb.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      {/* The app is dark-only, so the status bar is always light-on-dark. */}
      <StatusBar style="light" />
      <DatabaseProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.ground },
          }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="record"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
        </Stack>
      </DatabaseProvider>
    </SafeAreaProvider>
  );
}
