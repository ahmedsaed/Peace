import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import { PickerSheet, type PickerOption } from '@/components/picker-sheet';
import { StackHeader } from '@/components/screen';
import { db } from '@/db/client';
import { listAccountsWithBalance } from '@/db/repo/accounts';
import { CURRENCIES, currencyName } from '@/lib/currencies';
import { formatMinor } from '@/lib/money';
import { useSettingsStore } from '@/state/settings';

/**
 * Settings.
 *
 * ONLY SETTINGS THAT DO SOMETHING APPEAR HERE. `carryOver`, `viewMode` and
 * `showTotal` are defined and stored, but nothing reads them until budgets and
 * analysis exist — so showing them would be three switches that silently do
 * nothing, which is worse than an empty screen and exactly the kind of thing
 * that teaches you to stop trusting an app. They land with the features that
 * consume them.
 */
export default function SettingsScreen() {
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  const [sheet, setSheet] = useState<'currency' | 'account' | null>(null);

  const accounts = useMemo(() => listAccountsWithBalance(db), []);
  const defaultAccount = accounts.find((a) => a.id === settings.defaultAccountId);

  const currencyOptions: PickerOption[] = CURRENCIES.map((c) => ({
    id: c.code,
    label: c.name,
    icon: 'cash',
    detail: c.code,
  }));

  // "First account" is a real choice, not a null state, so it gets a row of its
  // own rather than being something you achieve by deselecting.
  const accountOptions: PickerOption[] = [
    { id: '', label: 'First account', icon: 'dots', detail: 'No preference' },
    ...accounts.map((a) => ({
      id: a.id,
      label: a.name,
      icon: a.icon,
      color: a.color,
      detail: formatMinor(a.balanceMinor, a.currency),
      detailTone: a.balanceMinor < 0 ? ('negative' as const) : ('neutral' as const),
    })),
  ];

  return (
    <View className="flex-1 bg-ground" testID="settings-screen">
      <StackHeader title="Settings" />

      <ScrollView contentContainerClassName="px-4 pb-10 pt-4">
        <Section title="Money">
          <Row
            label="Home currency"
            value={`${currencyName(settings.homeCurrency)} · ${settings.homeCurrency}`}
            hint="What totals and balances are shown in."
            onPress={() => setSheet('currency')}
            testID="setting-home-currency"
          />
          <Row
            label="Default account"
            value={defaultAccount?.name ?? 'First account'}
            hint="Pre-selected when you start a new record."
            onPress={() => setSheet('account')}
            testID="setting-default-account"
            last
          />
        </Section>

        <Text className="px-1 pt-6 text-xs leading-5 text-muted opacity-70">
          Budget carry-over and the default date range arrive with budgets and analysis. The Gemini
          API key comes with receipt capture — it is stored on this device and never included in a
          build.
        </Text>
      </ScrollView>

      <PickerSheet
        visible={sheet === 'currency'}
        title="Home currency"
        options={currencyOptions}
        selectedId={settings.homeCurrency}
        onSelect={(code) => {
          update('homeCurrency', code);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        testID="sheet-currency"
      />

      <PickerSheet
        visible={sheet === 'account'}
        title="Default account"
        options={accountOptions}
        selectedId={settings.defaultAccountId}
        onSelect={(id) => {
          update('defaultAccountId', id);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        testID="sheet-default-account"
      />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text className="mb-2 px-1 text-[10px] uppercase tracking-widest text-muted">{title}</Text>
      <View className="overflow-hidden rounded-xl bg-surface">{children}</View>
    </View>
  );
}

function Row({
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
  onPress: () => void;
  testID: string;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      className={`flex-row items-center gap-3 px-4 py-3.5 active:bg-raised ${
        last ? '' : 'border-b border-line'
      }`}>
      <View className="flex-1">
        <Text className="text-[15px] text-ink">{label}</Text>
        <Text className="text-xs text-muted">{hint}</Text>
      </View>
      <Text className="max-w-[45%] text-right text-sm text-accent" numberOfLines={1}>
        {value}
      </Text>
      <Icon name="chevron" size={14} color={palette.muted} />
    </Pressable>
  );
}
