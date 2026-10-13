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
      intro="Photograph a receipt on the record screen and Peace fills in the amount, the date and the shop. The photo is sent to Google Gemini only when you tap to read it."
      testID="settings-ai-receipts-page">
      <KeyNotice />
      <ReceiptsCard />
    </SettingsPage>
  );
}
