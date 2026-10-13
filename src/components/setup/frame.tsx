import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import { useKeyboardOverlap } from '@/lib/layout';

/**
 * The shape every setup step shares.
 *
 * Content scrolls and the actions are PINNED, for the same reason the record
 * screen pins its keypad: in split-screen there are 340dp to work with, and a
 * Continue button you have to scroll to find is a step nobody finishes. The
 * actions also ride above the keyboard, measured the way the assistant's
 * composer is — a modal-free screen on an edge-to-edge Android does not resize
 * for it.
 *
 * Each step's emblem is a coloured circle, like a category's: colour in this
 * app is data rather than chrome, and the step colours come from the category
 * palette so setup looks like the app it is setting up.
 */
export function StepFrame({
  emblem,
  color,
  eyebrow,
  title,
  body,
  children,
  actions,
  testID,
}: {
  emblem: string;
  color: string;
  eyebrow?: string;
  title: string;
  body?: string;
  children?: React.ReactNode;
  actions: React.ReactNode;
  testID: string;
}) {
  const keyboard = useKeyboardOverlap();
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1" testID={testID}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pb-6 pt-4"
        keyboardShouldPersistTaps="handled">
        <Animated.View entering={ZoomIn.duration(360).springify().damping(14)}>
          <View
            className="h-16 w-16 items-center justify-center rounded-full"
            style={{ backgroundColor: color }}>
            <Icon name={emblem} size={30} color={palette.ink} />
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(320).delay(60)} className="mt-6">
          {eyebrow ? (
            <Text className="mb-2 text-[11px] uppercase tracking-widest text-muted">{eyebrow}</Text>
          ) : null}
          <Text className="text-[28px] font-semibold leading-9 text-ink">{title}</Text>
          {body ? <Text className="mt-3 text-base leading-6 text-muted">{body}</Text> : null}
        </Animated.View>

        {children ? (
          <Animated.View entering={FadeInDown.duration(320).delay(140)} className="mt-7">
            {children}
          </Animated.View>
        ) : null}
      </ScrollView>

      <Animated.View
        entering={FadeIn.duration(300).delay(200)}
        className="gap-1 border-t border-line bg-ground px-6 pt-4"
        style={{ paddingBottom: Math.max(insets.bottom, 12) + 4 + keyboard }}>
        {actions}
      </Animated.View>
    </View>
  );
}

/** The one strong action on a step. Accent, because it is the interaction. */
export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  testID: string;
}) {
  const inert = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy }}
      className={`h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-accent active:opacity-80 ${
        disabled ? 'opacity-40' : ''
      }`}>
      {busy ? <ActivityIndicator color={palette['accent-ink']} /> : null}
      <Text className="text-base font-semibold text-accent-ink">{label}</Text>
    </Pressable>
  );
}

/** A second real choice — outlined, so it never competes with the primary. */
export function SecondaryButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      className="mt-1 h-12 items-center justify-center rounded-2xl border border-line active:bg-surface">
      <Text className="text-[15px] text-ink">{label}</Text>
    </Pressable>
  );
}

/**
 * "Not now". Quiet, but a full-width target: skipping is a legitimate answer
 * and must never be hard to hit.
 */
export function QuietButton({
  label = 'Not now',
  onPress,
  testID,
}: {
  label?: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      className="h-11 items-center justify-center active:opacity-60">
      <Text className="text-[15px] text-muted">{label}</Text>
    </Pressable>
  );
}

/** A small line under the controls: what just happened, or why it did not. */
export function Note({
  tone = 'muted',
  children,
  testID,
}: {
  tone?: 'muted' | 'good' | 'bad';
  children: React.ReactNode;
  testID?: string;
}) {
  const color = tone === 'good' ? 'text-income' : tone === 'bad' ? 'text-expense' : 'text-muted';
  return (
    <Text className={`mt-3 text-sm leading-5 ${color}`} testID={testID}>
      {children}
    </Text>
  );
}
