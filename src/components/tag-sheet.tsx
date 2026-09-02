import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import type { Tag } from '@/db/schema';
import { useKeyboardHeight } from '@/lib/layout';
import { isNewTagName, tagKey, tagNameProblem } from '@/lib/tag';

/**
 * Choosing labels, and managing them, in one sheet.
 *
 * MANAGEMENT IS INLINE, not a second sheet. A modal over a modal is unreliable
 * on Android — the same reason the search filters are a panel rather than a
 * sheet — so long-pressing a row expands it in place instead of opening
 * anything. Tags have to be renameable and archivable somewhere, and a screen
 * of their own would duplicate a picker that already lists every one of them.
 *
 * Multi-select, so it closes on Done rather than on the first tap: unlike an
 * account or a category, the answer is a SET, and a sheet that closed after one
 * choice would have to be reopened for the second.
 */
export function TagSheet({
  visible,
  tags,
  selectedIds,
  onToggle,
  onCreate,
  onRename,
  onArchive,
  onClose,
  testID = 'tag-sheet',
}: {
  visible: boolean;
  tags: Tag[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  /** Omitted where tags are being FILTERED by rather than assigned. */
  onCreate?: (name: string) => void;
  onRename?: (id: string, name: string) => void;
  onArchive?: (id: string) => void;
  onClose: () => void;
  testID?: string;
}) {
  const keyboardHeight = useKeyboardHeight();
  const [draft, setDraft] = useState('');
  /** The row expanded for renaming, if any. */
  const [editing, setEditing] = useState<Tag | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const needle = tagKey(draft);
  const shown = useMemo(
    () => (needle === '' ? tags : tags.filter((tag) => tag.normalised.includes(needle))),
    [tags, needle]
  );
  const canCreate = !!onCreate && isNewTagName(draft, tags);

  function close() {
    setDraft('');
    setEditing(null);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable className="flex-1" onPress={close} accessibilityLabel="Dismiss" />

      {/* LIFTED ABOVE THE KEYBOARD BY HAND. A Modal is its own window and does
          not resize with the keyboard the way the app's window does, so
          everything below the field — which here is the entire list — would sit
          underneath it the moment anyone typed. */}
      <View
        className="max-h-[70%] rounded-t-2xl border-t border-line bg-ground pb-8"
        style={{ elevation: 16, marginBottom: keyboardHeight }}
        testID={testID}>
        <View className="border-b border-line px-5 pb-3 pt-5">
          <View className="flex-row items-center gap-3">
            <Text className="flex-1 text-base font-semibold text-ink">Tags</Text>
            <Pressable onPress={close} testID="tag-done" accessibilityRole="button">
              <Text className="text-sm font-semibold text-accent">Done</Text>
            </Pressable>
          </View>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={onCreate ? 'Add or find a tag' : 'Find a tag'}
            placeholderTextColor={palette.muted}
            autoCapitalize="none"
            autoCorrect={false}
            testID="tag-input"
            className="mt-3 rounded-lg bg-raised px-3 py-2.5 text-sm text-ink"
          />
          {/* Said only when there is something to say. "Too long" while the
              field is empty is a screen telling you off for nothing. */}
          {draft.trim() !== '' && tagNameProblem(draft) === 'too-long' ? (
            <Text className="mt-2 text-xs text-expense" testID="tag-error">
              That name is too long for a tag.
            </Text>
          ) : null}
        </View>

        <ScrollView keyboardShouldPersistTaps="handled">
          {canCreate ? (
            <Pressable
              onPress={() => {
                onCreate?.(draft);
                setDraft('');
              }}
              testID="tag-create"
              accessibilityRole="button"
              className="flex-row items-center gap-3 border-b border-line px-5 py-3 active:bg-surface">
              <Icon name="label" size={18} color={palette.accent} />
              <Text className="flex-1 text-sm text-accent" numberOfLines={1}>
                Create “{draft.trim()}”
              </Text>
            </Pressable>
          ) : null}

          {shown.map((tag) =>
            editing?.id === tag.id ? (
              <View key={tag.id} className="border-b border-line px-5 py-3" testID="tag-editing">
                <TextInput
                  value={editDraft}
                  onChangeText={setEditDraft}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="tag-rename-input"
                  className="rounded-lg bg-raised px-3 py-2.5 text-sm text-ink"
                />
                <View className="mt-2 flex-row items-center gap-2">
                  <SmallButton label="Cancel" onPress={() => setEditing(null)} testID="tag-cancel" />
                  <View className="flex-1" />
                  {onArchive ? (
                    // Not "Delete". A finished project's spending was still part
                    // of it, and removing the tag would rewrite that.
                    <SmallButton
                      label="Archive"
                      onPress={() => {
                        onArchive(tag.id);
                        setEditing(null);
                      }}
                      testID="tag-archive"
                    />
                  ) : null}
                  <SmallButton
                    label="Rename"
                    primary
                    onPress={() => {
                      onRename?.(tag.id, editDraft);
                      setEditing(null);
                    }}
                    testID="tag-rename"
                  />
                </View>
              </View>
            ) : (
              <Pressable
                key={tag.id}
                onPress={() => onToggle(tag.id)}
                onLongPress={
                  onRename
                    ? () => {
                        setEditing(tag);
                        setEditDraft(tag.name);
                      }
                    : undefined
                }
                testID={`tag-row-${tag.normalised.replace(/[^a-z0-9]+/g, '-')}`}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedIds.includes(tag.id) }}
                className="flex-row items-center gap-3 border-b border-line px-5 py-3 active:bg-surface">
                <Icon
                  name="label"
                  size={18}
                  color={selectedIds.includes(tag.id) ? palette.accent : palette.muted}
                />
                <Text className="flex-1 text-sm text-ink" numberOfLines={1}>
                  {tag.name}
                </Text>
                {/* The same tick the account and category pickers use — a
                    character, not a glyph, because there is no `check` in the
                    icon map and inventing one to duplicate a "✓" that already
                    renders identically everywhere else would be a second shape
                    for one meaning. */}
                {selectedIds.includes(tag.id) ? (
                  <Text className="text-base text-accent">✓</Text>
                ) : null}
              </Pressable>
            )
          )}

          {shown.length === 0 && !canCreate ? (
            <Text className="px-5 py-6 text-center text-xs text-muted" testID="tag-empty">
              {tags.length === 0
                ? 'No tags yet. Type a name to make one.'
                : 'No tag matches that.'}
            </Text>
          ) : null}
        </ScrollView>

        {onRename ? (
          <Text className="px-5 pt-3 text-[11px] text-muted">
            Hold a tag to rename or archive it. Archiving keeps it on its records.
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

function SmallButton({
  label,
  onPress,
  testID,
  primary = false,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      className={`rounded-lg px-3 py-2 ${primary ? 'bg-accent' : 'bg-raised'}`}>
      <Text className={`text-xs font-semibold ${primary ? 'text-accent-ink' : 'text-ink'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The tags on the record being edited, with the control that changes them.
 *
 * Chips rather than a bare button, and the `+` is the last chip rather than a
 * separate control: assignment and current state are then the same thing. A
 * button on its own cannot say what is already tagged — which is why the
 * camera beside it carries a count.
 *
 * FULL HEIGHT ONLY. In split-screen the attach bar already collapses to a
 * single button and the note is one 44px line; there is no room for a row that
 * wraps, and tagging is not the thing that cannot wait when you are logging a
 * record with a bank notification open beside you. See `AttachmentBar`.
 */
export function TagChips({
  names,
  onOpen,
}: {
  names: string[];
  onOpen: () => void;
}) {
  return (
    <View className="mt-2 flex-row flex-wrap items-center gap-1.5" testID="tag-chips">
      {names.map((name) => (
        <View key={name} className="rounded-full bg-raised px-2.5 py-1">
          <Text className="text-[11px] text-ink" numberOfLines={1}>
            {name}
          </Text>
        </View>
      ))}
      <Pressable
        onPress={onOpen}
        testID="record-tags"
        accessibilityRole="button"
        accessibilityLabel={`Tags. ${names.length} on this record`}
        className="flex-row items-center gap-1 rounded-full bg-raised px-2.5 py-1 active:opacity-70">
        <Icon name="label" size={12} color={palette.muted} />
        <Text className="text-[11px] text-muted">{names.length > 0 ? 'Edit' : 'Tag'}</Text>
      </Pressable>
    </View>
  );
}
