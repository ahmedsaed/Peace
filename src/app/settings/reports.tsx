import { Section, SettingsPage, Toggle } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';
import { useSettingsStore } from '@/state/settings';

/** Settings › Records & reports: what the screens add up, and where. */
export default function ReportsSettings() {
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);

  return (
    <SettingsPage
      title="Records & reports"
      {...SECTIONS.reports}
      intro="How the records list and the month headers count. Neither changes a single record — only what is added up and shown."
      testID="settings-reports">
      <Section>
        <Toggle
          label="Carry the balance forward"
          hint="Show what each month started with, and your running total. Nothing is added to any budget — a limit stays a limit."
          value={settings.carryOver}
          onChange={(next) => update('carryOver', next)}
          testID="setting-carry-over"
        />
        <Toggle
          label="Daily totals"
          hint="Put each day's net beside its date in the records list. Transfers between your own accounts are left out."
          value={settings.showTotal}
          onChange={(next) => update('showTotal', next)}
          testID="setting-show-total"
          last
        />
      </Section>
    </SettingsPage>
  );
}
