/**
 * Calendar-month helpers.
 *
 * A "period" is the string `YYYY-MM` — the same format stored in
 * `budgets.period`. Text rather than a timestamp because a month is not an
 * instant: it sorts and ranges correctly as a string, and carries no timezone.
 *
 * Everything here works in LOCAL time on purpose. A purchase at 11pm on the
 * 31st belongs to that month as the user lived it, not to the next one because
 * UTC had already rolled over.
 */

export type Period = string; // 'YYYY-MM'

const pad = (n: number) => String(n).padStart(2, '0');

export function periodOf(date: Date): Period {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
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
export function periodBounds(period: Period): { start: Date; end: Date } {
  const { year, month } = parsePeriod(period);
  return {
    start: new Date(year, month - 1, 1, 0, 0, 0, 0),
    end: new Date(year, month, 1, 0, 0, 0, 0),
  };
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
export function formatPeriod(period: Period): string {
  const { year, month } = parsePeriod(period);
  return `${MONTHS[month - 1]} ${year}`;
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
