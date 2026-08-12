import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { StackHeader } from '@/components/screen';
import { db } from '@/db/client';
import { deleteRule, listRules, setRuleActive } from '@/db/repo/recurring';
import { testIdSlug } from '@/lib/id';
import { formatMinor } from '@/lib/money';
import { describeRecurrence } from '@/lib/recurrence';

/**
 * The standing orders that exist — and NOTHING for creating one.
 *
 * Rules are made on the record screen, by tapping Repeat while entering the
 * payment itself. This screen had its own form once: name, amount, and chip
 * lists standing in for the account and category pickers. It was a worse copy
 * of a screen that already existed, and a second place to fix every time either
 * changed. Pausing, deleting and seeing what is scheduled are the jobs a list
 * can do that the record screen cannot.
 *
 * A rule never writes to the ledger by itself. What it owes turns up as a grey
 * row on the records list to be added, edited or skipped, because a rule with a
 * typo in it that posts silently corrupts months of history before anyone
 * notices.
 */
export default function RecurringScreen() {
  const router = useRouter();
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  void version;

  const rules = listRules(db);

  const onDelete = (id: string, label: string) => {
      Alert.alert(
        `Delete "${label}"?`,
        'Records it has already created are kept — deleting a rule never deletes history.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              deleteRule(db, id);
              refresh();
            },
          },
        ]
      );
  };

  return (
    <View className="flex-1 bg-ground" testID="recurring-screen">
      <StackHeader title="Recurring" />

      <ScrollView contentContainerClassName="px-4 pb-10 pt-4" keyboardShouldPersistTaps="handled">
        {/* Form above the list: below it, the inputs drift under the keyboard
            as rules accumulate — the same mistake the portfolio screen made. */}
        <Label>Rules</Label>
        {rules.length === 0 ? (
          <Text className="px-1 text-sm text-muted" testID="rule-empty">
            Nothing recurring yet. A rule saves re-typing the same record every month.
          </Text>
        ) : (
          <View className="rounded-xl bg-surface">
            {rules.map((rule, index) => (
              <View
                key={rule.id}
                className={`p-4 ${index > 0 ? 'border-t border-line' : ''}`}
                testID={`rule-${testIdSlug((rule.name ?? 'rule').toLowerCase())}`}>
                <View className="flex-row items-center gap-2">
                  <Text
                    className={`flex-1 text-[15px] ${rule.active ? 'text-ink' : 'text-muted'}`}
                    numberOfLines={1}>
                    {rule.name ?? 'Recurring'}
                  </Text>
                  <Text className={`text-[15px] ${rule.active ? 'text-ink' : 'text-muted'}`}>
                    {formatMinor(rule.amountMinor, rule.currency)}
                  </Text>
                </View>

                <Text className="mt-0.5 text-xs text-muted">
                  {describeRecurrence({
                    frequency: rule.frequency,
                    interval: rule.interval,
                    anchorDay: rule.anchorDay,
                    startsOn: rule.startsOn,
                    endsOn: rule.endsOn,
                  })}
                  {rule.autoPost ? ' · automatic' : ''}
                  {rule.nextRunOn ? ` · next ${rule.nextRunOn}` : ' · finished'}
                </Text>

                <View className="mt-3 flex-row gap-2">
                  <Button
                    label={rule.active ? 'Pause' : 'Resume'}
                    onPress={() => {
                      setRuleActive(db, rule.id, !rule.active);
                      refresh();
                    }}
                    testID={`rule-toggle-${testIdSlug((rule.name ?? 'rule').toLowerCase())}`}
                  />
                  <Button
                    label="Delete"
                    onPress={() => onDelete(rule.id, rule.name ?? 'this rule')}
                    testID={`rule-delete-${testIdSlug((rule.name ?? 'rule').toLowerCase())}`}
                    danger
                  />
                </View>
              </View>
            ))}
          </View>
        )}

        <Text className="mt-6 px-1 text-xs leading-5 text-muted">
          Rules are made while entering a record — tap Repeat on the new-record screen. What a rule
          owes then turns up on the records list in grey: tap one to edit it before adding, or hold
          it to add or skip.
        </Text>

        <Pressable onPress={() => router.back()} className="mt-6 self-start px-1 py-2">
          <Text className="text-sm text-muted">Back to records</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Label({ children }: { children: string }) {
  return (
    <Text className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted">
      {children}
    </Text>
  );
}

function Button({
  label,
  onPress,
  testID,
  primary = false,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`self-start rounded-lg px-4 py-2.5 active:opacity-80 ${
        danger ? 'border border-expense/40' : primary ? 'bg-accent' : 'border border-line'
      }`}>
      <Text
        className={`text-sm font-semibold ${
          danger ? 'text-expense' : primary ? 'text-accent-ink' : 'text-ink'
        }`}>
        {label}
      </Text>
    </Pressable>
  );
}
