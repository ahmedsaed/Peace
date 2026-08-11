import { type Href, router } from 'expo-router';
import { type DrawerContentComponentProps } from 'expo-router/drawer';
import { Image, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { Wordmark } from '@/components/wordmark';
import palette from '@/constants/palette';
import { buildInfo } from '@/lib/build-info';
import { formatVersion } from '@/lib/version';

/**
 * What lives in the side menu, and what does not.
 *
 * The five tabs are the app's *content*; the tab bar owns them. The drawer
 * holds the things you touch a handful of times a year — settings, getting your
 * data out — which is exactly why they should not spend a tab slot. Duplicating
 * the tabs in here would only give two answers to "where is Budgets".
 */
const ITEMS: { icon: string; label: string; hint: string; href: Href; testID: string }[] = [
  {
    icon: 'settings',
    label: 'Settings',
    hint: 'Currency, carry-over, API key',
    href: '/settings',
    testID: 'drawer-settings',
  },
  {
    icon: 'export',
    label: 'Export & backup',
    hint: 'CSV out, full backup and restore',
    href: '/export',
    testID: 'drawer-export',
  },
  {
    icon: 'info',
    label: 'About',
    hint: 'Version and licences',
    href: '/about',
    testID: 'drawer-about',
  },
];

export function DrawerContent({ navigation }: DrawerContentComponentProps) {
  const insets = useSafeAreaInsets();

  // Close first, then navigate. Pushing onto the root stack does not dismiss
  // the drawer by itself, so it would still be sitting open behind the new
  // screen when you came back.
  const go = (href: Href) => {
    navigation.closeDrawer();
    router.push(href);
  };

  return (
    <View
      className="flex-1 bg-surface"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View className="flex-row items-center gap-3 border-b border-line px-5 pb-5 pt-4">
        <Image
          source={require('../../assets/images/logo-mark.png')}
          style={{ width: 40, height: 40 }}
          resizeMode="contain"
        />
        <View>
          <Wordmark size={24} />
          <Text className="text-xs text-muted">Local-first. Nothing leaves the phone.</Text>
        </View>
      </View>

      <View className="py-2">
        {ITEMS.map((item) => (
          <Pressable
            key={item.testID}
            onPress={() => go(item.href)}
            testID={item.testID}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            className="flex-row items-center gap-4 px-5 py-3.5 active:bg-raised">
            <Icon name={item.icon} size={20} color={palette.muted} />
            <View className="flex-1">
              <Text className="text-[15px] font-medium text-ink">{item.label}</Text>
              <Text className="text-xs text-muted">{item.hint}</Text>
            </View>
          </Pressable>
        ))}
      </View>

      <View className="flex-1" />

      <Text className="px-5 pb-3 text-xs text-muted opacity-60" testID="drawer-version">
        {formatVersion(buildInfo)}
      </Text>
    </View>
  );
}
