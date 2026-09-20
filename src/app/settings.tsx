import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import { ArchiveSheet, type ArchiveItem } from '@/components/archive-sheet';
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
import {
  archivedName,
  checkDeletion,
  deleteArchived,
  type ArchivedTarget,
} from '@/db/repo/archive';
import {
  InvariantError,
  listArchivedCategories,
  restoreCategory,
} from '@/db/repo/categories';
import { listArchivedTags, restoreTag } from '@/db/repo/tags';
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
  const router = useRouter();
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  const [sheet, setSheet] = useState<
    'currency' | 'account' | 'accounts' | 'categories' | 'tags' | null
  >(null);

  const [accounts, setAccounts] = useState(() => listAccountsWithBalance(db));
  /** Everything put away, read together because one section offers all of it. */
  const [archived, setArchived] = useState(() => readArchive());
  /** What this visit brought back or removed, for the line that says so. */
  const [restored, setRestored] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const reload = useCallback(() => {
    setAccounts(listAccountsWithBalance(db));
    setArchived(readArchive());
  }, []);

  // Re-read on focus, like every other screen that shows rows from the ledger.
  // Something archived in an editor while this screen sat mounted behind it
  // would otherwise leave these rows saying "None" at the exact moment the
  // archive they offer to open stopped being empty.
  useFocusEffect(
    useCallback(() => {
      reload();
      setRestored(null);
      setProblem(null);
    }, [reload])
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

  function bringBack(name: string) {
    reload();
    setRestored(name);
    setProblem(null);
    setSheet(null);
  }

  /**
   * Delete it, or go and look at what is stopping you.
   *
   * The sheet only offers the button when `checkDeletion` said nothing is in
   * the way, so this is belt and braces — but the repository throws rather
   * than trusting a screen, and a caught error here is better than a crash on
   * a ledger that changed underneath the sheet.
   */
  function remove(target: ArchivedTarget, name: string, records: number) {
    try {
      deleteArchived(db, target);
      reload();
      setProblem(null);
      setRestored(
        target.kind === 'tag' && records > 0
          ? `${name} deleted, and taken off ${records} record${records === 1 ? '' : 's'}.`
          : `${name} deleted.`
      );
    } catch (error) {
      setProblem(
        error instanceof InvariantError ? error.message : `Could not delete ${name}.`
      );
    }
    setSheet(null);
  }

  /**
   * Hand the records standing in the way to the screen built for lists of
   * records, rather than describing them in a sentence nobody can act on.
   *
   * The filter comes from the same `checkDeletion` that produced the count, so
   * the number on the row and the list that opens cannot disagree.
   */
  function showBlockers(target: ArchivedTarget) {
    const name = archivedName(db, target);
    const { filter } = checkDeletion(db, target);
    if (!filter || !name) return;

    setSheet(null);
    router.push({
      pathname: '/search',
      params: { ...filter, deleting: target.kind, deletingName: name },
    });
  }

  /** A testID key: ids carry colons and names carry spaces, regexes carry neither. */
  const testKey = (value: string) => value.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();

  const archivedAccountItems: ArchiveItem[] = archived.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    icon: a.icon,
    color: a.color,
    testKey: testKey(a.id),
    // What is still in it, because "which one was the old current account"
    // is answered by the balance far more often than by the name.
    detail: money(a.balanceMinor, a.currency),
    blocking: checkDeletion(db, { kind: 'account', id: a.id }).blocking,
  }));

  const archivedCategoryItems: ArchiveItem[] = archived.categories.map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.icon,
    color: c.color,
    testKey: testKey(c.id),
    // Sub-categories sit under the parent they were put away with, the same
    // shape the category picker uses — a lone "Restaurants" in a flat list
    // does not say which Food it belonged to.
    indented: !!c.parentId,
    detail: c.kind === 'income' ? 'Income' : 'Expense',
    blocking: checkDeletion(db, { kind: 'category', id: c.id }).blocking,
  }));

  const archivedTagItems: ArchiveItem[] = archived.tags.map((t) => {
    const { records } = checkDeletion(db, { kind: 'tag', id: t.id });
    return {
      id: t.id,
      name: t.name,
      icon: 'tag',
      testKey: testKey(t.normalised),
      // A tag is never blocked — it owns no money — so the count is not a
      // wall, it is the cost, and it belongs where it can be read BEFORE the
      // delete rather than in the sentence afterwards.
      detail: records === 0 ? 'On no records' : `On ${records} record${records === 1 ? '' : 's'}`,
      cost:
        records === 0
          ? undefined
          : `${records} record${records === 1 ? '' : 's'} will lose the label. Their money, ` +
            'categories and notes are untouched.',
    };
  });

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

        {/* Archiving is set in an editor you reach by tapping the thing in a
            list — and every one of those lists hides what is archived, so the
            toggle that undoes it sat behind a row that no longer existed. The
            way back cannot live where the state removed it from, which is why
            all three are here. */}
        <View className="pb-6 pt-6">
          <Section title="Archived">
            <Row
              label="Accounts"
              value={countLabel(archived.accounts.length)}
              hint="They keep every record and leave the pickers and the totals."
              // No archive, no destination: a row that opens an empty sheet
              // teaches you that the feature is broken rather than that you
              // have nothing put away.
              onPress={archived.accounts.length === 0 ? undefined : () => setSheet('accounts')}
              testID="setting-archived-accounts"
            />
            <Row
              label="Categories"
              value={countLabel(archived.categories.length)}
              hint="Old records keep theirs. Sub-categories are put away with their parent."
              onPress={archived.categories.length === 0 ? undefined : () => setSheet('categories')}
              testID="setting-archived-categories"
            />
            <Row
              label="Tags"
              value={countLabel(archived.tags.length)}
              hint="A finished project stays on its records and stops being offered."
              onPress={archived.tags.length === 0 ? undefined : () => setSheet('tags')}
              testID="setting-archived-tags"
              last
            />
          </Section>
          {restored ? (
            <Text className="px-1 pt-2 text-xs text-muted" testID="archive-restored">
              {restored.endsWith('.') ? restored : `${restored} is back.`}
            </Text>
          ) : null}
          {problem ? (
            <Text className="px-1 pt-2 text-xs text-expense" testID="archive-problem">
              {problem}
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

      <ArchiveSheet
        visible={sheet === 'accounts'}
        title="Archived accounts"
        hint="Tap one to bring it back."
        items={archivedAccountItems}
        // Restoring is one flag, undone by the same toggle that set it now
        // that the thing is listed again — so it needs no confirmation in
        // front of it, and deleting, which is forever, gets one.
        onRestore={(id) => bringBack(restoreAccount(db, id).name)}
        onResolve={(id) => showBlockers({ kind: 'account', id })}
        onDelete={(id) => {
          const item = archivedAccountItems.find((a) => a.id === id);
          if (item) remove({ kind: 'account', id }, item.name, 0);
        }}
        onClose={() => setSheet(null)}
        testID="sheet-archived-accounts"
      />

      <ArchiveSheet
        visible={sheet === 'categories'}
        title="Archived categories"
        hint="Tap one to bring it back."
        items={archivedCategoryItems}
        onRestore={(id) => bringBack(restoreCategory(db, id).name)}
        onResolve={(id) => showBlockers({ kind: 'category', id })}
        onDelete={(id) => {
          const item = archivedCategoryItems.find((c) => c.id === id);
          if (item) remove({ kind: 'category', id }, item.name, 0);
        }}
        onClose={() => setSheet(null)}
        testID="sheet-archived-categories"
      />

      <ArchiveSheet
        visible={sheet === 'tags'}
        title="Archived tags"
        hint="Tap one to bring it back."
        items={archivedTagItems}
        onRestore={(id) => bringBack(restoreTag(db, id).name)}
        onResolve={() => undefined}
        onDelete={(id) => {
          const item = archivedTagItems.find((t) => t.id === id);
          if (!item) return;
          remove({ kind: 'tag', id }, item.name, checkDeletion(db, { kind: 'tag', id }).records);
        }}
        onClose={() => setSheet(null)}
        testID="sheet-archived-tags"
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

/**
 * Everything put away, in one read.
 *
 * One function rather than three calls at the call site: the section offers
 * all three together, and a fourth kind of archive added later has one place
 * to appear rather than three that have to agree.
 */
function readArchive() {
  return {
    accounts: listArchivedAccounts(db),
    categories: listArchivedCategories(db),
    tags: listArchivedTags(db),
  };
}

/** "None" is a real answer and says the query ran; "0 put away" reads as a bug. */
const countLabel = (count: number) => (count === 0 ? 'None' : `${count} put away`);

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
