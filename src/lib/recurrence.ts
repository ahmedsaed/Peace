/**
 * When a recurring rule fires.
 *
 * Pure calendar arithmetic over LOCAL dates. A recurring payment belongs to a
 * DAY, not an instant — rent is due on the 1st wherever you are — so everything
 * here is `YYYY-MM-DD` strings and local `Date` construction, never UTC and
 * never SQLite's `localtime` (which reads the process timezone and would bucket
 * differently on a phone set to Cairo and on CI set to UTC).
 *
 * THE OCCURRENCE IS COMPUTED FROM ITS INDEX, NOT FROM THE LAST ONE THAT FIRED.
 * That is the whole design, and it exists to kill one specific bug: a monthly
 * rule anchored to the 31st has to fire on 28 February and then on 31 March. If
 * the next date is derived by adding a month to whatever fired last, February
 * poisons every month after it and the rule silently walks backwards to the
 * 28th forever. Deriving occurrence *n* from the start date means clamping
 * applies to one month and never leaks into the next.
 */

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type Recurrence = {
  frequency: Frequency;
  /** Every N periods. 1 = every month, 3 = quarterly. */
  interval: number;
  /**
   * Weekly: day of week, 0 = Sunday. Monthly and yearly: day of month.
   * Null means "take it from the start date".
   */
  anchorDay: number | null;
  /** `YYYY-MM-DD`. */
  startsOn: string;
  /** `YYYY-MM-DD`, inclusive. Null runs forever. */
  endsOn: string | null;
};

const pad = (n: number) => String(n).padStart(2, '0');

export function toYmd(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight. Never `new Date(string)`, which parses as UTC. */
export function fromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Day 0 of the next month is the last day of this one. */
export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

const addDays = (ymd: string, days: number): string => {
  const date = fromYmd(ymd);
  date.setDate(date.getDate() + days);
  return toYmd(date);
};

/**
 * Move `count` whole months, clamping the day to the target month's length.
 *
 * 31 January plus one month is 28 February, not 3 March — which is what
 * `setMonth` alone would give, because it overflows rather than clamps.
 */
function addMonthsClamped(year: number, monthIndex: number, day: number, count: number): string {
  const total = monthIndex + count;
  const targetYear = year + Math.floor(total / 12);
  // `%` keeps the sign of the dividend, so a negative month needs correcting.
  const targetMonth = ((total % 12) + 12) % 12;
  const clamped = Math.min(day, daysInMonth(targetYear, targetMonth));
  return `${targetYear}-${pad(targetMonth + 1)}-${pad(clamped)}`;
}

/**
 * The date of occurrence `index`, counting the first as 0.
 *
 * Derived from the START each time. See the note at the top of the file — this
 * is what stops February from dragging every later month back with it.
 */
export function occurrenceAt(rule: Recurrence, index: number): string {
  const step = Math.max(1, Math.trunc(rule.interval)) * index;
  const start = fromYmd(rule.startsOn);

  switch (rule.frequency) {
    case 'daily':
      return addDays(rule.startsOn, step);

    case 'weekly': {
      // Anchored to a weekday if one is given: the first occurrence is the
      // start date rolled FORWARD to that weekday, never backwards, or the rule
      // would fire before it began.
      let first = rule.startsOn;
      if (rule.anchorDay !== null) {
        const shift = (((rule.anchorDay - start.getDay()) % 7) + 7) % 7;
        first = addDays(rule.startsOn, shift);
      }
      return addDays(first, step * 7);
    }

    case 'monthly':
      return addMonthsClamped(
        start.getFullYear(),
        start.getMonth(),
        rule.anchorDay ?? start.getDate(),
        step
      );

    case 'yearly':
      // 29 February yearly lands on the 28th in common years, by the same
      // clamping — and returns to the 29th in the next leap year.
      return addMonthsClamped(
        start.getFullYear(),
        start.getMonth(),
        rule.anchorDay ?? start.getDate(),
        step * 12
      );
  }
}

/** Has the rule finished? `endsOn` is inclusive. */
export const isAfterEnd = (rule: Recurrence, ymd: string) =>
  rule.endsOn !== null && ymd > rule.endsOn;

/**
 * The first occurrence falling on or after `from`.
 *
 * Walks forward rather than solving for the index: the arithmetic differs per
 * frequency, and a closed form for "months since, with clamping" is the kind of
 * cleverness that is wrong in one calendar corner nobody tests.
 */
export function firstOccurrenceOnOrAfter(rule: Recurrence, from: string): string | null {
  const LIMIT = 4_000; // ~11 years of daily, far past any sane catch-up.
  for (let index = 0; index < LIMIT; index++) {
    const date = occurrenceAt(rule, index);
    if (isAfterEnd(rule, date)) return null;
    if (date >= from) return date;
  }
  return null;
}

export function nextOccurrenceAfter(rule: Recurrence, date: string): string | null {
  return firstOccurrenceOnOrAfter(rule, addDays(date, 1));
}

/**
 * Every occurrence owed between `from` and `today`, inclusive.
 *
 * Capped, and the cap matters. A daily rule started two years ago and opened
 * for the first time today would otherwise generate seven hundred records in
 * one pass — enough to look like the app corrupted itself. The caller reports
 * the truncation rather than pretending it caught up.
 */
export function occurrencesDue(
  rule: Recurrence,
  from: string,
  today: string,
  cap = 60
): { dates: string[]; truncated: boolean } {
  const dates: string[] = [];

  let cursor: string | null = firstOccurrenceOnOrAfter(rule, from);
  while (cursor !== null && cursor <= today) {
    if (dates.length >= cap) return { dates, truncated: true };
    dates.push(cursor);
    cursor = nextOccurrenceAfter(rule, cursor);
  }

  return { dates, truncated: false };
}

/** "Every month on the 15th" — for the rule list. */
export function describeRecurrence(rule: Recurrence): string {
  const n = Math.max(1, Math.trunc(rule.interval));
  const start = fromYmd(rule.startsOn);
  const every = n === 1 ? 'Every' : `Every ${n}`;

  switch (rule.frequency) {
    case 'daily':
      return n === 1 ? 'Every day' : `Every ${n} days`;
    case 'weekly': {
      const day = rule.anchorDay ?? start.getDay();
      const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return `${every} ${n === 1 ? '' : 'weeks on '}${names[day]}`.replace('  ', ' ');
    }
    case 'monthly': {
      const day = rule.anchorDay ?? start.getDate();
      return `${every} ${n === 1 ? 'month' : 'months'} on the ${ordinal(day)}`;
    }
    case 'yearly':
      return `${every} ${n === 1 ? 'year' : 'years'} on ${formatDayMonth(rule.startsOn)}`;
  }
}

function ordinal(day: number): string {
  if (day > 3 && day < 21) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

function formatDayMonth(ymd: string): string {
  return fromYmd(ymd).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}
