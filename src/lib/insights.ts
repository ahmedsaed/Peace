/**
 * The arithmetic behind Analysis's second and third slides — Pace and
 * Weekdays. Pure, so every rule below has a test rather than a screenshot.
 *
 * Everything works on DAYS of one period, where a period is whatever
 * `periodBounds` says a month is (it may start on the 25th). Day `i` is the
 * i-th local calendar day from the period's start; dates are built with
 * `new Date(y, m, d + i)` rather than by adding 86,400,000 ms, because a day
 * with a DST change in it is 23 or 25 hours long and a millisecond step lands
 * a purchase in the wrong day twice a year.
 */
import { roundHalfAwayFromZero } from './money';
import { periodBounds, type Period, type Weekday } from './period';

/** Midnight of every day in the period, in order. */
export function daysOf(period: Period): Date[] {
  const { start, end } = periodBounds(period);
  const days: Date[] = [];
  for (let i = 0; ; i++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (day.getTime() >= end.getTime()) return days;
    days.push(day);
  }
}

/** Which day of `days` an instant falls on, or -1 outside them. */
function dayIndex(days: Date[], at: Date): number {
  const t = at.getTime();
  if (days.length === 0 || t < days[0].getTime()) return -1;
  for (let i = days.length - 1; i >= 0; i--) if (t >= days[i].getTime()) return i;
  return -1;
}

/**
 * Sum amounts into the period's days. Rows outside the period are ignored —
 * the caller queried by the same bounds, so there should be none, and a stray
 * one must not land on the first or last day.
 */
export function bucketByDay(
  rows: readonly { at: Date; amountMinor: number }[],
  period: Period
): number[] {
  const days = daysOf(period);
  const { end } = periodBounds(period);
  const totals = days.map(() => 0);
  for (const row of rows) {
    if (row.at.getTime() >= end.getTime()) continue;
    const i = dayIndex(days, row.at);
    if (i >= 0) totals[i] += row.amountMinor;
  }
  return totals;
}

/** Running total: element i is everything up to and including day i. */
export function cumulative(daily: readonly number[]): number[] {
  let sum = 0;
  return daily.map((d) => (sum += d));
}

/**
 * The USUAL month, as a running total by day: the average of the previous
 * months' curves, day by day.
 *
 * A month that holds nothing at all is left out rather than averaged in as
 * zeros — it is a month before the ledger began, and counting it would make
 * "usual" a fraction of what the person actually spends. Months differ in
 * length: a shorter one is held at its final total for the days it does not
 * have (its money is all spent by then), a longer one is simply cut off.
 *
 * `null` when no previous month has anything in it: there is no usual yet, and
 * a screen must say so rather than compare against zero.
 */
export function usualCurve(
  previous: readonly (readonly number[])[],
  length: number
): number[] | null {
  const curves = previous
    .filter((daily) => daily.some((d) => d !== 0))
    .map((daily) => cumulative(daily));
  if (curves.length === 0 || length <= 0) return null;
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const curve of curves) sum += curve[Math.min(i, curve.length - 1)];
    out.push(roundHalfAwayFromZero(sum / curves.length));
  }
  return out;
}

/**
 * Where "today" sits in a period: its day index, the last day for a period
 * already over, and -1 for one that has not started.
 */
export function todayIndex(period: Period, now = new Date()): number {
  const days = daysOf(period);
  const { end } = periodBounds(period);
  if (now.getTime() >= end.getTime()) return days.length - 1;
  return dayIndex(days, now);
}

export type Pace = {
  /** Days in the period. */
  length: number;
  /** Day index of today; `length - 1` once the period is over. */
  today: number;
  /** True once the period is over — there is nothing to project. */
  complete: boolean;
  /** Running total of this period, up to and including today. */
  actual: number[];
  /** The usual month's running total, or null without history. */
  usual: number[] | null;
  /**
   * The rest of the period if it goes like the usual one: from today to the
   * last day. Empty when complete or without history.
   */
  projection: number[];
  /** Everything so far. */
  soFarMinor: number;
  /** Where the usual month stood by this day. Null without history. */
  usualByNowMinor: number | null;
  /** The usual month's whole total. Null without history. */
  usualTotalMinor: number | null;
  /** Where this period ends up if the rest goes like usual. Null when complete or without history. */
  projectedMinor: number | null;
  /** Average per day so far. */
  perDayMinor: number;
};

/**
 * This period against the usual one.
 *
 * THE PROJECTION IS NOT A STRAIGHT LINE. Rent leaves on the 1st, so a month
 * extrapolated from its first days reads as a catastrophe; and a quiet first
 * week extrapolates to a month that will not happen. Instead the rest of the
 * month is assumed to go the way the rest of the USUAL month goes: so far, plus
 * whatever the usual month still spends from today to the end. A rent already
 * paid is then not paid again, and one not yet due still is.
 *
 * `null` for a period that has not started — nothing to say about it yet.
 */
export function pace(
  daily: readonly number[],
  previous: readonly (readonly number[])[],
  today: number
): Pace | null {
  const length = daily.length;
  if (today < 0 || length === 0) return null;
  const actual = cumulative(daily.slice(0, today + 1));
  const usual = usualCurve(previous, length);
  const complete = today === length - 1;
  const soFarMinor = actual[actual.length - 1];

  let projection: number[] = [];
  let projectedMinor: number | null = null;
  if (usual && !complete) {
    projection = usual.slice(today).map((u) => soFarMinor + (u - usual[today]));
    projectedMinor = projection[projection.length - 1];
  }

  return {
    length,
    today,
    complete,
    actual,
    usual,
    projection,
    soFarMinor,
    usualByNowMinor: usual ? usual[today] : null,
    usualTotalMinor: usual ? usual[length - 1] : null,
    projectedMinor,
    perDayMinor: roundHalfAwayFromZero(soFarMinor / (today + 1)),
  };
}

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export type WeekdayAverage = {
  weekday: Weekday;
  /** Everything on this weekday in the days counted. */
  totalMinor: number;
  /** How many of this weekday were counted — the divisor, said out loud. */
  days: number;
  averageMinor: number;
};

/**
 * Average per weekday across the days of a period that have happened.
 *
 * Divided by how many of that weekday there WERE, not by how many had
 * spending: a Friday with nothing spent is a cheap Friday, and leaving it out
 * would make every weekday look as expensive as its worst days. Days still to
 * come are not counted at all — the month's fourth Thursday has not been cheap,
 * it has not happened.
 *
 * Ordered from `first` (the week-start setting), so the chart reads the same
 * way as the date picker.
 */
export function weekdayAverages(
  daily: readonly number[],
  period: Period,
  today: number,
  first: Weekday
): WeekdayAverage[] {
  const days = daysOf(period);
  const total = [0, 0, 0, 0, 0, 0, 0];
  const count = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i <= Math.min(today, days.length - 1); i++) {
    const w = days[i].getDay();
    total[w] += daily[i] ?? 0;
    count[w] += 1;
  }
  return Array.from({ length: 7 }, (_, k) => {
    const weekday = ((first + k) % 7) as Weekday;
    return {
      weekday,
      totalMinor: total[weekday],
      days: count[weekday],
      averageMinor: count[weekday] > 0 ? roundHalfAwayFromZero(total[weekday] / count[weekday]) : 0,
    };
  });
}

/**
 * The weekday with the highest average, earliest in the week on a tie so the
 * answer does not flicker between renders. Null when nothing was spent on any
 * of them — a "most expensive day" of zero is not a finding.
 */
export function busiestWeekday(averages: readonly WeekdayAverage[]): WeekdayAverage | null {
  let best: WeekdayAverage | null = null;
  for (const a of averages)
    if (a.averageMinor > 0 && (!best || a.averageMinor > best.averageMinor)) best = a;
  return best;
}
