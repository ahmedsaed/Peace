/**
 * Bar and line geometry for the assistant's charts. Pure and tested, like the
 * donut's in `lib/analysis.ts`, and shared by the screen and the PDF so both
 * draw the same picture from the same numbers.
 *
 * Driven by the AMOUNTS, never by rounded labels. Every coordinate is finite:
 * an SVG path containing `NaN` renders nothing at all on Android rather than
 * throwing, which is a chart that silently vanishes — so an all-zero series is
 * a flat line on the axis, not a division by zero.
 */

export type Frame = { width: number; height: number; left: number; right: number; top: number; bottom: number };

export type Scale = {
  /** The value at the top and bottom of the plot, after rounding out to nice numbers. */
  max: number;
  min: number;
  ticks: number[];
  /** Y coordinate of a value. */
  y: (value: number) => number;
};

const round = (n: number) => Math.round(n * 100) / 100;

/** 1, 2, 2.5 or 5 times a power of ten — the steps a reader can add up in their head. */
export function niceStep(span: number, steps: number): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / steps;
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const factor of [1, 2, 2.5, 5, 10]) {
    if (raw <= factor * power) return factor * power;
  }
  return 10 * power;
}

/**
 * A y-scale that always includes zero, so a bar's height is its value — a
 * chart whose axis starts at E£400 makes E£450 look like twice E£425.
 */
export function scaleFor(values: number[], frame: Frame, steps = 4): Scale {
  const top = Math.max(0, ...values);
  const bottom = Math.min(0, ...values);
  const step = niceStep(top - bottom, steps);
  const max = top === 0 ? (bottom === 0 ? step : 0) : Math.ceil(top / step) * step;
  const min = bottom === 0 ? 0 : Math.floor(bottom / step) * step;

  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v));

  const plotTop = frame.top;
  const plotHeight = frame.height - frame.top - frame.bottom;
  const span = max - min || 1;
  return { max, min, ticks, y: (value: number) => round(plotTop + ((max - value) / span) * plotHeight) };
}

export type Bar = { index: number; x: number; y: number; width: number; height: number; negative: boolean };

export function barLayout(values: number[], frame: Frame, scale: Scale): Bar[] {
  const plotWidth = frame.width - frame.left - frame.right;
  const slot = values.length > 0 ? plotWidth / values.length : plotWidth;
  // A bar as wide as its slot is a block; a hairline is unreadable and untappable.
  const width = round(Math.max(2, Math.min(36, slot * 0.62)));
  const zero = scale.y(0);
  return values.map((value, index) => {
    const end = scale.y(value);
    // Zero stays zero — an empty month must look empty. Anything else gets
    // at least a sliver, because "a little" and "nothing" are different facts.
    const raw = Math.abs(zero - end);
    const height = value === 0 ? 0 : Math.max(2, raw);
    return {
      index,
      x: round(frame.left + slot * index + (slot - width) / 2),
      y: round(value >= 0 ? zero - height : zero),
      width,
      height: round(height),
      negative: value < 0,
    };
  });
}

export type LinePoint = { index: number; x: number; y: number };

export function linePoints(values: number[], frame: Frame, scale: Scale): LinePoint[] {
  const plotWidth = frame.width - frame.left - frame.right;
  const slot = values.length > 0 ? plotWidth / values.length : plotWidth;
  return values.map((value, index) => ({ index, x: round(frame.left + slot * index + slot / 2), y: scale.y(value) }));
}

export function linePath(points: LinePoint[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
}

/**
 * Which x labels to print. Twelve month names fit under twelve bars; thirty
 * day numbers do not, and overlapping labels are worse than missing ones. The
 * LAST label is always kept, because the most recent period is the one a
 * reader looks for.
 */
export function labelIndices(count: number, maxLabels: number): number[] {
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);
  const every = Math.ceil(count / maxLabels);
  const out: number[] = [];
  for (let i = count - 1; i >= 0; i -= every) out.unshift(i);
  return out;
}

/** "Jan 2026" → "Jan", "Week of 3 Mar" → "3 Mar": short enough to sit under a bar. */
export function shortLabel(label: string): string {
  const month = /^([A-Z][a-z]{2}) \d{4}$/.exec(label);
  if (month) return month[1];
  const week = /^Week of (.*)$/.exec(label);
  if (week) return week[1];
  return label.length > 10 ? `${label.slice(0, 9)}…` : label;
}
