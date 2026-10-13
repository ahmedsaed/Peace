import { Pressable, Text, View } from 'react-native';

import { KeypadPreview } from '@/components/setup/keypad-preview';
import { SettingsPage } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';
import { useSettingsStore } from '@/state/settings';

/**
 * Settings › Keypad: chosen by looking at it, exactly as in setup.
 *
 * The two words "calculator" and "phone" mean nothing to somebody who has
 * never thought about which row their thumb expects on top — the picture does.
 * The previews are drawn from the same table the record screen uses, so what
 * is picked here is what appears there.
 */
export default function KeypadSettings() {
  const digits = useSettingsStore((s) => s.settings.keypadDigits);
  const operators = useSettingsStore((s) => s.settings.keypadOperators);
  const update = useSettingsStore((s) => s.update);

  return (
    <SettingsPage
      title="Keypad"
      {...SECTIONS.keypad}
      intro="The record screen's keypad. Pick the one your thumbs already know — a wrong digit is the most expensive mistake the app can let you make."
      testID="settings-keypad">
      <View>
        <Text className="mb-2 px-1 text-[10px] uppercase tracking-widest text-muted">Digits</Text>
        <View className="flex-row gap-3">
          <KeypadPreview
            digits="calculator"
            operators={operators}
            selected={digits !== 'phone'}
            label="Calculator · 7 8 9 on top"
            onPress={() => update('keypadDigits', 'calculator')}
            testID="setting-keypad-digits-calculator"
          />
          <KeypadPreview
            digits="phone"
            operators={operators}
            selected={digits === 'phone'}
            label="Phone · 1 2 3 on top"
            onPress={() => update('keypadDigits', 'phone')}
            testID="setting-keypad-digits-phone"
          />
        </View>
      </View>

      <View>
        <Text className="mb-2 px-1 text-[10px] uppercase tracking-widest text-muted">
          + − × ÷ go on the
        </Text>
        <View className="flex-row rounded-xl bg-surface p-1">
          {(['left', 'right'] as const).map((side) => (
            <Pressable
              key={side}
              onPress={() => update('keypadOperators', side)}
              testID={`setting-keypad-operators-${side}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: operators === side }}
              className={`flex-1 items-center rounded-lg py-2.5 ${
                operators === side ? 'bg-raised' : ''
              }`}>
              <Text className={operators === side ? 'font-semibold text-ink' : 'text-muted'}>
                {side === 'left' ? 'Left' : 'Right'}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text className="mt-2 px-1 text-xs leading-4 text-muted">
          Right suits a right thumb reaching for the operators; left keeps them out of its way.
        </Text>
      </View>
    </SettingsPage>
  );
}
