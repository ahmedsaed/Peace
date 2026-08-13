import { type Href, router } from 'expo-router';
import { type DrawerContentComponentProps, useDrawerStatus } from 'expo-router/drawer';
import { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { Wordmark } from '@/components/wordmark';
import palette from '@/constants/palette';
import { buildInfo } from '@/lib/build-info';
import { backupDue, describeAge } from '@/lib/drive-backup';
import { formatVersion } from '@/lib/version';
import type { Settings } from '@/lib/settings';
import { useSetting } from '@/state/settings';

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
    icon: 'refresh',
    label: 'Recurring',
    hint: 'Standing orders and instalments',
    href: '/recurring',
    testID: 'drawer-recurring',
  },
  {
    icon: 'analysis',
    label: 'Portfolio',
    hint: 'Target allocation and rebalancing',
    href: '/portfolio',
    testID: 'drawer-portfolio',
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
  const driveAccount = useSetting('driveAccount');
  const cadence = useSetting('driveCadence');
  const lastBackupAt = useSetting('driveLastBackupAt');
  const drawerStatus = useDrawerStatus();
  const connected = driveAccount.length > 0;

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
          {/* "Nothing leaves the phone" stops being true the moment Drive is
              connected — and it would sit directly above a card saying when it
              last left. Copy that contradicts the screen it is on is worse than
              copy that says less. */}
          <Text className="text-xs text-muted">
            {connected ? 'Local-first. Backed up to your Drive.' : 'Local-first. Nothing leaves the phone.'}
          </Text>
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

      {/* Only when there is something to report. A card saying "never backed
          up" to someone who has not set Drive up is nagging about a feature
          they did not ask for. */}
      {connected ? (
        <BackupCard
          // REMOUNTED WHEN THE DRAWER OPENS. The drawer mounts once and stays
          // mounted, so a clock captured at first render froze at app launch —
          // the card claimed a backup was five hours old while the export
          // screen, pushed fresh each visit, correctly said sixteen. Changing
          // the key runs the initialiser again, which reads the clock without
          // the impurity of doing it in a render body or the `setState` in an
          // effect that the compiler refuses.
          key={drawerStatus}
          account={driveAccount}
          cadence={cadence}
          lastBackupAt={lastBackupAt}
          onPress={() => go('/export')}
        />
      ) : null}

      <Text className="px-5 pb-3 text-xs text-muted opacity-60" testID="drawer-version">
        {formatVersion(buildInfo)}
      </Text>
    </View>
  );
}

/** The backup line at the foot of the drawer. */
function BackupCard({
  account,
  cadence,
  lastBackupAt,
  onPress,
}: {
  account: string;
  cadence: Settings['driveCadence'];
  lastBackupAt: number;
  onPress: () => void;
}) {
  const [now] = useState(() => Date.now());
  const overdue = lastBackupAt > 0 && backupDue({ cadence, lastBackupAt }, now);

  return (
    <Pressable
      onPress={onPress}
      testID="drawer-backup-card"
      accessibilityRole="button"
      accessibilityLabel="Backup status"
      className="mx-4 mb-3 flex-row items-center gap-3 rounded-xl bg-raised px-4 py-3 active:opacity-80">
      <Icon name="cloud" size={18} color={overdue ? palette.expense : palette.muted} />
      <View className="flex-1">
        <Text
          className={`text-[13px] ${overdue ? 'text-expense' : 'text-ink'}`}
          testID="drawer-backup-age">
          {describeAge(lastBackupAt > 0 ? lastBackupAt : null, now)}
          {overdue ? ' · overdue' : ''}
        </Text>
        <Text className="text-xs text-muted" numberOfLines={1}>
          {account}
        </Text>
      </View>
    </Pressable>
  );
}
