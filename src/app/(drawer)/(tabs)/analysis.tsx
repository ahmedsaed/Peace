import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Donut } from '@/components/donut';
import { Icon } from '@/components/icon';
import { EmptyState, MonthHeader, Screen } from '@/components/screen';
import palette from '@/constants/palette';
import { db } from '@/db/client';
import {
  cashFlow,
  cashFlowPeak,
  categoryBreakdown,
  type Breakdown,
  type CashFlowPoint,
} from '@/db/repo/analysis';
import { broughtForward, runningTotals } from '@/db/repo/carry';
import type { CategoryKind } from '@/db/repo/spend';
import { rankSlices, type RankedSlice } from '@/lib/analysis';
import { testIdSlug as slug } from '@/lib/id';
import { currentPeriod, formatPeriod, parsePeriod, type Period } from '@/lib/period';
import { useSetting } from '@/state/settings';
import { useMoney, type Money } from '@/state/money';

const EMPTY: Breakdown = {
  slices: [],
  totalMinor: 0,
  uncategorisedMinor: 0,
  unvaluedCount: 0,
};

/** How many months of history the cash-flow strip shows. */
const CASH_FLOW_MONTHS = 6;

export default function AnalysisScreen() {
  const money = useMoney();
  const homeCurrency = useSetting('homeCurrency');
  const carryOver = useSetting('carryOver');
  const [period, setPeriod] = useState(currentPeriod());
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [breakdown, setBreakdown] = useState<Breakdown>(EMPTY);
  const [flow, setFlow] = useState<CashFlowPoint[]>([]);
  const [flowOpening, setFlowOpening] = useState(0);

  const refresh = useCallback(() => {
    setBreakdown(categoryBreakdown(db, period, kind, homeCurrency));
    const points = cashFlow(db, period, { months: CASH_FLOW_MONTHS, homeCurrency });
    setFlow(points);
    // The strip starts at its OLDEST month, not at the month being viewed —
    // taking the carry for `period` would start the line at today's position and
    // then add the same months again on top of it.
    setFlowOpening(
      carryOver && points.length > 0
        ? broughtForward(db, points[0].period, homeCurrency).amountMinor
        : 0
    );
  }, [period, kind, homeCurrency, carryOver]);

  // On focus rather than on mount: every number here moves when a record is
  // logged, and returning from the record screen has to show that.
  useFocusEffect(refresh);

  const ranked = rankSlices(breakdown.slices, { otherColor: palette.line });
  const nothing = breakdown.totalMinor === 0;

  return (
    <Screen testID="analysis-screen">
      <MonthHeader period={period} onChange={setPeriod} />

      <ScrollView contentContainerClassName="pb-10">
        <KindSwitch kind={kind} onChange={setKind} />

        {nothing ? (
          <EmptyState
            icon="analysis"
            title={`No ${kind === 'expense' ? 'spending' : 'income'} in ${formatPeriod(period)}`}
            hint="Log a record, or step back a month."
          />
        ) : (
          <>
            <View className="items-center pt-2">
              <Donut slices={ranked} testID="analysis-donut">
                <Text className="text-[10px] uppercase tracking-widest text-muted">
                  {kind === 'expense' ? 'Spent' : 'Earned'}
                </Text>
                <Text
                  className="text-center text-xl font-semibold text-ink"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  testID="analysis-total">
                  {money(breakdown.totalMinor, homeCurrency)}
                </Text>
              </Donut>
            </View>

            <View className="mt-4">
              {ranked.map((slice) => (
                <SliceRow
                  key={slice.id}
                  slice={slice}
                  kind={kind}
                  homeCurrency={homeCurrency}
                  totalMinor={breakdown.totalMinor}
                />
              ))}
            </View>
          </>
        )}

        <Footnotes breakdown={breakdown} kind={kind} homeCurrency={homeCurrency} />

        <CashFlow
          points={flow}
          homeCurrency={homeCurrency}
          current={period}
          carryOver={carryOver}
          startingMinor={flowOpening}
        />
      </ScrollView>
    </Screen>
  );
}

/**
 * Expense or income.
 *
 * Both sides get the same chart rather than expense getting a chart and income
 * getting a number. "Where did it all come from" is a real question for anyone
 * with more than one source, and the reference app answers it too.
 */
function KindSwitch({
  kind,
  onChange,
}: {
  kind: CategoryKind;
  onChange: (next: CategoryKind) => void;
}) {
  return (
    <View className="mx-4 mt-3 flex-row rounded-lg bg-surface p-1">
      {(['expense', 'income'] as const).map((value) => (
        <Pressable
          key={value}
          onPress={() => onChange(value)}
          testID={`analysis-kind-${value}`}
          accessibilityRole="button"
          accessibilityState={{ selected: kind === value }}
          className={`flex-1 items-center rounded-md py-2 ${kind === value ? 'bg-raised' : ''}`}>
          <Text
            className={`text-sm ${
              kind === value ? 'font-semibold text-accent' : 'text-muted'
            }`}>
            {value === 'expense' ? 'Expense' : 'Income'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * One ranked row: colour, name, share, amount, and a bar.
 *
 * The bar is scaled against the LARGEST slice, not against the total. Scaled
 * against the total, a month split nineteen ways would render nineteen bars
 * that are all a few pixels long and tell you nothing — the percentage already
 * carries the share of the whole.
 */
function SliceRow({
  slice,
  kind,
  homeCurrency,
  totalMinor,
}: {
  slice: RankedSlice;
  kind: CategoryKind;
  homeCurrency: string;
  totalMinor: number;
}) {
  const money = useMoney();
  const id = slug(slice.id);
  // `percent` is already the share of the total; this is only the bar's length.
  const fraction = totalMinor > 0 ? slice.amountMinor / totalMinor : 0;

  return (
    <View className="border-b border-line px-4 py-2.5" testID={`analysis-row-${id}`}>
      <View className="flex-row items-center gap-3">
        <View
          className="h-8 w-8 items-center justify-center rounded-full"
          style={{ backgroundColor: slice.color }}>
          <Icon name={slice.icon ?? 'dots'} size={15} color="#FFFFFF" />
        </View>

        <Text className="flex-1 text-base text-ink" numberOfLines={1}>
          {slice.label}
        </Text>

        <View className="items-end">
          <Text
            className={`text-sm font-semibold ${
              kind === 'expense' ? 'text-expense' : 'text-income'
            }`}
            testID={`analysis-amount-${id}`}>
            {money(slice.amountMinor, homeCurrency)}
          </Text>
          <Text className="text-[11px] text-muted" testID={`analysis-percent-${id}`}>
            {slice.percent.toFixed(1)}%
          </Text>
        </View>
      </View>

      <View className="mt-2 h-1 overflow-hidden rounded-full bg-line">
        <View
          className="h-full rounded-full"
          style={{ width: `${fraction * 100}%`, backgroundColor: slice.color }}
        />
      </View>
    </View>
  );
}

/**
 * Income against spending, month by month.
 *
 * This is the part the month navigator cannot show: whether a month was
 * unusual. A single month's totals are only meaningful next to the ones either
 * side of them.
 */
function CashFlow({
  points,
  homeCurrency,
  current,
  carryOver,
  startingMinor,
}: {
  points: CashFlowPoint[];
  homeCurrency: string;
  current: Period;
  carryOver: boolean;
  startingMinor: number;
}) {
  const money = useMoney();
  const peak = cashFlowPeak(points);
  const running = runningTotals(
    startingMinor,
    points.map((p) => p.netMinor)
  );
  const runningEnd = running.length > 0 ? running[running.length - 1] : startingMinor;
  if (peak === 0) return null;

  return (
    <View className="mt-6 px-4" testID="analysis-cashflow">
      <Text className="mb-1 text-xs font-semibold text-muted">Last {points.length} months</Text>
      <Text className="mb-3 text-[11px] text-muted opacity-70">
        Income above, spending below. Transfers are excluded from both.
      </Text>

      {/* No gap between columns, so the axis below reads as one continuous
          line rather than a dashed one. The bars are a fixed width and centred
          instead — a bar as wide as its column is a block, not a bar. */}
      <View className="flex-row items-end justify-between">
        {points.map((point) => {
          const { month } = parsePeriod(point.period);
          const isCurrent = point.period === current;
          return (
            <View key={point.period} className="flex-1 items-center">
              {/* Both halves are scaled to the same peak, or they would be in
                  different units and the comparison would be a lie. */}
              <View style={{ height: BAR_MAX }} className="w-full items-center justify-end">
                <View
                  className="rounded-t-sm"
                  style={{
                    height: barHeight(point.incomeMinor, peak),
                    width: BAR_WIDTH,
                    backgroundColor: palette.income,
                  }}
                  testID={`cashflow-income-${point.period}`}
                />
              </View>

              {/* The zero axis. Without it a month with nothing in it renders as
                  blank space and the chart reads as broken rather than as
                  empty — which is exactly what an unused month looks like. */}
              <View className="h-px w-full bg-line" />

              <View style={{ height: BAR_MAX }} className="w-full items-center">
                <View
                  className="rounded-b-sm"
                  style={{
                    height: barHeight(point.expenseMinor, peak),
                    width: BAR_WIDTH,
                    backgroundColor: palette.expense,
                  }}
                  testID={`cashflow-expense-${point.period}`}
                />
              </View>

              <Text
                className={`mt-1 text-[10px] ${
                  isCurrent ? 'font-semibold text-ink' : 'text-muted'
                }`}>
                {MONTH_INITIALS[month - 1]}
              </Text>
            </View>
          );
        })}
      </View>

      {/* The running position across the same months.
          The bars answer "was this month unusual"; this answers "am I actually
          accumulating anything", which is the question underneath it. Only
          shown with carry-over on, because without a starting figure a running
          total would begin at zero and be a different, wronger number. */}
      {carryOver ? (
        <View className="mt-3 flex-row items-baseline justify-between">
          <Text className="text-[11px] text-muted">
            Started {money(startingMinor, homeCurrency)}
          </Text>
          <Text
            className={`text-xs font-semibold ${
              runningEnd < 0 ? 'text-expense' : 'text-ink'
            }`}
            testID="analysis-running-end">
            {money(runningEnd, homeCurrency)} now
          </Text>
        </View>
      ) : null}

      <Text className="mt-3 text-[11px] text-muted" testID="analysis-cashflow-net">
        {netSentence(points, homeCurrency, money)}
      </Text>
    </View>
  );
}

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/** Tallest a bar can be, in points. Half the strip's height, one for each side. */
const BAR_MAX = 52;
const BAR_WIDTH = 16;

/**
 * A bar's height in points.
 *
 * Zero stays zero — an empty month must look empty. Anything else gets at least
 * two points, because a month with a small amount in it and a month with
 * nothing in it are different facts, and at this scale honest arithmetic would
 * round the first one away to a bar you cannot see.
 */
function barHeight(valueMinor: number, peakMinor: number): number {
  if (valueMinor <= 0 || peakMinor <= 0) return 0;
  return Math.max(2, (valueMinor / peakMinor) * BAR_MAX);
}

function netSentence(points: CashFlowPoint[], homeCurrency: string, money: Money): string {
  const net = points.reduce((sum, p) => sum + p.netMinor, 0);
  const span = points.length;
  if (net === 0) return `Level across ${span} months.`;
  return net > 0
    ? `${money(net, homeCurrency)} kept across ${span} months.`
    : `${money(Math.abs(net), homeCurrency)} more spent than earned across ${span} months.`;
}

/**
 * What the chart is NOT counting.
 *
 * A donut is a claim to account for a whole. Anything left out of it has to be
 * said out loud, or this screen quietly disagrees with the records list and
 * nothing on either says why.
 */
function Footnotes({
  breakdown,
  kind,
  homeCurrency,
}: {
  breakdown: Breakdown;
  kind: CategoryKind;
  homeCurrency: string;
}) {
  const money = useMoney();
  if (breakdown.uncategorisedMinor === 0 && breakdown.unvaluedCount === 0) return null;

  return (
    <View className="mt-3 gap-1 px-4">
      {breakdown.uncategorisedMinor > 0 ? (
        <Text className="text-[11px] text-muted" testID="analysis-uncategorised">
          {money(breakdown.uncategorisedMinor, homeCurrency)} of{' '}
          {kind === 'expense' ? 'spending' : 'income'} has no category and is not in the chart
        </Text>
      ) : null}
      {breakdown.unvaluedCount > 0 ? (
        <Text className="text-[11px] text-muted" testID="analysis-unvalued">
          {breakdown.unvaluedCount === 1 ? '1 record is' : `${breakdown.unvaluedCount} records are`}{' '}
          not counted — no {homeCurrency} value
        </Text>
      ) : null}
    </View>
  );
}
