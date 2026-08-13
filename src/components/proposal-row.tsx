import { Modal, Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import type { Proposal } from '@/db/repo/recurring';
import { fromYmd } from '@/lib/recurrence';
import { formatMinor } from '@/lib/money';

/**
 * A record a rule says is due, shown before it exists.
 *
 * GREY, AND NOT IN ANY TOTAL. It has not happened yet — the month's figures
 * change when you add it, and that jump is the confirmation. Rendering it in
 * the ordinary colours would put money in the list that no total agrees with.
 *
 * These are never rows in the database. A pending row in `transactions` would
 * be a third reason for every total to exclude something, forever, including
 * backups, exports and search — for records that are not real. They are merged
 * into the list at render time instead, so the blast radius is this screen.
 */
export function ProposalRow({
  proposal,
  currency,
  upcoming = false,
  onPress,
  onLongPress,
}: {
  proposal: Proposal;
  currency: string;
  /**
   * Not owed yet — it belongs to a day that has not arrived.
   *
   * Shown so a monthly rent is visible in next month's list, which is most of
   * why anyone writes the rule down. It carries no actions: a rule advances
   * past the latest date it has handled, so accepting a future occurrence would
   * silently swallow everything still owed before it.
   */
  upcoming?: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const sign = proposal.type === 'income' ? '' : '-';

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      testID={`due-${proposal.ruleId}-${proposal.occurredOn}`}
      accessibilityRole="button"
      className={`flex-row items-center gap-3 px-4 py-3 active:bg-surface ${
        upcoming ? 'opacity-60' : ''
      }`}>
      <View className="h-7 w-7 items-center justify-center rounded-full border border-dashed border-line">
        <Icon name="refresh" size={14} color={palette.muted} />
      </View>

      <View className="flex-1">
        <Text className="text-[15px] text-muted" numberOfLines={1}>
          {proposal.ruleName}
        </Text>
        {/* The date it was ACTUALLY due, not the month being viewed. An
            occurrence missed in August shows up in today's list — otherwise it
            would sit in a month nobody scrolls back to — but it must not
            pretend to be from today. */}
          <Text className="text-xs text-muted opacity-70">
          {upcoming ? formatDue(proposal.occurredOn) : `due ${formatDue(proposal.occurredOn)}`}
        </Text>
      </View>

      <Text className="text-[15px] text-muted">
        {sign}
        {formatMinor(proposal.amountMinor, proposal.currency || currency)}
      </Text>
    </Pressable>
  );
}

function formatDue(ymd: string): string {
  return fromYmd(ymd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * What a long press on a due row offers.
 *
 * Add and Dismiss, and nothing else. Editing is a TAP, because a due record
 * that needs changing — the rent went up — is edited and saved like any other
 * record rather than through a menu.
 */
export function ProposalActions({
  proposal,
  currency,
  onClose,
  onAdd,
  onDismiss,
}: {
  proposal: Proposal | null;
  currency: string;
  onClose: () => void;
  onAdd: (proposal: Proposal) => void;
  onDismiss: (proposal: Proposal) => void;
}) {
  return (
    <Modal visible={proposal !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Dismiss" />

      <View
        className="rounded-t-2xl border-t border-line bg-ground pb-8"
        style={{ elevation: 16 }}
        testID="due-actions">
        {proposal ? (
          <>
            <View className="border-b border-line px-5 py-4">
              <Text className="text-base font-semibold text-ink" numberOfLines={1}>
                {proposal.ruleName}
              </Text>
              <Text className="text-xs text-muted" numberOfLines={1}>
                due {formatDue(proposal.occurredOn)} ·{' '}
                {formatMinor(proposal.amountMinor, proposal.currency || currency)}
              </Text>
            </View>

            <Action
              icon="records"
              label="Add it"
              hint="Writes the record, dated the day it was due"
              onPress={() => onAdd(proposal)}
              testID="due-add"
            />
            <Action
              icon="dots"
              label="Not this time"
              hint="Skips this one only — the rule carries on"
              onPress={() => onDismiss(proposal)}
              testID="due-dismiss"
              danger
            />
          </>
        ) : null}
      </View>
    </Modal>
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
