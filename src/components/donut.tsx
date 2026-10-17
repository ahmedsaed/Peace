import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import {
  donutSegments,
  mixHex,
  subRingSegments,
  type RankedSlice,
} from '@/lib/analysis';

/** The outer ring's width, and the gap between it and the main ring. */
const SUB_THICKNESS = 8;
const SUB_GAP = 4;

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
 * change size as you step between months.
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
  /** The page colour. Set it to draw the sub-category ring. */
  ground?: string;
  testID?: string;
  children?: React.ReactNode;
}) {
  const half = size / 2;
  const mainOuter = ground ? half - SUB_THICKNESS - SUB_GAP : half;
  const ring = {
    cx: half,
    cy: half,
    outer: mainOuter,
    inner: mainOuter - thickness,
  };
  const segments = donutSegments(ring, slices);
  const subs = ground
    ? subRingSegments(
        { cx: half, cy: half, outer: half, inner: half - SUB_THICKNESS },
        segments
      ).map((s) => ({ ...s, fill: mixHex(s.sub.color, ground, s.sub.tint) }))
    : [];

  return (
    <View style={{ width: size, height: size }} testID={testID}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {segments.map(({ slice, path }) => (
          <Path key={slice.id} d={path} fill={slice.color} />
        ))}
        {/* A hairline in the page colour between neighbours: tints of one
            colour side by side otherwise run together into one arc. */}
        {subs.map(({ sub, parentId, path, fill }) => (
          <Path
            key={`${parentId}:${sub.id}`}
            d={path}
            fill={fill}
            stroke={ground}
            strokeWidth={1}
          />
        ))}
      </Svg>

      {children ? (
        // Padded to the hole, not to the box: a long total would otherwise
        // shrink to fit a width that runs underneath the ring.
        <View
          className="absolute inset-0 items-center justify-center"
          style={{ paddingHorizontal: half - ring.inner + 6 }}>
          {children}
        </View>
      ) : null}
    </View>
  );
}
