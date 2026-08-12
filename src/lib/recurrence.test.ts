import {
  daysInMonth,
  describeRecurrence,
  firstOccurrenceOnOrAfter,
  fromYmd,
  nextOccurrenceAfter,
  occurrenceAt,
  occurrencesDue,
  toYmd,
  type Recurrence,
} from './recurrence';

const rule = (over: Partial<Recurrence> = {}): Recurrence => ({
  frequency: 'monthly',
  interval: 1,
  anchorDay: null,
  startsOn: '2026-01-15',
  endsOn: null,
  ...over,
});

/** The first `count` occurrences, for reading a schedule at a glance. */
const series = (r: Recurrence, count: number) =>
  Array.from({ length: count }, (_, i) => occurrenceAt(r, i));

describe('local dates', () => {
  it('round-trips without drifting a day', () => {
    // `new Date('2026-01-15')` parses as UTC and lands on the 14th in any
    // negative offset. Everything here is local by construction.
    expect(toYmd(fromYmd('2026-01-15'))).toBe('2026-01-15');
    expect(fromYmd('2026-01-15').getDate()).toBe(15);
  });

  it('knows the length of a month, including February in a leap year', () => {
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2028, 1)).toBe(29);
    expect(daysInMonth(2026, 3)).toBe(30);
  });
});

describe('monthly', () => {
  it('repeats on the same day', () => {
    expect(series(rule(), 3)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
  });

  it('honours an interval', () => {
    expect(series(rule({ interval: 3 }), 3)).toEqual(['2026-01-15', '2026-04-15', '2026-07-15']);
  });

  it('crosses a year boundary', () => {
    expect(series(rule({ startsOn: '2026-11-15' }), 3)).toEqual([
      '2026-11-15',
      '2026-12-15',
      '2027-01-15',
    ]);
  });

  /**
   * THE BUG THIS FILE EXISTS FOR.
   *
   * A rule on the 31st must fire on 28 February and then on 31 MARCH. Deriving
   * each date by adding a month to the one before would clamp February and then
   * carry the 28th forward forever — the rule silently walks backwards and
   * nobody notices until a payment is a3 days early for the rest of its life.
   */
  it('clamps to the end of a short month WITHOUT the clamp sticking', () => {
    expect(series(rule({ startsOn: '2026-01-31' }), 5)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
  });

  it('clamps to 29 February in a leap year', () => {
    expect(occurrenceAt(rule({ startsOn: '2028-01-31' }), 1)).toBe('2028-02-29');
  });

  it('takes an explicit anchor day over the start date', () => {
    // Started mid-month, but the payment is due on the 1st.
    expect(series(rule({ startsOn: '2026-01-20', anchorDay: 1 }), 3)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ]);
  });

  it('never overflows into the following month', () => {
    // `setMonth` alone turns 31 January into 3 March. Every occurrence here
    // must stay inside the month it belongs to.
    for (const date of series(rule({ startsOn: '2026-01-31' }), 24)) {
      const [, month, day] = date.split('-').map(Number);
      expect(day).toBeLessThanOrEqual(daysInMonth(2026, month - 1));
    }
  });
});

describe('daily and weekly', () => {
  it('steps by days', () => {
    expect(series(rule({ frequency: 'daily', startsOn: '2026-02-26' }), 4)).toEqual([
      '2026-02-26',
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ]);
  });

  it('steps by an interval of days', () => {
    expect(series(rule({ frequency: 'daily', interval: 10, startsOn: '2026-01-25' }), 3)).toEqual([
      '2026-01-25',
      '2026-02-04',
      '2026-02-14',
    ]);
  });

  it('steps by weeks from the start date', () => {
    expect(series(rule({ frequency: 'weekly', startsOn: '2026-01-15' }), 3)).toEqual([
      '2026-01-15',
      '2026-01-22',
      '2026-01-29',
    ]);
  });

  it('rolls FORWARD to the anchored weekday, never backwards', () => {
    // 2026-01-15 is a Thursday. Anchored to Monday (1), the first occurrence is
    // the following Monday — rolling back would fire before the rule began.
    expect(fromYmd('2026-01-15').getDay()).toBe(4);
    const weekly = rule({ frequency: 'weekly', startsOn: '2026-01-15', anchorDay: 1 });
    expect(series(weekly, 2)).toEqual(['2026-01-19', '2026-01-26']);
    expect(fromYmd('2026-01-19').getDay()).toBe(1);
  });

  it('keeps the start date when it already falls on the anchor', () => {
    const weekly = rule({ frequency: 'weekly', startsOn: '2026-01-15', anchorDay: 4 });
    expect(occurrenceAt(weekly, 0)).toBe('2026-01-15');
  });
});

describe('yearly', () => {
  it('repeats on the same date', () => {
    expect(series(rule({ frequency: 'yearly', startsOn: '2026-03-01' }), 3)).toEqual([
      '2026-03-01',
      '2027-03-01',
      '2028-03-01',
    ]);
  });

  it('clamps 29 February to the 28th in common years, and back again', () => {
    const leap = rule({ frequency: 'yearly', startsOn: '2028-02-29' });
    expect(series(leap, 5)).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      // Back to the 29th, because each date comes from the START, not from the
      // clamped one before it.
      '2032-02-29',
    ]);
  });
});

describe('finding the next one', () => {
  it('returns the first occurrence on or after a date', () => {
    expect(firstOccurrenceOnOrAfter(rule(), '2026-02-01')).toBe('2026-02-15');
    expect(firstOccurrenceOnOrAfter(rule(), '2026-02-15')).toBe('2026-02-15');
  });

  it('never returns something before the rule starts', () => {
    expect(firstOccurrenceOnOrAfter(rule(), '2020-01-01')).toBe('2026-01-15');
  });

  it('stops at the end date, which is inclusive', () => {
    const ending = rule({ endsOn: '2026-03-15' });
    expect(firstOccurrenceOnOrAfter(ending, '2026-03-15')).toBe('2026-03-15');
    expect(firstOccurrenceOnOrAfter(ending, '2026-03-16')).toBeNull();
    expect(nextOccurrenceAfter(ending, '2026-03-15')).toBeNull();
  });
});

/**
 * Catch-up: what the app owes you for the time it was closed.
 */
describe('occurrences due', () => {
  it('lists every month missed while the app was shut', () => {
    const { dates, truncated } = occurrencesDue(rule(), '2026-01-15', '2026-04-20');
    expect(dates).toEqual(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
    expect(truncated).toBe(false);
  });

  it('includes one falling exactly today', () => {
    expect(occurrencesDue(rule(), '2026-01-15', '2026-01-15').dates).toEqual(['2026-01-15']);
  });

  it('is empty when nothing is owed yet', () => {
    expect(occurrencesDue(rule(), '2026-01-15', '2026-01-14').dates).toEqual([]);
  });

  it('never runs past the end date', () => {
    const ending = rule({ endsOn: '2026-02-15' });
    expect(occurrencesDue(ending, '2026-01-15', '2026-12-31').dates).toEqual([
      '2026-01-15',
      '2026-02-15',
    ]);
  });

  /**
   * A daily rule left alone for two years would otherwise materialise seven
   * hundred records in one pass — indistinguishable, to the person holding the
   * phone, from the app corrupting itself.
   */
  it('caps a long absence and says it was capped', () => {
    const daily = rule({ frequency: 'daily', startsOn: '2024-01-01' });
    const { dates, truncated } = occurrencesDue(daily, '2024-01-01', '2026-01-01', 60);
    expect(dates).toHaveLength(60);
    expect(truncated).toBe(true);
    expect(dates[0]).toBe('2024-01-01');
  });

  it('does not claim truncation when it finished the job', () => {
    const { truncated } = occurrencesDue(rule(), '2026-01-15', '2026-03-15', 60);
    expect(truncated).toBe(false);
  });
});

describe('describing a rule', () => {
  it.each([
    [rule(), 'Every month on the 15th'],
    [rule({ anchorDay: 1 }), 'Every month on the 1st'],
    [rule({ anchorDay: 2 }), 'Every month on the 2nd'],
    [rule({ anchorDay: 3 }), 'Every month on the 3rd'],
    [rule({ anchorDay: 11 }), 'Every month on the 11th'],
    [rule({ anchorDay: 21 }), 'Every month on the 21st'],
    [rule({ interval: 3, anchorDay: 1 }), 'Every 3 months on the 1st'],
    [rule({ frequency: 'daily' }), 'Every day'],
    [rule({ frequency: 'daily', interval: 3 }), 'Every 3 days'],
  ])('describes %#', (r, expected) => {
    expect(describeRecurrence(r)).toBe(expected);
  });

  it('names the weekday for a weekly rule', () => {
    expect(describeRecurrence(rule({ frequency: 'weekly', anchorDay: 1 }))).toBe('Every Monday');
  });
});
