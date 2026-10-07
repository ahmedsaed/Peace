import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';

import {
  barLayout,
  labelIndices,
  linePath,
  linePoints,
  scaleFor,
  shortLabel,
  type Frame,
} from '@/assistant/chart-geometry';
import { shareChartCsv, shareChartImage } from '@/assistant/export';
import type { ChartPoint, ChartSpec } from '@/assistant/tools/types';
import { Donut } from '@/components/donut';
import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import { rankSlices } from '@/lib/analysis';
import { testIdSlug } from '@/lib/id';
import { useMoney } from '@/state/money';

/**
 * A chart the assistant drew, from numbers the app computed.
 *
 * TAP TO SEE WHAT IS INSIDE. A bar is a claim about a set of records, and the
 * fastest way to trust it — or to find the one miscategorised purchase that
 * makes September look odd — is to open that set. Every bar and every legend
 * row opens the records behind it.
 *
 * Geometry is not masked, figures are: with amounts hidden the bars keep their
 * shape and every label is dots, the trade the rest of the app makes.
 */

const HEIGHT = 190;
const FRAME_PAD = { left: 56, right: 6, top: 10, bottom: 22 };

function barColor(chart: ChartSpec, point: ChartPoint): string {
  if (point.color) return point.color;
  if (chart.measure === 'income') return palette.income;
  if (chart.measure === 'expense') return palette.expense;
  return point.valueMinor < 0 ? palette.expense : palette.income;
}

export function ChartCard({
  chart,
  onDrill,
  testID = 'assistant-chart',
}: {
  chart: ChartSpec;
  onDrill: (point: ChartPoint | null) => void;
  testID?: string;
}) {
  const money = useMoney();
  const [width, setWidth] = useState(0);
  const [busy, setBusy] = useState<'image' | 'csv' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shot = useRef<View>(null);

  const exportAs = async (kind: 'image' | 'csv') => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'csv') {
        await shareChartCsv(chart);
      } else {
        const uri = await captureRef(shot, { format: 'png', quality: 1, result: 'tmpfile' });
        await shareChartImage(uri, chart);
      }
    } catch (e) {
      console.warn('[assistant] chart export failed', e);
      setError('Could not export the chart.');
    } finally {
      setBusy(null);
    }
  };

  const what = chart.measure === 'expense' ? 'Spent' : chart.measure === 'income' ? 'Earned' : 'Net';
  const empty = chart.points.length === 0 || chart.points.every((p) => p.valueMinor === 0);

  return (
    <View className="overflow-hidden rounded-xl border border-line bg-surface" testID={testID}>
      {/* `collapsable={false}`: Android flattens views that draw nothing of
          their own, and a flattened view cannot be captured to an image. */}
      <View ref={shot} collapsable={false} className="bg-surface px-4 pb-3 pt-3.5">
        <Text className="text-[15px] font-semibold text-ink" numberOfLines={2}>
          {chart.title}
        </Text>
        <Text className="mb-2 text-xs text-muted" testID={`${testID}-caption`}>
          {chart.rangeLabel} · {what} {money(chart.totalMinor, chart.currency)}
        </Text>

        {empty ? (
          <Text className="py-6 text-center text-sm text-muted">Nothing to draw for this span.</Text>
        ) : chart.type === 'donut' ? (
          <DonutChart chart={chart} onDrill={onDrill} testID={testID} />
        ) : (
          <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: HEIGHT }}>
            {width > 0 ? <XyChart chart={chart} width={width} onDrill={onDrill} testID={testID} /> : null}
          </View>
        )}

        {chart.overlapping ? (
          <Text className="mt-2 text-[11px] text-muted">
            Tags overlap, so these do not add up to the total.
          </Text>
        ) : null}
        {chart.unvaluedCount > 0 ? (
          <Text className="mt-1 text-[11px] text-muted">
            {chart.unvaluedCount === 1 ? '1 record has' : `${chart.unvaluedCount} records have`} no {chart.currency}{' '}
            value and {chart.unvaluedCount === 1 ? 'is' : 'are'} left out.
          </Text>
        ) : null}
      </View>

      <View className="flex-row items-center gap-2 border-t border-line px-3 py-2">
        <Text className="flex-1 text-[11px] text-muted">
          {chart.type === 'donut' ? 'Tap a row to see its records' : 'Tap a bar to see its records'}
        </Text>
        <ExportButton label="Image" busy={busy === 'image'} onPress={() => exportAs('image')} testID={`${testID}-export-image`} />
        <ExportButton label="CSV" busy={busy === 'csv'} onPress={() => exportAs('csv')} testID={`${testID}-export-csv`} />
      </View>
      {error ? <Text className="px-4 pb-2 text-xs text-expense">{error}</Text> : null}
    </View>
  );
}

function ExportButton({
  label,
  busy,
  onPress,
  testID,
}: {
  label: string;
  busy: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`Export as ${label}`}
      className={`flex-row items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 active:bg-raised ${
        busy ? 'opacity-40' : ''
      }`}>
      <Icon name="export" size={13} color={palette.muted} />
      <Text className="text-xs text-muted">{busy ? '…' : label}</Text>
    </Pressable>
  );
}

function XyChart({
  chart,
  width,
  onDrill,
  testID,
}: {
  chart: ChartSpec;
  width: number;
  onDrill: (point: ChartPoint) => void;
  testID: string;
}) {
  const money = useMoney();
  const frame: Frame = { width, height: HEIGHT, ...FRAME_PAD };
  const values = chart.points.map((p) => p.valueMinor);
  const scale = scaleFor(values, frame);
  const shown = new Set(labelIndices(values.length, Math.max(3, Math.floor((width - 60) / 44))));
  const slot = (width - frame.left - frame.right) / Math.max(1, values.length);

  const bars = barLayout(values, frame, scale);
  const points = linePoints(values, frame, scale);
  const centre = (i: number) => (chart.type === 'line' ? points[i].x : bars[i].x + bars[i].width / 2);

  return (
    <View>
      <Svg width={width} height={HEIGHT}>
        {scale.ticks.map((tick) => (
          <Line
            key={`grid-${tick}`}
            x1={frame.left}
            x2={width - frame.right}
            y1={scale.y(tick)}
            y2={scale.y(tick)}
            stroke={tick === 0 ? palette.muted : palette.line}
            strokeWidth={1}
          />
        ))}
        {scale.ticks.map((tick) => (
          <SvgText
            key={`tick-${tick}`}
            x={frame.left - 6}
            y={scale.y(tick) + 3}
            fontSize={9}
            fill={palette.muted}
            textAnchor="end">
            {money(tick, chart.currency)}
          </SvgText>
        ))}

        {chart.type === 'line' ? (
          <>
            <Path d={linePath(points)} stroke={barColor(chart, chart.points[0])} strokeWidth={2} fill="none" />
            {points.map((p) => (
              <Circle key={p.index} cx={p.x} cy={p.y} r={3.5} fill={barColor(chart, chart.points[p.index])} />
            ))}
          </>
        ) : (
          bars.map((bar) => (
            <Rect
              key={bar.index}
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              rx={2}
              fill={barColor(chart, chart.points[bar.index])}
            />
          ))
        )}

        {chart.points.map((point, i) =>
          shown.has(i) ? (
            <SvgText key={`label-${point.key}`} x={centre(i)} y={HEIGHT - 6} fontSize={9} fill={palette.muted} textAnchor="middle">
              {shortLabel(point.label)}
            </SvgText>
          ) : null
        )}
      </Svg>

      {/* The hit targets are full-height columns laid over the plot rather than
          the bars themselves: a bar of an empty month has no height to tap,
          and "nothing in September" is exactly what someone taps to confirm. */}
      <View className="absolute flex-row" style={{ left: frame.left, right: frame.right, top: 0, bottom: 0 }}>
        {chart.points.map((point) => (
          <Pressable
            key={point.key}
            onPress={() => onDrill(point)}
            style={{ width: slot, height: '100%' }}
            testID={`assistant-bar-${testIdSlug(point.key)}`}
            accessibilityRole="button"
            accessibilityLabel={`${point.label}, ${money(point.valueMinor, chart.currency)}`}
          />
        ))}
      </View>
    </View>
  );
}

function DonutChart({
  chart,
  onDrill,
  testID,
}: {
  chart: ChartSpec;
  onDrill: (point: ChartPoint | null) => void;
  testID: string;
}) {
  const money = useMoney();
  const ranked = rankSlices(
    chart.points.map((p) => ({
      id: p.key,
      label: p.label,
      color: p.color ?? palette.accent,
      icon: null,
      amountMinor: Math.max(0, p.valueMinor),
    })),
    { otherColor: palette.line }
  );
  const byKey = new Map(chart.points.map((p) => [p.key, p]));

  return (
    <View>
      <View className="items-center py-1">
        <Donut slices={ranked} size={160} thickness={28} />
      </View>
      <View className="mt-2">
        {ranked.map((slice) => {
          const point = byKey.get(slice.id) ?? null;
          return (
            <Pressable
              key={slice.id}
              // "Other" stands for several slices; opening it would list a
              // mix with nothing to say which part of the ring it is.
              disabled={!point}
              onPress={() => point && onDrill(point)}
              testID={`assistant-slice-${testIdSlug(slice.id)}`}
              accessibilityRole="button"
              className="flex-row items-center gap-2.5 py-1.5 active:opacity-70">
              <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: slice.color }} />
              <Text className="flex-1 text-sm text-ink" numberOfLines={1}>
                {slice.label}
              </Text>
              <Text className="text-xs text-muted">{slice.percent.toFixed(1)}%</Text>
              <Text className="w-28 text-right text-sm font-semibold text-ink" numberOfLines={1}>
                {money(slice.amountMinor, chart.currency)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
