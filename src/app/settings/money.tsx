import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { PickerSheet, type PickerOption } from '@/components/picker-sheet';
import { Row, Section, SettingsPage } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';
import { db } from '@/db/client';
import { listAccountsWithBalance } from '@/db/repo/accounts';
import { CURRENCIES, currencyName } from '@/lib/currencies';
import { useMoney } from '@/state/money';
import { useSettingsStore } from '@/state/settings';

/** Settings › Money: what everything is counted in, and where a record starts. */
export default function MoneySettings() {
  const money = useMoney();
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  const [sheet, setSheet] = useState<'currency' | 'account' | null>(null);

  const [accounts, setAccounts] = useState(() => listAccountsWithBalance(db));

  // Re-read on focus, like every other screen that shows rows from the ledger:
  // the default-account row names one, and it can be renamed or added to while
  // this screen sits mounted behind the editor.
  useFocusEffect(
    useCallback(() => {
      setAccounts(listAccountsWithBalance(db));
    }, [])
  );

  const defaultAccount = accounts.find((a) => a.id === settings.defaultAccountId);

  // The current currency is offered even when it is not on the curated list —
  // a region's currency detected at setup may not be.
  const listed = CURRENCIES.some((c) => c.code === settings.homeCurrency)
    ? CURRENCIES
    : [{ code: settings.homeCurrency, name: currencyName(settings.homeCurrency) }, ...CURRENCIES];
  const currencyOptions: PickerOption[] = listed.map((c) => ({
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
      detail: money(a.balanceMinor, a.currency),
      detailTone: a.balanceMinor < 0 ? ('negative' as const) : ('neutral' as const),
    })),
  ];

  return (
    <SettingsPage
      title="Money"
      {...SECTIONS.money}
      intro="The currency every total, budget and chart is counted in, and the account a new record starts on. Records in other currencies keep their own amount and the rate you gave them."
      testID="settings-money">
      <Section>
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
    </SettingsPage>
  );
}
