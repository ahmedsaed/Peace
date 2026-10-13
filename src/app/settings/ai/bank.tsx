import { BankMessagesCard } from '@/components/bank-card';
import { AiNotice, SettingsPage } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';

/** Settings › AI › Bank messages. "Allow…" leads to setup's disclosure, never past it. */
export default function BankSettings() {
  return (
    <SettingsPage
      title="Bank messages"
      {...SECTIONS.bank}
      testID="settings-bank">
      <AiNotice />
      <BankMessagesCard />
    </SettingsPage>
  );
}
