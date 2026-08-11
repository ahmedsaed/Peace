import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { donutSegments, type RankedSlice } from '@/lib/analysis';

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
 */
export function Donut({
  slices,
  size = 200,
  thickness = 34,
  testID,
  children,
}: {
  slices: RankedSlice[];
  size?: number;
  thickness?: number;
  testID?: string;
  children?: React.ReactNode;
}) {
  const ring = {
    cx: size / 2,
    cy: size / 2,
    outer: size / 2,
    inner: size / 2 - thickness,
  };
  const segments = donutSegments(ring, slices);

  return (
    <View style={{ width: size, height: size }} testID={testID}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {segments.map(({ slice, path }) => (
          <Path key={slice.id} d={path} fill={slice.color} />
        ))}
      </Svg>

      {children ? (
        <View className="absolute inset-0 items-center justify-center px-6">{children}</View>
      ) : null}
    </View>
  );
}
