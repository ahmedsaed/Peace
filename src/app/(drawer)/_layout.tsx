import { Drawer } from 'expo-router/drawer';

import { DrawerContent } from '@/components/drawer-content';
import palette from '@/constants/palette';

/**
 * Side menu wrapped around the tab bar.
 *
 * `(drawer)` is a route group, so nesting the tabs inside it changes no URLs —
 * Records is still `/`. That matters: every `router.push` in the app, and every
 * Maestro flow, keeps working.
 *
 * The drawer holds only the tab group. Settings, Export and About are pushed
 * onto the *root* stack instead of being drawer screens, so they arrive with a
 * back gesture and a back arrow rather than being dismissable only by reopening
 * the menu.
 *
 * Since SDK 56 this navigator ships inside expo-router (backed by
 * react-native-drawer-layout) — @react-navigation/drawer is not a dependency.
 */
export default function DrawerLayout() {
  return (
    <Drawer
      drawerContent={DrawerContent}
      screenOptions={{
        // The app draws its own header; the navigator's would be a second one.
        headerShown: false,
        drawerType: 'front',
        drawerStyle: { backgroundColor: palette.surface, width: 292 },
        overlayColor: 'rgba(0,0,0,0.55)',
        // Only from the drawer's own edge. Left as 'screen' it competes with
        // horizontal gestures inside content, and on Android it fights the
        // system back-swipe.
        swipeEdgeWidth: 40,
      }}>
      <Drawer.Screen name="(tabs)" />
    </Drawer>
  );
}
