import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import { DatabaseProvider } from '@/db/provider';

import '@/global.css';

/**
 * Five tabs, mirroring the information architecture documented in
 * docs/research/mymoney.md. Records is the default because logging a spend is
 * the reason the app gets opened.
 */
const TABS: { name: string; title: string; icon: string }[] = [
  { name: 'index', title: 'Records', icon: 'records' },
  { name: 'analysis', title: 'Analysis', icon: 'analysis' },
  { name: 'budgets', title: 'Budgets', icon: 'budgets' },
  { name: 'accounts', title: 'Accounts', icon: 'accounts' },
  { name: 'categories', title: 'Categories', icon: 'categories' },
];

function AppTabs() {
  // Setting an explicit tabBarStyle height opts out of the automatic safe-area
  // handling, so the inset has to be added back by hand — otherwise the labels
  // sit underneath Android's gesture pill and become unreadable.
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: palette.ground },
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.muted,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.line,
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingTop: 6,
          paddingBottom: 6 + insets.bottom,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
      }}>
      {TABS.map(({ name, title, icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ color }) => <Icon name={icon} color={color} size={22} />,
            // Maestro matches on this; tab labels are the kind of thing that
            // gets reworded.
            tabBarButtonTestID: `tab-${name}`,
          }}
        />
      ))}
    </Tabs>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      {/* The app is dark-only, so the status bar is always light-on-dark. */}
      <StatusBar style="light" />
      <DatabaseProvider>
        <AppTabs />
      </DatabaseProvider>
    </SafeAreaProvider>
  );
}
