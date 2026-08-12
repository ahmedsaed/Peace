import { Pacifico_400Regular } from '@expo-google-fonts/pacifico';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import palette from '@/constants/palette';
import { DatabaseProvider } from '@/db/provider';
import { DriveCatchUp } from '@/state/drive';

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
  /**
   * The wordmark font, loaded before anything renders.
   *
   * Rendering first and swapping later is worse than waiting: the header would
   * visibly re-set itself a frame in. The wait is short and lands while the
   * splash screen is still up, and the database provider below already gates on
   * migrations anyway — so this adds no new kind of delay, only one more reason
   * for the existing one.
   *
   * `error` is deliberately not fatal. A missing font is a cosmetic problem;
   * refusing to open a ledger over it would not be.
   */
  const [fontsLoaded, fontError] = useFonts({ Pacifico_400Regular });
  if (!fontsLoaded && !fontError) return null;

  return (
    // Required by the drawer's swipe gesture. Without it the menu still opens
    // from the button but never from the edge, which reads as a broken drawer
    // rather than a missing provider.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* The app is dark-only, so the status bar is always light-on-dark. */}
        <StatusBar style="light" />
        <DatabaseProvider>
          {/* Backs up to Drive if one is due. Renders nothing, blocks nothing,
              and swallows every failure — see the file for why the app being
              opened IS the scheduler rather than a fallback behind one. */}
          <DriveCatchUp />
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
            <Stack.Screen name="portfolio" />
            <Stack.Screen name="recurring" />
            <Stack.Screen name="about" />
          </Stack>
        </DatabaseProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
