import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import { Keypad, type KeyPress } from '@/components/keypad';
import { PickerSheet, type PickerOption } from '@/components/picker-sheet';
import { db } from '@/db/client';
import { listAccountsWithBalance } from '@/db/repo/accounts';
import { InvariantError, listCategoryTree } from '@/db/repo/categories';
import { createRecord, createTransfer } from '@/db/repo/transactions';
import {
  backspace,
  committedMinor,
  equals,
  initialCalc,
  inputDigit,
  inputDot,
  inputOp,
} from '@/lib/calculator';
import { formatDayLabel, formatTimeLabel } from '@/lib/period';

type RecordType = 'income' | 'expense' | 'transfer';

const TYPES: { value: RecordType; label: string }[] = [
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
  { value: 'transfer', label: 'Transfer' },
];

export default function RecordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const accounts = useMemo(() => listAccountsWithBalance(db), []);
  const [type, setType] = useState<RecordType>('expense');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState<string | null>(accounts[1]?.id ?? null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [calc, setCalc] = useState(initialCalc());
  const [occurredAt] = useState(() => new Date());
  const [sheet, setSheet] = useState<'account' | 'category' | 'toAccount' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const account = accounts.find((a) => a.id === accountId);
  const currency = account?.currency ?? 'EGP';

  // Only categories of the matching kind are offered — a category is income XOR
  // expense, so showing all of them would just invite an invalid pick.
  const categoryTree = useMemo(
    () => (type === 'transfer' ? [] : listCategoryTree(db, type)),
    [type]
  );
  const category = useMemo(
    () =>
      categoryTree
        .flatMap((node) => [node, ...node.children])
        .find((c) => c.id === categoryId),
    [categoryTree, categoryId]
  );

  const amountMinor = committedMinor(calc, currency);
  const canSave =
    amountMinor !== null &&
    amountMinor > 0 &&
    !!accountId &&
    (type !== 'transfer' || (!!toAccountId && toAccountId !== accountId));

  function onKey(press: KeyPress) {
    setError(null);
    setCalc((state) => {
      switch (press.kind) {
        case 'digit':
          return inputDigit(state, press.value, currency);
        case 'dot':
          return inputDot(state, currency);
        case 'op':
          return inputOp(state, press.value, currency);
        case 'equals':
          return equals(state, currency);
      }
    });
  }

  function onSave() {
    if (!canSave || amountMinor === null) return;
    try {
      if (type === 'transfer') {
        createTransfer(db, {
          fromAccountId: accountId,
          toAccountId: toAccountId!,
          amountMinor,
          currency,
          note: note.trim() || null,
          occurredAt,
        });
      } else {
        createRecord(db, {
          type,
          accountId,
          categoryId,
          amountMinor,
          currency,
          note: note.trim() || null,
          occurredAt,
        });
      }
      router.back();
    } catch (e) {
      // An InvariantError is the user's mistake and worth showing verbatim;
      // anything else is a real fault and gets a generic line.
      setError(
        e instanceof InvariantError ? e.message : 'Could not save this record. Please try again.'
      );
    }
  }

  const accountOptions: PickerOption[] = accounts.map((a) => ({
    id: a.id,
    label: a.name,
    icon: a.icon,
    color: a.color,
    detail: a.currency,
  }));

  const categoryOptions: PickerOption[] = categoryTree.flatMap((node) => [
    { id: node.id, label: node.name, icon: node.icon, color: node.color },
    ...node.children.map((child) => ({
      id: child.id,
      label: child.name,
      icon: child.icon,
      color: child.color,
      indented: true,
    })),
  ]);

  return (
    <View
      className="flex-1 bg-ground"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      testID="record-screen">
      {/* Cancel and Save are real buttons. They end the task, so they get a
          target you can hit without aiming — and Save carries the accent so it
          reads as the primary action. */}
      <View className="flex-row items-center justify-between px-4 py-3">
        <Pressable
          onPress={() => router.back()}
          testID="record-cancel"
          accessibilityRole="button"
          className="rounded-lg border border-line px-5 py-2.5 active:opacity-70">
          <Text className="text-sm font-medium text-muted">Cancel</Text>
        </Pressable>

        <Pressable
          onPress={onSave}
          disabled={!canSave}
          testID="record-save"
          accessibilityRole="button"
          className={`rounded-lg px-7 py-2.5 active:opacity-80 ${
            canSave ? 'bg-accent' : 'bg-surface'
          }`}>
          <Text
            className={`text-sm font-semibold ${canSave ? 'text-accent-ink' : 'text-line'}`}>
            Save
          </Text>
        </Pressable>
      </View>

      {/* Type switch changes what the whole form means, so it leads. */}
      <View className="mx-4 mb-3 flex-row rounded-lg bg-surface p-1">
        {TYPES.map(({ value, label }) => (
          <Pressable
            key={value}
            onPress={() => {
              setType(value);
              setCategoryId(null);
              setError(null);
            }}
            testID={`type-${value}`}
            accessibilityRole="button"
            className={`flex-1 items-center rounded-md py-2 ${type === value ? 'bg-raised' : ''}`}>
            <Text
              className={`text-sm ${type === value ? 'font-semibold text-accent' : 'text-muted'}`}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View className="mx-4 mb-3 flex-row gap-3">
        <PickerButton
          label={type === 'transfer' ? 'From' : 'Account'}
          value={account?.name}
          icon={account?.icon}
          color={account?.color}
          onPress={() => setSheet('account')}
          testID="pick-account"
        />
        {type === 'transfer' ? (
          <PickerButton
            label="To"
            value={accounts.find((a) => a.id === toAccountId)?.name}
            icon={accounts.find((a) => a.id === toAccountId)?.icon}
            color={accounts.find((a) => a.id === toAccountId)?.color}
            onPress={() => setSheet('toAccount')}
            testID="pick-to-account"
          />
        ) : (
          <PickerButton
            label="Category"
            value={category?.name}
            icon={category?.icon ?? 'categories'}
            color={category?.color}
            onPress={() => setSheet('category')}
            testID="pick-category"
          />
        )}
      </View>

      {/* Notes claims every pixel between the pickers and the amount, the way a
          web textarea fills its container. It is the only element here with no
          natural size, so giving the slack to it keeps the layout stable on any
          screen height instead of leaving a dead gap. */}
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Add notes"
        placeholderTextColor={palette.muted}
        multiline
        textAlignVertical="top"
        testID="record-note"
        className="mx-4 mb-3 flex-1 rounded-lg bg-surface px-4 py-3 text-base text-ink"
      />

      <View className="mx-4 mb-3 flex-row items-center justify-end gap-4 rounded-lg bg-surface px-4 py-4">
        <Text
          className="text-4xl font-light text-ink"
          numberOfLines={1}
          adjustsFontSizeToFit
          testID="amount-display">
          {calc.entry}
        </Text>
        <Pressable
          onPress={() => setCalc(backspace)}
          hitSlop={12}
          testID="key-backspace"
          accessibilityRole="button"
          accessibilityLabel="Backspace">
          <Text className="text-2xl text-muted">&#9003;</Text>
        </Pressable>
      </View>

      {calc.error || error ? (
        <Text className="mx-4 mb-2 text-sm text-expense" testID="record-error">
          {calc.error ?? error}
        </Text>
      ) : null}

      <View className="mx-3">
        <Keypad onKey={onKey} />
      </View>

      {/* Date and time are buttons: they are editable, so they must look it.
          The picker itself lands with the edit-record work — until then these
          report "now" and say so when tapped. */}
      <View className="mx-4 mb-1 mt-3 flex-row gap-3">
        <Pressable
          onPress={() => setError('Changing the date arrives with edit — this is logged as now.')}
          testID="record-date"
          accessibilityRole="button"
          className="flex-1 items-center rounded-lg border border-line py-2.5 active:opacity-70">
          <Text className="text-sm text-ink">{formatDayLabel(occurredAt)}</Text>
        </Pressable>
        <Pressable
          onPress={() => setError('Changing the time arrives with edit — this is logged as now.')}
          testID="record-time"
          accessibilityRole="button"
          className="flex-1 items-center rounded-lg border border-line py-2.5 active:opacity-70">
          <Text className="text-sm text-ink">{formatTimeLabel(occurredAt)}</Text>
        </Pressable>
      </View>

      <PickerSheet
        visible={sheet === 'account'}
        title={type === 'transfer' ? 'From account' : 'Account'}
        options={accountOptions}
        selectedId={accountId}
        onSelect={(id) => {
          setAccountId(id);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        testID="sheet-account"
      />

      <PickerSheet
        visible={sheet === 'toAccount'}
        title="To account"
        options={accountOptions.filter((o) => o.id !== accountId)}
        selectedId={toAccountId}
        onSelect={(id) => {
          setToAccountId(id);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        testID="sheet-to-account"
      />

      <PickerSheet
        visible={sheet === 'category'}
        title="Category"
        options={categoryOptions}
        selectedId={categoryId}
        onSelect={(id) => {
          setCategoryId(id);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        testID="sheet-category"
      />
    </View>
  );
}

function PickerButton({
  label,
  value,
  icon,
  color,
  onPress,
  testID,
}: {
  label: string;
  value?: string;
  icon?: string | null;
  color?: string | null;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      className="flex-1 flex-row items-center gap-2 rounded-lg bg-surface px-3 py-3 active:opacity-70">
      <View
        className="h-7 w-7 items-center justify-center rounded-full"
        style={{ backgroundColor: color ?? '#6B5B4A' }}>
        <Icon name={icon ?? 'dots'} size={14} color="#FFFFFF" />
      </View>
      <View className="flex-1">
        <Text className="text-[10px] uppercase tracking-wider text-muted">{label}</Text>
        <Text className={`text-sm ${value ? 'text-ink' : 'text-muted'}`} numberOfLines={1}>
          {value ?? 'Choose'}
        </Text>
      </View>
    </Pressable>
  );
}
