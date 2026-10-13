import { ReceiptsCard } from '@/components/receipts-card';
import { KeyNotice, SettingsPage } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';

/** Settings › AI › Receipts. */
export default function ReceiptSettings() {
  return (
    <SettingsPage
      title="Receipts"
      emblem="camera"
      color={SECTIONS.ai.color}
      testID="settings-ai-receipts-page">
      <KeyNotice />
      <ReceiptsCard />
    </SettingsPage>
  );
}
