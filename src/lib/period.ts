/**
 * Month helpers — calendar months, or months that start on payday.
 *
 * A "period" is the string `YYYY-MM` — the same format stored in
 * `budgets.period`. Text rather than a timestamp because a month is not an
 * instant: it sorts and ranges correctly as a string, and carries no timezone.
 *
 * THE MONTH CAN START ON ANY DAY FROM THE 1ST TO THE 28TH (`monthStartDay`).
 * Somebody paid on the 25th lives in months that run from the 25th to the
 * 24th, and a calendar month splits every one of their budgets across two
 * paydays. Every screen, query and chart that thinks in months goes through
 * `periodOf` and `periodBounds` here, so they all move together and can never
 * disagree about which month a record is in. No later than the 28th, so every
 * month HAS the day — a start on the 31st has no answer in February.
 *
 * A custom month is NAMED after the calendar month holding most of its days:
 * 25 Sep – 24 Oct is "October", and 5 Oct – 4 Nov is "October" too. Budgets
 * are keyed by that name, so changing the start day leaves "October's budget"
 * attached to the stretch of time people think of as October.
 *
 * The start day is module state, set from the settings store
 * (`configurePeriods`) rather than threaded through forty call sites — the
 * same single source every caller reads.
 *
 * Everything here works in LOCAL time on purpose. A purchase at 11pm on the
 * 31st belongs to that month as the user lived it, not to the next one because
 * UTC had already rolled over.
 */

export type Period = string; // 'YYYY-MM'

const pad = (n: number) => String(n).padStart(2, '0');

/** 1 for calendar months; at most 28. Anything else falls back to 1. */
export function clampMonthStart(day: unknown): number {
  return typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 28 ? day : 1;
}

/** 0 = Sunday … 6 = Saturday, as `Date.getDay()` counts. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

let monthStartDay = 1;
let weekStartDay: Weekday = 1;

/** Set by the settings store whenever the setting is read or changed. */
export function configurePeriods(config: { monthStart?: number; weekStart?: Weekday }): void {
  if (config.monthStart !== undefined) monthStartDay = clampMonthStart(config.monthStart);
  if (config.weekStart !== undefined) weekStartDay = config.weekStart;
}

export function monthStart(): number {
  return monthStartDay;
}

export function weekStart(): Weekday {
  return weekStartDay;
}

/** A start after the 15th names the month by where it ENDS; earlier, by where it begins. */
const nameOffset = (start: number) => (start > 15 ? 1 : 0);

export function periodOf(date: Date, start = monthStartDay): Period {
  // The calendar month in which this date's period BEGAN…
  const began = date.getDate() >= start ? date.getMonth() : date.getMonth() - 1;
  // …and the month it is named after. `new Date` rolls years both ways.
  const named = new Date(date.getFullYear(), began + nameOffset(start), 1);
  return `${named.getFullYear()}-${pad(named.getMonth() + 1)}`;
}

export function currentPeriod(now = new Date()): Period {
  return periodOf(now);
}

export function parsePeriod(period: Period): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) throw new Error(`Invalid period "${period}", expected YYYY-MM`);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error(`Invalid month in period "${period}"`);
  return { year: Number(match[1]), month };
}

/** Step a period forward or back. Handles year boundaries in both directions. */
export function addMonths(period: Period, delta: number): Period {
  const { year, month } = parsePeriod(period);
  // Work in a zero-based absolute month count so negative deltas wrap correctly;
  // `month - 1 + delta` can legitimately go below zero.
  const total = year * 12 + (month - 1) + delta;
  return `${Math.floor(total / 12)}-${pad((((total % 12) + 12) % 12) + 1)}`;
}

/** Inclusive start and exclusive end timestamps, for range queries. */
export function periodBounds(period: Period, start = monthStartDay): { start: Date; end: Date } {
  const { year, month } = parsePeriod(period);
  const began = month - 1 - nameOffset(start);
  return {
    start: new Date(year, began, start, 0, 0, 0, 0),
    end: new Date(year, began + 1, start, 0, 0, 0, 0),
  };
}

/** Does a period begin at exactly this instant? */
export function isPeriodStart(date: Date, start = monthStartDay): boolean {
  return periodBounds(periodOf(date, start), start).start.getTime() === date.getTime();
}

/** The first day of the week containing `date`, at midnight. */
export function startOfWeek(date: Date, first: Weekday = weekStartDay): Date {
  const back = (date.getDay() - first + 7) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - back);
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * "August 2026". Hand-rolled rather than Intl.DateTimeFormat because Hermes
 * ships less ICU data than Node and degrades silently — the same trap that made
 * EGP render as "EGP" instead of "E£". Twelve strings are not worth that risk.
 */
export function formatPeriod(period: Period, start = monthStartDay): string {
  const { year, month } = parsePeriod(period);
  if (start === 1) return `${MONTHS[month - 1]} ${year}`;
  // A month that is not a calendar month says which days it covers: "October"
  // over a list that starts on 25 September would be a header disagreeing
  // with the rows beneath it.
  const { start: from, end } = periodBounds(period, start);
  const to = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
  const day = (d: Date) => `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
  return `${day(from)} – ${day(to)}, ${to.getFullYear()}`;
}

/** "25th" — for the setting that says which day a month starts on. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/**
 * "Sep" — a column heading, where "September 2026" would not fit.
 *
 * From the same hand-rolled list as `formatPeriod` and for the same reason:
 * Hermes ships less ICU data than Node and shortens September to "Sept", so an
 * `Intl` month name is a string the tests cannot predict.
 */
export function shortMonth(period: Period): string {
  const { month } = parsePeriod(period);
  return MONTHS[month - 1].slice(0, 3);
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Aug 08, 2026" — the record form's date footer. */
export function formatDayLabel(date: Date): string {
  return `${MONTHS[date.getMonth()].slice(0, 3)} ${pad(date.getDate())}, ${date.getFullYear()}`;
}

/** "Aug 06, Thursday" — the day heading in the records list. */
export function formatDayHeading(date: Date): string {
  return `${MONTHS[date.getMonth()].slice(0, 3)} ${pad(date.getDate())}, ${DAYS[date.getDay()]}`;
}

/** "7:14 PM". Hand-rolled for the same reason as formatPeriod. */
export function formatTimeLabel(date: Date): string {
  const hours = date.getHours();
  const suffix = hours < 12 ? 'AM' : 'PM';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${pad(date.getMinutes())} ${suffix}`;
}
