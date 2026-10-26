/**
 * Speaking a record or a question — everything except the key, which is shared.
 *
 * Shaped like the Receipts card: the switch beside the sentence that says what
 * it does and what it sends, and the rules box only while it is on.
 */

import { Switch, Text, View } from 'react-native';

import { ModelRow } from '@/components/model-picker';
import { PromptEditor } from '@/components/prompt-editor';
import { useAi } from '@/state/ai';
import { useSettingsStore } from '@/state/settings';
import { useSwitchColors } from '@/state/theme';

export function VoiceCard() {
  const switchColors = useSwitchColors();
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  // Wanted and possible — Use AI, some key and this switch — as Receipts does.
  const ai = useAi();
  const enabled = ai.ready && settings.voiceEnabled;

  return (
    <View className="rounded-xl bg-surface p-4" testID="voice-card">
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <Text className="text-[15px] leading-6 text-ink">
            Tap the mic on a new record, or in Penny, and say it in Arabic, English or both. The
            recording is sent to the model you choose here, read once and deleted — it is never kept.
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
        <View className="mt-4 gap-4 border-t border-line pt-4">
          <ModelRow
            label="Listen with"
            value={settings.voiceModel}
            onChange={(stored) => update('voiceModel', stored)}
            sheetTitle="Model for voice"
            testIDPrefix="voice-model"
            listen
          />
          {/* Only when the listener writes words down rather than hearing. */}
          {settings.modelAbilities[settings.voiceModel]?.transcription ? (
            <ModelRow
              label="Then read with"
              value={settings.voiceReadModel}
              onChange={(stored) => update('voiceReadModel', stored)}
              sheetTitle="Model that reads what was said"
              testIDPrefix="voice-read-model"
            />
          ) : null}
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
