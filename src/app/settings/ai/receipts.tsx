import { ReceiptsCard } from '@/components/receipts-card';
import { AiNotice, SettingsPage } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';

/** Settings › AI › Receipts & invoices: reading a photo, a PDF or a text file into a record. */
export default function ReceiptSettings() {
  return (
    <SettingsPage
      title="Receipts & invoices"
      emblem="camera"
      color={SECTIONS.ai.color}
      testID="settings-ai-receipts-page">
      <AiNotice />
      <ReceiptsCard />
    </SettingsPage>
  );
}
