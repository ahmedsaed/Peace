import { BankMessagesCard } from '@/components/bank-card';
import { SettingsPage } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';

/** Settings › Bank messages. "Allow…" leads to setup's disclosure, never past it. */
export default function BankSettings() {
  return (
    <SettingsPage
      title="Bank messages"
      {...SECTIONS.bank}
      intro="Your bank's payment alerts, offered as records to approve. Only messages from banks you name are read, with your AI key — everything else is ignored as it arrives."
      testID="settings-bank">
      <BankMessagesCard />
    </SettingsPage>
  );
}
