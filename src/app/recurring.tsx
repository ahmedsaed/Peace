import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/icon';
import { StackHeader } from '@/components/screen';
import palette from '@/constants/palette';
import { db } from '@/db/client';
import { listAccountsWithBalance } from '@/db/repo/accounts';
import { listCategoryTree } from '@/db/repo/categories';
import {
  createRule,
  deleteRule,
  listRules,
  RecurringError,
  setRuleActive,
} from '@/db/repo/recurring';
import { testIdSlug } from '@/lib/id';
import { formatMinor, parseAmountToMinor } from '@/lib/money';
import { describeRecurrence, toYmd, type Frequency } from '@/lib/recurrence';
import { useSetting } from '@/state/settings';

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'daily', label: 'Daily' },
];

/**
 * Standing orders: rent, salary, an instalment plan.
 *
 * A rule NEVER writes to the ledger by itself unless you say it may. Left
 * alone, everything it owes turns up as a grey row on the records list to be
 * added, edited or skipped — because a rule with a typo in it that posts
 * silently corrupts months of history before anyone notices.
 *
 * "Add automatically" is the opt-out, for the ones you stop wanting to think
 * about. That is the whole point of the feature: your Installments category is
 * most of your spending and is re-typed by hand every month.
 */
export default function RecurringScreen() {
  const router = useRouter();
  const currency = useSetting('homeCurrency');
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  void version;

  const rules = listRules(db);
  const accounts = listAccountsWithBalance(db);
  const categories = listCategoryTree(db, 'expense');

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [anchorDay, setAnchorDay] = useState('');
  const [autoPost, setAutoPost] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreate = useCallback(() => {
    try {
      setError(null);
      const minor = parseAmountToMinor(amount, currency) ?? 0;
      const account = accountId ?? accounts[0]?.id;
      if (!account) throw new RecurringError('Add an account first.');
      if (!name.trim()) throw new RecurringError('Give the rule a name.');

      const day = anchorDay.trim() === '' ? null : Number(anchorDay);
      if (day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) {
        throw new RecurringError('The day must be between 1 and 31.');
      }

      createRule(db, {
        name: name.trim(),
        type: 'expense',
        accountId: account,
        categoryId,
        amountMinor: minor,
        currency,
        frequency,
        anchorDay: day,
        startsOn: toYmd(new Date()),
        autoPost,
      });

      setName('');
      setAmount('');
      setAnchorDay('');
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    }
  }, [amount, currency, accountId, accounts, name, anchorDay, categoryId, frequency, autoPost, refresh]);

  const onDelete = useCallback(
    (id: string, label: string) => {
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
    },
    [refresh]
  );

  return (
    <View className="flex-1 bg-ground" testID="recurring-screen">
      <StackHeader title="Recurring" />

      <ScrollView contentContainerClassName="px-4 pb-10 pt-4" keyboardShouldPersistTaps="handled">
        {/* Form above the list: below it, the inputs drift under the keyboard
            as rules accumulate — the same mistake the portfolio screen made. */}
        <Label>New rule</Label>
        <View className="mb-6 gap-2 rounded-xl bg-surface p-4">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="What is it? e.g. Rent"
            placeholderTextColor={palette.muted}
            className="rounded-lg border border-line px-3 py-2 text-ink"
            testID="rule-name"
          />
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="Amount"
            placeholderTextColor={palette.muted}
            keyboardType="decimal-pad"
            className="rounded-lg border border-line px-3 py-2 text-ink"
            testID="rule-amount"
          />

          <View className="flex-row flex-wrap gap-2">
            {FREQUENCIES.map((f) => (
              <Chip
                key={f.value}
                label={f.label}
                selected={frequency === f.value}
                onPress={() => setFrequency(f.value)}
                testID={`rule-freq-${f.value}`}
              />
            ))}
          </View>

          {frequency === 'monthly' ? (
            <TextInput
              value={anchorDay}
              onChangeText={setAnchorDay}
              placeholder="Day of the month (blank = today's date)"
              placeholderTextColor={palette.muted}
              keyboardType="number-pad"
              className="rounded-lg border border-line px-3 py-2 text-ink"
              testID="rule-day"
            />
          ) : null}

          <Text className="mt-1 text-xs uppercase tracking-wide text-muted">Account</Text>
          <View className="flex-row flex-wrap gap-2">
            {accounts.map((a) => (
              <Chip
                key={a.id}
                label={a.name}
                selected={(accountId ?? accounts[0]?.id) === a.id}
                onPress={() => setAccountId(a.id)}
                testID={`rule-account-${testIdSlug(a.name.toLowerCase())}`}
              />
            ))}
          </View>

          <Text className="mt-1 text-xs uppercase tracking-wide text-muted">Category</Text>
          <View className="flex-row flex-wrap gap-2">
            {categories.slice(0, 12).map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                selected={categoryId === c.id}
                onPress={() => setCategoryId(c.id)}
                testID={`rule-category-${testIdSlug(c.name.toLowerCase())}`}
              />
            ))}
          </View>

          <Pressable
            onPress={() => setAutoPost((v) => !v)}
            testID="rule-autopost"
            accessibilityRole="switch"
            accessibilityState={{ checked: autoPost }}
            className="mt-2 flex-row items-center gap-3 py-1">
            <View
              className={`h-5 w-5 items-center justify-center rounded border ${
                autoPost ? 'border-accent bg-accent' : 'border-line'
              }`}>
              {autoPost ? <Icon name="records" size={12} color={palette['accent-ink']} /> : null}
            </View>
            <View className="flex-1">
              <Text className="text-[15px] text-ink">Add automatically</Text>
              <Text className="text-xs text-muted">
                {autoPost
                  ? 'Records appear without asking.'
                  : 'Records wait on the list until you add them.'}
              </Text>
            </View>
          </Pressable>

          <Button label="Create rule" onPress={onCreate} testID="rule-create" primary />

          {error ? (
            <Text className="text-sm text-expense" testID="rule-error">
              {error}
            </Text>
          ) : null}
        </View>

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
          What a rule owes turns up on the records list in grey. Tap one to edit it before adding,
          or hold it to add or skip.
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

function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`rounded-full px-3.5 py-1.5 active:opacity-80 ${
        selected ? 'bg-accent' : 'border border-line'
      }`}>
      <Text className={`text-sm ${selected ? 'font-semibold text-accent-ink' : 'text-ink'}`}>
        {label}
      </Text>
    </Pressable>
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
