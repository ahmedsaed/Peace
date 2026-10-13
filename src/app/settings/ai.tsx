import { AssistantCard } from '@/components/assistant-card';
import { GeminiKeyCard } from '@/components/gemini-key';
import { ReceiptsCard } from '@/components/receipts-card';
import { SettingsPage } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';

/**
 * Settings › AI. The key first, because everything below it runs on it — and
 * it is not a receipt setting, so it is not buried under one.
 */
export default function AiSettings() {
  return (
    <SettingsPage
      title="AI — receipts and Penny"
      {...SECTIONS.ai}
      intro="Reading receipts, reading bank messages and Penny all run on your own Google Gemini key. Only Google sees what is sent, and only for the features you turn on."
      testID="settings-ai">
      <GeminiKeyCard />
      <ReceiptsCard />
      <AssistantCard />
    </SettingsPage>
  );
}
