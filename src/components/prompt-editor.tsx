/**
 * Editing the rules only the account holder knows.
 *
 * THE BOX HOLDS THEIR HALF AND NOTHING ELSE. It once seeded itself with the
 * app's own field rules — what a "total" means, how a direction must be read —
 * which is the output contract, not a preference: it put the wiring in a
 * settings box, invited someone to delete a line the parser depends on, and
 * buried the one thing they were there to write. That half is now appended
 * under the hood and never shown.
 *
 * So this starts EMPTY, and empty is the normal state rather than a gap to be
 * filled. The placeholder is an EXAMPLE of the kind of sentence that belongs
 * here, never text that would be sent.
 */

import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import palette from '@/constants/palette';

export function PromptEditor({
  label,
  hint,
  example,
  value,
  onChange,
  testID,
}: {
  label: string;
  hint: string;
  /** A sample instruction, shown as the placeholder. NEVER sent to the model. */
  example: string;
  /** The user's own text. Empty for almost everybody. */
  value: string;
  onChange: (next: string) => void;
  testID: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const added = value.trim() !== '';

  return (
    <View className="border-t border-line pt-3">
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-sm text-ink">{label}</Text>
        <Text className="text-xs text-muted" testID={`${testID}-state`}>
          {added ? 'Added' : 'None'}
        </Text>
      </View>
      <Text className="mb-2 text-xs leading-4 text-muted">{hint}</Text>

      {open ? (
        <>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={example}
            placeholderTextColor={palette.muted}
            multiline
            textAlignVertical="top"
            autoCapitalize="sentences"
            autoCorrect={false}
            style={{ minHeight: 120 }}
            className="mb-2 rounded-lg border border-line px-3 py-2.5 text-xs leading-5 text-ink"
            testID={`${testID}-input`}
          />
          <Text className="mb-2 text-xs leading-4 text-muted">
            Peace already tells the model what each field means and hands it your accounts and
            categories. Write only what it could not work out for itself.
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
            {added ? (
              <Button
                label="Clear"
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
        <>
          {added ? (
            <Text className="mb-2 text-xs leading-5 text-ink" testID={`${testID}-current`}>
              {value}
            </Text>
          ) : null}
          <Button
            label={added ? 'Edit rules' : 'Add rules'}
            testID={`${testID}-edit`}
            onPress={() => {
              // Opens on THEIR text, or on nothing. Never on the app's own rules.
              setDraft(value);
              setOpen(true);
            }}
          />
        </>
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
