import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { PickerSheet, type PickerOption } from '@/components/picker-sheet';
import { KeypadPreview } from '@/components/setup/keypad-preview';
import { Row, Section, SettingsPage } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';
import { db } from '@/db/client';
import { listAccountsWithBalance } from '@/db/repo/accounts';
import { useMoney } from '@/state/money';
import { useSettingsStore } from '@/state/settings';

/**
 * Settings › Recording: how a new record starts — the account it opens on, and
 * the keypad the amount is typed with. Both shape the same few seconds, which
 * is why the default account lives here rather than with the currency.
 *
 * The keypad is chosen by looking at it, exactly as in setup.
 *
 * The two words "calculator" and "phone" mean nothing to somebody who has
 * never thought about which row their thumb expects on top — the picture does.
 * The previews are drawn from the same table the record screen uses, so what
 * is picked here is what appears there.
 */
export default function RecordingSettings() {
  const money = useMoney();
  const digits = useSettingsStore((s) => s.settings.keypadDigits);
  const operators = useSettingsStore((s) => s.settings.keypadOperators);
  const defaultAccountId = useSettingsStore((s) => s.settings.defaultAccountId);
  const update = useSettingsStore((s) => s.update);
  const [picking, setPicking] = useState(false);

  // Re-read on focus: an account can be renamed or added while this screen
  // sits mounted behind the editor.
  const [accounts, setAccounts] = useState(() => listAccountsWithBalance(db));
  useFocusEffect(useCallback(() => setAccounts(listAccountsWithBalance(db)), []));
  const defaultAccount = accounts.find((a) => a.id === defaultAccountId);

  // "First account" is a real choice, not a null state, so it gets a row of its
  // own rather than being something you achieve by deselecting.
  const accountOptions: PickerOption[] = [
    { id: '', label: 'First account', icon: 'dots', detail: 'No preference' },
    ...accounts.map((a) => ({
      id: a.id,
      label: a.name,
      icon: a.icon,
      color: a.color,
      detail: money(a.balanceMinor, a.currency),
      detailTone: a.balanceMinor < 0 ? ('negative' as const) : ('neutral' as const),
    })),
  ];

  return (
    <SettingsPage
      title="Recording"
      {...SECTIONS.keypad}
      intro="How a new record starts: the account it opens on, and the keypad you type the amount with. Pick the keypad your thumbs already know — a wrong digit is the most expensive mistake the app can let you make."
      testID="settings-recording">
      <Section>
        <Row
          label="Default account"
          value={defaultAccount?.name ?? 'First account'}
          hint="Pre-selected when you start a new record."
          onPress={() => setPicking(true)}
          testID="setting-default-account"
          last
        />
      </Section>

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

      <PickerSheet
        visible={picking}
        title="Default account"
        options={accountOptions}
        selectedId={defaultAccountId}
        onSelect={(id) => {
          update('defaultAccountId', id);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
        testID="sheet-default-account"
      />
    </SettingsPage>
  );
}
