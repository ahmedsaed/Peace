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
import { useSetting } from '@/state/settings';

const TYPES: { value: Account['type']; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'card', label: 'Card' },
  { value: 'savings', label: 'Savings' },
  { value: 'loan', label: 'Loan' },
];

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
  const [icon, setIcon] = useState(existing?.icon ?? 'wallet');
  const [color, setColor] = useState(existing?.color ?? '#6B5B4A');
  const [archived, setArchived] = useState(existing?.archived ?? false);
  const [error, setError] = useState<string | null>(null);

  const openingMinor = opening.trim() === '' ? 0 : parseAmountToMinor(opening, currency);
  const canSave = name.trim().length > 0 && currency.trim().length === 3 && openingMinor !== null;

  function onSave() {
    if (!canSave) return;
    try {
      const patch = {
        name,
        type,
        currency: currency.toUpperCase(),
        openingBalance: openingMinor ?? 0,
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
              <TextField
                value={currency}
                onChangeText={(next) => setCurrency(next.toUpperCase())}
                placeholder="EGP"
                autoCapitalize="characters"
                maxLength={3}
                testID="account-currency"
              />
            </Field>
          </View>
          <View className="flex-1">
            <Field label="Opening balance">
              <TextField
                value={opening}
                onChangeText={setOpening}
                placeholder="0"
                keyboardType="numeric"
                testID="account-opening"
              />
            </Field>
          </View>
        </View>

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

        {existing ? (
          <DangerButton label="Delete account" onPress={onDelete} testID="account-delete" />
        ) : null}

        {existing ? (
          <Text className="mt-3 text-xs text-muted">
            Current balance {formatMinor(existing.openingBalance, existing.currency)} opening, plus
            every record on this account.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
