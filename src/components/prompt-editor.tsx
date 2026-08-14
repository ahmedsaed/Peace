/**
 * Editing the finance half of a prompt.
 *
 * THE CONTRACT IS NOT EDITABLE, and that split is the whole design. What a
 * "total" means, which card is which, what to ignore — that is knowledge about
 * one person's money, and they know it better than this app does. The output
 * shape is not: an instruction that could break the JSON would turn a bad
 * sentence into an unparseable reply, so the system half stays in code and is
 * wrapped around this.
 *
 * Empty means "use the shipped default" rather than "send nothing", so clearing
 * the box is a reset. The default is shown as the placeholder, which makes the
 * field double as documentation of what the model is actually being told.
 */

import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import palette from '@/constants/palette';

export function PromptEditor({
  label,
  hint,
  value,
  fallback,
  onChange,
  testID,
}: {
  label: string;
  hint: string;
  /** The user's own text, or '' when they have not written any. */
  value: string;
  /** What the app sends when `value` is empty. Shown as the placeholder. */
  fallback: string;
  onChange: (next: string) => void;
  testID: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const customised = value.trim() !== '';

  return (
    <View className="border-t border-line pt-3">
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-sm text-ink">{label}</Text>
        <Text className="text-xs text-muted" testID={`${testID}-state`}>
          {customised ? 'Customised' : 'Default'}
        </Text>
      </View>
      <Text className="mb-2 text-xs leading-4 text-muted">{hint}</Text>

      {open ? (
        <>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={fallback}
            placeholderTextColor={palette.muted}
            multiline
            textAlignVertical="top"
            autoCapitalize="none"
            autoCorrect={false}
            style={{ minHeight: 160 }}
            className="mb-2 rounded-lg border border-line px-3 py-2.5 text-xs leading-5 text-ink"
            testID={`${testID}-input`}
          />
          <Text className="mb-2 text-xs leading-4 text-muted">
            Peace adds the rest — what it is reading, how to answer, and your own accounts and
            categories. Leave this empty to go back to the default.
          </Text>
          <View className="flex-row gap-2">
            <Button
              label="Save"
              primary
              testID={`${testID}-save`}
              onPress={() => {
                onChange(draft.trim());
                setOpen(false);
              }}
            />
            <Button
              label="Cancel"
              testID={`${testID}-cancel`}
              onPress={() => {
                setDraft(value);
                setOpen(false);
              }}
            />
            {customised ? (
              <Button
                label="Reset"
                testID={`${testID}-reset`}
                onPress={() => {
                  setDraft('');
                  onChange('');
                  setOpen(false);
                }}
              />
            ) : null}
          </View>
        </>
      ) : (
        <Button
          label={customised ? 'Edit instructions' : 'Add instructions'}
          testID={`${testID}-edit`}
          onPress={() => {
            // Seeded with the DEFAULT rather than an empty box the first time:
            // editing a prompt from scratch means guessing what the app already
            // says, and the useful edit is almost always an addition to it.
            setDraft(value.trim() === '' ? fallback : value);
            setOpen(true);
          }}
        />
      )}
    </View>
  );
}

function Button({
  label,
  onPress,
  primary,
  testID,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      className={`rounded-lg px-4 py-2.5 active:opacity-80 ${
        primary ? 'bg-accent' : 'border border-line'
      }`}>
      <Text className={`text-sm font-semibold ${primary ? 'text-accent-ink' : 'text-muted'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
