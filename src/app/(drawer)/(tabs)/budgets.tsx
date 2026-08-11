import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/icon';
import { EmptyState, MonthHeader, Screen } from '@/components/screen';
import palette from '@/constants/palette';
import { db } from '@/db/client';
import {
  applySuggestions,
  clearBudget,
  copyBudgets,
  latestBudgetedPeriod,
  listBudgets,
  setBudget,
  suggestBudgets,
  type BudgetRow,
  type BudgetSummary,
  type SuggestionSet,
} from '@/db/repo/budgets';
import { budgetFraction, budgetPercent, budgetState, remainingMinor } from '@/lib/budget';
import { formatMinor, minorToMajor, parseAmountToMinor } from '@/lib/money';
import { testIdSlug as slug } from '@/lib/id';
import { formatPeriod, currentPeriod, type Period } from '@/lib/period';
import { useSetting } from '@/state/settings';

const EMPTY: BudgetSummary = {
  budgeted: [],
  unbudgeted: [],
  totalBudgetMinor: 0,
  totalSpentMinor: 0,
  uncategorisedMinor: 0,
  unvaluedCount: 0,
  staleCount: 0,
};

export default function BudgetsScreen() {
  const homeCurrency = useSetting('homeCurrency');
  const [period, setPeriod] = useState(currentPeriod());
  const [summary, setSummary] = useState<BudgetSummary>(EMPTY);
  const [offer, setOffer] = useState<SuggestionSet>({ suggestions: [], monthsWithData: 0, basis: 'none' });
  const [copyFrom, setCopyFrom] = useState<Period | null>(null);
  const [editing, setEditing] = useState<BudgetRow | null>(null);

  const refresh = useCallback(() => {
    setSummary(listBudgets(db, period, homeCurrency));
    setOffer(suggestBudgets(db, period, { homeCurrency }));
    setCopyFrom(latestBudgetedPeriod(db, period));
  }, [period, homeCurrency]);

  // On focus, not on mount: logging a record moves every number on this screen,
  // and coming back from the record screen has to show that.
  useFocusEffect(refresh);

  const nothingBudgeted = summary.budgeted.length === 0;

  function onSave(categoryId: string, raw: string) {
    const minor = parseAmountToMinor(raw, homeCurrency);
    // Unparseable input clears rather than writing NaN into the ledger. An
    // empty field is how someone removes a limit they set by accident.
    setBudget(db, categoryId, period, minor === null ? 0 : Math.abs(minor), homeCurrency);
    setEditing(null);
    refresh();
  }

  return (
    <Screen testID="budgets-screen">
      <MonthHeader period={period} onChange={setPeriod}>
        <Totals summary={summary} homeCurrency={homeCurrency} />
      </MonthHeader>

      <ScrollView contentContainerClassName="pb-10" keyboardShouldPersistTaps="handled">
        {nothingBudgeted ? (
          <StartHere
            period={period}
            offer={offer}
            copyFrom={copyFrom}
            homeCurrency={homeCurrency}
            onUseSuggestions={() => {
              applySuggestions(db, period, offer.suggestions, homeCurrency);
              refresh();
            }}
            onCopy={() => {
              if (copyFrom) copyBudgets(db, copyFrom, period, homeCurrency);
              refresh();
            }}
          />
        ) : (
          <Section title={`Budgeted — ${formatPeriod(period)}`}>
            {summary.budgeted.map((row) => (
              <BudgetLine
                key={row.categoryId}
                row={row}
                homeCurrency={homeCurrency}
                onPress={() => setEditing(row)}
              />
            ))}
          </Section>
        )}

        {summary.unbudgeted.length > 0 ? (
          <Section title="Not budgeted">
            {summary.unbudgeted.map((row) => (
              <UnbudgetedLine
                key={row.categoryId}
                row={row}
                homeCurrency={homeCurrency}
                onPress={() => setEditing(row)}
              />
            ))}
          </Section>
        ) : null}

        <Footnotes summary={summary} homeCurrency={homeCurrency} />
      </ScrollView>

      <BudgetEditor
        // Remounting per category is what puts the right number in the field.
        // Without it, opening Transport straight after Food offers Food's limit
        // as Transport's starting point.
        key={editing?.categoryId ?? 'none'}
        row={editing}
        period={period}
        homeCurrency={homeCurrency}
        onClose={() => setEditing(null)}
        onSave={onSave}
        onClear={(categoryId) => {
          clearBudget(db, categoryId, period);
          setEditing(null);
          refresh();
        }}
      />
    </Screen>
  );
}

/**
 * BUDGET / SPENT / LEFT, with the overall bar under them.
 *
 * "Left" rather than a second percentage: the question a budget answers is how
 * much more can be spent, and a percentage makes that a subtraction the person
 * has to do themselves.
 */
function Totals({ summary, homeCurrency }: { summary: BudgetSummary; homeCurrency: string }) {
  const { totalBudgetMinor: budget, totalSpentMinor: spent } = summary;
  const left = remainingMinor(spent, budget);
  const state = budgetState(spent, budget);

  const cell = (label: string, value: string, tone: string, testID: string) => (
    <View className="flex-1 items-center">
      <Text className="mb-0.5 text-[10px] uppercase tracking-widest text-muted">{label}</Text>
      <Text className={`text-xs font-semibold ${tone}`} testID={testID}>
        {value}
      </Text>
    </View>
  );

  if (budget === 0) {
    return (
      <Text className="mt-3 text-center text-xs text-muted" testID="budget-total-none">
        Nothing budgeted this month
      </Text>
    );
  }

  return (
    <View className="mt-3">
      <View className="flex-row">
        {cell('Budget', formatMinor(budget, homeCurrency), 'text-ink', 'budget-total-budget')}
        {cell('Spent', formatMinor(spent, homeCurrency), 'text-expense', 'budget-total-spent')}
        {cell(
          left < 0 ? 'Over' : 'Left',
          formatMinor(Math.abs(left), homeCurrency),
          left < 0 ? 'text-expense' : 'text-ink',
          'budget-total-left'
        )}
      </View>
      <Bar fraction={budgetFraction(spent, budget)} state={state} className="mt-3" />
    </View>
  );
}

function Bar({
  fraction,
  state,
  className = '',
}: {
  fraction: number;
  state: ReturnType<typeof budgetState>;
  className?: string;
}) {
  return (
    <View className={`h-1.5 overflow-hidden rounded-full bg-line ${className}`}>
      <View
        style={{
          width: `${fraction * 100}%`,
          // Over-budget is the only state that changes the fill. "Close" is
          // already shown by the bar being nearly full — recolouring it too
          // would spend the alarm before anything has gone wrong.
          backgroundColor: state === 'over' ? palette.expense : palette.accent,
        }}
        className="h-full rounded-full"
      />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text className="px-4 pb-1.5 pt-4 text-xs font-semibold text-muted">{title}</Text>
      {children}
    </View>
  );
}

function CategoryDot({ row, size = 34 }: { row: BudgetRow; size?: number }) {
  return (
    <View
      className="items-center justify-center rounded-full"
      style={{ width: size, height: size, backgroundColor: row.categoryColor ?? '#6B5B4A' }}>
      <Icon name={row.categoryIcon ?? 'dots'} size={size / 2} color="#FFFFFF" />
    </View>
  );
}

function BudgetLine({
  row,
  homeCurrency,
  onPress,
}: {
  row: BudgetRow;
  homeCurrency: string;
  onPress: () => void;
}) {
  const state = budgetState(row.spentMinor, row.budgetMinor);
  const left = remainingMinor(row.spentMinor, row.budgetMinor);
  const id = slug(row.categoryId);

  // A limit written while a different home currency was in force does not mean
  // what it says any more. Saying so is the only honest option — silently
  // converting it would invent a number nobody chose.
  if (row.stale) {
    return (
      <Pressable
        onPress={onPress}
        testID={`budget-row-${id}`}
        className="flex-row items-center gap-3 border-b border-line px-4 py-3 active:bg-surface">
        <CategoryDot row={row} />
        <View className="flex-1">
          <Text className="text-base text-ink">{row.categoryName}</Text>
          <Text className="text-xs text-muted" testID={`budget-stale-${id}`}>
            Limit set in another currency — tap to set it again
          </Text>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      testID={`budget-row-${id}`}
      className="border-b border-line px-4 py-3 active:bg-surface">
      <View className="flex-row items-center gap-3">
        <CategoryDot row={row} />
        <View className="flex-1">
          <Text className="text-base text-ink" numberOfLines={1}>
            {row.categoryName}
          </Text>
          <Text className="text-xs text-muted" testID={`budget-amounts-${id}`}>
            {formatMinor(row.spentMinor, homeCurrency)} of{' '}
            {formatMinor(row.budgetMinor, homeCurrency)}
          </Text>
        </View>
        <View className="items-end">
          <Text
            className={`text-sm font-semibold ${state === 'over' ? 'text-expense' : 'text-ink'}`}
            testID={`budget-percent-${id}`}>
            {budgetPercent(row.spentMinor, row.budgetMinor)}%
          </Text>
          {/* The remaining amount is what makes "close" mean something: the bar
              being nearly full says the same thing, but not how much room is
              actually left. */}
          <Text
            className={`text-[11px] ${
              state === 'over' ? 'text-expense' : state === 'close' ? 'text-accent' : 'text-muted'
            }`}
            testID={`budget-left-${id}`}>
            {left < 0
              ? `${formatMinor(Math.abs(left), homeCurrency)} over`
              : `${formatMinor(left, homeCurrency)} left`}
          </Text>
        </View>
      </View>
      <Bar
        fraction={budgetFraction(row.spentMinor, row.budgetMinor)}
        state={state}
        className="mt-2.5"
      />
    </Pressable>
  );
}

function UnbudgetedLine({
  row,
  homeCurrency,
  onPress,
}: {
  row: BudgetRow;
  homeCurrency: string;
  onPress: () => void;
}) {
  const id = slug(row.categoryId);
  return (
    <Pressable
      onPress={onPress}
      testID={`budget-row-${id}`}
      className="flex-row items-center gap-3 border-b border-line px-4 py-2.5 active:bg-surface">
      <CategoryDot row={row} size={28} />
      <Text className="flex-1 text-sm text-ink" numberOfLines={1}>
        {row.categoryName}
      </Text>
      {/* What it is costing, not just its name. "What am I not watching" cannot
          be answered by a list of names. */}
      {row.spentMinor > 0 ? (
        <Text className="text-xs text-muted" testID={`budget-spent-${id}`}>
          {formatMinor(row.spentMinor, homeCurrency)} spent
        </Text>
      ) : null}
      <Text className="text-xs text-accent">Set</Text>
    </Pressable>
  );
}

/**
 * The first-run screen — the whole reason this feature gets used at all.
 *
 * MyMoney's only affordance here is "copy from past months", which is useless
 * on the first month because there is nothing to copy: it opens on a blank
 * screen asking for nineteen numbers you have no basis for. So the offer is
 * built from what was actually spent, and it says how many months it is drawing
 * on rather than presenting one partial month as though it were three.
 */
function StartHere({
  period,
  offer,
  copyFrom,
  homeCurrency,
  onUseSuggestions,
  onCopy,
}: {
  period: Period;
  offer: SuggestionSet;
  copyFrom: Period | null;
  homeCurrency: string;
  onUseSuggestions: () => void;
  onCopy: () => void;
}) {
  if (offer.suggestions.length === 0 && !copyFrom) {
    return (
      <EmptyState
        icon="budgets"
        title={`No budget for ${formatPeriod(period)}`}
        hint="Log a few expenses first — then this screen can suggest a limit per category from what you actually spend."
      />
    );
  }

  return (
    <View className="mx-4 mt-4 rounded-lg bg-surface p-4" testID="budget-offer">
      {copyFrom ? (
        <Pressable
          onPress={onCopy}
          testID="budget-copy"
          className="mb-3 items-center rounded-lg bg-raised py-3 active:opacity-70">
          <Text className="text-sm font-semibold text-ink">
            Copy the {formatPeriod(copyFrom)} budget
          </Text>
        </Pressable>
      ) : null}

      {offer.suggestions.length > 0 ? (
        <>
          {/* The sentence changes with where the numbers came from. Calling a
              partial month's spending an "average" would be the app claiming
              more than it knows, and the number below it is the one the user
              is about to commit to. */}
          <Text className="mb-3 text-sm text-muted" testID="budget-offer-basis">
            {offer.basis === 'current-month'
              ? 'No full month to go on yet. Based on what you have spent so far this month:'
              : offer.monthsWithData === 1
                ? 'Based on 1 month of spending, you averaged:'
                : `Based on ${offer.monthsWithData} months of spending, you averaged:`}
          </Text>

          {offer.suggestions.map((suggestion) => (
            <View
              key={suggestion.categoryId}
              className="flex-row items-center gap-3 py-1.5"
              testID={`budget-suggestion-${slug(suggestion.categoryId)}`}>
              <View
                className="h-6 w-6 items-center justify-center rounded-full"
                style={{ backgroundColor: suggestion.categoryColor ?? '#6B5B4A' }}>
                <Icon name={suggestion.categoryIcon ?? 'dots'} size={12} color="#FFFFFF" />
              </View>
              <Text className="flex-1 text-sm text-ink" numberOfLines={1}>
                {suggestion.categoryName}
              </Text>
              <Text className="text-sm text-ink">
                {formatMinor(suggestion.amountMinor, homeCurrency)}
              </Text>
            </View>
          ))}

          <Pressable
            onPress={onUseSuggestions}
            testID="budget-apply"
            className="mt-3 items-center rounded-lg bg-accent py-3 active:opacity-80">
            <Text className="text-sm font-semibold text-accent-ink">Use these as my budget</Text>
          </Pressable>
          {/* This has to move with the basis as well. It read "Rounded up from
              your average" directly beneath a line saying there was no full
              month to average — two sentences contradicting each other about
              the number the user is being asked to commit to. */}
          <Text className="mt-2 text-center text-[11px] text-muted" testID="budget-offer-note">
            {offer.basis === 'current-month'
              ? 'A starting point, not a target. Tap any category below to change one.'
              : 'Rounded up from your average. Tap any category below to change one.'}
          </Text>
        </>
      ) : null}
    </View>
  );
}

/**
 * The lines that keep this screen honest about what it is NOT counting.
 *
 * Without them the totals here quietly disagree with the records screen and
 * nothing on either says why.
 */
function Footnotes({ summary, homeCurrency }: { summary: BudgetSummary; homeCurrency: string }) {
  if (
    summary.uncategorisedMinor === 0 &&
    summary.unvaluedCount === 0 &&
    summary.staleCount === 0
  ) {
    return null;
  }

  return (
    <View className="mt-4 gap-1 px-4">
      {summary.uncategorisedMinor > 0 ? (
        <Text className="text-[11px] text-muted" testID="budget-uncategorised">
          {formatMinor(summary.uncategorisedMinor, homeCurrency)} spent with no category — it cannot
          be budgeted until those records have one
        </Text>
      ) : null}
      {summary.unvaluedCount > 0 ? (
        <Text className="text-[11px] text-muted" testID="budget-unvalued">
          {summary.unvaluedCount === 1 ? '1 record is' : `${summary.unvaluedCount} records are`} not
          counted — no {homeCurrency} value
        </Text>
      ) : null}
      {summary.staleCount > 0 ? (
        <Text className="text-[11px] text-muted" testID="budget-stale-count">
          {summary.staleCount === 1 ? '1 limit was' : `${summary.staleCount} limits were`} set in
          another currency and {summary.staleCount === 1 ? 'is' : 'are'} not counted
        </Text>
      ) : null}
    </View>
  );
}

function BudgetEditor({
  row,
  period,
  homeCurrency,
  onClose,
  onSave,
  onClear,
}: {
  row: BudgetRow | null;
  period: Period;
  homeCurrency: string;
  onClose: () => void;
  onSave: (categoryId: string, raw: string) => void;
  onClear: (categoryId: string) => void;
}) {
  // Seeded once, from the initialiser, because the component is remounted per
  // category. Deliberately NOT set from an onShow callback: if that ever failed
  // to fire, the field would open empty on an existing limit — and an empty
  // field means "remove", so a missed callback would delete the very budget the
  // user opened to look at.
  const [draft, setDraft] = useState(() =>
    row && row.budgetMinor > 0 ? String(minorToMajor(row.budgetMinor, homeCurrency)) : ''
  );

  return (
    <Modal visible={row !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Dismiss" />

      <View
        className="rounded-t-2xl border-t border-line bg-ground px-5 pb-8 pt-5"
        style={{ elevation: 16 }}
        testID="budget-editor">
        {row ? (
          <>
            <View className="mb-4 flex-row items-center gap-3">
              <CategoryDot row={row} />
              <View className="flex-1">
                <Text className="text-base font-semibold text-ink">{row.categoryName}</Text>
                <Text className="text-xs text-muted">
                  {formatPeriod(period)} · {formatMinor(row.spentMinor, homeCurrency)} spent so far
                </Text>
              </View>
            </View>

            <View className="flex-row items-center gap-3 rounded-lg bg-raised px-4">
              <Text className="text-sm text-muted">{homeCurrency}</Text>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="0"
                placeholderTextColor={palette.muted}
                keyboardType="decimal-pad"
                autoFocus
                testID="budget-input"
                className="flex-1 py-3 text-right text-xl text-ink"
              />
            </View>

            <Pressable
              onPress={() => onSave(row.categoryId, draft)}
              testID="budget-save"
              className="mt-4 items-center rounded-lg bg-accent py-3 active:opacity-80">
              <Text className="text-sm font-semibold text-accent-ink">Save limit</Text>
            </Pressable>

            {row.budgetMinor > 0 || row.stale ? (
              <Pressable
                onPress={() => onClear(row.categoryId)}
                testID="budget-remove"
                className="mt-2 items-center py-2">
                <Text className="text-sm text-expense">Remove limit</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </View>
    </Modal>
  );
}
