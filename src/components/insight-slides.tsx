import { useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import type { CategoryKind } from '@/db/repo/spend';
import { mixHex } from '@/lib/analysis';
import {
  busiestWeekday,
  daysOf,
  WEEKDAY_NAMES,
  type Pace,
  type WeekdayAverage,
} from '@/lib/insights';
import type { Period } from '@/lib/period';
import { useMoney } from '@/state/money';
import { useTheme } from '@/state/theme';

export type Slide = {
  key: string;
  label: string;
  render: (width: number) => ReactNode;
};

/**
 * Charts that share one place on the screen, one at a time.
 *
 * A horizontal pager rather than more charts down the page: Analysis is already
 * a long scroll, and a second chart below the category list would sit where
 * nobody looks. The pager is SWIPED, but a swipe is invisible — to anyone who
 * would not think to try it, and to TalkBack entirely — so the names under it
 * are buttons too, and the current one is marked. They sit UNDER the chart, as
 * a chart's range or metric selector does in most finance apps: the chart is
 * what you look at first, and two switch rows stacked above it (this and
 * Expense/Income) read as one muddled control.
 */
export function ChartPager({ slides, height }: { slides: Slide[]; height: number }) {
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const scroller = useRef<ScrollView>(null);

  const go = (next: number) => {
    setIndex(next);
    scroller.current?.scrollTo({ x: next * width, animated: true });
  };

  return (
    <View onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))}>
      {width > 0 ? (
        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          testID="analysis-pager">
          {slides.map((slide) => (
            <View key={slide.key} style={{ width, height }} className="pt-2">
              {slide.render(width)}
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={{ height }} />
      )}
      <View className="mt-2 flex-row justify-center gap-1" accessibilityRole="tablist">
        {slides.map((slide, i) => (
          <Pressable
            key={slide.key}
            onPress={() => go(i)}
            accessibilityRole="tab"
            accessibilityState={{ selected: i === index }}
            testID={`analysis-slide-${slide.key}`}
            hitSlop={6}
            className={`rounded-full px-3 py-1 ${i === index ? 'bg-surface' : ''}`}>
            <Text className={`text-xs ${i === index ? 'font-semibold text-accent' : 'text-muted'}`}>
              {slide.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/**
 * THIS MONTH AGAINST YOUR USUAL ONE.
 *
 * The donut answers "where did it go"; this answers "am I on track", which a
 * ring cannot. The headline is the projection while the month is running and
 * the total once it is over — a past month has nothing left to project.
 */
export function PaceSlide({
  pace,
  scope,
  kind,
  period,
  homeCurrency,
  width,
  height,
}: {
  pace: Pace | null;
  /** The tag the screen is narrowed to, named on the slide as on the ring. */
  scope: string | null;
  kind: CategoryKind;
  period: Period;
  homeCurrency: string;
  width: number;
  height: number;
}) {
  const palette = useTheme();
  const money = useMoney();
  const spend = kind === 'expense';

  if (!pace) {
    return (
      <View className="flex-1 items-center justify-center px-6" testID="pace-not-started">
        <Text className="text-center text-sm text-muted">This month has not started yet.</Text>
      </View>
    );
  }

  const headline = pace.projectedMinor ?? pace.soFarMinor;
  const caption = pace.complete
    ? spend
      ? 'Spent this month'
      : 'Earned this month'
    : pace.projectedMinor !== null
      ? 'Heading for about'
      : spend
        ? 'Spent so far'
        : 'Earned so far';

  // The sentence belongs to the figure it explains, so it is decided beside it.
  let comparison: string;
  if (pace.usual === null) {
    comparison = 'No earlier month to compare with yet.';
  } else {
    const against = pace.complete ? pace.usualTotalMinor! : pace.usualByNowMinor!;
    const diff = pace.soFarMinor - against;
    const when = pace.complete ? 'your usual month' : 'your usual month by this day';
    comparison =
      diff === 0
        ? `Exactly ${when}.`
        : `${money(Math.abs(diff), homeCurrency)} ${diff > 0 ? 'more' : 'less'} than ${when}.`;
  }

  const chartWidth = width - 32;
  const chartHeight = Math.max(80, height - 150);

  return (
    <View className="flex-1 px-4" testID="pace-slide">
      <Text className="text-[10px] uppercase tracking-widest text-muted" numberOfLines={1}>
        {scope ? `${caption} · ${scope}` : caption}
      </Text>
      <Text
        className="text-2xl font-semibold text-ink"
        numberOfLines={1}
        adjustsFontSizeToFit
        testID="pace-headline">
        {money(headline, homeCurrency)}
      </Text>
      <Text className="mb-2 text-xs text-muted" testID="pace-comparison">
        {comparison}
      </Text>

      <PaceChart
        pace={pace}
        period={period}
        width={chartWidth}
        height={chartHeight}
        accessibilityLabel={`${caption} ${money(headline, homeCurrency)}. ${comparison}`}
      />

      <View className="mt-1 flex-row items-center gap-4">
        <Legend color={palette.accent} label="This month" />
        {pace.usual ? <Legend color={palette.muted} label="Usual" dashed /> : null}
        <Text className="ml-auto text-[11px] text-muted" testID="pace-per-day">
          {money(pace.perDayMinor, homeCurrency)} a day
        </Text>
      </View>
    </View>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <View className="flex-row items-center gap-1">
      <Svg width={14} height={4}>
        <Line
          x1={0}
          y1={2}
          x2={14}
          y2={2}
          stroke={color}
          strokeWidth={2}
          strokeDasharray={dashed ? '3 2' : undefined}
        />
      </Svg>
      <Text className="text-[11px] text-muted">{label}</Text>
    </View>
  );
}

/**
 * The running total, the usual month's, and — while the month runs — where
 * this one goes if the rest of it is usual.
 */
function PaceChart({
  pace,
  period,
  width,
  height,
  accessibilityLabel,
}: {
  pace: Pace;
  period: Period;
  width: number;
  height: number;
  accessibilityLabel: string;
}) {
  const palette = useTheme();
  const pad = 6;
  const bottom = height - 14;
  const all = [...pace.actual, ...(pace.usual ?? []), ...pace.projection];
  const top = Math.max(1, ...all);
  const floor = Math.min(0, ...all);
  const last = Math.max(1, pace.length - 1);

  const x = (i: number) => pad + (i / last) * (width - 2 * pad);
  const y = (v: number) => pad + (1 - (v - floor) / (top - floor)) * (bottom - pad);
  // An SVG path with NaN in it draws nothing on Android rather than failing,
  // so every point is checked rather than trusted.
  const line = (values: readonly number[], from = 0) =>
    values
      .map((v, i) => {
        const px = x(i + from);
        const py = y(v);
        return Number.isFinite(px) && Number.isFinite(py)
          ? `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`
          : '';
      })
      .join(' ');

  const days = daysOf(period);
  const todayX = x(pace.today);
  const todayY = y(pace.soFarMinor);

  return (
    <View accessible accessibilityLabel={accessibilityLabel} testID="pace-chart">
      <Svg width={width} height={height}>
        <Line x1={pad} y1={y(0)} x2={width - pad} y2={y(0)} stroke={palette.line} strokeWidth={1} />
        {pace.usual ? (
          <Path
            d={line(pace.usual)}
            stroke={palette.muted}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            fill="none"
          />
        ) : null}
        {pace.projection.length > 1 ? (
          <Path
            d={line(pace.projection, pace.today)}
            stroke={palette.accent}
            strokeWidth={2}
            strokeDasharray="1 5"
            strokeLinecap="round"
            fill="none"
          />
        ) : null}
        <Path
          d={line(pace.actual)}
          stroke={palette.accent}
          strokeWidth={2.5}
          strokeLinejoin="round"
          fill="none"
        />
        {!pace.complete ? (
          <Line
            x1={todayX}
            y1={pad}
            x2={todayX}
            y2={bottom}
            stroke={palette.accent}
            strokeOpacity={0.3}
            strokeWidth={1}
          />
        ) : null}
        <Circle cx={todayX} cy={todayY} r={3.5} fill={palette.accent} />
      </Svg>
      <View className="absolute bottom-0 left-0 right-0 flex-row justify-between px-1">
        <Text className="text-[10px] text-muted">{days[0]?.getDate()}</Text>
        <Text className="text-[10px] text-muted">{days[days.length - 1]?.getDate()}</Text>
      </View>
    </View>
  );
}

/**
 * Which days of the week cost the most, averaged over the month's days so far.
 *
 * The bars are proportions; the amount of the day being looked at is said in
 * words underneath, through `money`, so a masked ledger stays masked. Tap a bar
 * to read it — the busiest day is the one shown first.
 */
export function WeekdaySlide({
  averages,
  scope,
  daysCounted,
  kind,
  homeCurrency,
  height,
}: {
  averages: WeekdayAverage[];
  scope: string | null;
  daysCounted: number;
  kind: CategoryKind;
  homeCurrency: string;
  height: number;
}) {
  const palette = useTheme();
  const money = useMoney();
  const busiest = busiestWeekday(averages);
  const [picked, setPicked] = useState<number | null>(null);
  const shown = averages.find((a) => a.weekday === picked) ?? busiest;
  const peak = Math.max(1, ...averages.map((a) => a.averageMinor));
  const barMax = Math.max(48, height - 120);
  const spend = kind === 'expense';

  if (!busiest) {
    return (
      <View className="flex-1 items-center justify-center px-6" testID="weekday-empty">
        <Text className="text-center text-sm text-muted">
          {spend ? 'Nothing spent this month yet.' : 'Nothing earned this month yet.'}
        </Text>
      </View>
    );
  }

  const plural = (w: number) => `${WEEKDAY_NAMES[w]}s`;
  const headline = `${plural(busiest.weekday)} ${spend ? 'cost you most' : 'bring in most'}`;

  return (
    <View className="flex-1 px-4" testID="weekday-slide">
      <Text className="text-[10px] uppercase tracking-widest text-muted" numberOfLines={1}>
        {scope ? `On average, per day · ${scope}` : 'On average, per day'}
      </Text>
      <Text className="text-lg font-semibold text-ink" testID="weekday-headline">
        {headline}
      </Text>
      <Text className="mb-3 text-xs text-muted" testID="weekday-detail">
        {shown
          ? `${plural(shown.weekday)}: ${money(shown.averageMinor, homeCurrency)} on average, over ${shown.days} ${shown.days === 1 ? 'day' : 'days'}.`
          : ''}
        {daysCounted < 14 ? ' Firmer after a few more weeks.' : ''}
      </Text>

      <View className="flex-row items-end justify-between" style={{ height: barMax + 18 }}>
        {averages.map((a) => {
          const active = a.weekday === shown?.weekday;
          return (
            <Pressable
              key={a.weekday}
              onPress={() => setPicked(a.weekday)}
              className="flex-1 items-center justify-end"
              style={{ height: barMax + 18 }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${plural(a.weekday)}: ${money(a.averageMinor, homeCurrency)} on average`}
              testID={`weekday-bar-${a.weekday}`}>
              <View
                className="rounded-t-sm"
                style={{
                  width: 18,
                  height: a.averageMinor > 0 ? Math.max(2, (a.averageMinor / peak) * barMax) : 0,
                  backgroundColor: active
                    ? palette.accent
                    : mixHex(palette.accent, palette.ground, 0.6),
                }}
              />
              <Text
                className={`mt-1 text-[10px] ${active ? 'font-semibold text-ink' : 'text-muted'}`}>
                {WEEKDAY_NAMES[a.weekday].slice(0, 3)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
