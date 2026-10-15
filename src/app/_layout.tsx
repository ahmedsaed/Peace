import { Pacifico_400Regular } from '@expo-google-fonts/pacifico';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppLockGate } from '@/components/app-lock';
import { WhatsNewOnLaunch } from '@/components/whats-new';
import { DatabaseProvider } from '@/db/provider';
import { CONTENT_MAX_WIDTH } from '@/lib/layout';
import { BankCatchUp } from '@/state/bank';
import { DriveCatchUp } from '@/state/drive';
import { ReminderSchedule } from '@/state/reminders';
import { ThemeRoot, useTheme } from '@/state/theme';
import { WidgetSync } from '@/state/widget';

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
/**
 * Records sits under anything opened by a LINK. The launcher shortcuts
 * (plugins/with-shortcuts.js) open `peace://record` straight from the home
 * screen; without an anchor that record screen is the whole stack, so Save and
 * Back close the app instead of landing on the list the record was added to.
 * It also keeps the first-launch redirect in `(drawer)` in force: a shortcut
 * pressed before setup still goes through setup.
 */
export const unstable_settings = {
  anchor: '(drawer)',
};

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
        {/* Until the theme is known — while the database opens — the screen
            is Ledger, so its icons are light. ThemeRoot's own StatusBar
            mounts later and wins. */}
        <StatusBar style="light" />
        <DatabaseProvider>
          {/* Inside the database gate: the theme is a setting, and settings
              are loaded there. */}
          <ThemeRoot>
            <Shell />
          </ThemeRoot>
        </DatabaseProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Everything that draws, in the active theme. */
function Shell() {
  const palette = useTheme();
  return (
    <>
      {/* Backs up to Drive if one is due. Renders nothing, blocks nothing,
          and swallows every failure — see the file for why the app being
          opened IS the scheduler rather than a fallback behind one. */}
      <DriveCatchUp />
      {/* Drains whatever the notification listener captured while the app
          was closed, and reads it. Renders nothing, blocks nothing, and
          swallows every failure — a message left unread is read next time. */}
      <BankCatchUp />
      {/* Re-arms the nightly reminder with what is waiting right now. The
          counts are frozen when a notification is SCHEDULED — no JS runs
          when one fires — so every return to the foreground lays the
          window down again. Renders nothing and swallows every failure. */}
      <ReminderSchedule />
      {/* Writes the home-screen widget's snapshot on launch and whenever the
          app leaves the foreground. Renders nothing, swallows every failure. */}
      <WidgetSync />
      {/* A column, centred, no wider than a large phone. Peace is laid out for
          one hand; on a tablet or an unfolded phone — where Android 16 ignores
          the portrait lock — a keypad key 300dp wide and a row with its amount
          a hand's width from its name are harder to use, not easier. The
          ground fills the sides. Bottom sheets cap themselves the same way
          (SheetPanel), because each is its own window. */}
      <View style={{ flex: 1, alignItems: 'center', backgroundColor: palette.ground }}>
      <View style={{ flex: 1, width: '100%', maxWidth: CONTENT_MAX_WIDTH }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.ground },
        }}>
        <Stack.Screen name="(drawer)" />
        <Stack.Screen name="setup" options={{ animation: 'fade' }} />
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
        <Stack.Screen name="export" />
        <Stack.Screen name="import" />
        <Stack.Screen name="portfolio" />
        <Stack.Screen name="recurring" />
        <Stack.Screen name="about" />
        <Stack.Screen name="assistant" />
      </Stack>
      </View>
      </View>
      {/* Release notes, once after an update. Before the lock, so a locked
          app shows the lock on top and the notes after it. */}
      <WhatsNewOnLaunch />
      {/* After the navigator, so it covers every screen without being
          one of them — locking never unmounts a half-typed record. Off
          unless switched on in Settings › App lock. */}
      <AppLockGate />
    </>
  );
}
