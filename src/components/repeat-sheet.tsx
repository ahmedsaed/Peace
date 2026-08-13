import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import palette from '@/constants/palette';
import { useKeyboardHeight } from '@/lib/layout';
import { describeRecurrence, type Frequency, type Recurrence } from '@/lib/recurrence';

/**
 * How often a record repeats — and NOTHING ELSE.
 *
 * Amount, account, category, currency, note and date all belong to the record
 * screen, which already has a keypad, a category picker and an account picker
 * built for them. An earlier version of this feature had its own form with chip
 * lists standing in for all of that: a worse copy of a screen that already
 * existed, and a second place to fix every time either changed.
 *
 * So this asks the one question the record screen cannot already answer.
 */

export type Repeat = {
  frequency: Frequency;
  interval: number;
  /** Monthly: day of month. Null takes it from the record's own date. */
  anchorDay: number | null;
  endsOn: string | null;
};

export const NO_REPEAT: Repeat | null = null;

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

/** The label on the record screen's button. */
export function describeRepeat(repeat: Repeat | null, startsOn: string): string {
  if (!repeat) return 'Does not repeat';
  return describeRecurrence({ ...repeat, startsOn, endsOn: repeat.endsOn } as Recurrence);
}

export function RepeatSheet({
  visible,
  value,
  startsOn,
  onClose,
  onChange,
}: {
  visible: boolean;
  value: Repeat | null;
  /** The record's own date, so the preview reads as the real schedule. */
  startsOn: string;
  onClose: () => void;
  onChange: (repeat: Repeat | null) => void;
}) {
  const [draft, setDraft] = useState<Repeat>(
    value ?? { frequency: 'monthly', interval: 1, anchorDay: null, endsOn: null }
  );
  const keyboardHeight = useKeyboardHeight();
  const [everyText, setEveryText] = useState(String(value?.interval ?? 1));
  const [dayText, setDayText] = useState(value?.anchorDay ? String(value.anchorDay) : '');

  const commit = () => {
    const interval = Math.max(1, Math.trunc(Number(everyText) || 1));
    const day = dayText.trim() === '' ? null : Number(dayText);
    const anchorDay =
      draft.frequency === 'monthly' && day !== null && day >= 1 && day <= 31 ? day : null;

    onChange({ ...draft, interval, anchorDay });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Dismiss" />

      {/* LIFTED ABOVE THE KEYBOARD BY HAND. A Modal is its own window and does
          not resize with the keyboard the way the app's window does, so the day
          field and the buttons below it sit underneath it — scrolling cannot
          help, because the sheet still believes it has the whole screen. */}
      <View
        className="max-h-[80%] rounded-t-2xl border-t border-line bg-ground pb-8"
        style={{ elevation: 16, marginBottom: keyboardHeight }}
        testID="repeat-sheet">
        <View className="border-b border-line px-5 py-4">
          <Text className="text-base font-semibold text-ink">Repeat</Text>
          <Text className="text-xs text-muted">
            Saves a rule as well as this record. What it owes later turns up on the records list to
            be added or skipped.
          </Text>
        </View>

        <ScrollView contentContainerClassName="px-5 py-4 gap-4" keyboardShouldPersistTaps="handled">
          <View className="flex-row flex-wrap gap-2">
            {FREQUENCIES.map((f) => (
              <Chip
                key={f.value}
                label={f.label}
                selected={draft.frequency === f.value}
                onPress={() => setDraft((d) => ({ ...d, frequency: f.value }))}
                testID={`repeat-${f.value}`}
              />
            ))}
          </View>

          <View className="flex-row items-center gap-3">
            <Text className="text-sm text-muted">Every</Text>
            <TextInput
              value={everyText}
              onChangeText={setEveryText}
              keyboardType="number-pad"
              className="w-16 rounded-lg border border-line px-3 py-2 text-center text-ink"
              testID="repeat-interval"
            />
            <Text className="text-sm text-muted">
              {draft.frequency === 'daily'
                ? 'days'
                : draft.frequency === 'weekly'
                  ? 'weeks'
                  : draft.frequency === 'monthly'
                    ? 'months'
                    : 'years'}
            </Text>
          </View>

          {draft.frequency === 'monthly' ? (
            <View className="gap-1">
              <Text className="text-xs uppercase tracking-wide text-muted">Day of the month</Text>
              <TextInput
                value={dayText}
                onChangeText={setDayText}
                placeholder="Same day as this record"
                placeholderTextColor={palette.muted}
                keyboardType="number-pad"
                className="rounded-lg border border-line px-3 py-2 text-ink"
                testID="repeat-day"
              />
              {/* Worth saying, because it is the one behaviour people expect to
                  be wrong: a rule on the 31st fires on the 28th in February and
                  is back on the 31st in March. */}
              <Text className="text-xs text-muted">
                A day later than a short month lands on its last day, then goes back.
              </Text>
            </View>
          ) : null}

          <View className="rounded-lg bg-surface px-4 py-3">
            <Text className="text-sm text-ink" testID="repeat-preview">
              {describeRepeat(
                {
                  ...draft,
                  interval: Math.max(1, Math.trunc(Number(everyText) || 1)),
                  anchorDay:
                    draft.frequency === 'monthly' && dayText.trim() !== ''
                      ? Number(dayText)
                      : null,
                },
                startsOn
              )}
            </Text>
          </View>
        </ScrollView>

        <View className="flex-row gap-2 border-t border-line px-5 pt-4">
          <Pressable
            onPress={commit}
            testID="repeat-save"
            accessibilityRole="button"
            className="rounded-lg bg-accent px-5 py-2.5 active:opacity-80">
            <Text className="text-sm font-semibold text-accent-ink">Repeat this</Text>
          </Pressable>

          {value ? (
            <Pressable
              onPress={() => {
                onChange(null);
                onClose();
              }}
              testID="repeat-clear"
              accessibilityRole="button"
              className="rounded-lg border border-expense/40 px-5 py-2.5 active:opacity-80">
              <Text className="text-sm font-semibold text-expense">Stop repeating</Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={onClose}
            testID="repeat-cancel"
            accessibilityRole="button"
            className="rounded-lg border border-line px-5 py-2.5 active:opacity-80">
            <Text className="text-sm font-semibold text-ink">Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`rounded-full px-3.5 py-1.5 active:opacity-80 ${
        selected ? 'bg-accent' : 'border border-line'
      }`}>
      <Text className={`text-sm ${selected ? 'font-semibold text-accent-ink' : 'text-ink'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
