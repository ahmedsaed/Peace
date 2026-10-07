import { formatPeriod, periodBounds } from '../lib/period';

/**
 * Turning what the model says about time into calendar bounds.
 *
 * THE APP RESOLVES DATES, NOT THE MODEL. The model is told today's date and
 * asked to name spans as `2025-12` or `2026-01-01`; turning those into
 * half-open [start, end) on LOCAL calendar boundaries is the same job
 * `periodBounds` already does correctly and is tested for. Letting the model
 * send timestamps would put a timezone conversion inside a language model.
 *
 * Every span carries a LABEL, and tools echo it back. "December" is ambiguous
 * in October; the answer saying "December 2025" is what lets the user see
 * which one was meant without having to trust that the right one was.
 */

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

export type Span = {
  start: Date | null;
  end: Date | null;
  label: string;
};

export type SpanArgs = {
  month?: unknown;
  from?: unknown;
  to?: unknown;
};

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Point = { date: Date; precision: 'year' | 'month' | 'day' };

/**
 * One end of a span. `edge` decides which side of a month or year a coarse
 * value lands on: "from 2025-03" is the 1st, "to 2025-03" runs to the end.
 */
function parsePoint(raw: unknown, edge: 'start' | 'end', name: string): Point | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new ToolInputError(`"${name}" must be a date string.`);
  const value = raw.trim();

  let match = /^(\d{4})$/.exec(value);
  if (match) {
    const year = Number(match[1]);
    return { date: edge === 'start' ? new Date(year, 0, 1) : new Date(year + 1, 0, 1), precision: 'year' };
  }

  match = /^(\d{4})-(\d{2})$/.exec(value);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) throw new ToolInputError(`"${value}" is not a month.`);
    return {
      date: edge === 'start' ? new Date(year, month - 1, 1) : new Date(year, month, 1),
      precision: 'month',
    };
  }

  match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    // `new Date(2025, 1, 30)` is quietly the 2nd of March. A date that rolled
    // over was not a date.
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      throw new ToolInputError(`"${value}" is not a real date.`);
    }
    // `to` is INCLUSIVE in what the model says and exclusive in what is
    // queried, so the last day named is counted whole.
    return {
      date: edge === 'start' ? date : new Date(year, month - 1, day + 1),
      precision: 'day',
    };
  }

  throw new ToolInputError(`"${value}" is not a date. Use YYYY-MM-DD, YYYY-MM or YYYY.`);
}

function dayLabel(date: Date): string {
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

function monthLabel(date: Date): string {
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

/** The day before an exclusive end — the last day the span actually covers. */
function lastDay(end: Date): Date {
  return new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
}

function isMonthStart(date: Date): boolean {
  return date.getDate() === 1;
}

export function spanLabel(start: Date | null, end: Date | null): string {
  if (!start && !end) return 'All time';
  if (start && !end) return `Since ${dayLabel(start)}`;
  if (!start && end) return `Until ${dayLabel(lastDay(end))}`;

  const s = start!;
  const e = end!;
  if (isMonthStart(s) && isMonthStart(e)) {
    const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
    if (months === 1) return formatPeriod(`${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}`);
    if (months === 12 && s.getMonth() === 0) return String(s.getFullYear());
    if (months > 0) return `${monthLabel(s)} – ${monthLabel(lastDay(e))}`;
  }
  const last = lastDay(e);
  if (last.getTime() === s.getTime()) return dayLabel(s);
  return `${dayLabel(s)} – ${dayLabel(last)}`;
}

/**
 * `{ month }` or `{ from, to }`, either end optional. Nothing at all is all
 * time, which is a legitimate question ("what have I ever spent on rent").
 */
export function resolveSpan(args: SpanArgs): Span {
  if (args.month !== undefined && args.month !== null && args.month !== '') {
    if (typeof args.month !== 'string' || !/^\d{4}-\d{2}$/.test(args.month.trim())) {
      throw new ToolInputError(`"month" must look like 2025-12.`);
    }
    const month = args.month.trim();
    const m = Number(month.slice(5));
    if (m < 1 || m > 12) throw new ToolInputError(`"${month}" is not a month.`);
    const { start, end } = periodBounds(month);
    return { start, end, label: formatPeriod(month) };
  }

  const from = parsePoint(args.from, 'start', 'from');
  const to = parsePoint(args.to, 'end', 'to');
  const start = from?.date ?? null;
  const end = to?.date ?? null;

  if (start && end && start.getTime() >= end.getTime()) {
    throw new ToolInputError('"from" must be before "to".');
  }
  return { start, end, label: spanLabel(start, end) };
}

/** `YYYY-MM-DD` in local time, the way the model is asked to write dates. */
export function ymd(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
