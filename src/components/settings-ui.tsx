import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Segmented } from '@/components/form';
import { StackHeader } from '@/components/screen';
import palette from '@/constants/palette';
import { useGeminiKeyStore } from '@/state/gemini-key';

/**
 * The parts every Settings page is built from.
 *
 * Settings used to be one long page — currency, keypad, reporting, reminders,
 * the AI key, three AI features and bank messages in a single scroll, where
 * the switch you wanted was always below the fold and nothing said which
 * things belonged together. It is now an index of sections, each its own page
 * with a sentence saying what the section is for. These are the shared pieces,
 * so the eight pages read as one screen rather than eight.
 */

/**
 * A section page: header, then the colour and the sentence that say what the
 * section is for, then its controls. Same emblem as the matching setup step,
 * so somebody who met "Keypad" during setup recognises it here.
 */
export function SettingsPage({
  title,
  emblem,
  color,
  intro,
  testID,
  children,
}: {
  title: string;
  emblem: string;
  color: string;
  intro: string;
  testID: string;
  children: React.ReactNode;
}) {
  return (
    <View className="flex-1 bg-ground" testID={testID}>
      <StackHeader title={title} />
      <ScrollView contentContainerClassName="px-4 pb-12 pt-4" keyboardShouldPersistTaps="handled">
        <View className="mb-6 flex-row items-start gap-4 px-1">
          <View
            className="h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: color }}>
            <Icon name={emblem} size={22} color={palette.ink} />
          </View>
          <Text className="flex-1 text-sm leading-5 text-muted">{intro}</Text>
        </View>
        <View className="gap-6">{children}</View>
      </ScrollView>
    </View>
  );
}

/**
 * A labelled group of rows on one surface. `caption` is a sentence under the
 * title, for a group whose rows share something worth saying once — the AI
 * group's "sent to Google" rather than the same words on every row.
 */
export function Section({
  title,
  caption,
  testID,
  children,
}: {
  title?: string;
  caption?: string;
  testID?: string;
  children: React.ReactNode;
}) {
  return (
    <View testID={testID}>
      {title ? (
        <Text className="mb-2 px-1 text-[10px] uppercase tracking-widest text-muted">{title}</Text>
      ) : null}
      {caption ? <Text className="-mt-1 mb-2 px-1 text-xs leading-4 text-muted">{caption}</Text> : null}
      <View className="overflow-hidden rounded-xl bg-surface">{children}</View>
    </View>
  );
}

/**
 * One row on the Settings index: the section's emblem, its name, and what it
 * is set to NOW — so the index answers "is my reminder on?" without opening
 * anything, and a row that says "Off" is its own invitation.
 */
export function SectionLink({
  emblem,
  color,
  title,
  summary,
  onPress,
  testID,
  dim = false,
  last = false,
}: {
  emblem: string;
  color: string;
  title: string;
  summary: string;
  onPress: () => void;
  testID: string;
  /** Still tappable — its page explains itself — but visibly not running. */
  dim?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${summary}`}
      className={`flex-row items-center gap-3.5 px-4 py-3.5 active:bg-raised ${
        last ? '' : 'border-b border-line'
      }`}>
      <View
        className="h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: color, opacity: dim ? 0.4 : 1 }}>
        <Icon name={emblem} size={18} color={palette.ink} />
      </View>
      <View className="flex-1">
        <Text className="text-[15px] text-ink">{title}</Text>
        <Text className="text-xs leading-4 text-muted" numberOfLines={1} testID={`${testID}-summary`}>
          {summary}
        </Text>
      </View>
      <Icon name="chevron" size={14} color={palette.muted} />
    </Pressable>
  );
}

/**
 * A row whose value is one of a few named choices, all of them in view.
 *
 * Segmented rather than a picker sheet: with two options, a sheet is a tap to
 * open it, a tap to choose and nothing to show for either until you leave.
 */
export function Choice<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
  testIDPrefix,
  last = false,
}: {
  label: string;
  hint: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  testIDPrefix: string;
  last?: boolean;
}) {
  return (
    <View className={`gap-2 px-4 py-3.5 ${last ? '' : 'border-b border-line'}`}>
      <View>
        <Text className="text-[15px] text-ink">{label}</Text>
        <Text className="text-xs leading-4 text-muted">{hint}</Text>
      </View>
      <Segmented options={options} value={value} onChange={onChange} testIDPrefix={testIDPrefix} />
    </View>
  );
}

/**
 * A row whose value is a switch rather than a destination.
 *
 * The whole row is not pressable: a switch already has its own hit target, and
 * a row that toggles on tap AND carries a switch gives two controls for one
 * value that can disagree about what a tap meant.
 */
export function Toggle({
  label,
  hint,
  value,
  onChange,
  testID,
  last = false,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => void;
  testID: string;
  last?: boolean;
}) {
  return (
    <View
      className={`flex-row items-center gap-3 px-4 py-3.5 ${last ? '' : 'border-b border-line'}`}>
      <View className="flex-1">
        <Text className="text-[15px] text-ink">{label}</Text>
        <Text className="text-xs leading-4 text-muted">{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        testID={testID}
        accessibilityLabel={label}
        trackColor={{ false: palette.line, true: palette.accent }}
        thumbColor={palette.ink}
      />
    </View>
  );
}

/**
 * A row that leads somewhere — or, with no `onPress`, one that only reports.
 *
 * A row with nowhere to go keeps its place in the list rather than
 * disappearing, but loses the chevron and the press state: a control that
 * looks tappable and does nothing is the same lie as a switch that changes
 * nothing.
 */
export function Row({
  label,
  value,
  hint,
  onPress,
  testID,
  last = false,
}: {
  label: string;
  value: string;
  hint: string;
  onPress?: () => void;
  testID: string;
  last?: boolean;
}) {
  const className = `flex-row items-center gap-3 px-4 py-3.5 ${
    last ? '' : 'border-b border-line'
  }`;

  const body = (
    <>
      <View className="flex-1">
        <Text className="text-[15px] text-ink">{label}</Text>
        <Text className="text-xs leading-4 text-muted">{hint}</Text>
      </View>
      <Text
        className={`max-w-[45%] text-right text-sm ${onPress ? 'text-accent' : 'text-muted'}`}
        numberOfLines={1}>
        {value}
      </Text>
      {onPress ? <Icon name="chevron" size={14} color={palette.muted} /> : null}
    </>
  );

  if (!onPress) {
    return (
      <View className={className} testID={testID} accessibilityLabel={`${label}, ${value}`}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      className={`${className} active:bg-raised`}>
      {body}
    </Pressable>
  );
}

/**
 * "This runs on the Gemini key, which is not set" — at the top of every AI
 * feature's page, with the way to fix it.
 *
 * The key lives on the Settings page, one level up, so a feature page that only said
 * "needs a key" would send somebody hunting. Nothing at all once a key exists:
 * a notice that is always there stops being read.
 */
export function KeyNotice() {
  const router = useRouter();
  const hasKey = useGeminiKeyStore((state) => state.hasKey);
  if (hasKey !== false) return null;
  return (
    <View className="flex-row items-center gap-3 rounded-xl border border-line px-4 py-3" testID="key-notice">
      <Icon name="key" size={18} color={palette.muted} />
      <Text className="flex-1 text-sm leading-5 text-muted">
        Runs on your Gemini key, which is not set yet.
      </Text>
      <Pressable
        onPress={() => router.navigate('/settings')}
        testID="key-notice-add"
        accessibilityRole="button"
        className="rounded-full bg-accent px-4 py-2 active:opacity-80">
        <Text className="text-sm font-semibold text-accent-ink">Add a key</Text>
      </Pressable>
    </View>
  );
}
