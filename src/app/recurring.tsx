import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { EmptyState, StackHeader } from '@/components/screen';
import palette from '@/constants/palette';
import { db } from '@/db/client';
import { deleteRule, listRules, setRuleActive } from '@/db/repo/recurring';
import { formatMinor } from '@/lib/money';
import { describeRecurrence, fromYmd } from '@/lib/recurrence';

type Rule = ReturnType<typeof listRules>[number];

/**
 * The standing orders that exist — and nothing for creating one.
 *
 * Rules are made on the record screen, by tapping Repeat while entering the
 * payment itself. This screen had its own form once: name, amount, and chip
 * lists standing in for the account and category pickers. It was a worse copy
 * of a screen that already existed, and a second place to fix every time either
 * changed.
 *
 * What is left is a LIST, and it is built like the records list: a row is a
 * line of facts, and the actions live behind a long press. Pause and Delete
 * buttons under every rule turned four standing orders into sixteen things to
 * read, and put a destructive action on screen permanently for something done
 * once a year.
 */
export default function RecurringScreen() {
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  void version;

  const rules = listRules(db);
  const [acting, setActing] = useState<Rule | null>(null);

  const paused = rules.filter((r) => !r.active).length;

  const onDelete = (rule: Rule) => {
    setActing(null);
    Alert.alert(
      `Delete "${rule.name ?? 'this rule'}"?`,
      'Records it has already created are kept — deleting a rule never deletes history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteRule(db, rule.id);
            refresh();
          },
        },
      ]
    );
  };

  return (
    <View className="flex-1 bg-ground" testID="recurring-screen">
      <StackHeader title="Recurring" />

      {rules.length === 0 ? (
        <EmptyState
          icon="refresh"
          title="Nothing repeats yet"
          hint="Tap the repeat button while entering a record to save it as a rule."
        />
      ) : (
        <ScrollView contentContainerClassName="px-4 pb-10 pt-4">
          {/* One line, not a paragraph: what is on this page, and how much of it
              is switched off. */}
          <Text className="mb-3 px-1 text-sm text-muted" testID="rule-count">
            {rules.length === 1 ? '1 rule' : `${rules.length} rules`}
            {paused > 0 ? ` · ${paused} paused` : ''}
          </Text>

          <View className="overflow-hidden rounded-xl bg-surface">
            {rules.map((rule, index) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                first={index === 0}
                onLongPress={() => setActing(rule)}
              />
            ))}
          </View>

          <Text className="mt-4 px-1 text-xs leading-5 text-muted">
            Hold a rule to pause or delete it. What one owes turns up on the records list in grey.
          </Text>
        </ScrollView>
      )}

      {/* The rule is handed BACK by the sheet rather than read from state with
          a `!` assertion. The sheet only renders its actions when it has one,
          so this is the place where non-null is actually known — asserting it
          in the parent reads `.active` on null the moment the sheet is closed. */}
      <RuleActions
        rule={acting}
        onClose={() => setActing(null)}
        onToggle={(rule) => {
          setRuleActive(db, rule.id, !rule.active);
          setActing(null);
          refresh();
        }}
        onDelete={onDelete}
      />
    </View>
  );
}

function RuleRow({
  rule,
  first,
  onLongPress,
}: {
  rule: Rule;
  first: boolean;
  onLongPress: () => void;
}) {
  const schedule = describeRecurrence({
    frequency: rule.frequency,
    interval: rule.interval,
    anchorDay: rule.anchorDay,
    startsOn: rule.startsOn,
    endsOn: rule.endsOn,
  });

  return (
    <Pressable
      onLongPress={onLongPress}
      testID={`rule-${slug(rule.name)}`}
      accessibilityRole="button"
      accessibilityLabel={`${rule.name ?? 'Recurring'}, ${schedule}`}
      className={`flex-row items-center gap-3 px-4 py-3.5 active:bg-raised ${
        first ? '' : 'border-t border-line'
      } ${rule.active ? '' : 'opacity-50'}`}>
      <View className="h-8 w-8 items-center justify-center rounded-full bg-raised">
        <Icon name="refresh" size={15} color={rule.active ? palette.accent : palette.muted} />
      </View>

      <View className="flex-1">
        <Text className="text-[15px] text-ink" numberOfLines={1}>
          {rule.name ?? 'Recurring'}
        </Text>
        <Text className="text-xs text-muted" numberOfLines={1}>
          {schedule}
          {rule.autoPost ? ' · automatic' : ''}
        </Text>
      </View>

      {/* Amount and next date stack on the right, so the eye runs down two
          columns rather than along four facts crammed into one line. */}
      <View className="items-end">
        <Text className="text-[15px] text-ink">{formatMinor(rule.amountMinor, rule.currency)}</Text>
        <Text className="text-xs text-muted">{whenNext(rule)}</Text>
      </View>
    </Pressable>
  );
}

/** `12 Sep`, or why there is no next one. Never the raw `2026-09-12`. */
function whenNext(rule: Rule): string {
  if (!rule.active) return 'Paused';
  if (!rule.nextRunOn) return 'Finished';
  return fromYmd(rule.nextRunOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * Actions behind a long press — the same gesture a record uses.
 *
 * Pausing is rare and deleting is destructive, so neither earns a permanent
 * button on every row.
 */
function RuleActions({
  rule,
  onClose,
  onToggle,
  onDelete,
}: {
  rule: Rule | null;
  onClose: () => void;
  onToggle: (rule: Rule) => void;
  onDelete: (rule: Rule) => void;
}) {
  return (
    <Modal visible={rule !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Dismiss" />

      <View
        className="rounded-t-2xl border-t border-line bg-ground pb-8"
        style={{ elevation: 16 }}
        testID="rule-actions">
        {rule ? (
          <>
            <View className="border-b border-line px-5 py-4">
              <Text className="text-base font-semibold text-ink" numberOfLines={1}>
                {rule.name ?? 'Recurring'}
              </Text>
              <Text className="text-xs text-muted" numberOfLines={1}>
                {formatMinor(rule.amountMinor, rule.currency)} · {whenNext(rule)}
              </Text>
            </View>

            <Action
              icon={rule.active ? 'clock' : 'refresh'}
              label={rule.active ? 'Pause' : 'Resume'}
              hint={
                rule.active
                  ? 'Owes nothing until you turn it back on'
                  : 'Starts owing again from its next date'
              }
              onPress={() => onToggle(rule)}
              testID="rule-toggle"
            />
            <Action
              icon="dots"
              label="Delete"
              hint="Records it already created are kept"
              onPress={() => onDelete(rule)}
              testID="rule-delete"
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

/** Predictable in a flow, unlike the row's UUID. */
const slug = (name: string | null) =>
  (name ?? 'rule')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
