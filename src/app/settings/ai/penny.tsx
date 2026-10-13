import { AssistantCard } from '@/components/assistant-card';
import { AiNotice, SettingsPage } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';

/** Settings › AI › Penny. The switch is the consent; its sentence is on the card. */
export default function PennySettings() {
  return (
    <SettingsPage
      title="Penny"
      emblem="sparkle"
      color={SECTIONS.ai.color}
      testID="settings-ai-penny-page">
      <AiNotice />
      <AssistantCard />
    </SettingsPage>
  );
}
