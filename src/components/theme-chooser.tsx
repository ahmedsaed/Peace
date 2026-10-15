import { Pressable, Text, useColorScheme, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemePreview } from '@/components/theme-preview';
import { THEME_IDS, themeColors, themeLabel, type ThemeId, type ThemeSetting } from '@/lib/theme';
import { useSettingsStore } from '@/state/settings';
import { useTheme } from '@/state/theme';

/**
 * Which theme, or follow the phone — as a GRID OF MINIATURES, not a list of
 * names. Every option is the records screen in its own colours, so choosing is
 * looking, and the difference between two warm themes is visible before either
 * is tried. The previews take their colours from `themeColors(id)` on purpose:
 * this is the one control that draws themes other than the active one.
 *
 * Shared by Settings › Appearance and the setup step, so the two can never
 * offer different choices. A tap writes the setting at once.
 */
export function ThemeChooser() {
  const setting = useSettingsStore((state) => state.settings.theme);
  const update = useSettingsStore((state) => state.update);
  const phone = useColorScheme();
  const choose = (next: ThemeSetting) => update('theme', next);
  // Only true of the PHONE while following it: a chosen theme forces the
  // app's night mode, and `useColorScheme` then reports the app's.
  const now = setting !== 'system' ? null : phone === 'light' ? 'light' : phone === 'dark' ? 'dark' : null;

  return (
    <View className="gap-3">
      <Option
        value="system"
        selected={setting === 'system'}
        onPress={choose}
        label="Match phone"
        hint={`${themeLabel('ledger')} when your phone is dark, ${themeLabel('paper')} when it is light.${
          now ? ` It is ${now} now.` : ''
        }`}>
        <View className="flex-row gap-2">
          <View className="flex-1">
            <ThemePreview colors={themeColors('ledger')} height={150} />
          </View>
          <View className="flex-1">
            <ThemePreview colors={themeColors('paper')} height={150} />
          </View>
        </View>
      </Option>

      <View className="flex-row flex-wrap justify-between gap-y-3">
        {THEME_IDS.map((id) => (
          <View key={id} style={{ width: '48.5%' }}>
            <Option
              value={id}
              selected={setting === id}
              onPress={choose}
              label={themeLabel(id)}
              hint={HINTS[id]}>
              <ThemePreview colors={themeColors(id)} />
            </Option>
          </View>
        ))}
      </View>
    </View>
  );
}

const HINTS: Record<ThemeId, string> = {
  ledger: 'Warm and dark. Easy on the eyes at night.',
  graphite: 'True black, the most contrast. Kind to OLED batteries.',
  paper: 'Warm and light, for daylight.',
  mist: 'Cool and light, in blue.',
};

/** One choice: its preview, then its name and a line about it. */
function Option({
  value,
  selected,
  onPress,
  label,
  hint,
  children,
}: {
  value: ThemeSetting;
  selected: boolean;
  onPress: (value: ThemeSetting) => void;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  const palette = useTheme();
  return (
    <Pressable
      onPress={() => onPress(value)}
      testID={`theme-option-${value}`}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}. ${hint}`}
      className={`gap-2.5 rounded-2xl border-2 bg-surface p-2.5 active:opacity-80 ${
        selected ? 'border-accent' : 'border-transparent'
      }`}>
      {children}
      <View className="flex-row items-start gap-2 px-0.5">
        <View className="flex-1">
          <Text className="text-[15px] font-semibold text-ink">{label}</Text>
          <Text className="text-xs leading-4 text-muted">{hint}</Text>
        </View>
        <View
          className={`mt-0.5 h-5 w-5 items-center justify-center rounded-full ${
            selected ? 'bg-accent' : 'border-2 border-muted'
          }`}
          testID={selected ? 'theme-selected' : undefined}>
          {selected ? <Icon name="check" size={12} color={palette['accent-ink']} /> : null}
        </View>
      </View>
    </Pressable>
  );
}
