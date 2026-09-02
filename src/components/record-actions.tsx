import { Modal, Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import type { RecordRow } from '@/db/repo/records';
import type { ReversalLink } from '@/db/repo/reversal';
import { canDuplicate, canRefund, canReverse } from '@/lib/record-actions';
import { useMoney, type Money } from '@/state/money';

/**
 * Everything this sheet knows about how the row relates to others.
 *
 * Resolved by the screen when the sheet opens, not carried on every row in the
 * list: it is two indexed lookups on one id, paid once per long press, where
 * folding them into the list query would pay for them on every row of every
 * month whether or not anybody ever asks.
 */
export type ReversalContext = {
  /** What this row exists to undo, or null when it undoes nothing. */
  reverses: ReversalLink | null;
  /**
   * True when this row DOES undo something whose record has since been deleted.
   *
   * Distinct from `reverses: null`, because the sheet has different things to
   * say: "nothing to show" is silence, "the record it reversed is gone" is
   * worth a line — otherwise a refund that used to link somewhere silently
   * stops, and it looks like the link never existed.
   */
  danglingSource: boolean;
  /** What undoes this row: its refunds, or the transfer that reversed it. */
  reversedBy: { links: ReversalLink[]; count: number; totalMinor: number };
};

const NOTHING: ReversalContext = {
  reverses: null,
  danglingSource: false,
  reversedBy: { links: [], count: 0, totalMinor: 0 },
};

/**
 * What a long press on a record offers.
 *
 * Delete used to live at the bottom of the edit form, which meant opening a
 * record to change it in order to remove it — and put a destructive action in
 * the same place as the save button.
 *
 * Refund and Reverse both start FROM the record they undo, which is the whole
 * reason they are here rather than types on the record screen: each inherits
 * what it cannot be allowed to get wrong. A refund inherits the account and
 * category of the purchase, so it cannot net against the wrong one; a reversal
 * inherits the two accounts and swaps them, so it cannot send the money
 * somewhere it never came from. Both mistakes look completely ordinary in the
 * list afterwards.
 *
 * The rules for which of them appear are in `lib/record-actions.ts`, not here:
 * they overlap, and a rule spelled out at each call site is a rule that gets
 * forgotten at one of them.
 */
export function RecordActions({
  row,
  context = NOTHING,
  onClose,
  onRefund,
  onReverse,
  onDuplicate,
  onDelete,
  onOpen,
}: {
  row: RecordRow | null;
  context?: ReversalContext;
  onClose: () => void;
  onRefund: (row: RecordRow) => void;
  onReverse: (row: RecordRow) => void;
  onDuplicate: (row: RecordRow) => void;
  onDelete: (row: RecordRow) => void;
  /** Open one of the linked records. */
  onOpen: (id: string) => void;
}) {
  const money = useMoney();

  return (
    <Modal visible={row !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Dismiss" />

      <View
        className="rounded-t-2xl border-t border-line bg-ground pb-8"
        style={{ elevation: 16 }}
        testID="record-actions">
        {/* Rendered from a NON-NULL row handed down, never from `row!` inside a
            handler: the sheet is closed almost all of the time, and an assertion
            in a closure over state is how a screen typechecks clean and crashes
            on first open. */}
        {row ? (
          <Body
            row={row}
            context={context}
            money={money}
            onRefund={onRefund}
            onReverse={onReverse}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            onOpen={onOpen}
          />
        ) : null}
      </View>
    </Modal>
  );
}

function Body({
  row,
  context,
  money,
  onRefund,
  onReverse,
  onDuplicate,
  onDelete,
  onOpen,
}: {
  row: RecordRow;
  context: ReversalContext;
  money: Money;
  onRefund: (row: RecordRow) => void;
  onReverse: (row: RecordRow) => void;
  onDuplicate: (row: RecordRow) => void;
  onDelete: (row: RecordRow) => void;
  onOpen: (id: string) => void;
}) {
  const subject = {
    isTransfer: row.isTransfer,
    isAdjustment: row.isAdjustment,
    isRefund: row.isRefund,
    amountMinor: row.amountMinor,
    reversesId: row.reversesId,
    reversedByCount: context.reversedBy.count,
  };

  const { links, count, totalMinor } = context.reversedBy;
  // A local const, so the JSX below narrows it instead of asserting it.
  const reverses = context.reverses;
  const undoneWord = row.isTransfer ? 'Reversed' : 'Refunded';

  return (
    <>
      <View className="border-b border-line px-5 py-4">
        <Text className="text-base font-semibold text-ink" numberOfLines={1}>
          {row.isTransfer
            ? 'Transfer'
            : row.isAdjustment
              ? 'Balance correction'
              : (row.categoryName ?? 'Uncategorised')}
        </Text>
        <Text className="text-xs text-muted" numberOfLines={1}>
          {row.accountName} · {money(Math.abs(row.amountMinor), row.currency)}
        </Text>
      </View>

      {/* WHAT THIS ROW UNDOES, and what undoes it.
          Above the actions, because they describe the record you are looking at
          rather than something to do to it — and because the first question a
          refund raises is "of what?", which used to have no answer anywhere in
          the app. */}
      {reverses ? (
        <Link
          label={`${row.isTransfer ? 'Reverses' : 'Refunds'} ${reverses.label}`}
          detail={`${money(Math.abs(reverses.amountMinor), reverses.currency)} · ${dayOf(reverses.occurredAt)}`}
          onPress={() => onOpen(reverses.id)}
          testID="link-reverses"
        />
      ) : context.danglingSource ? (
        // Said rather than hidden: a link that quietly disappears looks like it
        // was never there. Delete is undoable, so this can come back.
        <View className="border-b border-line px-5 py-3" testID="link-deleted">
          <Text className="text-xs text-muted">
            The record this {row.isTransfer ? 'reversed' : 'refunded'} has been deleted
          </Text>
        </View>
      ) : null}

      {count > 0 ? (
        <View className="border-b border-line" testID="link-reversed-by">
          <Text className="px-5 pb-1 pt-3 text-[10px] uppercase tracking-widest text-muted">
            {/* The AMOUNT that came back, not just that some did. "Refunded"
                on an E£800 purchase says nothing about whether E£50 or all of
                it returned, and the difference is the entire question. */}
            {undoneWord} · {money(Math.abs(totalMinor), row.currency)} of{' '}
            {money(Math.abs(row.amountMinor), row.currency)}
          </Text>
          {links.map((link, index) => (
            <Link
              key={link.id}
              label={link.label}
              detail={`${money(Math.abs(link.amountMinor), link.currency)} · ${dayOf(link.occurredAt)}`}
              onPress={() => onOpen(link.id)}
              // By POSITION, not by id: a flow cannot predict a UUID, and the
              // list is ordered newest first so index 0 is a stable target.
              testID={`link-undone-${index}`}
            />
          ))}
          {count > links.length ? (
            <Text className="px-5 pb-3 pt-1 text-xs text-muted">
              +{count - links.length} more
            </Text>
          ) : null}
        </View>
      ) : null}

      {canRefund(subject) ? (
        <Action
          icon="refresh"
          label="Refund"
          hint="Money coming back — nets against this category"
          onPress={() => onRefund(row)}
          testID="action-refund"
        />
      ) : null}

      {canReverse(subject) ? (
        <Action
          icon="transfer"
          label="Reverse"
          hint="Send it back the other way"
          onPress={() => onReverse(row)}
          testID="action-reverse"
        />
      ) : null}

      {canDuplicate(subject) ? (
        <Action
          icon="records"
          label="Duplicate"
          hint="Same again, dated today"
          onPress={() => onDuplicate(row)}
          testID="action-duplicate"
        />
      ) : null}

      <Action
        icon="dots"
        label="Delete"
        hint="Undo is offered straight after"
        onPress={() => onDelete(row)}
        testID="action-delete"
        danger
      />
    </>
  );
}

/**
 * Short and local, never through `Intl`'s month names.
 *
 * Android ships different ICU data from Node — September shortens to "Sept",
 * not "Sep" — so anything formatted this way has to be seen on a device before
 * a test can assert it. A numeric day and month has no such disagreement.
 */
function dayOf(date: Date): string {
  return `${date.getDate()}/${date.getMonth() + 1}`;
}

function Link({
  label,
  detail,
  onPress,
  testID,
}: {
  label: string;
  detail: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${detail}`}
      className="flex-row items-center gap-3 border-b border-line px-5 py-3 active:bg-surface">
      <View className="flex-1">
        <Text className="text-sm text-ink" numberOfLines={1}>
          {label}
        </Text>
        <Text className="text-xs text-muted" numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <Icon name="chevron" size={12} color={palette.muted} />
    </Pressable>
  );
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
      className="flex-row items-center gap-4 px-5 py-3.5 active:bg-surface">
      <Icon name={icon} size={18} color={danger ? palette.expense : palette.ink} />
      <View className="flex-1">
        <Text className={`text-[15px] ${danger ? 'text-expense' : 'text-ink'}`}>{label}</Text>
        <Text className="text-xs text-muted">{hint}</Text>
      </View>
    </Pressable>
  );
}
