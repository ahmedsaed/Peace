import { Pressable, Text, TextInput, View } from 'react-native';

import { Icon, ICON_NAMES } from '@/components/icon';
import { useTheme } from '@/state/theme';

/** The default category palette from docs/design-system.md. */
export const SWATCHES = [
  '#B03A3A',
  '#C2622C',
  '#C99A2E',
  '#6E8B3D',
  '#2E7D46',
  '#2F8A78',
  '#2F6FA8',
  '#3B4E9E',
  '#6B4CA8',
  '#9C2D6B',
  '#A8475C',
  '#6B5B4A',
];

/**
 * What TalkBack calls each swatch. A colour circle has no text, so without a
 * name every one of them is announced as "button" and the picker is twelve
 * identical choices.
 */
const SWATCH_NAMES: Record<string, string> = {
  '#B03A3A': 'Red',
  '#C2622C': 'Orange',
  '#C99A2E': 'Mustard',
  '#6E8B3D': 'Olive',
  '#2E7D46': 'Green',
  '#2F8A78': 'Teal',
  '#2F6FA8': 'Blue',
  '#3B4E9E': 'Indigo',
  '#6B4CA8': 'Purple',
  '#9C2D6B': 'Plum',
  '#A8475C': 'Rose',
  '#6B5B4A': 'Brown',
};

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="mb-4">
      <Text className="mb-1.5 text-[10px] uppercase tracking-widest text-muted">{label}</Text>
      {children}
    </View>
  );
}

export function TextField({
  value,
  onChangeText,
  placeholder,
  testID,
  autoCapitalize = 'sentences',
  maxLength,
  keyboardType,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  testID?: string;
  autoCapitalize?: 'none' | 'sentences' | 'characters';
  maxLength?: number;
  keyboardType?: 'default' | 'numeric';
}) {
  const palette = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={palette.muted}
      testID={testID}
      autoCapitalize={autoCapitalize}
      maxLength={maxLength}
      keyboardType={keyboardType}
      className="rounded-lg bg-surface px-4 py-3 text-base text-ink"
    />
  );
}

/** Segmented choice, the same control as the record screen's type switch. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  testIDPrefix,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  disabled?: (value: T) => boolean;
  testIDPrefix: string;
}) {
  return (
    <View className="flex-row rounded-lg bg-surface p-1">
      {options.map((option) => {
        const locked = disabled?.(option.value) ?? false;
        return (
          <Pressable
            key={option.value}
            disabled={locked}
            onPress={() => onChange(option.value)}
            testID={`${testIDPrefix}-${option.value}`}
            accessibilityRole="button"
            className={`flex-1 items-center rounded-md py-2 ${
              value === option.value ? 'bg-raised' : ''
            }`}>
            <Text
              className={`text-sm ${
                value === option.value
                  ? 'font-semibold text-accent'
                  : locked
                    ? 'text-line'
                    : 'text-muted'
              }`}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  // Wraps for the same reason as the icons below it: the last few swatches were
  // clipped off the right edge with nothing to suggest they existed.
  return (
    <View className="flex-row flex-wrap gap-3">
      {SWATCHES.map((swatch) => (
        <Pressable
          key={swatch}
          onPress={() => onChange(swatch)}
          testID={`swatch-${swatch.slice(1)}`}
          accessibilityRole="radio"
          accessibilityLabel={SWATCH_NAMES[swatch] ?? 'Colour'}
          accessibilityState={{ selected: value === swatch }}
          // The selected swatch gets a ring rather than a tick: a checkmark on a
          // saturated circle is hard to read, and the ring keeps the colour itself
          // unobstructed, which is the thing being chosen.
          className={`h-9 w-9 rounded-full ${value === swatch ? 'border-2 border-ink' : ''}`}
          style={{ backgroundColor: swatch }}
        />
      ))}
    </View>
  );
}

export function IconPicker({
  value,
  color,
  onChange,
}: {
  value: string;
  color: string;
  onChange: (next: string) => void;
}) {
  const palette = useTheme();
  // Wraps rather than scrolls horizontally. A horizontal strip hid two thirds of
  // the set behind a gesture nobody thinks to make, on a form with empty space
  // below it — you cannot choose from a list you do not know is there.
  return (
    <View className="flex-row flex-wrap gap-3">
      {ICON_NAMES.map((name) => (
        <Pressable
          key={name}
          onPress={() => onChange(name)}
          testID={`icon-${name}`}
          accessibilityRole="radio"
          // The slug is the only name a glyph has; "fast-food" reads fine.
          accessibilityLabel={name.replace(/-/g, ' ')}
          accessibilityState={{ selected: value === name }}
          className={`h-11 w-11 items-center justify-center rounded-full ${
            value === name ? 'border-2 border-ink' : ''
          }`}
          style={{ backgroundColor: value === name ? color : palette.surface }}>
          <Icon name={name} size={19} color={value === name ? '#FFFFFF' : palette.muted} />
        </Pressable>
      ))}
    </View>
  );
}

/** Header shared by the account and category forms. */
export function FormHeader({
  title,
  onCancel,
  onSave,
  canSave,
}: {
  title: string;
  onCancel: () => void;
  onSave: () => void;
  canSave: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between px-4 py-3">
      <Pressable
        onPress={onCancel}
        testID="form-cancel"
        accessibilityRole="button"
        className="rounded-lg border border-line px-5 py-2.5 active:opacity-70">
        <Text className="text-sm font-medium text-muted">Cancel</Text>
      </Pressable>

      <Text className="text-sm font-medium text-muted" testID="form-title">
        {title}
      </Text>

      <Pressable
        onPress={onSave}
        disabled={!canSave}
        testID="form-save"
        accessibilityRole="button"
        className={`rounded-lg px-7 py-2.5 active:opacity-80 ${canSave ? 'bg-accent' : 'bg-surface'}`}>
        <Text className={`text-sm font-semibold ${canSave ? 'text-accent-ink' : 'text-line'}`}>
          Save
        </Text>
      </Pressable>
    </View>
  );
}

export function DangerButton({
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
      className="self-start rounded-lg border border-expense/40 px-4 py-2 active:opacity-70">
      <Text className="text-sm font-medium text-expense">{label}</Text>
    </Pressable>
  );
}
