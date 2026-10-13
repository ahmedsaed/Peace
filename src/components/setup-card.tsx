import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import { setupProgress, STEP_LABELS } from '@/lib/setup';
import { useSetting, useSettingsStore } from '@/state/settings';
import { useSetupFacts } from '@/state/setup';

/**
 * "Finish setting up" — what setup left for later, one tap from each.
 *
 * This is what makes skipping a step safe to offer: a step left behind is not
 * a decision made forever, it is a chip on the screen the app opens to. It
 * counts from what is actually TRUE (`setupProgress`), so a reminder switched
 * on in Settings drops off here too, and the card goes away by itself once
 * there is nothing left — or for good, from its close button.
 */
export function SetupCard() {
  const router = useRouter();
  const visible = useSetting('setupCard');
  const update = useSettingsStore((s) => s.update);
  const facts = useSetupFacts();

  if (!visible) return null;
  const { done, total, remaining } = setupProgress(facts);
  if (remaining.length === 0) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(250)}
      exiting={FadeOut.duration(200)}
      className="mx-4 mt-3 rounded-2xl bg-surface px-4 pb-3 pt-3"
      testID="setup-card">
      <View className="flex-row items-center">
        <Text className="flex-1 text-[15px] font-semibold text-ink">Finish setting up</Text>
        <Text className="text-xs text-muted" testID="setup-card-count">
          {done} of {total}
        </Text>
        <Pressable
          onPress={() => update('setupCard', false)}
          hitSlop={12}
          testID="setup-card-dismiss"
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          className="-mr-1 ml-2 h-7 w-7 items-center justify-center rounded-full active:bg-raised">
          <Icon name="close" size={12} color={palette.muted} />
        </Pressable>
      </View>

      <View className="mt-2 h-1 flex-row overflow-hidden rounded-full bg-line">
        <View className="h-1 rounded-full bg-accent" style={{ width: `${(done / total) * 100}%` }} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="-mx-4 mt-3"
        contentContainerClassName="gap-2 px-4">
        {remaining.map((step) => (
          <Pressable
            key={step}
            onPress={() => router.push({ pathname: '/setup', params: { step } })}
            testID={`setup-card-${step}`}
            accessibilityRole="button"
            className="flex-row items-center gap-1 rounded-full border border-line px-3 py-1.5 active:bg-raised">
            <Text className="text-sm text-ink">{STEP_LABELS[step]}</Text>
            <Icon name="chevron" size={10} color={palette.muted} />
          </Pressable>
        ))}
      </ScrollView>
    </Animated.View>
  );
}
