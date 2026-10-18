import { useState } from 'react';
import { Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import {
  donutSegments,
  hitDonut,
  holeBounds,
  mixHex,
  placeTooltip,
  rankSubs,
  subRingSegments,
  tooltipAnchor,
  type DonutHit,
  type RankedSlice,
  type Ring,
} from '@/lib/analysis';

/**
 * The outer ring's width and the gap inside it, as fractions of the chart, so
 * a ring drawn larger keeps its proportions rather than its pixels.
 */
const SUB_THICKNESS = 0.04;
const SUB_GAP = 0.02;

/** How far everything but the touched wedge fades back. */
const DIMMED = 0.3;

/**
 * The category ring.
 *
 * Hand-drawn SVG rather than a chart library. `victory-native` was already in
 * package.json and unused; using it would have pulled Skia's native render
 * surface into the build for one ring, when every icon in the app is already an
 * inline `react-native-svg` path. The geometry lives in `src/lib/analysis.ts`
 * and is unit-tested, which is more than a library would have given.
 *
 * `children` is rendered centred in the hole — the total belongs there, where a
 * reader looks first.
 *
 * With `ground` set, the ring makes room for a thin OUTER ring breaking each
 * wedge down by its sub-categories, in tints of the wedge fading towards
 * `ground` — the page colour, so a tint reads the same in every theme. The
 * room is kept whether or not this month has a breakdown, so the ring does not
 * change size as you step between months. It also separates the wedges with a
 * hairline of the page, and makes them TOUCHABLE: a tap or a hold on either
 * ring names what is under the finger in a tooltip, and fades the rest.
 *
 * The tooltip adds nothing the list below does not already say — a chart's
 * figures must never be reachable only by touching it — so it is hidden from
 * TalkBack, which reads the list.
 */
export function Donut({
  slices,
  size = 200,
  thickness = 34,
  ground,
  testID,
  children,
}: {
  slices: RankedSlice[];
  size?: number;
  thickness?: number;
  /** The page colour. Set it to draw the sub-category ring and allow touching. */
  ground?: string;
  testID?: string;
  children?: React.ReactNode;
}) {
  const [selected, setSelected] = useState<DonutHit | null>(null);
  const [tipSize, setTipSize] = useState<{ key: string; width: number; height: number } | null>(
    null
  );

  const half = size / 2;
  const subThickness = Math.round(size * SUB_THICKNESS);
  const mainOuter = ground ? half - subThickness - Math.round(size * SUB_GAP) : half;
  const ring: Ring = { cx: half, cy: half, outer: mainOuter, inner: mainOuter - thickness };
  const subRing: Ring = { cx: half, cy: half, outer: half, inner: half - subThickness };

  const segments = donutSegments(ring, slices);
  const subs = ground
    ? subRingSegments(subRing, segments).map((s) => ({
        ...s,
        fill: mixHex(s.sub.color, ground, s.sub.tint),
      }))
    : [];

  // A selection the data no longer contains — another month, the other side —
  // simply shows nothing, rather than pointing at a wedge that has gone.
  const tip = describe(selected, segments, subs, ring);
  const lit = (id: string, parentId?: string) =>
    !tip || tip.ids.has(id) || (parentId !== undefined && tip.ids.has(parentId) && !tip.isSub);

  const onPress = (event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent;
    const hit = hitDonut(
      locationX,
      locationY,
      { ring, segments },
      subs.length > 0 ? { ring: subRing, segments: subs } : null
    );
    // The same wedge again, or anywhere that is not a wedge, puts it away.
    setSelected(hit && !(selected && sameHit(hit, selected)) ? hit : null);
  };
  // A hold shows it while the finger is still down; it never toggles off.
  const onLongPress = (event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent;
    const hit = hitDonut(
      locationX,
      locationY,
      { ring, segments },
      subs.length > 0 ? { ring: subRing, segments: subs } : null
    );
    if (hit) setSelected(hit);
  };

  const placed =
    tip && tipSize?.key === tip.key
      ? placeTooltip(tip.anchor, tipSize.width, tipSize.height, holeBounds(ring))
      : null;

  const chart = (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {segments.map(({ slice, path }) => (
        <Path
          key={slice.id}
          d={path}
          fill={slice.color}
          opacity={lit(slice.id) ? 1 : DIMMED}
          // Wedges side by side are told apart by a hairline of the page, so
          // two close colours never read as one arc.
          stroke={ground && segments.length > 1 ? ground : undefined}
          strokeWidth={ground && segments.length > 1 ? 2 : 0}
        />
      ))}
      {subs.map(({ sub, parentId, path, fill }) => (
        <Path
          key={`${parentId}:${sub.id}`}
          d={path}
          fill={fill}
          opacity={lit(sub.id, parentId) ? 1 : DIMMED}
          stroke={ground}
          strokeWidth={1}
        />
      ))}
    </Svg>
  );

  return (
    <View style={{ width: size, height: size }} testID={testID}>
      {ground ? (
        <Pressable
          onPress={onPress}
          onLongPress={onLongPress}
          delayLongPress={300}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          // Literal, so the flow validator can see it: only one ring on any
          // screen is touchable.
          testID="donut-touch">
          {chart}
        </Pressable>
      ) : (
        chart
      )}

      {children ? (
        // Padded to the hole, not to the box: a long total would otherwise
        // shrink to fit a width that runs underneath the ring. Untouchable,
        // so a tap in the hole reaches the ring's handler and clears.
        <View
          pointerEvents="none"
          className="absolute inset-0 items-center justify-center"
          // Hidden while a tooltip has the hole: two blocks of text in it read
          // as one, and the total is back the moment the tooltip is put away.
          style={{ paddingHorizontal: half - ring.inner + 6, opacity: tip ? 0 : 1 }}>
          {children}
        </View>
      ) : null}

      {tip ? (
        <View
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          onLayout={(e) =>
            setTipSize({
              key: tip.key,
              width: e.nativeEvent.layout.width,
              height: e.nativeEvent.layout.height,
            })
          }
          // Measured first, invisibly, then placed: where it can open without
          // being cut off depends on how wide the name made it.
          style={{
            position: 'absolute',
            left: placed?.left ?? 0,
            top: placed?.top ?? 0,
            opacity: placed ? 1 : 0,
            maxWidth: holeBounds(ring).side,
            elevation: 4,
          }}
          className="rounded-xl border border-line bg-raised px-3 py-2"
          testID="donut-tooltip">
          {/* The figure leads and the name follows: the reader already knows
              which wedge they touched and wants its number. */}
          <View className="flex-row items-center gap-2">
            <View className="h-1 w-3 rounded-full" style={{ backgroundColor: tip.color }} />
            <Text className="text-base font-semibold text-ink" testID="donut-tooltip-figure">
              {tip.figure}
            </Text>
          </View>
          <Text className="text-xs text-ink" numberOfLines={1} testID="donut-tooltip-label">
            {tip.label}
          </Text>
          {tip.context ? (
            <Text className="text-[11px] text-muted" numberOfLines={1}>
              {tip.context}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function sameHit(a: DonutHit, b: DonutHit): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** What the tooltip says about a hit, and where it points from. */
function describe(
  hit: DonutHit | null,
  segments: ReturnType<typeof donutSegments>,
  subs: (ReturnType<typeof subRingSegments>[number] & { fill: string })[],
  ring: Ring
) {
  if (!hit) return null;

  if (hit.kind === 'slice') {
    const segment = segments.find((s) => s.slice.id === hit.id);
    if (!segment) return null;
    const { slice } = segment;
    return {
      key: `slice:${slice.id}`,
      ids: new Set([slice.id]),
      isSub: false,
      color: slice.color,
      figure: `${slice.percent.toFixed(1)}%`,
      label: slice.label,
      context: null,
      anchor: tooltipAnchor(ring, segment.startDeg, segment.endDeg),
    };
  }

  const line = subs.find((s) => s.sub.id === hit.id && s.parentId === hit.parentId);
  const parent = segments.find((s) => s.slice.id === hit.parentId);
  if (!line || !parent) return null;
  // A breakdown holding a refund has no shares that add up (see `rankSubs`),
  // so its lines say what they belong to instead of a percentage.
  const percent = rankSubs(parent.slice).find((s) => s.id === line.sub.id)?.percent ?? null;
  return {
    key: `sub:${line.parentId}:${line.sub.id}`,
    ids: new Set([line.sub.id, line.parentId]),
    isSub: true,
    color: line.fill,
    figure: percent === null ? line.sub.label : `${percent.toFixed(1)}%`,
    label: percent === null ? `in ${parent.slice.label}` : line.sub.label,
    context: percent === null ? null : `in ${parent.slice.label}`,
    anchor: tooltipAnchor(ring, line.startDeg, line.endDeg),
  };
}
