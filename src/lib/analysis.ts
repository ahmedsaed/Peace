/**
 * Chart maths.
 *
 * Pure — no database and no React — so the two things most likely to be subtly
 * wrong, the percentages and the arc geometry, are testable without a device.
 *
 * The donut is drawn by hand with react-native-svg rather than by a chart
 * library. `victory-native` was in package.json and unused; reaching for it now
 * would have pulled in Skia's native surface for one ring, when the app already
 * renders SVG for every icon. The arithmetic below is the entire cost of not
 * having a chart dependency, and unlike a library it can be unit-tested.
 */

export type Slice = {
  id: string;
  label: string;
  color: string;
  icon: string | null;
  /** Unsigned magnitude in minor units. */
  amountMinor: number;
  /**
   * What this slice is made of, when it is a parent with sub-categories that
   * have something in them this month. Absent or empty means no breakdown.
   * See `rankSubs`.
   */
  subs?: SubSlice[];
};

/**
 * One line of a parent's breakdown: a sub-category, or the money filed on the
 * parent itself (`own`), without which the lines would not add up to it.
 */
export type SubSlice = {
  id: string;
  label: string;
  color: string;
  icon: string | null;
  /**
   * SIGNED, in minor units: positive is money spent (or earned), negative is a
   * sub-category whose month nets as money RETURNED — a refund with nothing
   * spent against it. The lines of one parent sum to its `amountMinor`.
   */
  amountMinor: number;
  own: boolean;
};

export type RankedSlice = Slice & {
  /** Percent of the total, scaled by `decimals`. See sharePercents. */
  percent: number;
  /** True for the bucket that stands in for everything past the cut. */
  isOther: boolean;
};

/**
 * Percentages that add up to exactly 100.
 *
 * Rounding each share independently does not: three equal slices give 33.3
 * three times and a legend that sums to 99.9, which reads as a bug in a screen
 * whose whole job is to account for money. This distributes the rounding error
 * by largest remainder, so the printed numbers always total 100 even though
 * individual values may be a tenth away from their exact share.
 *
 * Works in integer tenths (or hundredths) rather than floats, for the same
 * reason money does.
 */
export function sharePercents(amounts: number[], decimals = 1): number[] {
  const scale = 10 ** decimals;
  return apportion(amounts, 100 * scale).map((v) => v / scale);
}

/**
 * Split `target` whole units between `amounts` in proportion, by largest
 * remainder, so the parts always add up to exactly `target`.
 */
function apportion(amounts: number[], target: number): number[] {
  const magnitudes = amounts.map((a) => Math.abs(a));
  const total = magnitudes.reduce((sum, a) => sum + a, 0);
  if (total === 0) return amounts.map(() => 0);

  const exact = magnitudes.map((a) => (a / total) * target);
  const floors = exact.map((v) => Math.floor(v));
  let remaining = target - floors.reduce((sum, v) => sum + v, 0);

  // Largest fractional part wins the spare unit. Ties break on the earlier
  // index so the result is deterministic — a legend that reorders itself
  // between two renders of the same data is its own bug.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const out = [...floors];
  for (const { i } of order) {
    if (remaining <= 0) break;
    out[i] += 1;
    remaining -= 1;
  }

  return out;
}

/**
 * Rank slices largest first and fold the tail into a single "Other".
 *
 * A donut with nineteen segments is a colour wheel, not a chart: the slices
 * past the first handful are a few pixels wide and their legend entries are
 * what push the ranked list off the screen. Everything is still reachable —
 * the ranked list below the chart is the full story — but the ring only shows
 * what can be told apart.
 *
 * The tail is folded only when it saves more than one row. Collapsing a single
 * category into "Other" hides its name to show the same wedge.
 */
export function rankSlices(
  slices: Slice[],
  { maxSlices = 6, otherColor = '#6B5B4A', decimals = 1 } = {}
): RankedSlice[] {
  const present = slices.filter((s) => s.amountMinor > 0);
  const sorted = [...present].sort(
    (a, b) => b.amountMinor - a.amountMinor || a.label.localeCompare(b.label)
  );

  let kept: Slice[] = sorted;
  let other: Slice | null = null;

  if (sorted.length > maxSlices + 1) {
    kept = sorted.slice(0, maxSlices);
    const tail = sorted.slice(maxSlices);
    other = {
      id: 'other',
      label: `Other (${tail.length})`,
      color: otherColor,
      icon: 'dots',
      amountMinor: tail.reduce((sum, s) => sum + s.amountMinor, 0),
    };
  }

  const all = other ? [...kept, other] : kept;
  const percents = sharePercents(
    all.map((s) => s.amountMinor),
    decimals
  );

  return all.map((slice, i) => ({
    ...slice,
    percent: percents[i],
    isOther: slice.id === 'other' && other !== null,
  }));
}

export type RankedSub = SubSlice & {
  /**
   * Share of the MONTH, like the parent's — so the lines under "Food 37.1%"
   * add up to 37.1, by the same largest remainder as the ring. Null for a
   * refund line, and for every line of a parent that has one: lines that
   * overshoot the parent and come back down have no shares that add up.
   */
  percent: number | null;
  /** 0 is the parent's own colour; higher fades towards the page. */
  tint: number;
};

/** How far the faintest line of a breakdown fades towards the page. */
const MAX_TINT = 0.6;

/**
 * A parent's breakdown, largest first, refunds last.
 *
 * Sub-categories are drawn as TINTS of the parent rather than in their own
 * colours. The seed gives every child its parent's colour, so their own would
 * be one wedge of identical slices; and a tint is what says, at a glance, that
 * the outer ring belongs to the wedge it sits on.
 */
export function rankSubs(parent: RankedSlice, decimals = 1): RankedSub[] {
  const subs = parent.subs ?? [];
  const byLabel = (a: SubSlice, b: SubSlice) => a.label.localeCompare(b.label);
  const spent = subs
    .filter((s) => s.amountMinor > 0)
    .sort((a, b) => b.amountMinor - a.amountMinor || byLabel(a, b));
  const returned = subs
    .filter((s) => s.amountMinor < 0)
    .sort((a, b) => a.amountMinor - b.amountMinor || byLabel(a, b));

  const scale = 10 ** decimals;
  const parts =
    returned.length === 0
      ? apportion(
          spent.map((s) => s.amountMinor),
          Math.round(parent.percent * scale)
        )
      : null;

  return [
    ...spent.map((sub, i) => ({
      ...sub,
      percent: parts ? parts[i] / scale : null,
      tint: spent.length > 1 ? (i / (spent.length - 1)) * MAX_TINT : 0,
    })),
    ...returned.map((sub) => ({ ...sub, percent: null, tint: 0 })),
  ];
}

/**
 * `from` moved `amount` (0–1) of the way towards `to`, both `#RRGGBB`.
 *
 * Towards the PAGE colour rather than towards white: a tint towards white
 * would glow on Ledger and vanish on Paper, where the page is nearly white.
 */
export function mixHex(from: string, to: string, amount: number): string {
  const channels = (hex: string) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = channels(from);
  const b = channels(to);
  if ([...a, ...b].some(Number.isNaN)) return from;
  return (
    '#' +
    a
      .map((v, i) => Math.round(v + (b[i] - v) * amount))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

// ---------------------------------------------------------------------------
// Donut geometry
// ---------------------------------------------------------------------------

/**
 * Trig leaves float dust — `cos(270°)` puts the top of the circle at
 * 99.99999999999999 rather than 100. Harmless to look at, since it is a
 * ten-thousandth of a pixel, but it triples the length of every path string and
 * makes two paths that describe the same shape compare unequal. Three decimals
 * is well under a pixel at any radius this app draws.
 */
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Degrees, clockwise from 12 o'clock, to a point on a circle. */
function pointOn(cx: number, cy: number, radius: number, degrees: number) {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return {
    x: round(cx + radius * Math.cos(radians)),
    y: round(cy + radius * Math.sin(radians)),
  };
}

export type Ring = { cx: number; cy: number; outer: number; inner: number };

/**
 * One donut segment as an SVG path.
 *
 * Angles are degrees clockwise from 12 o'clock, which is where a reader expects
 * a chart to start. The `large-arc-flag` has to be set past 180 degrees or the
 * renderer draws the *short* way round and a 300-degree slice appears as a
 * 60-degree one — a wrong chart that still looks like a chart.
 */
export function donutSegment(ring: Ring, startDeg: number, endDeg: number): string {
  const { cx, cy, outer, inner } = ring;
  const sweep = endDeg - startDeg;

  // A single category owning everything is the common case in a month with one
  // kind of spending, and it cannot be drawn as an arc: start and end land on
  // the same point, so the renderer draws nothing at all. Two half-circles do
  // what one full one cannot.
  if (sweep >= 360) {
    const oTop = pointOn(cx, cy, outer, 0);
    const oBottom = pointOn(cx, cy, outer, 180);
    const iTop = pointOn(cx, cy, inner, 0);
    const iBottom = pointOn(cx, cy, inner, 180);
    return [
      `M ${oTop.x} ${oTop.y}`,
      `A ${outer} ${outer} 0 0 1 ${oBottom.x} ${oBottom.y}`,
      `A ${outer} ${outer} 0 0 1 ${oTop.x} ${oTop.y}`,
      `M ${iTop.x} ${iTop.y}`,
      `A ${inner} ${inner} 0 0 0 ${iBottom.x} ${iBottom.y}`,
      `A ${inner} ${inner} 0 0 0 ${iTop.x} ${iTop.y}`,
      'Z',
    ].join(' ');
  }

  const largeArc = sweep > 180 ? 1 : 0;
  const outerStart = pointOn(cx, cy, outer, startDeg);
  const outerEnd = pointOn(cx, cy, outer, endDeg);
  const innerEnd = pointOn(cx, cy, inner, endDeg);
  const innerStart = pointOn(cx, cy, inner, startDeg);

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outer} ${outer} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${inner} ${inner} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

export type Segment = { slice: RankedSlice; path: string; startDeg: number; endDeg: number };

/**
 * Lay the ranked slices out around the ring.
 *
 * Angles come from the AMOUNTS, not from the rounded percentages. Using the
 * printed numbers would leave a hairline gap or overlap wherever the rounding
 * went, and the last slice would absorb all of it.
 */
export function donutSegments(ring: Ring, slices: RankedSlice[]): Segment[] {
  const total = slices.reduce((sum, s) => sum + s.amountMinor, 0);
  if (total <= 0) return [];

  const segments: Segment[] = [];
  let cursor = 0;

  slices.forEach((slice, i) => {
    // The last slice closes on 360 exactly rather than on an accumulated sum of
    // divisions, so float drift cannot leave a sliver of background showing.
    const end = i === slices.length - 1 ? 360 : cursor + (slice.amountMinor / total) * 360;
    segments.push({ slice, path: donutSegment(ring, cursor, end), startDeg: cursor, endDeg: end });
    cursor = end;
  });

  return segments;
}

export type SubSegment = { sub: RankedSub; parentId: string; path: string };

/**
 * The outer ring: each parent's breakdown laid inside the span of its wedge.
 *
 * Only the lines that SPENT are drawn, sized against one another. Without a
 * refund among them that is exactly their share of the parent; with one, they
 * add up to more than the parent nets, and drawing them to scale would spill
 * past the wedge into its neighbour — so they split the wedge between them
 * and the refund is a line in the list, the only place a negative can go.
 * A parent with no breakdown leaves its stretch of the outer ring empty,
 * which is the honest picture of "nothing to break down".
 */
export function subRingSegments(ring: Ring, parents: Segment[]): SubSegment[] {
  const out: SubSegment[] = [];

  for (const { slice, startDeg, endDeg } of parents) {
    const spent = rankSubs(slice).filter((s) => s.amountMinor > 0);
    const total = spent.reduce((sum, s) => sum + s.amountMinor, 0);
    if (total <= 0) continue;

    let cursor = startDeg;
    spent.forEach((sub, i) => {
      const end =
        i === spent.length - 1
          ? endDeg
          : cursor + (sub.amountMinor / total) * (endDeg - startDeg);
      out.push({ sub, parentId: slice.id, path: donutSegment(ring, cursor, end) });
      cursor = end;
    });
  }

  return out;
}
