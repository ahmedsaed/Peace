import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import { PickerSheet, type PickerOption } from '@/components/picker-sheet';
import { BankMessagesCard } from '@/components/bank-card';
import { ReceiptsCard } from '@/components/receipts-card';
import { GeminiKeyCard } from '@/components/gemini-key';
import { StackHeader } from '@/components/screen';
import { db } from '@/db/client';
import {
  listAccountsWithBalance,
  listArchivedAccounts,
  restoreAccount,
} from '@/db/repo/accounts';
import { CURRENCIES, currencyName } from '@/lib/currencies';
import { useSettingsStore } from '@/state/settings';
import { useMoney } from '@/state/money';

/**
 * Settings.
 *
 * ONLY SETTINGS THAT DO SOMETHING APPEAR HERE. A control for a preference
 * nothing reads is a switch that silently does nothing, which is worse than an
 * empty screen and exactly how an app teaches you to stop trusting it. Each row
 * lands in the same change as the code that honours it — `carryOver` appeared
 * the moment two screens started reading it, and `showTotal` the moment the
 * records list learned to total a day.
 */
export default function SettingsScreen() {
  const money = useMoney();
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  const [sheet, setSheet] = useState<'currency' | 'account' | 'archived' | null>(null);

  const [accounts, setAccounts] = useState(() => listAccountsWithBalance(db));
  const [archived, setArchived] = useState(() => listArchivedAccounts(db));
  /** The account this visit brought back, for the line that says so. */
  const [restored, setRestored] = useState<string | null>(null);

  // Re-read on focus, like every other screen that shows rows from the ledger.
  // An account archived in the editor while this screen sat mounted behind it
  // would otherwise leave the row below saying "None" at the exact moment the
  // archive it is offering to open stopped being empty.
  useFocusEffect(
    useCallback(() => {
      setAccounts(listAccountsWithBalance(db));
      setArchived(listArchivedAccounts(db));
      setRestored(null);
    }, [])
  );

  const defaultAccount = accounts.find((a) => a.id === settings.defaultAccountId);

  const currencyOptions: PickerOption[] = CURRENCIES.map((c) => ({
    id: c.code,
    label: c.name,
    icon: 'cash',
    detail: c.code,
  }));

  // "First account" is a real choice, not a null state, so it gets a row of its
  // own rather than being something you achieve by deselecting.
  const accountOptions: PickerOption[] = [
    { id: '', label: 'First account', icon: 'dots', detail: 'No preference' },
    ...accounts.map((a) => ({
      id: a.id,
      label: a.name,
      icon: a.icon,
      color: a.color,
      detail: money(a.balanceMinor, a.currency),
      detailTone: a.balanceMinor < 0 ? ('negative' as const) : ('neutral' as const),
    })),
  ];

  const archivedOptions: PickerOption[] = archived.map((a) => ({
    id: a.id,
    label: a.name,
    icon: a.icon,
    color: a.color,
    // What is still in it, because "which one was the old current account"
    // is answered by the balance far more often than by the name.
    detail: money(a.balanceMinor, a.currency),
    detailTone: a.balanceMinor < 0 ? ('negative' as const) : ('neutral' as const),
  }));

  return (
    <View className="flex-1 bg-ground" testID="settings-screen">
      <StackHeader title="Settings" />

      <ScrollView contentContainerClassName="px-4 pb-10 pt-4">
        <Section title="Money">
          <Row
            label="Home currency"
            value={`${currencyName(settings.homeCurrency)} · ${settings.homeCurrency}`}
            hint="What totals and balances are shown in."
            onPress={() => setSheet('currency')}
            testID="setting-home-currency"
          />
          <Row
            label="Default account"
            value={defaultAccount?.name ?? 'First account'}
            hint="Pre-selected when you start a new record."
            onPress={() => setSheet('account')}
            testID="setting-default-account"
            last
          />
        </Section>

        {/* Archiving is reached from the account editor, and undoing it was
            not reachable from anywhere: the editor opens by tapping the
            account on the Accounts tab, which hides archived ones. The way
            back belongs somewhere that does not depend on the account being
            listed, and Settings is the screen that already holds the accounts
            it would offer. */}
        <View className="pb-6 pt-6">
          <Section title="Accounts">
            <Row
              label="Archived accounts"
              value={archived.length === 0 ? 'None' : `${archived.length} put away`}
              hint="They keep every record and leave the pickers and totals. Tap to bring one back."
              // No archive, no destination: a row that opens an empty sheet
              // teaches you that the feature is broken rather than that you
              // have nothing put away.
              onPress={archived.length === 0 ? undefined : () => setSheet('archived')}
              testID="setting-archived-accounts"
              last
            />
          </Section>
          {restored ? (
            <Text className="px-1 pt-2 text-xs text-muted" testID="account-restored">
              {restored} is back in your accounts.
            </Text>
          ) : null}
        </View>

        <Section title="Reporting">
          <Toggle
            label="Carry the balance forward"
            hint="Show what each month started with, and your running total. Nothing is added to any budget — a limit stays a limit."
            value={settings.carryOver}
            onChange={(next) => update('carryOver', next)}
            testID="setting-carry-over"
          />
          <Toggle
            label="Daily totals"
            hint="Put each day's net beside its date in the records list. Transfers between your own accounts are left out."
            value={settings.showTotal}
            onChange={(next) => update('showTotal', next)}
            testID="setting-show-total"
            last
          />
        </Section>

        {/* Its own section, because the key is not a receipt setting: both
            reading features run on it, and burying it under one of them is what
            made "where do I put my key" a question at all. */}
        <View className="pt-6">
          <Text className="mb-2 px-1 text-[10px] uppercase tracking-widest text-muted">
            Reading with AI
          </Text>
          <GeminiKeyCard />
        </View>

        <View className="pt-4">
          <ReceiptsCard />
        </View>

        <View className="pt-4">
          <BankMessagesCard />
        </View>

        <Text className="px-1 pt-6 text-xs leading-5 text-muted opacity-70">
          The default date range arrives with a screen that reads it.
        </Text>
      </ScrollView>

      <PickerSheet
        visible={sheet === 'currency'}
        title="Home currency"
        options={currencyOptions}
        selectedId={settings.homeCurrency}
        onSelect={(code) => {
          update('homeCurrency', code);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        testID="sheet-currency"
      />

      <PickerSheet
        visible={sheet === 'archived'}
        title="Bring an account back"
        options={archivedOptions}
        onSelect={(id) => {
          // Restoring is one flag and is undone by the same toggle that set
          // it, now that the account is listed again — so there is nothing
          // here worth a confirmation step in front of it.
          const account = restoreAccount(db, id);
          setAccounts(listAccountsWithBalance(db));
          setArchived(listArchivedAccounts(db));
          setRestored(account.name);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        testID="sheet-archived-accounts"
      />

      <PickerSheet
        visible={sheet === 'account'}
        title="Default account"
        options={accountOptions}
        selectedId={settings.defaultAccountId}
        onSelect={(id) => {
          update('defaultAccountId', id);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        testID="sheet-default-account"
      />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text className="mb-2 px-1 text-[10px] uppercase tracking-widest text-muted">{title}</Text>
      <View className="overflow-hidden rounded-xl bg-surface">{children}</View>
    </View>
  );
}

/**
 * A row whose value is a switch rather than a destination.
 *
 * The whole row is not pressable: a switch already has its own hit target, and
 * a row that toggles on tap AND carries a switch gives two controls for one
 * value that can disagree about what a tap meant.
 */
function Toggle({
  label,
  hint,
  value,
  onChange,
  testID,
  last = false,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => void;
  testID: string;
  last?: boolean;
}) {
  return (
    <View
      className={`flex-row items-center gap-3 px-4 py-3.5 ${
        last ? '' : 'border-b border-line'
      }`}>
      <View className="flex-1">
        <Text className="text-[15px] text-ink">{label}</Text>
        <Text className="text-xs leading-4 text-muted">{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        testID={testID}
        accessibilityLabel={label}
        trackColor={{ false: palette.line, true: palette.accent }}
        thumbColor={palette.ink}
      />
    </View>
  );
}

/**
 * A row that leads somewhere — or, with no `onPress`, one that only reports.
 *
 * A row with nowhere to go keeps its place in the list rather than
 * disappearing, but loses the chevron and the press state: a control that
 * looks tappable and does nothing is the same lie as a switch that changes
 * nothing.
 */
function Row({
  label,
  value,
  hint,
  onPress,
  testID,
  last = false,
}: {
  label: string;
  value: string;
  hint: string;
  onPress?: () => void;
  testID: string;
  last?: boolean;
}) {
  const className = `flex-row items-center gap-3 px-4 py-3.5 ${
    last ? '' : 'border-b border-line'
  }`;

  const body = (
    <>
      <View className="flex-1">
        <Text className="text-[15px] text-ink">{label}</Text>
        <Text className="text-xs text-muted">{hint}</Text>
      </View>
      <Text
        className={`max-w-[45%] text-right text-sm ${onPress ? 'text-accent' : 'text-muted'}`}
        numberOfLines={1}>
        {value}
      </Text>
      {onPress ? <Icon name="chevron" size={14} color={palette.muted} /> : null}
    </>
  );

  if (!onPress) {
    return (
      <View className={className} testID={testID} accessibilityLabel={`${label}, ${value}`}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      className={`${className} active:bg-raised`}>
      {body}
    </Pressable>
  );
}
