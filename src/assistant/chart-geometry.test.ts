import { barLayout, labelIndices, linePath, linePoints, niceStep, scaleFor, shortLabel, type Frame } from './chart-geometry';

const frame: Frame = { width: 300, height: 160, left: 40, right: 10, top: 10, bottom: 20 };

describe('scaleFor', () => {
  it('always includes zero and rounds the top out to a nice number', () => {
    const scale = scaleFor([12000, 0, 15000], frame);
    expect(scale.min).toBe(0);
    expect(scale.max).toBe(15000);
    expect(scale.ticks).toEqual([0, 5000, 10000, 15000]);
    // Rounded OUT, never in: 15,001 needs the next step up.
    expect(scaleFor([15001], frame).max).toBe(20000);
    expect(scale.y(scale.max)).toBe(frame.top);
    expect(scale.y(0)).toBe(frame.height - frame.bottom);
  });

  it('reaches below zero for a negative net', () => {
    const scale = scaleFor([5000, -2000], frame);
    expect(scale.min).toBeLessThan(0);
    expect(scale.ticks).toContain(0);
  });

  it('stays finite when every value is zero', () => {
    // An SVG path with NaN in it renders nothing on Android.
    const scale = scaleFor([0, 0, 0], frame);
    expect(Number.isFinite(scale.y(0))).toBe(true);
    const bars = barLayout([0, 0, 0], frame, scale);
    expect(bars.every((b) => b.height === 0 && Number.isFinite(b.x))).toBe(true);
    expect(linePath(linePoints([0, 0, 0], frame, scale))).not.toContain('NaN');
  });
});

describe('niceStep', () => {
  it('steps in 1, 2, 2.5 and 5', () => {
    expect(niceStep(15000, 4)).toBe(5000);
    expect(niceStep(100, 4)).toBe(25);
    expect(niceStep(0, 4)).toBe(1);
  });
});

describe('barLayout', () => {
  it('draws zero as nothing and a small value as a visible sliver', () => {
    const scale = scaleFor([100000, 0, 1], frame);
    const [big, empty, tiny] = barLayout([100000, 0, 1], frame, scale);
    expect(empty.height).toBe(0);
    expect(tiny.height).toBeGreaterThanOrEqual(2);
    expect(big.y).toBe(frame.top);
  });

  it('hangs a negative bar below the axis', () => {
    const scale = scaleFor([5000, -2000], frame);
    const [up, down] = barLayout([5000, -2000], frame, scale);
    expect(up.y + up.height).toBeCloseTo(scale.y(0));
    expect(down.y).toBeCloseTo(scale.y(0));
    expect(down.negative).toBe(true);
  });
});

describe('labels', () => {
  it('keeps every label when they fit and thins them when they do not, always keeping the last', () => {
    expect(labelIndices(6, 8)).toEqual([0, 1, 2, 3, 4, 5]);
    const thinned = labelIndices(31, 8);
    expect(thinned.length).toBeLessThanOrEqual(8);
    expect(thinned.at(-1)).toBe(30);
  });

  it('shortens month and week labels to fit under a bar', () => {
    expect(shortLabel('Sep 2026')).toBe('Sep');
    expect(shortLabel('Week of 3 Mar')).toBe('3 Mar');
    expect(shortLabel('Transportation')).toBe('Transport…');
  });
});
