import {
  addMonths,
  formatPeriod,
  parsePeriod,
  periodBounds,
  periodOf,
} from './period';

describe('periodOf', () => {
  it('uses local calendar parts, not UTC', () => {
    // 31 Aug 23:30 local. If this used UTC getters, a positive-offset timezone
    // would file the purchase under September.
    expect(periodOf(new Date(2026, 7, 31, 23, 30))).toBe('2026-08');
    expect(periodOf(new Date(2026, 0, 1, 0, 0))).toBe('2026-01');
  });

  it('zero-pads single-digit months', () => {
    expect(periodOf(new Date(2026, 8, 15))).toBe('2026-09');
  });
});

describe('addMonths', () => {
  it('steps within a year', () => {
    expect(addMonths('2026-08', 1)).toBe('2026-09');
    expect(addMonths('2026-08', -1)).toBe('2026-07');
  });

  it('crosses year boundaries in both directions', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });

  it('handles multi-year jumps', () => {
    expect(addMonths('2026-08', 12)).toBe('2027-08');
    expect(addMonths('2026-08', -20)).toBe('2024-12');
  });

  it('is reversible', () => {
    for (const delta of [1, -1, 7, -13, 25]) {
      expect(addMonths(addMonths('2026-08', delta), -delta)).toBe('2026-08');
    }
  });
});

describe('parsePeriod', () => {
  it('rejects malformed input rather than guessing', () => {
    expect(() => parsePeriod('2026-8')).toThrow(/Invalid period/);
    expect(() => parsePeriod('not-a-month')).toThrow(/Invalid period/);
    expect(() => parsePeriod('2026-13')).toThrow(/Invalid month/);
    expect(() => parsePeriod('2026-00')).toThrow(/Invalid month/);
  });
});

describe('periodBounds', () => {
  it('spans the whole month, end-exclusive', () => {
    const { start, end } = periodBounds('2026-02');
    expect(start).toEqual(new Date(2026, 1, 1));
    expect(end).toEqual(new Date(2026, 2, 1));
  });

  it('covers 29 February in a leap year', () => {
    const { start, end } = periodBounds('2024-02');
    const days = (end.getTime() - start.getTime()) / 86_400_000;
    expect(days).toBe(29);
  });

  it('rolls over the year for December', () => {
    expect(periodBounds('2026-12').end).toEqual(new Date(2027, 0, 1));
  });
});

describe('sorting', () => {
  it('orders correctly as plain strings', () => {
    // This is the whole reason periods are text and not timestamps.
    const periods = ['2026-10', '2025-12', '2026-02', '2026-09'];
    expect([...periods].sort()).toEqual(['2025-12', '2026-02', '2026-09', '2026-10']);
  });
});

describe('formatPeriod', () => {
  it('renders a human month', () => {
    expect(formatPeriod('2026-08')).toBe('August 2026');
    expect(formatPeriod('2026-01')).toBe('January 2026');
    expect(formatPeriod('2026-12')).toBe('December 2026');
  });
});
