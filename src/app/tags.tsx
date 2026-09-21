import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArchivedGroup } from '@/components/archived-group';
import { EntityActions, type EntityItem } from '@/components/entity-actions';
import { Snackbar } from '@/components/snackbar';
import { Icon } from '@/components/icon';
import { StackHeader } from '@/components/screen';
import palette from '@/constants/palette';
import { db } from '@/db/client';
import { checkDeletion, deleteEntity } from '@/db/repo/archive';
import { InvariantError } from '@/db/repo/categories';
import { listTags, renameTag, setTagArchived, tagUsage } from '@/db/repo/tags';
import type { Tag } from '@/db/schema';
import { recordCount } from '@/lib/entity-actions';
import { idSlug } from '@/lib/slug';

/**
 * Every tag there is, which no other screen could show.
 *
 * A tag had no home. It was created in a picker, archived by a long press in
 * that same picker, and could only be brought back from a Settings screen —
 * three surfaces for one thing, and the only list of them was a chooser that
 * hid whatever had been retired. So a finished project was findable nowhere,
 * and "which of these is a typo of another" was unanswerable.
 *
 * This keeps ONLY what a list can do that a picker cannot, exactly as the
 * recurring screen kept only what a form could not: see them all, see how much
 * each is actually used, and act on one. CREATION stays in the picker, where
 * the inputs already are — a tag is made while labelling a record, and a "new
 * tag" form here would be a worse copy of a text field that already exists.
 *
 * The usage count is the reason this earns a screen. It is invisible in a
 * picker and it is the only thing that tells you which tags are dead. There is
 * deliberately no lifetime TOTAL beside it: the search screen already computes
 * that over the whole match, and a second place adding up the same money is
 * the disease this whole redesign exists to cure.
 */
export default function TagsScreen() {
  const router = useRouter();
  const [tags, setTags] = useState<Tag[]>([]);
  const [usage, setUsage] = useState<Map<string, number>>(new Map());
  const [acting, setActing] = useState<EntityItem | null>(null);
  const [renaming, setRenaming] = useState<EntityItem | null>(null);
  /**
   * What just happened, shown over the list rather than at the top of it.
   *
   * It was a line of text above the rows, which meant a message about the
   * tag you had just scrolled down to and held was rendered off-screen
   * above you — a screen answering a question where you were not looking. The
   * snackbar is pinned, so the answer arrives where the action did. `token`
   * restarts its timer, or a second message inherits the first's countdown.
   */
  const [said, setSaid] = useState<{ text: string; bad: boolean; token: number } | null>(null);
  const say = useCallback((text: string, bad = false) => {
    setSaid({ text, bad, token: Date.now() });
  }, []);

  const reload = useCallback(() => {
    const all = listTags(db, { includeArchived: true });
    setTags(all);
    setUsage(tagUsage(db, all.map((tag) => tag.id)));
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const active = tags.filter((tag) => !tag.archived);
  const archived = tags.filter((tag) => tag.archived);

  function hold(tag: Tag) {
    const { blocking, records } = checkDeletion(db, { kind: 'tag', id: tag.id });
    setSaid(null);
    setActing({
      kind: 'tag',
      id: tag.id,
      name: tag.name,
      icon: 'label',
      archived: tag.archived,
      records,
      blocking,
      detail: records === 0 ? 'On no records' : `On ${recordCount(records)}`,
      testKey: idSlug(tag.normalised),
    });
  }

  function archive(item: EntityItem) {
    setTagArchived(db, item.id, !item.archived);
    setActing(null);
    say(item.archived ? `${item.name} is back.` : `${item.name} is put away.`);
    reload();
  }

  function remove(item: EntityItem) {
    try {
      deleteEntity(db, { kind: 'tag', id: item.id });
      say(
        item.records > 0
          ? `${item.name} deleted, and taken off ${recordCount(item.records)}.`
          : `${item.name} deleted.`
      );
    } catch (error) {
      say(
        error instanceof InvariantError ? error.message : `Could not delete ${item.name}.`,
        true
      );
    }
    setActing(null);
    reload();
  }

  return (
    <View className="flex-1 bg-ground" testID="tags-screen">
      <StackHeader title="Tags" />

      <ScrollView contentContainerClassName="px-4 pb-8 pt-2">
        {active.length === 0 && archived.length === 0 ? (
          <Text className="px-1 pt-6 text-sm leading-6 text-muted" testID="tags-empty">
            No tags yet. Add one while labelling a record — the tag field on the record screen
            makes them as you type.
          </Text>
        ) : null}

        <View className="overflow-hidden rounded-xl bg-surface">
          {active.map((tag, index) => (
            <TagRow
              key={tag.id}
              tag={tag}
              count={usage.get(tag.id) ?? 0}
              first={index === 0}
              onPress={() => hold(tag)}
              onLongPress={() => hold(tag)}
            />
          ))}
        </View>

        <ArchivedGroup
          count={archived.length}
          hint="Still on every record that wore them, and off the tag picker. Hold one to bring it back."
          testID="tags-archived">
          <View className="overflow-hidden rounded-xl bg-surface">
            {archived.map((tag, index) => (
              <TagRow
                key={tag.id}
                tag={tag}
                count={usage.get(tag.id) ?? 0}
                first={index === 0}
                dimmed
                onPress={() => hold(tag)}
                onLongPress={() => hold(tag)}
              />
            ))}
          </View>
        </ArchivedGroup>

        {active.length > 0 || archived.length > 0 ? (
          <Text className="px-1 pt-4 text-xs leading-5 text-muted">
            Tap or hold a tag to see its records, rename it, or put it away. New tags are made on
            the record screen.
          </Text>
        ) : null}
      </ScrollView>

      <EntityActions
        item={acting}
        onClose={() => setActing(null)}
        onShowRecords={(item) => {
          setActing(null);
          router.push({ pathname: '/search', params: { tagId: item.id } });
        }}
        // Nothing ever blocks a tag — its links cascade and touch no money — so
        // this is unreachable. Wired to the same place rather than left to
        // throw if that ever stops being true.
        onShowBlockers={(item) => {
          setActing(null);
          router.push({ pathname: '/search', params: { tagId: item.id } });
        }}
        onUpdateBalance={() => {}}
        onEdit={() => {}}
        onRename={(item) => {
          setActing(null);
          setRenaming(item);
        }}
        onArchive={archive}
        onDelete={remove}
      />

      {/* Handed the tag as a NON-NULL prop, like every other sheet here. */}
      {renaming ? (
        <RenameSheet
          tag={renaming}
          onClose={() => setRenaming(null)}
          onRename={(next) => {
            try {
              renameTag(db, renaming.id, next);
              say(`Renamed to ${next.trim()}.`);
            } catch (error) {
              say(
                error instanceof InvariantError ? error.message : 'Could not rename that tag.',
                true
              );
            }
            setRenaming(null);
            reload();
          }}
        />
      ) : null}

      {/* Pinned, so the answer arrives where the action did rather than at the
          top of a list the user has scrolled away from. */}
      {said ? (
        <Snackbar
          message={said.text}
          token={said.token}
          onDismiss={() => setSaid(null)}
          durationMs={said.bad ? 12000 : 5000}
          testID="tags-notice"
        />
      ) : null}
    </View>
  );
}

function TagRow({
  tag,
  count,
  first,
  dimmed = false,
  onPress,
  onLongPress,
}: {
  tag: Tag;
  count: number;
  first: boolean;
  dimmed?: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${tag.name}, on ${recordCount(count)}`}
      testID={`tag-${idSlug(tag.normalised)}`}
      className={`flex-row items-center gap-3 px-4 py-3 active:bg-raised ${
        first ? '' : 'border-t border-line'
      } ${dimmed ? 'opacity-60' : ''}`}>
      <Icon name="label" size={16} color={palette.muted} />
      <Text className="flex-1 text-base text-ink" numberOfLines={1}>
        {tag.name}
      </Text>
      {/* The number a picker can never show, and the only thing that says
          which of these is dead. */}
      <Text
        className={`text-xs ${count === 0 ? 'text-muted' : 'text-ink'}`}
        testID={`tag-count-${idSlug(tag.normalised)}`}>
        {count === 0 ? 'unused' : recordCount(count)}
      </Text>
    </Pressable>
  );
}

/**
 * Renaming, which a tag needs because it has no editor screen of its own.
 *
 * A Modal is its own window and does NOT resize with the keyboard, so this one
 * sits at the TOP rather than the foot — there is one field and one pair of
 * buttons, and lifting a bottom sheet by hand for that is more machinery than
 * the content is worth.
 */
function RenameSheet({
  tag,
  onClose,
  onRename,
}: {
  tag: EntityItem;
  onClose: () => void;
  onRename: (next: string) => void;
}) {
  const [draft, setDraft] = useState(tag.name);
  const insets = useSafeAreaInsets();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Dismiss" />
      <View
        className="absolute left-0 right-0 border-b border-line bg-ground px-5 pb-5"
        style={{ paddingTop: insets.top + 16, elevation: 16 }}
        testID="tag-rename-sheet">
        <Text className="pb-2 text-base font-semibold text-ink">Rename {tag.name}</Text>
        <Text className="pb-3 text-xs text-muted">
          Every record wearing it follows — the label changes, nothing else does.
        </Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          testID="tag-rename-input"
          className="rounded-lg bg-raised px-3 py-2.5 text-base text-ink"
        />
        <View className="flex-row justify-end gap-2 pt-3">
          <Pressable
            onPress={onClose}
            testID="tag-rename-cancel"
            accessibilityRole="button"
            className="rounded-lg bg-raised px-4 py-2 active:opacity-70">
            <Text className="text-sm text-ink">Cancel</Text>
          </Pressable>
          <Pressable
            onPress={() => onRename(draft)}
            disabled={draft.trim().length === 0}
            testID="tag-rename-save"
            accessibilityRole="button"
            className={`rounded-lg bg-accent px-4 py-2 active:opacity-70 ${
              draft.trim().length === 0 ? 'opacity-40' : ''
            }`}>
            <Text className="text-sm font-medium text-ground">Rename</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
