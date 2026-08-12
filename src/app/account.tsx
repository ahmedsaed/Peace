import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ColorPicker,
  DangerButton,
  Field,
  FormHeader,
  IconPicker,
  Segmented,
  TextField,
} from '@/components/form';
import { Icon } from '@/components/icon';
import { PickerSheet, type PickerOption } from '@/components/picker-sheet';
import palette from '@/constants/palette';
import { db } from '@/db/client';
import {
  createAccount,
  deleteAccount,
  getAccount,
  updateAccount,
} from '@/db/repo/accounts';
import { InvariantError } from '@/db/repo/categories';
import type { Account } from '@/db/schema';
import { formatMinor, parseAmountToMinor } from '@/lib/money';
import { CURRENCIES, currencyName } from '@/lib/currencies';
import { ReconcileSheet } from '@/components/reconcile-sheet';
import { accountBalance, reconcileAccount } from '@/db/repo/adjust';
import { bpToPercent, isLiability, percentToBp } from '@/lib/liability';
import { useSetting } from '@/state/settings';

const TYPES: { value: Account['type']; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'card', label: 'Card' },
  { value: 'savings', label: 'Savings' },
  { value: 'loan', label: 'Loan' },
];

const CURRENCY_OPTIONS: PickerOption[] = CURRENCIES.map((c) => ({
  id: c.code,
  label: c.name,
  icon: 'cash',
  detail: c.code,
}));

export default function AccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const existing = useMemo(() => (id ? getAccount(db, id) : undefined), [id]);

  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<Account['type']>(existing?.type ?? 'cash');
  const homeCurrency = useSetting('homeCurrency');
  // A new account almost always uses the home currency; a foreign-currency
  // account is the exception worth typing, not the default worth assuming.
  const [currency, setCurrency] = useState(existing?.currency ?? homeCurrency);
  const [opening, setOpening] = useState(
    existing ? String(existing.openingBalance / 100) : ''
  );
  const [limit, setLimit] = useState(
    existing?.creditLimit ? String(existing.creditLimit / 100) : ''
  );
  const [foreignFee, setForeignFee] = useState(bpToPercent(existing?.foreignFeeBp ?? null));
  const [cashFee, setCashFee] = useState(bpToPercent(existing?.cashFeeBp ?? null));
  const [icon, setIcon] = useState(existing?.icon ?? 'wallet');
  const [color, setColor] = useState(existing?.color ?? '#6B5B4A');
  const [archived, setArchived] = useState(existing?.archived ?? false);
  const [sheet, setSheet] = useState<'currency' | 'reconcile' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Re-read after a correction rather than kept in sync by hand: the balance is
  // derived, and a copy of a derived number is a copy that can be wrong.
  const [balanceNow, setBalanceNow] = useState(() =>
    existing ? accountBalance(db, existing.id) : 0
  );

  // A card is set up with its LIMIT, not a balance. Whatever is already owed
  // arrives through "Update balance" as a dated adjustment — visible in the
  // list, questionable later, deletable. An undated number quietly sitting
  // under the account name is a bad place to keep a debt.
  const liability = isLiability(type);

  const openingMinor = opening.trim() === '' ? 0 : parseAmountToMinor(opening, currency);
  const limitMinor = limit.trim() === '' ? null : parseAmountToMinor(limit, currency);
  const canSave =
    name.trim().length > 0 &&
    currency.trim().length === 3 &&
    (liability || openingMinor !== null) &&
    (limit.trim() === '' || limitMinor !== null);

  function onSave() {
    if (!canSave) return;
    try {
      const patch = {
        name,
        type,
        currency: currency.toUpperCase(),
        // A liability keeps its opening balance at zero on purpose; see above.
        openingBalance: liability ? (existing?.openingBalance ?? 0) : (openingMinor ?? 0),
        creditLimit: liability ? (limitMinor === null ? null : Math.abs(limitMinor)) : null,
        foreignFeeBp: liability ? percentToBp(foreignFee) : null,
        cashFeeBp: liability ? percentToBp(cashFee) : null,
        icon,
        color,
      };
      if (existing) updateAccount(db, existing.id, { ...patch, archived });
      else createAccount(db, patch);
      router.back();
    } catch (e) {
      setError(e instanceof InvariantError ? e.message : 'Could not save this account.');
    }
  }

  function onDelete() {
    if (!existing) return;
    try {
      deleteAccount(db, existing.id);
      router.back();
    } catch (e) {
      // The guard against deleting an account with history explains itself —
      // show it verbatim rather than a generic failure.
      setError(e instanceof InvariantError ? e.message : 'Could not delete this account.');
    }
  }

  return (
    <View
      className="flex-1 bg-ground"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      testID="account-screen">
      <FormHeader
        title={existing ? 'Edit account' : 'New account'}
        onCancel={() => router.back()}
        onSave={onSave}
        canSave={canSave}
      />

      <ScrollView contentContainerClassName="px-4 pb-8" keyboardShouldPersistTaps="handled">
        <Field label="Name">
          <TextField value={name} onChangeText={setName} placeholder="Cash" testID="account-name" />
        </Field>

        <Field label="Type">
          <Segmented options={TYPES} value={type} onChange={setType} testIDPrefix="acct-type" />
        </Field>

        <View className="flex-row gap-3">
          <View className="flex-1">
            <Field label="Currency">
              {/* A picker, not free text. Typing three letters invites "USDD",
                  "eg" and "£" — and a currency that is not a real ISO code
                  formats as itself and converts against nothing. The same list
                  the settings screen uses. */}
              <Pressable
                onPress={() => setSheet('currency')}
                testID="account-currency"
                accessibilityRole="button"
                accessibilityLabel={`Currency, ${currencyName(currency)}`}
                className="flex-row items-center justify-between rounded-lg bg-surface px-4 py-3 active:bg-raised">
                <Text className="text-base text-ink">{currency}</Text>
                <Icon name="chevron" size={14} color={palette.muted} />
              </Pressable>
            </Field>
          </View>
          <View className="flex-1">
            {liability ? (
              <Field label="Credit limit">
                <TextField
                  value={limit}
                  onChangeText={setLimit}
                  placeholder="Optional"
                  keyboardType="numeric"
                  testID="account-limit"
                />
              </Field>
            ) : (
              <Field label="Opening balance">
                <TextField
                  value={opening}
                  onChangeText={setOpening}
                  placeholder="0"
                  keyboardType="numeric"
                  testID="account-opening"
                />
              </Field>
            )}
          </View>
        </View>

        {/* Per-card, never global. A card with these left empty behaves exactly
            like any other account — which is the point: one bank's rules baked
            into the app is a rule every other card has to be excused from. */}
        {liability ? (
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Field label="Foreign fee %">
                <TextField
                  value={foreignFee}
                  onChangeText={setForeignFee}
                  placeholder="e.g. 3"
                  keyboardType="numeric"
                  testID="account-foreign-fee"
                />
              </Field>
            </View>
            <View className="flex-1">
              <Field label="Cash fee %">
                <TextField
                  value={cashFee}
                  onChangeText={setCashFee}
                  placeholder="e.g. 5"
                  keyboardType="numeric"
                  testID="account-cash-fee"
                />
              </Field>
            </View>
          </View>
        ) : null}

        <Field label="Colour">
          <ColorPicker value={color} onChange={setColor} />
        </Field>

        <Field label="Icon">
          <IconPicker value={icon} color={color} onChange={setIcon} />
        </Field>

        {existing ? (
          <Field label="Archived">
            {/* Archiving is the safe way to retire an account: the history stays,
                and it stops appearing in pickers. */}
            <Pressable
              onPress={() => setArchived((a) => !a)}
              testID="account-archived"
              accessibilityRole="switch"
              accessibilityState={{ checked: archived }}
              className="flex-row items-center justify-between rounded-lg bg-surface px-4 py-3 active:opacity-70">
              <Text className="text-sm text-ink">
                {archived ? 'Hidden from pickers' : 'Active'}
              </Text>
              <View
                className={`h-6 w-11 justify-center rounded-full px-0.5 ${
                  archived ? 'bg-accent' : 'bg-line'
                }`}>
                <View className={`h-5 w-5 rounded-full bg-ink ${archived ? 'self-end' : ''}`} />
              </View>
            </Pressable>
          </Field>
        ) : null}

        {error ? (
          <Text className="mb-4 text-sm text-expense" testID="account-error">
            {error}
          </Text>
        ) : null}

        {/* The drift fix. A card's balance is derived, so there is nothing to
            edit — instead you say what the bank shows and Peace writes a dated
            correction for the difference. */}
        {existing ? (
          <Pressable
            onPress={() => setSheet('reconcile')}
            testID="account-reconcile"
            className="mb-3 items-center rounded-lg bg-raised py-3 active:opacity-70">
            <Text className="text-sm font-semibold text-ink">Update balance</Text>
          </Pressable>
        ) : null}

        {existing ? (
          <DangerButton label="Delete account" onPress={onDelete} testID="account-delete" />
        ) : null}

        {existing ? (
          <Text className="mt-3 text-xs leading-5 text-muted">
            {liability
              ? `Currently ${formatMinor(Math.abs(balanceNow), existing.currency)} ${
                  balanceNow <= 0 ? 'owed' : 'in credit'
                }, from every record on this card. Use "Update balance" when the bank disagrees.`
              : `Current balance ${formatMinor(
                  existing.openingBalance,
                  existing.currency
                )} opening, plus every record on this account.`}
          </Text>
        ) : null}
      </ScrollView>

      {existing ? (
        <ReconcileSheet
          visible={sheet === 'reconcile'}
          accountName={existing.name}
          accountType={existing.type}
          currency={existing.currency}
          currentMinor={balanceNow}
          creditLimitMinor={existing.creditLimit}
          onClose={() => setSheet(null)}
          onConfirm={(targetMinor) => {
            reconcileAccount(db, existing.id, targetMinor);
            setBalanceNow(accountBalance(db, existing.id));
            setSheet(null);
          }}
        />
      ) : null}

      <PickerSheet
        visible={sheet === 'currency'}
        title="Account currency"
        options={CURRENCY_OPTIONS}
        selectedId={currency}
        onSelect={(code) => {
          setCurrency(code);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        testID="sheet-account-currency"
      />

    </View>
  );
}
