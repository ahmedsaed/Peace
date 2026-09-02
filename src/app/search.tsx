import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  SectionList,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { Icon } from '@/components/icon';
import { PickerSheet, type PickerOption } from '@/components/picker-sheet';
import { TagSheet } from '@/components/tag-sheet';
import { RecordRow } from '@/components/record-row';
import { EmptyState, StackHeader } from '@/components/screen';
import palette from '@/constants/palette';
import { db } from '@/db/client';
import { listAccountsWithBalance } from '@/db/repo/accounts';
import { listCategoryTree } from '@/db/repo/categories';
import { listTags } from '@/db/repo/tags';
import { groupByDay } from '@/db/repo/records';
import { searchRecords, type SearchOutcome } from '@/db/repo/search';
import {
  activeFilterCount,
  EMPTY_QUERY,
  isRunnable,
  KIND_LABELS,
  RANGE_LABELS,
  withKind,
  type DateRange,
  type RecordKind,
  type SearchQuery,
} from '@/lib/search-query';
import { useSetting } from '@/state/settings';
import { useMoney } from '@/state/money';

/**
 * How long to wait after a keystroke before querying.
 *
 * The query is synchronous against SQLite, so running it on every character
 * types six queries into the word "coffee" and each one blocks the thread that
 * is drawing the next letter. Short enough to feel immediate, long enough that
 * a normal typing speed produces one query rather than one per key. Taps on the
 * filters skip it — a tap is already a deliberate, single action.
 */
const DEBOUNCE_MS = 180;

/** Sentinel for the "no filter" row in the account and category pickers. */
const ANY = 'filter-any';

export default function SearchScreen() {
  const money = useMoney();
  const router = useRouter();
  const homeCurrency = useSetting('homeCurrency');
  const { height } = useWindowDimensions();

  const [query, setQuery] = useState<SearchQuery>(EMPTY_QUERY);
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [picking, setPicking] = useState<'account' | 'counter' | 'category' | null>(null);
  const [tagSheet, setTagSheet] = useState(false);
  // Archived tags included: a finished project is exactly the thing you go
  // looking for afterwards, and hiding it here would make its records
  // unfindable by the one label that groups them.
  const tags = useMemo(() => listTags(db, { includeArchived: true }), []);

  const accounts = useMemo(() => listAccountsWithBalance(db), []);
  // Both kinds in one list: a search is not scoped to expense or income until
  // the type filter says so, and asking someone to set the type before they can
  // pick a category would be a filter that gates another filter.
  const categoryTree = useMemo(
    () => [...listCategoryTree(db, 'expense'), ...listCategoryTree(db, 'income')],
    []
  );

  const patch = (next: Partial<SearchQuery>) => setQuery((q) => ({ ...q, ...next }));

  const run = useCallback(() => {
    // An empty query is not a search. Returning the whole ledger would be the
    // records list with its month navigator removed, and the slowest thing the
    // app could do on the keystroke that clears the field.
    if (!isRunnable(query)) {
      setOutcome(null);
      return;
    }
    setOutcome(searchRecords(db, query, { homeCurrency }));
  }, [query, homeCurrency]);

  useEffect(() => {
    const timer = setTimeout(run, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [run]);

  // Re-run on focus so an edited record reappears with its new values — but
  // through a ref, because `run` changes identity on every keystroke and a
  // focus effect that depended on it would fire immediately each time and
  // undo the debounce above.
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  useFocusEffect(useCallback(() => runRef.current(), []));

  const filterCount = activeFilterCount(query);
  const sections = groupByDay(outcome?.rows ?? []).map((group) => ({
    key: group.key,
    title: group.heading,
    data: group.rows,
  }));

  const accountName = accounts.find((a) => a.id === query.accountId)?.name;
  const counterAccountName = accounts.find((a) => a.id === query.counterAccountId)?.name;
  const tagNames = tags.filter((t) => query.tagIds.includes(t.id)).map((t) => t.name);
  const categoryName = categoryTree
    .flatMap((node) => [node, ...node.children])
    .find((c) => c.id === query.categoryId)?.name;

  const accountOptions: PickerOption[] = [
    { id: ANY, label: 'Any account', icon: 'dots', color: palette.line },
    ...accounts.map((a) => ({
      id: a.id,
      label: a.name,
      icon: a.icon,
      color: a.color,
      detail: money(a.balanceMinor, a.currency),
      detailTone: a.balanceMinor < 0 ? ('negative' as const) : ('neutral' as const),
    })),
  ];

  const categoryOptions: PickerOption[] = [
    { id: ANY, label: 'Any category', icon: 'dots', color: palette.line },
    ...categoryTree.flatMap((node) => [
      { id: node.id, label: node.name, icon: node.icon, color: node.color },
      ...node.children.map((child) => ({
        id: child.id,
        label: child.name,
        icon: child.icon,
        color: child.color,
        indented: true,
      })),
    ]),
  ];

  return (
    <View className="flex-1 bg-ground" testID="search-screen">
      <StackHeader title="Search" />

      <View className="flex-row items-center gap-2 bg-surface px-4 pb-3">
        <TextInput
          value={query.text}
          onChangeText={(text) => patch({ text })}
          placeholder="Note, category or account"
          placeholderTextColor={palette.muted}
          testID="search-input"
          autoFocus
          returnKeyType="search"
          className="flex-1 rounded-lg bg-raised px-4 py-3 text-base text-ink"
        />
        <Pressable
          onPress={() => setFiltersOpen((open) => !open)}
          testID="search-filters"
          accessibilityRole="button"
          accessibilityLabel={filtersOpen ? 'Hide filters' : 'Show filters'}
          className={`h-11 w-11 items-center justify-center rounded-lg ${
            filterCount > 0 || filtersOpen ? 'bg-accent' : 'bg-raised'
          }`}>
          {/* The count sits in place of the icon rather than as a corner badge:
              at 44px a badge is a 10px dot that reads as a rendering artefact,
              and the number is the only thing worth knowing here. */}
          {filterCount > 0 ? (
            <Text className="text-base font-semibold text-accent-ink" testID="search-filter-count">
              {filterCount}
            </Text>
          ) : (
            <Icon
              name="filter"
              size={20}
              color={filtersOpen ? palette['accent-ink'] : palette.ink}
            />
          )}
        </Pressable>
      </View>

      {filtersOpen ? (
        <FilterPanel
          query={query}
          patch={patch}
          maxHeight={Math.max(190, height * 0.4)}
          accountName={accountName}
          counterAccountName={counterAccountName}
          categoryName={categoryName}
          onKind={(kind) => setQuery((q) => withKind(q, kind))}
          tagNames={tagNames}
          onPickTags={() => setTagSheet(true)}
          onPickAccount={() => setPicking('account')}
          onPickCounter={() => setPicking('counter')}
          onPickCategory={() => setPicking('category')}
          onClear={() => setQuery({ ...EMPTY_QUERY, text: query.text })}
          canClear={filterCount > 0}
        />
      ) : null}

      {outcome ? <ResultSummary outcome={outcome} homeCurrency={homeCurrency} /> : null}

      {!outcome ? (
        <EmptyState
          icon="search"
          title="Search every record"
          hint="Type part of a note, a category or an account — or filter by type, amount and date."
        />
      ) : outcome.rows.length === 0 ? (
        <EmptyState
          icon="search"
          title="No records match"
          hint="Try a shorter word, or clear a filter."
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(row) => row.id}
          renderItem={({ item }) => (
            <RecordRow
              row={item}
              onPress={() => router.push({ pathname: '/record', params: { id: item.id } })}
            />
          )}
          renderSectionHeader={({ section }) => (
            <Text className="bg-ground px-4 pb-1.5 pt-4 text-xs font-semibold text-muted">
              {section.title}
            </Text>
          )}
          stickySectionHeadersEnabled={false}
          // The keyboard opens with the screen, so scrolling the results is the
          // gesture that means "I am reading now, not typing".
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="pb-10"
          testID="search-results"
        />
      )}

      <PickerSheet
        visible={picking === 'account'}
        title="Account"
        // The two ends of a transfer cannot be the same account, so offering it
        // on both rows offers a query that is guaranteed to match nothing.
        // Null unless a transfer is being filtered, which excludes nothing.
        options={accountOptions.filter((o) => o.id !== query.counterAccountId)}
        selectedId={query.accountId ?? ANY}
        onSelect={(id) => {
          patch({ accountId: id === ANY ? null : id });
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
        testID="account-sheet"
      />

      {/* The other end of a transfer. A separate sheet from the one above
          rather than one with computed props: they are two different filters
          and a flow has to be able to say which one it opened. */}
      <PickerSheet
        visible={picking === 'counter'}
        title="Transferred to"
        options={accountOptions.filter((o) => o.id !== query.accountId)}
        selectedId={query.counterAccountId ?? ANY}
        onSelect={(id) => {
          patch({ counterAccountId: id === ANY ? null : id });
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
        testID="counter-account-sheet"
      />

      {/* No create, no rename: this sheet is for FINDING by a label, and a
          search screen that could rename a tag would be editing the ledger from
          the one place built to read it. */}
      <TagSheet
        visible={tagSheet}
        tags={tags}
        selectedIds={query.tagIds}
        onToggle={(id) =>
          patch({
            tagIds: query.tagIds.includes(id)
              ? query.tagIds.filter((t) => t !== id)
              : [...query.tagIds, id],
          })
        }
        onClose={() => setTagSheet(false)}
        testID="search-tag-sheet"
      />

      <PickerSheet
        visible={picking === 'category'}
        title="Category"
        options={categoryOptions}
        selectedId={query.categoryId ?? ANY}
        onSelect={(id) => {
          patch({ categoryId: id === ANY ? null : id });
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
        testID="category-sheet"
      />
    </View>
  );
}

/**
 * The result strip.
 *
 * Deliberately more than a count: "how much did I spend on coffee" is the
 * question behind most searches, and a list of matching rows with no total
 * leaves the person adding them up by hand.
 */
function ResultSummary({
  outcome,
  homeCurrency,
}: {
  outcome: SearchOutcome;
  homeCurrency: string;
}) {
  const money = useMoney();
  return (
    <View className="border-b border-line bg-surface px-4 py-2">
      <View className="flex-row items-center gap-4">
        <Text className="flex-1 text-xs text-muted" testID="search-count">
          {outcome.matchCount === 1 ? '1 record' : `${outcome.matchCount} records`}
        </Text>
        {outcome.expenseMinor !== 0 ? (
          <Text className="text-xs font-semibold text-expense" testID="search-expense">
            {money(outcome.expenseMinor, homeCurrency)}
          </Text>
        ) : null}
        {outcome.incomeMinor !== 0 ? (
          <Text className="text-xs font-semibold text-income" testID="search-income">
            {money(outcome.incomeMinor, homeCurrency)}
          </Text>
        ) : null}
      </View>

      {/* Saying the list is capped matters because the TOTAL above is not:
          without this line, a count of 1,240 next to 300 visible rows reads as
          a bug rather than as a cap. */}
      {outcome.truncated ? (
        <Text className="mt-1 text-[11px] text-muted" testID="search-truncated">
          Showing the newest {outcome.rows.length}. Narrow the search to see the rest.
        </Text>
      ) : null}

      {outcome.unvaluedCount > 0 ? (
        <Text className="mt-1 text-[11px] text-muted" testID="search-unvalued">
          {outcome.unvaluedCount === 1 ? '1 record is' : `${outcome.unvaluedCount} records are`} not
          counted — no {homeCurrency} value
        </Text>
      ) : null}
    </View>
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
      className={`rounded-full px-3 py-1.5 ${selected ? 'bg-accent' : 'bg-raised'}`}>
      {/* `numberOfLines` is load-bearing, not a nicety. Android measures the
          label a fraction wider than the width it then lays out in, so "This
          year" wrapped onto a second line the chip has no height for and
          rendered as "This" — inside a chip that was correctly sized for the
          full text, which is what makes it look like a truncation bug rather
          than a wrap. Pinning one line makes the measurement deterministic. */}
      <Text
        numberOfLines={1}
        className={`text-xs ${selected ? 'font-semibold text-accent-ink' : 'text-ink'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function FilterRow({
  label,
  value,
  onPress,
  testID,
}: {
  label: string;
  value: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      className="flex-row items-center gap-3 rounded-lg bg-raised px-3 py-2.5 active:opacity-70">
      <Text className="text-xs text-muted">{label}</Text>
      <Text className="flex-1 text-right text-sm text-ink" numberOfLines={1}>
        {value}
      </Text>
      <Icon name="chevron" size={12} color={palette.muted} />
    </Pressable>
  );
}

/**
 * The filters, inline rather than in a sheet.
 *
 * A sheet would have to open the account and category pickers on top of itself,
 * and a modal over a modal is unreliable on Android. Inline also keeps the
 * results visible while a filter is being changed, which is what tells you
 * whether the filter did what you wanted.
 *
 * It scrolls inside a bounded height for the same reason the record screen
 * pins its keypad: with a bank notification open beside the app there is not
 * enough room for both this and a result, and the result is what matters.
 */
function FilterPanel({
  query,
  patch,
  onKind,
  maxHeight,
  accountName,
  counterAccountName,
  categoryName,
  tagNames,
  onPickTags,
  onPickAccount,
  onPickCounter,
  onPickCategory,
  onClear,
  canClear,
}: {
  query: SearchQuery;
  patch: (next: Partial<SearchQuery>) => void;
  onKind: (kind: RecordKind | null) => void;
  maxHeight: number;
  accountName?: string;
  counterAccountName?: string;
  categoryName?: string;
  tagNames: string[];
  onPickTags: () => void;
  onPickAccount: () => void;
  onPickCounter: () => void;
  onPickCategory: () => void;
  onClear: () => void;
  canClear: boolean;
}) {
  const label = (text: string) => (
    <Text className="mb-1.5 text-[10px] uppercase tracking-widest text-muted">{text}</Text>
  );

  // A transfer has no category, so that row could only ever empty the screen.
  // What a transfer HAS instead is a far end, and the account row on its own
  // cannot reach it: search lists the outgoing leg, so "Account" is where the
  // money left from.
  const isTransfer = query.kind === 'transfer';

  return (
    <View
      style={{ maxHeight }}
      className="border-b border-line bg-surface"
      testID="search-filter-panel">
      <ScrollView
        contentContainerClassName="gap-3 px-4 pb-4"
        keyboardShouldPersistTaps="handled">
        <View>
          {label('Type')}
          <View className="flex-row flex-wrap gap-2">
            <Chip
              label="All"
              selected={query.kind === null}
              onPress={() => onKind(null)}
              testID="filter-kind-all"
            />
            {(Object.keys(KIND_LABELS) as RecordKind[]).map((kind) => (
              <Chip
                key={kind}
                label={KIND_LABELS[kind]}
                selected={query.kind === kind}
                // Tapping the selected chip clears it. Without that the only way
                // back to "All" is to find the All chip, and a filter you cannot
                // undo where you set it is the one people give up on.
                //
                // Through `withKind`, not `patch`: switching type hides one of
                // the two account/category rows, and a filter left set behind a
                // control that is no longer on screen empties the results with
                // no way to see why.
                onPress={() => onKind(query.kind === kind ? null : kind)}
                testID={`filter-kind-${kind}`}
              />
            ))}
          </View>
        </View>

        <View>
          {label('When')}
          <View className="flex-row flex-wrap gap-2">
            {(Object.keys(RANGE_LABELS) as DateRange[]).map((range) => (
              <Chip
                key={range}
                label={RANGE_LABELS[range]}
                selected={query.range === range}
                onPress={() => patch({ range })}
                testID={`filter-range-${range}`}
              />
            ))}
          </View>
        </View>

        <View className="gap-2">
          <FilterRow
            label={isTransfer ? 'From' : 'Account'}
            value={accountName ?? 'Any'}
            onPress={onPickAccount}
            testID="filter-account"
          />
          {isTransfer ? (
            <FilterRow
              label="To"
              value={counterAccountName ?? 'Any'}
              onPress={onPickCounter}
              testID="filter-counter-account"
            />
          ) : (
            <FilterRow
              label="Category"
              value={categoryName ?? 'Any'}
              onPress={onPickCategory}
              testID="filter-category"
            />
          )}
          {/* Below the account and category rows, and shown for every type: a
              label is orthogonal to the ledger side, so unlike the two above it
              nothing about the type can make it meaningless. */}
          <FilterRow
            label="Tags"
            value={tagNames.length > 0 ? tagNames.join(', ') : 'Any'}
            onPress={onPickTags}
            testID="filter-tags"
          />
        </View>

        <View>
          {label('Amount')}
          <View className="flex-row items-center gap-2">
            <TextInput
              value={query.minAmount}
              onChangeText={(minAmount) => patch({ minAmount })}
              placeholder="Min"
              placeholderTextColor={palette.muted}
              keyboardType="decimal-pad"
              testID="filter-min"
              className="flex-1 rounded-lg bg-raised px-3 py-2.5 text-sm text-ink"
            />
            <Text className="text-sm text-muted">to</Text>
            <TextInput
              value={query.maxAmount}
              onChangeText={(maxAmount) => patch({ maxAmount })}
              placeholder="Max"
              placeholderTextColor={palette.muted}
              keyboardType="decimal-pad"
              testID="filter-max"
              className="flex-1 rounded-lg bg-raised px-3 py-2.5 text-sm text-ink"
            />
          </View>
        </View>

        {canClear ? (
          <Pressable onPress={onClear} testID="filter-clear" className="items-center py-1">
            <Text className="text-sm text-accent">Clear filters</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
