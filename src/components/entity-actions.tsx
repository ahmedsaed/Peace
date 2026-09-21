import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import {
  archiveHint,
  archiveLabel,
  canEdit,
  canRename,
  canShowRecords,
  canUpdateBalance,
  deleteCost,
  deleteHint,
  deleteMode,
  type EntityKind,
  type EntitySubject,
} from '@/lib/entity-actions';

/**
 * One account, category or tag, as everything a long press needs to know.
 *
 * Resolved by the screen when the sheet opens rather than carried on every row:
 * the counts are aggregate queries, and folding them into the list would pay
 * for them on every row whether or not anybody ever asks. Same trade
 * `RecordActions` makes for its reversal links.
 */
export type EntityItem = EntitySubject & {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  /** The balance, the side of the ledger, what the tag is on. */
  detail?: string;
  /** Regex-safe key for testIDs — ids carry colons, names carry spaces. */
  testKey: string;
};

/**
 * What a long press on an account, a category or a tag offers.
 *
 * ONE SHEET FOR THREE LISTS, and it replaces five different vocabularies:
 * archiving used to be a switch in an editor, a dimmed group on one tab,
 * nothing at all on another, three count rows in Settings, and an inline
 * "Archive" button in a picker. Deleting was a dead sentence in one place and
 * a silent loss of history in another. None of that was a design; it was five
 * separate answers to one question, and the only way to stop them drifting is
 * for there to be one of them.
 *
 * Destructive actions are NOT in the editor, for the same reason they are not
 * on the record form: opening a thing to change it in order to remove it puts
 * Delete next to Save.
 */
export function EntityActions({
  item,
  onClose,
  onShowRecords,
  onShowBlockers,
  onUpdateBalance,
  onEdit,
  onRename,
  onArchive,
  onDelete,
}: {
  item: EntityItem | null;
  onClose: () => void;
  onShowRecords: (item: EntityItem) => void;
  /**
   * Same destination, different question.
   *
   * Browsing an entity's records is an ordinary search; arriving because a
   * DELETE was refused needs the search to say why and what to do about it.
   * Two callbacks rather than one with a flag, so a caller cannot send someone
   * to a bare list under a banner they were never shown.
   */
  onShowBlockers: (item: EntityItem) => void;
  onUpdateBalance: (item: EntityItem) => void;
  onEdit: (item: EntityItem) => void;
  onRename: (item: EntityItem) => void;
  /** Toggles: the caller reads `item.archived` to know which way. */
  onArchive: (item: EntityItem) => void;
  onDelete: (item: EntityItem) => void;
}) {
  return (
    <Modal visible={item !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Dismiss" />

      <View
        className="rounded-t-2xl border-t border-line bg-ground pb-8"
        style={{ elevation: 16 }}
        testID="entity-actions">
        {/* Rendered from a NON-NULL item handed down, never from `item!` inside
            a handler: the sheet is closed almost all of the time, and an
            assertion in a closure over state is how a screen typechecks clean
            and crashes on first open. */}
        {/* KEYED, and mounted only while there is an item. A Modal keeps its
            children mounted while hidden, so an armed confirmation held in the
            parent would still be armed the next time the sheet opened — over
            whatever entity was long-pressed next. Letting the body own that
            state and die with the sheet makes the reset structural instead of
            something an effect has to remember. */}
        {item ? (
          <Body
            key={item.id}
            item={item}
            onShowRecords={() => onShowRecords(item)}
            onShowBlockers={() => onShowBlockers(item)}
            onUpdateBalance={() => onUpdateBalance(item)}
            onEdit={() => onEdit(item)}
            onRename={() => onRename(item)}
            onArchive={() => onArchive(item)}
            onDelete={() => onDelete(item)}
          />
        ) : null}
      </View>
    </Modal>
  );
}

function Body({
  item,
  onShowRecords,
  onShowBlockers,
  onUpdateBalance,
  onEdit,
  onRename,
  onArchive,
  onDelete,
}: {
  item: EntityItem;
  onShowRecords: () => void;
  onShowBlockers: () => void;
  onUpdateBalance: () => void;
  onEdit: () => void;
  onRename: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  /** True once Delete has been asked for but not yet confirmed. */
  const [armed, setArmed] = useState(false);
  const mode = deleteMode(item);
  const cost = deleteCost(item);

  return (
    <>
      <View className="flex-row items-center gap-3 border-b border-line px-5 py-4">
        <View
          className="h-10 w-10 items-center justify-center rounded-full"
          style={{ backgroundColor: item.color ?? '#6B5B4A' }}>
          <Icon name={item.icon ?? fallbackIcon(item.kind)} size={18} color="#FFFFFF" />
        </View>
        <View className="flex-1">
          <Text className="text-base font-semibold text-ink" numberOfLines={1}>
            {item.name}
          </Text>
          {item.detail ? (
            <Text className="text-xs text-muted" numberOfLines={1} testID="entity-detail">
              {item.detail}
            </Text>
          ) : null}
        </View>
        {/* Said on the subject rather than implied by a dimmed row, so the
            state is legible from the sheet that can undo it. */}
        {item.archived ? (
          <View className="rounded-full bg-raised px-2.5 py-1" testID="entity-archived-chip">
            <Text className="text-[10px] uppercase tracking-widest text-muted">Archived</Text>
          </View>
        ) : null}
      </View>

      {canShowRecords(item) ? (
        <Action
          icon="search"
          label="Show records"
          hint={`Open search filtered to ${item.name}`}
          onPress={onShowRecords}
          testID="entity-show-records"
        />
      ) : null}

      {canUpdateBalance(item) ? (
        <Action
          icon="cash"
          label="Update balance"
          hint="Say what the bank shows — writes a dated correction"
          onPress={onUpdateBalance}
          testID="entity-update-balance"
        />
      ) : null}

      {canEdit(item) ? (
        <Action
          icon="settings"
          label="Edit"
          hint="Name, icon, colour"
          onPress={onEdit}
          testID="entity-edit"
        />
      ) : null}

      {canRename(item) ? (
        <Action
          icon="label"
          label="Rename"
          hint="Every record wearing it follows"
          onPress={onRename}
          testID="entity-rename"
        />
      ) : null}

      <Action
        icon={item.archived ? 'refresh' : 'folder'}
        label={archiveLabel(item)}
        hint={archiveHint(item)}
        onPress={onArchive}
        testID={item.archived ? 'entity-restore' : 'entity-archive'}
      />

      {/* THE REFUSAL IS A DESTINATION. A blocked delete is not a disabled
          button with an apology under it — it is a link to the records in the
          way, counted by the same query that will list them. */}
      {mode === 'blocked' ? (
        <Action
          icon="dots"
          label="Delete"
          hint={deleteHint(item)}
          onPress={onShowBlockers}
          testID="entity-delete-blocked"
          danger
        />
      ) : armed ? (
        <View className="gap-2 px-5 py-3.5" testID="entity-confirm-row">
          <Text className="text-sm text-ink">Delete {item.name} for good?</Text>
          {cost ? <Text className="text-xs text-muted">{cost}</Text> : null}
          <View className="flex-row gap-2 pt-1">
            <Pressable
              onPress={() => setArmed(false)}
              testID="entity-cancel"
              accessibilityRole="button"
              className="rounded-lg bg-raised px-4 py-2 active:opacity-70">
              <Text className="text-sm text-ink">Keep it</Text>
            </Pressable>
            <Pressable
              onPress={onDelete}
              testID="entity-confirm"
              accessibilityRole="button"
              className="rounded-lg border border-expense/40 px-4 py-2 active:opacity-70">
              <Text className="text-sm font-medium text-expense">Delete</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Action
          icon="dots"
          label="Delete"
          hint={deleteHint(item)}
          onPress={() => setArmed(true)}
          testID="entity-delete"
          danger
        />
      )}
    </>
  );
}

/** What to draw when the entity carries no icon of its own. */
function fallbackIcon(kind: EntityKind): string {
  return kind === 'tag' ? 'label' : kind === 'account' ? 'wallet' : 'dots';
}

function Action({
  icon,
  label,
  hint,
  onPress,
  testID,
  danger = false,
}: {
  icon: string;
  label: string;
  hint: string;
  onPress: () => void;
  testID: string;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      className="flex-row items-center gap-4 px-5 py-3.5 active:bg-surface">
      <Icon name={icon} size={18} color={danger ? palette.expense : palette.ink} />
      <View className="flex-1">
        <Text className={`text-[15px] ${danger ? 'text-expense' : 'text-ink'}`}>{label}</Text>
        <Text className="text-xs text-muted">{hint}</Text>
      </View>
    </Pressable>
  );
}
