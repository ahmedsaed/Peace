import * as Device from 'expo-device';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedIcon } from '@/components/animated-icon';
import { HintRow } from '@/components/hint-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { formatMinor } from '@/lib/money';

function getDevMenuHint() {
  if (Platform.OS === 'web') {
    return <ThemedText type="small">use browser devtools</ThemedText>;
  }
  if (Device.isDevice) {
    return (
      <ThemedText type="small">
        shake device or press <ThemedText type="code">m</ThemedText> in terminal
      </ThemedText>
    );
  }
  const shortcut = Platform.OS === 'android' ? 'cmd+m (or ctrl+m)' : 'cmd+d';
  return (
    <ThemedText type="small">
      press <ThemedText type="code">{shortcut}</ThemedText>
    </ThemedText>
  );
}

export default function HomeScreen() {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} testID="home-screen">
        <ThemedView style={styles.heroSection}>
          <AnimatedIcon />
          <ThemedText type="title" style={styles.title}>
            Welcome to&nbsp;Expo
          </ThemedText>
        </ThemedView>

        {/* Toolchain smoke check: renders the "Ledger" palette tokens on-device.
            Delete once real screens exist — until then it is the canary that
            tells us NativeWind and tailwind.config.js are still wired up. */}
        <View className="mx-6 mb-4 rounded-xl bg-surface p-4" testID="palette-check">
          <Text className="mb-3 text-xs uppercase tracking-widest text-muted">
            Ledger palette
          </Text>
          <View className="flex-row items-center justify-between border-b border-line pb-2">
            <Text className="text-sm text-ink">Salary</Text>
            <Text className="text-sm font-semibold text-income" testID="nw-income">
              {formatMinor(1250000, 'EGP', { showSign: true })}
            </Text>
          </View>
          <View className="flex-row items-center justify-between border-b border-line py-2">
            <Text className="text-sm text-ink">Food</Text>
            <Text className="text-sm font-semibold text-expense" testID="nw-expense">
              {formatMinor(-8000, 'EGP', { showSign: true })}
            </Text>
          </View>
          <View className="flex-row items-center justify-between pt-2">
            <Text className="text-sm text-ink">Bank → Credit Card</Text>
            <Text className="text-sm font-semibold text-transfer" testID="nw-transfer">
              {formatMinor(1075300, 'EGP')}
            </Text>
          </View>
        </View>

        <ThemedText type="code" style={styles.code}>
          get started
        </ThemedText>

        <ThemedView type="backgroundElement" style={styles.stepContainer}>
          <HintRow
            title="Try editing"
            hint={<ThemedText type="code">src/app/index.tsx</ThemedText>}
          />
          <HintRow title="Dev tools" hint={getDevMenuHint()} />
          <HintRow
            title="Fresh start"
            hint={<ThemedText type="code">npm run reset-project</ThemedText>}
          />
        </ThemedView>

        {Platform.OS === 'web' && <WebBadge />}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  heroSection: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
  },
  title: {
    textAlign: 'center',
  },
  code: {
    textTransform: 'uppercase',
  },
  stepContainer: {
    gap: Spacing.three,
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    borderRadius: Spacing.four,
  },
});
