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
import { useCallback } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';

import { ModelRow } from '@/components/model-picker';
import palette from '@/constants/palette';
import { useAi } from '@/state/ai';
import { useGeminiKeyStore } from '@/state/gemini-key';
import { useSettingsStore } from '@/state/settings';

export function AssistantCard() {
  // Shown on only when Penny can answer — a key, Use AI and this switch. With
  // no key the switch is off and muted; her own setting is kept for later.
  const ai = useAi();
  const enabled = ai.penny;
  const model = useSettingsStore((state) => state.settings.assistantModel);
  const update = useSettingsStore((state) => state.update);
  // Re-read on focus: the key is saved on another page of Settings.
  const refreshKey = useGeminiKeyStore((state) => state.refresh);
  useFocusEffect(
    useCallback(() => {
      void refreshKey();
    }, [refreshKey])
  );

  return (
    <View className="rounded-xl bg-surface p-4" testID="assistant-card">
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <Text className="text-[15px] leading-6 text-ink">
            Your assistant. Ask about your money in plain words — Penny only changes anything once you
            approve it.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={(next) => {
            update('assistantEnabled', next);
          }}
          disabled={!ai.ready}
          testID="assistant-enabled"
          accessibilityLabel="Use Penny"
          trackColor={{ false: palette.line, true: palette.accent }}
          thumbColor={palette.ink}
        />
      </View>

      <Text className="mt-3 text-xs leading-5 text-muted" testID="assistant-privacy">
        To answer, Penny sends your question and what it reads from your ledger — totals, notes,
        account, category and tag names — to Google&apos;s Gemini using your key. Your data stays stored on
        this phone. Turning this on means you accept that.
      </Text>

      {enabled ? (
        <View className="mt-4 gap-4 border-t border-line pt-4">
          <ModelRow
            label="Model"
            value={model}
            onChange={(id) => update('assistantModel', id)}
            sheetTitle="Penny's model"
            testIDPrefix="assistant-model"
          />
          <Pressable
            onPress={() => router.push('/assistant')}
            testID="assistant-open"
            accessibilityRole="button"
            className="items-center rounded-lg bg-accent py-2.5 active:opacity-80">
            <Text className="text-sm font-semibold text-accent-ink">Open Penny</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
