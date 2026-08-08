import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { Keypad, type KeyPress } from '@/components/keypad';
import { PickerSheet, type PickerOption } from '@/components/picker-sheet';
import palette from '@/constants/palette';
import { db } from '@/db/client';
import { listAccountsWithBalance } from '@/db/repo/accounts';
import { InvariantError, listCategoryTree } from '@/db/repo/categories';
import {
  createRecord,
  createTransfer,
  deleteRecord,
  getRecord,
  updateRecord,
  updateTransfer,
} from '@/db/repo/transactions';
import {
  backspace,
  calcFromMinor,
  committedMinor,
  equals,
  initialCalc,
  inputDigit,
  inputDot,
  inputOp,
} from '@/lib/calculator';
import { formatDayLabel, formatTimeLabel } from '@/lib/period';
import { useUndoStore } from '@/state/undo';

type RecordType = 'income' | 'expense' | 'transfer';

const TYPES: { value: RecordType; label: string }[] = [
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
  { value: 'transfer', label: 'Transfer' },
];

export default function RecordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const accounts = useMemo(() => listAccountsWithBalance(db), []);

  // Load once. `id` does not change while the screen is mounted, and re-reading
  // on every render would fight the edits being made.
  const existing = useMemo(() => (id ? getRecord(db, id) : undefined), [id]);
  const isEdit = !!existing;
  const editingTransfer = !!existing?.transferPairId;

  const [type, setType] = useState<RecordType>(() => {
    if (!existing) return 'expense';
    if (existing.transferPairId) return 'transfer';
    return existing.amountMinor < 0 ? 'expense' : 'income';
  });

  // A transfer can be opened from either leg; the form always presents it as
  // "from the account that lost money".
  const [accountId, setAccountId] = useState(() => {
    if (!existing) return accounts[0]?.id ?? '';
    if (existing.transferPairId && existing.amountMinor > 0) {
      return existing.counterAccountId ?? existing.accountId;
    }
    return existing.accountId;
  });
  const [toAccountId, setToAccountId] = useState<string | null>(() => {
    if (!existing) return accounts[1]?.id ?? null;
    if (existing.transferPairId && existing.amountMinor > 0) return existing.accountId;
    return existing.counterAccountId ?? accounts[1]?.id ?? null;
  });

  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null);
  const [note, setNote] = useState(existing?.note ?? '');
  const [occurredAt, setOccurredAt] = useState<Date>(existing?.occurredAt ?? new Date());
  const [picking, setPicking] = useState<'date' | 'time' | null>(null);
  const [sheet, setSheet] = useState<'account' | 'category' | 'toAccount' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offerUndo = useUndoStore((state) => state.offer);

  const account = accounts.find((a) => a.id === accountId);
  const currency = account?.currency ?? 'EGP';

  const [calc, setCalc] = useState(() =>
    existing ? calcFromMinor(existing.amountMinor, existing.currency) : initialCalc()
  );

  // Only categories of the matching kind are offered — a category is income XOR
  // expense, so showing all of them would just invite an invalid pick.
  const categoryTree = useMemo(
    () => (type === 'transfer' ? [] : listCategoryTree(db, type)),
    [type]
  );
  const category = useMemo(
    () => categoryTree.flatMap((n) => [n, ...n.children]).find((c) => c.id === categoryId),
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

  /**
   * `onValueChange` fires only when a value is actually chosen — cancelling
   * goes to `onDismiss` — so there is no event type to check here. (The older
   * `onChange` callback, which received both, is deprecated in v9.)
   */
  function onPickDateTime(_event: unknown, picked: Date) {
    const mode = picking;
    setPicking(null);

    // The picker hands back a whole Date, so keep the half the user was not
    // editing — otherwise choosing a date silently resets the time to midnight.
    setOccurredAt((current) => {
      const next = new Date(current);
      if (mode === 'date') {
        next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
      } else {
        next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
      }
      return next;
    });
  }

  function onSave() {
    if (!canSave || amountMinor === null) return;
    try {
      if (existing) {
        if (editingTransfer) {
          updateTransfer(db, existing.id, {
            fromAccountId: accountId,
            toAccountId: toAccountId!,
            amountMinor,
            currency,
            note: note.trim() || null,
            occurredAt,
          });
        } else {
          updateRecord(db, existing.id, {
            type: type as 'expense' | 'income',
            accountId,
            categoryId,
            amountMinor,
            currency,
            note: note.trim() || null,
            occurredAt,
          });
        }
      } else if (type === 'transfer') {
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

  function onDelete() {
    if (!existing) return;
    try {
      // The rows come back so they can be put straight back on undo — see
      // src/state/undo.ts for why this is not a soft delete.
      const removed = deleteRecord(db, existing.id);
      offerUndo(removed, removed.length > 1 ? 'Transfer deleted' : 'Record deleted');
      router.back();
    } catch {
      setError('Could not delete this record.');
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

  /**
   * Editing cannot turn a record into a transfer or back — that changes how many
   * rows exist. Delete and re-add is clearer than a silent restructure.
   */
  const typeLocked = (value: RecordType) =>
    isEdit && (editingTransfer ? value !== 'transfer' : value === 'transfer');

  return (
    <View
      className="flex-1 bg-ground"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      testID="record-screen">
      <View className="flex-row items-center justify-between px-4 py-3">
        <Pressable
          onPress={() => router.back()}
          testID="record-cancel"
          accessibilityRole="button"
          className="rounded-lg border border-line px-5 py-2.5 active:opacity-70">
          <Text className="text-sm font-medium text-muted">Cancel</Text>
        </Pressable>

        <Text className="text-sm font-medium text-muted" testID="record-title">
          {isEdit ? 'Edit record' : 'New record'}
        </Text>

        <Pressable
          onPress={onSave}
          disabled={!canSave}
          testID="record-save"
          accessibilityRole="button"
          className={`rounded-lg px-7 py-2.5 active:opacity-80 ${
            canSave ? 'bg-accent' : 'bg-surface'
          }`}>
          <Text className={`text-sm font-semibold ${canSave ? 'text-accent-ink' : 'text-line'}`}>
            Save
          </Text>
        </Pressable>
      </View>

      <View className="mx-4 mb-3 flex-row rounded-lg bg-surface p-1">
        {TYPES.map(({ value, label }) => {
          const locked = typeLocked(value);
          return (
            <Pressable
              key={value}
              disabled={locked}
              onPress={() => {
                setType(value);
                setCategoryId(null);
                setError(null);
              }}
              testID={`type-${value}`}
              accessibilityRole="button"
              className={`flex-1 items-center rounded-md py-2 ${type === value ? 'bg-raised' : ''}`}>
              <Text
                className={`text-sm ${
                  type === value
                    ? 'font-semibold text-accent'
                    : locked
                      ? 'text-line'
                      : 'text-muted'
                }`}>
                {label}
              </Text>
            </Pressable>
          );
        })}
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
          web textarea fills its container. */}
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

      {/* Delete sits at the bottom-left, far from Save, and is the only
          destructive control on the screen — hence the expense colour. */}
      {isEdit ? (
        <Pressable
          onPress={onDelete}
          testID="record-delete"
          accessibilityRole="button"
          className="mx-4 mb-2 self-start rounded-lg border border-expense/40 px-4 py-2 active:opacity-70">
          <Text className="text-sm font-medium text-expense">Delete</Text>
        </Pressable>
      ) : null}

      <View className="mx-3">
        <Keypad onKey={onKey} />
      </View>

      {/* Surface fill and radius match the account and category pickers, so the
          form reads as one set of controls. The value alone is the label here —
          a date needs no caption to be recognisable as a date. */}
      <View className="mx-4 mb-1 mt-3 flex-row gap-3">
        <Pressable
          onPress={() => setPicking('date')}
          testID="record-date"
          accessibilityRole="button"
          accessibilityLabel={`Date, ${formatDayLabel(occurredAt)}`}
          className="flex-1 items-center rounded-lg bg-surface py-3 active:opacity-70">
          <Text className="text-sm text-ink">{formatDayLabel(occurredAt)}</Text>
        </Pressable>
        <Pressable
          onPress={() => setPicking('time')}
          testID="record-time"
          accessibilityRole="button"
          accessibilityLabel={`Time, ${formatTimeLabel(occurredAt)}`}
          className="flex-1 items-center rounded-lg bg-surface py-3 active:opacity-70">
          <Text className="text-sm text-ink">{formatTimeLabel(occurredAt)}</Text>
        </Pressable>
      </View>

      {picking ? (
        <DateTimePicker
          value={occurredAt}
          mode={picking}
          is24Hour={false}
          onValueChange={onPickDateTime}
          onDismiss={() => setPicking(null)}
        />
      ) : null}

      <PickerSheet
        visible={sheet === 'account'}
        title={type === 'transfer' ? 'From account' : 'Account'}
        options={accountOptions}
        selectedId={accountId}
        onSelect={(pickedId) => {
          setAccountId(pickedId);
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
        onSelect={(pickedId) => {
          setToAccountId(pickedId);
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
        onSelect={(pickedId) => {
          setCategoryId(pickedId);
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
