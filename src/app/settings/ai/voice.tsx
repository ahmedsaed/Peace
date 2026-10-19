import { AiNotice, SettingsPage } from '@/components/settings-ui';
import { VoiceCard } from '@/components/voice-card';
import { SECTIONS } from '@/constants/sections';

/** Settings › AI › Voice: speaking a record, or a question to Penny. */
export default function VoiceSettings() {
  return (
    <SettingsPage title="Voice" emblem="mic" color={SECTIONS.ai.color} testID="settings-ai-voice-page">
      <AiNotice />
      <VoiceCard />
    </SettingsPage>
  );
}
