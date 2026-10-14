import { Pressable, Text, useColorScheme, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Section, SettingsPage } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';
import { THEME_IDS, themeColors, themeLabel, type ThemeColors, type ThemeSetting } from '@/lib/theme';
import { useSettingsStore } from '@/state/settings';
import { useTheme } from '@/state/theme';

/**
 * Settings › Appearance: which theme, or follow the phone.
 *
 * Every option is drawn IN ITS OWN COLOURS — a strip of ground, a card, a
 * figure in and a figure out — so choosing is looking, not reading names and
 * guessing. The previews take their colours from `themeColors(id)` on purpose:
 * this is the one screen that draws themes other than the active one.
 */
export default function AppearanceSettings() {
  const palette = useTheme();
  const setting = useSettingsStore((state) => state.settings.theme);
  const update = useSettingsStore((state) => state.update);
  const phone = useColorScheme();
  const choose = (next: ThemeSetting) => update('theme', next);

  const options: { value: ThemeSetting; label: string; hint: string }[] = [
    {
      value: 'system',
      label: 'Match phone',
      hint: `${themeLabel('ledger')} when your phone is dark, ${themeLabel('paper')} when it is light.`,
    },
    ...THEME_IDS.map((id) => ({ value: id, label: themeLabel(id), hint: HINTS[id] })),
  ];

  return (
    <SettingsPage
      title="Appearance"
      {...SECTIONS.appearance}
      intro="How Peace looks. Nothing about your records changes — only the colours they are drawn in."
      testID="settings-appearance">
      <Section>
        {options.map((option, i) => {
          const selected = setting === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => choose(option.value)}
              testID={`theme-option-${option.value}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              className={`flex-row items-center gap-3.5 px-4 py-3.5 active:bg-raised ${
                i === options.length - 1 ? '' : 'border-b border-line'
              }`}>
              {option.value === 'system' ? (
                <View className="flex-row overflow-hidden rounded-lg">
                  <Swatch colors={themeColors('ledger')} half="left" />
                  <Swatch colors={themeColors('paper')} half="right" />
                </View>
              ) : (
                <Swatch colors={themeColors(option.value)} />
              )}
              <View className="flex-1">
                <Text className="text-[15px] text-ink">{option.label}</Text>
                <Text className="text-xs leading-4 text-muted">
                  {option.value === 'system' && phone && phone !== 'unspecified'
                    ? `${option.hint} It is ${phone} now.`
                    : option.hint}
                </Text>
              </View>
              <View
                className={`h-6 w-6 items-center justify-center rounded-full ${
                  selected ? 'bg-accent' : 'border-2 border-muted'
                }`}
                testID={selected ? 'theme-selected' : undefined}>
                {selected ? <Icon name="check" size={14} color={palette['accent-ink']} /> : null}
              </View>
            </Pressable>
          );
        })}
      </Section>
    </SettingsPage>
  );
}

const HINTS: Record<(typeof THEME_IDS)[number], string> = {
  ledger: 'Warm and dark. Easy on the eyes at night.',
  graphite: 'True black, with the most contrast. Saves battery on OLED screens.',
  paper: 'Warm and light, for daylight.',
  mist: 'Cool and light, in blue.',
};

/**
 * A theme in miniature: its ground, a card on it, a line of text, and one
 * figure out and one in. Drawn with that theme's literal colours.
 */
function Swatch({ colors: c, half }: { colors: ThemeColors; half?: 'left' | 'right' }) {
  return (
    <View
      className={half ? '' : 'rounded-lg'}
      style={{
        width: half ? 28 : 56,
        height: 44,
        backgroundColor: c.ground,
        borderWidth: half ? 0 : 1,
        borderColor: c.line,
        padding: 5,
        alignItems: half === 'right' ? 'flex-end' : 'flex-start',
        overflow: 'hidden',
      }}>
      <View
        style={{
          width: half ? 40 : 44,
          height: 32,
          borderRadius: 4,
          backgroundColor: c.surface,
          padding: 4,
          gap: 3,
          marginLeft: half === 'right' ? -20 : 0,
          marginRight: half === 'left' ? -20 : 0,
        }}>
        <View style={{ width: 26, height: 3, borderRadius: 2, backgroundColor: c.ink }} />
        <View style={{ width: 18, height: 3, borderRadius: 2, backgroundColor: c.muted }} />
        <View style={{ flexDirection: 'row', gap: 3 }}>
          <View style={{ width: 12, height: 4, borderRadius: 2, backgroundColor: c.expense }} />
          <View style={{ width: 12, height: 4, borderRadius: 2, backgroundColor: c.income }} />
          <View style={{ width: 6, height: 4, borderRadius: 2, backgroundColor: c.accent }} />
        </View>
      </View>
    </View>
  );
}
