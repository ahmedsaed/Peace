import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import palette from '@/constants/palette';
import { DatabaseProvider } from '@/db/provider';

import '@/global.css';

/**
 * Root stack. The tab bar and the side menu both live inside the `(drawer)`
 * group, so anything declared here sits *over* them — which is what the
 * add-record screen needs: a full-screen form with no tab bar competing for the
 * thumb, and no edge-swipe opening a menu mid-entry.
 *
 * The side-menu destinations (settings, export, about) and search are pushed
 * here rather than being drawer screens, so they arrive with a back arrow and
 * the system back gesture instead of being dismissable only by reopening the
 * menu.
 */
export default function RootLayout() {
  return (
    // Required by the drawer's swipe gesture. Without it the menu still opens
    // from the button but never from the edge, which reads as a broken drawer
    // rather than a missing provider.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* The app is dark-only, so the status bar is always light-on-dark. */}
        <StatusBar style="light" />
        <DatabaseProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: palette.ground },
            }}>
            <Stack.Screen name="(drawer)" />
            <Stack.Screen
              name="record"
              options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen
              name="account"
              options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen
              name="category"
              options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen name="search" />
            <Stack.Screen name="settings" />
            <Stack.Screen name="export" />
            <Stack.Screen name="about" />
          </Stack>
        </DatabaseProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
