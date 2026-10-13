import { ReminderCard } from '@/components/reminder-card';
import { SettingsPage } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';

/** Settings › Reminder. The card holds its own logic and its readback. */
export default function ReminderSettings() {
  return (
    <SettingsPage
      title="Reminder"
      {...SECTIONS.reminder}
      intro="One notification in the evening, so the day's spending gets written down while you still remember it. Android posts it on its own — no server is involved, and nothing about your ledger leaves the phone."
      testID="settings-reminders">
      <ReminderCard />
    </SettingsPage>
  );
}
