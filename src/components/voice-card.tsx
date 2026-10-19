/**
 * Speaking a record or a question — everything except the key, which is shared.
 *
 * Shaped like the Receipts card: the switch beside the sentence that says what
 * it does and what it sends, and the rules box only while it is on.
 */

import { Switch, Text, View } from 'react-native';

import { PromptEditor } from '@/components/prompt-editor';
import { useAi } from '@/state/ai';
import { useSettingsStore } from '@/state/settings';
import { useSwitchColors } from '@/state/theme';

export function VoiceCard() {
  const switchColors = useSwitchColors();
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  // Shows whether voice can RUN — a key, Use AI and this switch — as Receipts does.
  const ai = useAi();
  const enabled = ai.voice;

  return (
    <View className="rounded-xl bg-surface p-4" testID="voice-card">
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <Text className="text-[15px] leading-6 text-ink">
            Tap the mic on a new record, or in Penny, and say it in Arabic, English or both. The
            recording is sent to Gemini, read once and deleted — it is never kept.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={(next) => update('voiceEnabled', next)}
          disabled={!ai.ready}
          testID="voice-enabled"
          accessibilityLabel="Speak records and questions"
          {...switchColors}
        />
      </View>

      {enabled ? (
        <View className="mt-4">
          <PromptEditor
            label="Your rules"
            hint="Anything a spoken record could not know — what you call an account, a word you use for a category. Most people need none."
            example={'"The card" means CIB Visa.\n"مواصلات" is Transport.'}
            value={settings.voiceGuidance}
            onChange={(next) => update('voiceGuidance', next)}
            testID="voice-guidance"
          />
        </View>
      ) : ai.ready ? (
        <Text className="mt-3 text-xs leading-5 text-muted" testID="voice-off">
          Off: no mic on the record screen or in Penny.
        </Text>
      ) : null}
    </View>
  );
}
