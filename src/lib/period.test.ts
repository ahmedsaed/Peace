import {
  addMonths,
  clampMonthStart,
  configurePeriods,
  formatDayHeading,
  formatDayLabel,
  formatPeriod,
  formatTimeLabel,
  isPeriodStart,
  monthStart,
  ordinal,
  parsePeriod,
  periodBounds,
  periodOf,
  startOfWeek,
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

describe('day and time labels', () => {
  it('formats the record form date footer', () => {
    expect(formatDayLabel(new Date(2026, 7, 8))).toBe('Aug 08, 2026');
    expect(formatDayLabel(new Date(2026, 11, 25))).toBe('Dec 25, 2026');
  });

  it('formats the records list day heading', () => {
    // 6 Aug 2026 is a Thursday.
    expect(formatDayHeading(new Date(2026, 7, 6))).toBe('Aug 06, Thursday');
  });

  it('formats 12-hour time with the right meridiem', () => {
    expect(formatTimeLabel(new Date(2026, 7, 8, 19, 14))).toBe('7:14 PM');
    expect(formatTimeLabel(new Date(2026, 7, 8, 7, 5))).toBe('7:05 AM');
  });

  it('renders both midnights as 12, not 0', () => {
    // The classic off-by-twelve: hours % 12 is 0 at both noon and midnight.
    expect(formatTimeLabel(new Date(2026, 7, 8, 0, 30))).toBe('12:30 AM');
    expect(formatTimeLabel(new Date(2026, 7, 8, 12, 30))).toBe('12:30 PM');
  });
});

describe('months that start on a day other than the 1st', () => {
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

  it('names a payday month (start after the 15th) after the month it ENDS in', () => {
    expect(periodOf(at(2026, 10, 24), 25)).toBe('2026-10');
    expect(periodOf(at(2026, 10, 25, 0), 25)).toBe('2026-11');
    const { start, end } = periodBounds('2026-10', 25);
    expect(start).toEqual(new Date(2026, 8, 25));
    expect(end).toEqual(new Date(2026, 9, 25));
  });

  it('names an early start (the 15th or before) after the month it BEGINS in', () => {
    expect(periodOf(at(2026, 10, 3), 5)).toBe('2026-09');
    expect(periodOf(at(2026, 10, 5), 5)).toBe('2026-10');
    const { start, end } = periodBounds('2026-10', 5);
    expect(start).toEqual(new Date(2026, 9, 5));
    expect(end).toEqual(new Date(2026, 10, 5));
  });

  it('crosses the year in both directions', () => {
    expect(periodOf(at(2026, 12, 26), 25)).toBe('2027-01');
    expect(periodBounds('2027-01', 25).start).toEqual(new Date(2026, 11, 25));
    expect(periodOf(at(2027, 1, 2), 5)).toBe('2026-12');
  });

  it('puts every day of two years in exactly the period whose bounds hold it, for every start day', () => {
    for (let start = 1; start <= 28; start++) {
      for (let day = 0; day < 730; day++) {
        const date = new Date(2025, 0, 1 + day, 13);
        const period = periodOf(date, start);
        const bounds = periodBounds(period, start);
        expect(date >= bounds.start && date < bounds.end).toBe(true);
      }
    }
  });

  it('leaves no gap and no overlap between consecutive periods', () => {
    for (const start of [1, 5, 15, 16, 25, 28]) {
      for (let i = 0; i < 24; i++) {
        const period = addMonths('2025-01', i);
        expect(periodBounds(period, start).end).toEqual(periodBounds(addMonths(period, 1), start).start);
      }
    }
  });

  it('says which days a custom month covers', () => {
    expect(formatPeriod('2026-10', 25)).toBe('Sep 25 – Oct 24, 2026');
    expect(formatPeriod('2027-01', 25)).toBe('Dec 25 – Jan 24, 2027');
    expect(formatPeriod('2026-10', 1)).toBe('October 2026');
  });

  it('knows where a period begins', () => {
    expect(isPeriodStart(new Date(2026, 8, 25), 25)).toBe(true);
    expect(isPeriodStart(new Date(2026, 9, 1), 25)).toBe(false);
    expect(isPeriodStart(new Date(2026, 9, 1), 1)).toBe(true);
  });

  it('refuses a start day a month might not have', () => {
    expect(clampMonthStart(29)).toBe(1);
    expect(clampMonthStart(0)).toBe(1);
    expect(clampMonthStart(2.5)).toBe(1);
    expect(clampMonthStart('25')).toBe(1);
    expect(clampMonthStart(28)).toBe(28);
  });

  it('follows the configured start day by default, and back', () => {
    configurePeriods({ monthStart: 25 });
    try {
      expect(monthStart()).toBe(25);
      expect(periodOf(at(2026, 10, 26))).toBe('2026-11');
    } finally {
      configurePeriods({ monthStart: 1 });
    }
    expect(periodOf(at(2026, 10, 26))).toBe('2026-10');
  });
});

describe('weeks', () => {
  // Wednesday 14 October 2026.
  const wednesday = new Date(2026, 9, 14, 15);

  it('starts on the configured weekday', () => {
    expect(startOfWeek(wednesday, 1)).toEqual(new Date(2026, 9, 12));
    expect(startOfWeek(wednesday, 0)).toEqual(new Date(2026, 9, 11));
    expect(startOfWeek(wednesday, 6)).toEqual(new Date(2026, 9, 10));
  });

  it('is its own start on the first day', () => {
    expect(startOfWeek(new Date(2026, 9, 12, 9), 1)).toEqual(new Date(2026, 9, 12));
  });
});

describe('ordinal', () => {
  it('reads the way a person says it', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 25, 28].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '25th', '28th',
    ]);
  });
});
