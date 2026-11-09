import { localNoon as on } from '../test/dates';
import { configurePeriods } from './period';
import {
  bucketByDay,
  busiestWeekday,
  cumulative,
  daysOf,
  pace,
  todayIndex,
  usualCurve,
  weekdayAverages,
} from './insights';

afterEach(() => configurePeriods({ monthStart: 1, weekStart: 1 }));

describe('daysOf', () => {
  it('lists every calendar day of a month', () => {
    expect(daysOf('2026-02')).toHaveLength(28);
    expect(daysOf('2026-11')).toHaveLength(30);
    expect(daysOf('2026-11')[0]).toEqual(new Date(2026, 10, 1));
  });

  it('follows a month that starts on the 25th', () => {
    configurePeriods({ monthStart: 25 });
    const days = daysOf('2026-10');
    // "October" is 25 Sep – 24 Oct.
    expect(days[0]).toEqual(new Date(2026, 8, 25));
    expect(days[days.length - 1]).toEqual(new Date(2026, 9, 24));
    expect(days).toHaveLength(30);
  });
});

describe('bucketByDay', () => {
  it('sums rows into their local day and ignores anything outside', () => {
    const daily = bucketByDay(
      [
        { at: on(2026, 11, 1), amountMinor: 300 },
        { at: new Date(2026, 10, 1, 23, 59), amountMinor: 50 },
        { at: new Date(2026, 10, 2, 0, 0), amountMinor: 7 },
        { at: on(2026, 11, 30), amountMinor: 1 },
        { at: on(2026, 12, 1), amountMinor: 999 },
        { at: on(2026, 10, 31), amountMinor: 999 },
      ],
      '2026-11'
    );
    expect(daily[0]).toBe(350);
    expect(daily[1]).toBe(7);
    expect(daily[29]).toBe(1);
    expect(daily.reduce((a, b) => a + b, 0)).toBe(358);
  });

  it('nets a refund against its day', () => {
    const daily = bucketByDay(
      [
        { at: on(2026, 11, 3), amountMinor: 500 },
        { at: on(2026, 11, 3), amountMinor: -200 },
      ],
      '2026-11'
    );
    expect(daily[2]).toBe(300);
  });
});

describe('usualCurve', () => {
  it('averages earlier months day by day', () => {
    expect(
      usualCurve(
        [
          [10, 0, 10],
          [30, 0, 0],
        ],
        3
      )
    ).toEqual([20, 20, 25]);
  });

  it('leaves out a month with nothing in it, rather than averaging in zeros', () => {
    // The month before the ledger began is not a cheap month.
    expect(
      usualCurve(
        [
          [10, 10],
          [0, 0],
        ],
        2
      )
    ).toEqual([10, 20]);
  });

  it('holds a shorter month at its total and cuts a longer one off', () => {
    expect(
      usualCurve(
        [
          [5, 5],
          [1, 1, 1, 1],
        ],
        4
      )
    ).toEqual([3, 6, 6.5, 7].map(Math.round));
    expect(usualCurve([[1, 1, 1, 1]], 2)).toEqual([1, 2]);
  });

  it('is null with no history at all', () => {
    expect(usualCurve([], 30)).toBeNull();
    expect(usualCurve([[0, 0, 0]], 3)).toBeNull();
  });

  it('rounds half away from zero, never towards +infinity', () => {
    expect(usualCurve([[-1], [-2]], 1)).toEqual([-2]);
    expect(usualCurve([[1], [2]], 1)).toEqual([2]);
  });
});

describe('pace', () => {
  // Usual month: rent of 3000 on day 1, then 100 a day.
  const usualMonth = [3000, 100, 100, 100, 100];

  it('projects the rest of the month the way the usual month goes — not a straight line', () => {
    // Rent paid, then 50 a day for two days. A straight line from day 3
    // would claim (3100 / 3) * 5 ≈ 5167; the usual shape says 3100 + 200.
    const out = pace([3000, 50, 50, 0, 0], [usualMonth], 2)!;
    expect(out.soFarMinor).toBe(3100);
    expect(out.usualByNowMinor).toBe(3200);
    expect(out.projectedMinor).toBe(3300);
    expect(out.projection).toEqual([3100, 3200, 3300]);
    expect(out.complete).toBe(false);
  });

  it('still counts a rent that has not been paid yet', () => {
    // Day 1 was quiet; rent is still to come in the usual shape. Day 0 of the
    // usual month already includes it, so from day 0 on the projection adds
    // only what the usual month spends AFTER day 0 — and the rent that is
    // late shows as being behind the usual month, not as a cheaper one.
    const out = pace([0, 0, 0, 0, 0], [usualMonth], 0)!;
    expect(out.usualByNowMinor).toBe(3000);
    expect(out.soFarMinor - out.usualByNowMinor!).toBe(-3000);
  });

  it('has nothing to project once the month is over', () => {
    const out = pace([3000, 100, 100, 100, 100], [usualMonth], 4)!;
    expect(out.complete).toBe(true);
    expect(out.projectedMinor).toBeNull();
    expect(out.projection).toEqual([]);
    expect(out.soFarMinor).toBe(3400);
    expect(out.usualTotalMinor).toBe(3400);
  });

  it('says nothing of a month that has not started', () => {
    expect(pace([0, 0, 0], [[1, 1, 1]], -1)).toBeNull();
  });

  it('works without history, and says there is none', () => {
    const out = pace([100, 200, 0], [[0, 0, 0]], 1)!;
    expect(out.usual).toBeNull();
    expect(out.usualByNowMinor).toBeNull();
    expect(out.projectedMinor).toBeNull();
    expect(out.soFarMinor).toBe(300);
    expect(out.perDayMinor).toBe(150);
  });
});

describe('todayIndex', () => {
  it('places today inside, after and before a month', () => {
    expect(todayIndex('2026-11', on(2026, 11, 9))).toBe(8);
    expect(todayIndex('2026-10', on(2026, 11, 9))).toBe(30);
    expect(todayIndex('2026-12', on(2026, 11, 9))).toBe(-1);
  });
});

describe('weekdayAverages', () => {
  // November 2026 begins on a Sunday.
  const daily = Array.from({ length: 30 }, () => 0);
  daily[4] = 400; // Thu 5
  daily[11] = 200; // Thu 12
  daily[2] = 90; // Tue 3

  it('divides by every such day that has happened, spent on or not', () => {
    const out = weekdayAverages(daily, '2026-11', 29, 1);
    const thursday = out.find((a) => a.weekday === 4)!;
    // Four Thursdays in November 2026: 5, 12, 19, 26.
    expect(thursday.days).toBe(4);
    expect(thursday.totalMinor).toBe(600);
    expect(thursday.averageMinor).toBe(150);
  });

  it('ignores days that have not happened yet', () => {
    const out = weekdayAverages(daily, '2026-11', 8, 1);
    expect(out.find((a) => a.weekday === 4)).toMatchObject({
      days: 1,
      averageMinor: 400,
    });
    // Up to Mon 9: two Sundays and two Mondays so far, one of everything else.
    expect(out.find((a) => a.weekday === 0)!.days).toBe(2);
    expect(out.find((a) => a.weekday === 6)!.days).toBe(1);
  });

  it('starts the week where the setting does', () => {
    expect(weekdayAverages(daily, '2026-11', 29, 6).map((a) => a.weekday)).toEqual([
      6, 0, 1, 2, 3, 4, 5,
    ]);
    expect(weekdayAverages(daily, '2026-11', 29, 1).map((a) => a.weekday)).toEqual([
      1, 2, 3, 4, 5, 6, 0,
    ]);
  });

  it('names the busiest day, earliest on a tie, and nothing when nothing was spent', () => {
    expect(busiestWeekday(weekdayAverages(daily, '2026-11', 29, 1))!.weekday).toBe(4);
    const tie = Array.from({ length: 30 }, () => 0);
    tie[2] = 100; // Tue 3
    tie[3] = 100; // Wed 4
    expect(busiestWeekday(weekdayAverages(tie, '2026-11', 6, 1))!.weekday).toBe(2);
    expect(
      busiestWeekday(
        weekdayAverages(
          tie.map(() => 0),
          '2026-11',
          29,
          1
        )
      )
    ).toBeNull();
  });
});

describe('cumulative', () => {
  it('runs a total', () => {
    expect(cumulative([1, 2, -1])).toEqual([1, 3, 2]);
  });
});
