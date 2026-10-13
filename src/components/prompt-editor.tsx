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
 *
 * ALWAYS OPEN. It used to be folded behind "Add rules" / "Edit rules" with
 * Save and Cancel, because it shared one long Settings page with everything
 * else. Each AI feature has a page of its own now, so the rules are simply
 * there: what is written can be read without a tap, and changed in place.
 * It saves as you type — a moment after you stop — and once more as the page
 * closes, and says so. Saving only when the edit "ended" lost text on a
 * device: Back unmounts the field before Android reports the end of an edit.
 */

import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

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
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);

  // "Saved" is a confirmation, not a state: it fades after a moment.
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [saved]);

  // A moment after typing stops. Trimmed on the way out, so a trailing space
  // mid-sentence is not a change and the field never fights the cursor.
  useEffect(() => {
    if (draft.trim() === value) return;
    const timer = setTimeout(() => {
      onChange(draft.trim());
      setSaved(true);
    }, 600);
    return () => clearTimeout(timer);
  }, [draft, value, onChange]);

  // And whatever is still pending when the page closes. Refs, because the
  // cleanup runs once, at unmount, with whatever was current then.
  const latest = useRef({ draft, value, onChange });
  useEffect(() => {
    latest.current = { draft, value, onChange };
  });
  useEffect(
    () => () => {
      const { draft: pending, value: stored, onChange: save } = latest.current;
      if (pending.trim() !== stored) save(pending.trim());
    },
    []
  );

  return (
    <View className="border-t border-line pt-3" testID={testID}>
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-sm text-ink">{label}</Text>
        <Text className="text-xs text-income" testID={`${testID}-state`}>
          {saved ? 'Saved' : ''}
        </Text>
      </View>
      <Text className="mb-2 text-xs leading-4 text-muted">{hint}</Text>

      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder={example}
        placeholderTextColor={palette.muted}
        multiline
        textAlignVertical="top"
        autoCapitalize="sentences"
        autoCorrect={false}
        style={{ minHeight: 140 }}
        className="rounded-lg border border-line bg-ground px-3 py-2.5 text-sm leading-5 text-ink"
        testID={`${testID}-input`}
      />
      <Text className="mt-2 text-xs leading-4 text-muted">
        Peace already tells the model what each field means and hands it your accounts and
        categories. Write only what it could not work out for itself. Saved as you type.
      </Text>
    </View>
  );
}
