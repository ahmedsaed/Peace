import { useState } from 'react';

import { PickerSheet, type PickerOption } from '@/components/picker-sheet';
import { Choice, Row, Section, SettingsPage } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';
import { CURRENCIES, currencyName } from '@/lib/currencies';
import { formatPeriod, ordinal, periodOf } from '@/lib/period';
import type { WeekStart } from '@/lib/settings';
import { resolveWeekStart, useSettingsStore } from '@/state/settings';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "The 25th" — or, for the 1st, what that means. */
const describeMonthStart = (day: number) =>
  day === 1 ? 'The 1st · calendar months' : `The ${ordinal(day)}`;

/** Settings › Money & months: what everything is counted in, and when a month begins. */
export default function MoneySettings() {
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  const [sheet, setSheet] = useState<'currency' | 'month' | null>(null);

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

  /**
   * Every possible start day, each showing the dates THIS month would cover —
   * "25th · Sep 25 – Oct 24" says what choosing it does, where "25th" alone
   * leaves the reader to work out which way the month moves.
   */
  const now = new Date();
  const monthOptions: PickerOption[] = Array.from({ length: 28 }, (_, i) => {
    const day = i + 1;
    return {
      id: String(day),
      label: day === 1 ? '1st · calendar months' : ordinal(day),
      icon: 'calendar',
      detail: formatPeriod(periodOf(now, day), day),
    };
  });

  const phoneDay = WEEKDAYS[resolveWeekStart('phone')];

  return (
    <SettingsPage
      title="Money & months"
      {...SECTIONS.money}
      intro="What everything is counted in, and when a month begins. Records in other currencies keep their own amount and the rate you gave them."
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

      <Section title="Months and weeks">
        <Row
          label="Month starts on"
          value={describeMonthStart(settings.monthStartDay)}
          hint={
            settings.monthStartDay === 1
              ? 'Paid on the 25th? Start your months on payday, so each budget runs from one pay to the next.'
              : `This month is ${formatPeriod(periodOf(now))}. Records, budgets, charts and Penny all count months this way.`
          }
          onPress={() => setSheet('month')}
          testID="setting-month-start"
        />
        <Choice<WeekStart>
          label="Week starts on"
          hint={`For the calendar when you pick a date, and for Penny's week-by-week answers. Your phone says ${phoneDay}.`}
          options={[
            { value: 'phone', label: 'Phone' },
            { value: 'monday', label: 'Mon' },
            { value: 'sunday', label: 'Sun' },
            { value: 'saturday', label: 'Sat' },
          ]}
          value={settings.weekStart}
          onChange={(next) => update('weekStart', next)}
          testIDPrefix="setting-week-start"
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
        visible={sheet === 'month'}
        title="Month starts on"
        options={monthOptions}
        selectedId={String(settings.monthStartDay)}
        onSelect={(id) => {
          update('monthStartDay', Number(id));
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        testID="sheet-month-start"
      />
    </SettingsPage>
  );
}
