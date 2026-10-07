/**
 * The assistant's settings: whether it is on, and which model it talks to.
 *
 * THE SWITCH IS THE CONSENT. The sentence above it says what leaves the phone
 * when you ask a question, and nothing is sent until the switch beneath that
 * sentence is turned on — so nobody arrives at a chat screen that has already
 * been talking to Google without having read it. Off by default.
 *
 * The model row appears only when the assistant is on AND a key exists, for
 * the same reason the reading features' model row waits for a key: a control
 * for something that cannot run is a control that silently does nothing.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';

import { ModelRow } from '@/components/model-picker';
import palette from '@/constants/palette';
import { getGeminiKey } from '@/lib/secrets';
import { useSettingsStore } from '@/state/settings';

export function AssistantCard() {
  const enabled = useSettingsStore((state) => state.settings.assistantEnabled);
  const model = useSettingsStore((state) => state.settings.assistantModel);
  const update = useSettingsStore((state) => state.update);
  const [hasKey, setHasKey] = useState<boolean | null>(null);

  // On focus: the key is added in the card above, on this same screen, and
  // the row below has to notice without a restart.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void getGeminiKey().then((key) => alive && setHasKey(key !== null));
      return () => {
        alive = false;
      };
    }, [])
  );

  return (
    <View className="rounded-xl bg-surface p-4" testID="assistant-card">
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <Text className="mb-1 text-base font-semibold text-ink">Assistant</Text>
          <Text className="text-sm leading-5 text-muted">
            Ask about your money in plain words, and have it make changes you approve first.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={(next) => {
            update('assistantEnabled', next);
            // The key card above sets the key; re-read it so the row below
            // reflects one added a moment ago.
            void getGeminiKey().then((key) => setHasKey(key !== null));
          }}
          testID="assistant-enabled"
          accessibilityLabel="Use the assistant"
          trackColor={{ false: palette.line, true: palette.accent }}
          thumbColor={palette.ink}
        />
      </View>

      <Text className="mt-3 text-xs leading-5 text-muted" testID="assistant-privacy">
        To answer, the assistant sends your question and what it reads from your ledger — totals, notes,
        account, category and tag names — to Google&apos;s Gemini using your key. Your data stays stored on
        this phone. Turning this on means you accept that.
      </Text>

      {enabled ? (
        hasKey ? (
          <View className="mt-4 gap-4 border-t border-line pt-4">
            <ModelRow
              label="Model"
              value={model}
              onChange={(id) => update('assistantModel', id)}
              sheetTitle="Assistant model"
              testIDPrefix="assistant-model"
            />
            <Pressable
              onPress={() => router.push('/assistant')}
              testID="assistant-open"
              accessibilityRole="button"
              className="items-center rounded-lg bg-accent py-2.5 active:opacity-80">
              <Text className="text-sm font-semibold text-accent-ink">Open the assistant</Text>
            </Pressable>
          </View>
        ) : hasKey === false ? (
          <Text className="mt-3 text-xs text-expense" testID="assistant-needs-key">
            Add a Gemini key above to use it.
          </Text>
        ) : null
      ) : null}
    </View>
  );
}
