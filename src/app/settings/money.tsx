import { useState } from 'react';

import { PickerSheet, type PickerOption } from '@/components/picker-sheet';
import { Row, Section, SettingsPage } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';
import { CURRENCIES, currencyName } from '@/lib/currencies';
import { useSettingsStore } from '@/state/settings';

/** Settings › Money: what everything is counted in. */
export default function MoneySettings() {
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  const [sheet, setSheet] = useState<'currency' | null>(null);

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

  return (
    <SettingsPage
      title="Money"
      {...SECTIONS.money}
      intro="The currency every total, budget and chart is counted in. Records in other currencies keep their own amount and the rate you gave them."
      testID="settings-money">
      <Section>
        <Row
          label="Home currency"
          value={`${currencyName(settings.homeCurrency)} · ${settings.homeCurrency}`}
          hint="What totals and balances are shown in."
          onPress={() => setSheet('currency')}
          testID="setting-home-currency"
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

    </SettingsPage>
  );
}
