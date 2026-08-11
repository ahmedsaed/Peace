import {
  donutSegment,
  donutSegments,
  rankSlices,
  sharePercents,
  type Ring,
  type Slice,
} from './analysis';

const slice = (id: string, amountMinor: number, label = id): Slice => ({
  id,
  label,
  color: '#B03A3A',
  icon: 'dots',
  amountMinor,
});

describe('sharePercents', () => {
  it('splits a simple total', () => {
    expect(sharePercents([50, 25, 25])).toEqual([50, 25, 25]);
  });

  /**
   * The reason this is not three independent roundings. 33.3 three times sums
   * to 99.9, which reads as a bug on a screen whose whole job is accounting for
   * money.
   */
  it('always totals exactly 100', () => {
    for (const amounts of [
      [1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [17, 23, 41, 8, 11],
      [999_999, 1, 2],
      [5, 5, 5, 5, 5, 5],
    ]) {
      const sum = sharePercents(amounts).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(100, 6);
    }
  });

  it('totals 100 at two decimal places too', () => {
    const sum = sharePercents([1, 1, 1], 2).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 6);
  });

  it('gives the spare tenth to the largest remainder', () => {
    // Exact shares are 33.333 each; one of them has to become 33.4.
    const out = sharePercents([1, 1, 1]);
    expect(out.filter((v) => v === 33.4)).toHaveLength(1);
    expect(out.filter((v) => v === 33.3)).toHaveLength(2);
  });

  it('breaks ties on the earlier index, so the legend never reorders itself', () => {
    expect(sharePercents([1, 1, 1])).toEqual([33.4, 33.3, 33.3]);
  });

  it('is unsigned — expenses are stored negative', () => {
    expect(sharePercents([-50, -25, -25])).toEqual([50, 25, 25]);
  });

  it('returns zeroes rather than NaN for an empty total', () => {
    // x / 0 is NaN, and NaN in a chart width crashes the layout.
    expect(sharePercents([0, 0])).toEqual([0, 0]);
    expect(sharePercents([])).toEqual([]);
  });

  it('gives a lone slice the whole circle', () => {
    expect(sharePercents([42])).toEqual([100]);
  });
});

describe('rankSlices', () => {
  it('orders largest first', () => {
    const out = rankSlices([slice('a', 100), slice('c', 300), slice('b', 200)]);
    expect(out.map((s) => s.id)).toEqual(['c', 'b', 'a']);
  });

  it('drops categories with nothing in them', () => {
    // A month has nineteen categories and spending in four. The other fifteen
    // are not zero-width slices, they are absent.
    const out = rankSlices([slice('a', 100), slice('b', 0)]);
    expect(out.map((s) => s.id)).toEqual(['a']);
  });

  it('breaks equal amounts on the label, for a stable order', () => {
    const out = rankSlices([slice('b', 100, 'Beta'), slice('a', 100, 'Alpha')]);
    expect(out.map((s) => s.label)).toEqual(['Alpha', 'Beta']);
  });

  it('folds the tail into one Other bucket', () => {
    const many = Array.from({ length: 10 }, (_, i) => slice(`c${i}`, 100 - i));
    const out = rankSlices(many, { maxSlices: 3 });
    expect(out).toHaveLength(4);
    expect(out[3].isOther).toBe(true);
    expect(out[3].label).toBe('Other (7)');
    // Nothing may be lost in the fold — the ring still accounts for every unit.
    expect(out.reduce((sum, s) => sum + s.amountMinor, 0)).toBe(
      many.reduce((sum, s) => sum + s.amountMinor, 0)
    );
  });

  /**
   * Collapsing a single category into "Other" hides its name to show the very
   * same wedge — strictly worse than leaving it alone.
   */
  it('does not fold when it would save only one row', () => {
    const seven = Array.from({ length: 7 }, (_, i) => slice(`c${i}`, 100 - i));
    const out = rankSlices(seven, { maxSlices: 6 });
    expect(out).toHaveLength(7);
    expect(out.some((s) => s.isOther)).toBe(false);
  });

  it('still totals 100 after folding', () => {
    const many = Array.from({ length: 12 }, (_, i) => slice(`c${i}`, 37 + i * 13));
    const out = rankSlices(many, { maxSlices: 5 });
    expect(out.reduce((sum, s) => sum + s.percent, 0)).toBeCloseTo(100, 6);
  });

  it('handles nothing at all', () => {
    expect(rankSlices([])).toEqual([]);
    expect(rankSlices([slice('a', 0)])).toEqual([]);
  });
});

describe('donutSegment', () => {
  const ring: Ring = { cx: 100, cy: 100, outer: 80, inner: 50 };

  it('starts at 12 o’clock', () => {
    // A chart that starts at 3 o'clock reads as rotated by everyone.
    const path = donutSegment(ring, 0, 90);
    expect(path.startsWith('M 100 20')).toBe(true);
  });

  /**
   * Past 180 degrees the renderer draws the SHORT way round unless told
   * otherwise, so a 300-degree slice appears as a 60-degree one — a wrong chart
   * that still looks like a chart.
   */
  it('sets the large-arc flag past a half turn', () => {
    expect(donutSegment(ring, 0, 90)).toContain(`A 80 80 0 0 1`);
    expect(donutSegment(ring, 0, 270)).toContain(`A 80 80 0 1 1`);
  });

  /**
   * One category owning the whole month is common, and it cannot be drawn as an
   * arc: start and end land on the same point, so the renderer draws nothing.
   */
  it('draws a full circle as two arcs rather than nothing', () => {
    const path = donutSegment(ring, 0, 360);
    expect(path).not.toBe('');
    // Four arcs: outer there and back, inner there and back.
    expect(path.match(/A /g)).toHaveLength(4);
  });

  it('closes every path, or the fill leaks', () => {
    expect(donutSegment(ring, 0, 90).endsWith('Z')).toBe(true);
    expect(donutSegment(ring, 0, 360).endsWith('Z')).toBe(true);
  });

  it('emits no float dust', () => {
    // cos(270°) lands the top of the circle on 99.99999999999999. Harmless to
    // look at, but it triples the length of every path string and makes two
    // paths describing the same shape compare unequal.
    const path = donutSegment(ring, 0, 270);
    expect(path).not.toMatch(/\d\.\d{4,}/);
  });

  it('never emits NaN', () => {
    // A NaN in a path silently renders nothing on Android rather than throwing.
    for (const [a, b] of [
      [0, 0],
      [0, 360],
      [45, 46],
      [359, 360],
    ]) {
      expect(donutSegment(ring, a, b)).not.toMatch(/NaN/);
    }
  });
});

describe('donutSegments', () => {
  const ring: Ring = { cx: 100, cy: 100, outer: 80, inner: 50 };

  it('gives one path per slice', () => {
    const out = donutSegments(ring, rankSlices([slice('a', 300), slice('b', 100)]));
    expect(out).toHaveLength(2);
    expect(out[0].slice.id).toBe('a');
  });

  /**
   * Angles come from the amounts, not from the rounded percentages. Driving the
   * ring off the printed numbers would leave a hairline of background showing
   * wherever the rounding went.
   */
  it('closes the ring exactly on 360', () => {
    const out = donutSegments(ring, rankSlices([slice('a', 1), slice('b', 1), slice('c', 1)]));
    const last = out[out.length - 1].path;
    // The final segment ends where the first began: the top of the circle.
    expect(last).toContain('100 20');
  });

  it('draws a lone slice as a ring, not as nothing', () => {
    const out = donutSegments(ring, rankSlices([slice('a', 500)]));
    expect(out).toHaveLength(1);
    expect(out[0].path.match(/A /g)).toHaveLength(4);
  });

  it('has nothing to draw for an empty month', () => {
    expect(donutSegments(ring, [])).toEqual([]);
  });
});
