import { AssistantCard } from '@/components/assistant-card';
import { KeyNotice, SettingsPage } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';

/** Settings › AI › Penny. The switch is the consent; its sentence is on the card. */
export default function PennySettings() {
  return (
    <SettingsPage
      title="Penny"
      emblem="sparkle"
      color={SECTIONS.ai.color}
      intro="Ask about your spending in plain words. Penny answers from your own ledger, and every amount it gives is one your screens would show."
      testID="settings-ai-penny-page">
      <KeyNotice />
      <AssistantCard />
    </SettingsPage>
  );
}
