import type { LedgerFact } from '../db/repo/ledger-query';
import { ToolInputError } from './dates';

/**
 * Summing ledger facts into groups. Pure, so every rule here is unit-tested.
 *
 * WHAT A MEASURE COUNTS:
 *   expense  the expense side, as a positive amount spent. A refund is on this
 *            side with a positive stored amount, so it SUBTRACTS — returning
 *            shoes lowers what clothes cost, it does not become income.
 *   income   the income side, as stored.
 *   net      everything: income minus spending.
 *
 * A record with no value in the home currency is left out of every sum and
 * counted instead, so a total can say it is incomplete rather than quietly add
 * dollars to pounds.
 *
 * EMPTY MONTHS ARE KEPT. "How does coffee compare month to month" over a span
 * with a month of no coffee must show that month as zero — dropping it would
 * draw the line straight across it and say the opposite of the truth.
 */

export type Measure = 'expense' | 'income' | 'net';
export type GroupBy =
  | 'none'
  | 'month'
  | 'week'
  | 'day'
  | 'category'
  | 'subcategory'
  | 'tag'
  | 'account';

export const MEASURES: Measure[] = ['expense', 'income', 'net'];
export const GROUP_BYS: GroupBy[] = [
  'none',
  'month',
  'week',
  'day',
  'category',
  'subcategory',
  'tag',
  'account',
];

export type Bucket = {
  key: string;
  label: string;
  valueMinor: number;
  count: number;
  /** For a time bucket: its own half-open span, for drilling into it. */
  start?: Date;
  end?: Date;
  /** For a categorical bucket: what it is, so a tap can filter to it. */
  categoryId?: string | null;
  tagId?: string;
  accountId?: string;
};

export type Aggregate = {
  buckets: Bucket[];
  totalMinor: number;
  count: number;
  unvaluedCount: number;
  /** Tags overlap: a record with two tags is in two buckets. */
  overlapping: boolean;
};

/** Upper bounds on time buckets, so one bad span cannot draw a thousand bars. */
export const BUCKET_LIMITS = { month: 60, week: 104, day: 92 } as const;

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** What one fact adds to a measure, or null when it does not belong to it. */
export function contribution(fact: LedgerFact, measure: Measure): number | null | 'skip' {
  if (measure === 'expense' && fact.side !== 'expense') return 'skip';
  if (measure === 'income' && fact.side !== 'income') return 'skip';
  if (fact.valueMinor === null) return null;
  // Expense is reported as an amount SPENT, positive. Stored purchases are
  // negative and refunds positive, so negating does both at once. `+ 0`
  // normalises the negative zero a settled category would otherwise produce.
  return measure === 'expense' ? -fact.valueMinor + 0 : fact.valueMinor;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Monday-based weeks, the convention almost everywhere this app is used. */
function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  const offset = (day.getDay() + 6) % 7;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - offset);
}

type TimeUnit = 'month' | 'week' | 'day';

function unitStart(date: Date, unit: TimeUnit): Date {
  if (unit === 'month') return new Date(date.getFullYear(), date.getMonth(), 1);
  if (unit === 'week') return startOfWeek(date);
  return startOfDay(date);
}

function nextUnit(date: Date, unit: TimeUnit): Date {
  if (unit === 'month') return new Date(date.getFullYear(), date.getMonth() + 1, 1);
  if (unit === 'week') return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

function unitKey(date: Date, unit: TimeUnit): string {
  if (unit === 'month') return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function unitLabel(date: Date, unit: TimeUnit): string {
  if (unit === 'month') return `${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
  const day = `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
  return unit === 'week' ? `Week of ${day}` : day;
}

function timeBuckets(
  facts: LedgerFact[],
  measure: Measure,
  unit: TimeUnit,
  start: Date | null,
  end: Date | null
): { buckets: Bucket[]; unvalued: number } {
  const first = start ?? facts[0]?.occurredAt ?? null;
  // Exclusive. With no end, the bucket holding the last fact is the last one.
  const last = end ?? (facts.length > 0 ? new Date(facts[facts.length - 1].occurredAt.getTime() + 1) : null);
  if (!first || !last) return { buckets: [], unvalued: 0 };

  const buckets: Bucket[] = [];
  const index = new Map<string, Bucket>();
  for (let at = unitStart(first, unit); at.getTime() < last.getTime(); at = nextUnit(at, unit)) {
    if (buckets.length >= BUCKET_LIMITS[unit]) {
      throw new ToolInputError(
        `That is more than ${BUCKET_LIMITS[unit]} ${unit}s. Narrow the span or group by a longer unit.`
      );
    }
    const bucket: Bucket = {
      key: unitKey(at, unit),
      label: unitLabel(at, unit),
      valueMinor: 0,
      count: 0,
      // Clipped to the span, so drilling into a partial first week does not
      // show records from before the question started.
      start: start && at.getTime() < start.getTime() ? start : at,
      end: end && nextUnit(at, unit).getTime() > end.getTime() ? end : nextUnit(at, unit),
    };
    buckets.push(bucket);
    index.set(bucket.key, bucket);
  }

  let unvalued = 0;
  for (const fact of facts) {
    const value = contribution(fact, measure);
    if (value === 'skip') continue;
    if (value === null) {
      unvalued++;
      continue;
    }
    const bucket = index.get(unitKey(unitStart(fact.occurredAt, unit), unit));
    if (!bucket) continue;
    bucket.valueMinor += value;
    bucket.count++;
  }
  return { buckets, unvalued };
}

function byLabel(a: Bucket, b: Bucket): number {
  const x = a.label.toLowerCase();
  const y = b.label.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

export function aggregate(
  facts: LedgerFact[],
  {
    measure,
    groupBy,
    start = null,
    end = null,
  }: { measure: Measure; groupBy: GroupBy; start?: Date | null; end?: Date | null }
): Aggregate {
  let totalMinor = 0;
  let count = 0;
  let unvaluedCount = 0;
  for (const fact of facts) {
    const value = contribution(fact, measure);
    if (value === 'skip') continue;
    if (value === null) unvaluedCount++;
    else {
      totalMinor += value;
      count++;
    }
  }

  if (groupBy === 'month' || groupBy === 'week' || groupBy === 'day') {
    const { buckets } = timeBuckets(facts, measure, groupBy, start, end);
    return { buckets, totalMinor, count, unvaluedCount, overlapping: false };
  }

  if (groupBy === 'none') {
    return {
      buckets: [{ key: 'total', label: 'Total', valueMinor: totalMinor, count }],
      totalMinor,
      count,
      unvaluedCount,
      overlapping: false,
    };
  }

  const index = new Map<string, Bucket>();
  const add = (key: string, make: () => Bucket, value: number) => {
    let bucket = index.get(key);
    if (!bucket) {
      bucket = make();
      index.set(key, bucket);
    }
    bucket.valueMinor += value;
    bucket.count++;
  };

  for (const fact of facts) {
    const value = contribution(fact, measure);
    if (value === 'skip' || value === null) continue;

    switch (groupBy) {
      case 'category': {
        const id = fact.topCategoryId;
        add(
          id ?? 'none',
          () => ({ key: id ?? 'none', label: fact.topCategoryName ?? 'Uncategorised', valueMinor: 0, count: 0, categoryId: id }),
          value
        );
        break;
      }
      case 'subcategory': {
        const id = fact.categoryId;
        const nested = id !== null && fact.topCategoryId !== id;
        add(
          id ?? 'none',
          () => ({
            key: id ?? 'none',
            label: id === null ? 'Uncategorised' : nested ? `${fact.topCategoryName} › ${fact.categoryName}` : (fact.categoryName ?? ''),
            valueMinor: 0,
            count: 0,
            categoryId: id,
          }),
          value
        );
        break;
      }
      case 'account':
        add(
          fact.accountId,
          () => ({ key: fact.accountId, label: fact.accountName, valueMinor: 0, count: 0, accountId: fact.accountId }),
          value
        );
        break;
      case 'tag':
        // Untagged records are in the total and in no bucket. That is what
        // `overlapping` warns about: these buckets are not a partition.
        fact.tagIds.forEach((tagId, i) =>
          add(tagId, () => ({ key: tagId, label: fact.tagNames[i], valueMinor: 0, count: 0, tagId }), value)
        );
        break;
    }
  }

  const buckets = [...index.values()]
    // A category whose refunds exactly cancelled its spending moved nothing.
    .filter((bucket) => bucket.valueMinor !== 0)
    // Biggest first, ties by name, so the same data never reorders itself.
    .sort((a, b) => Math.abs(b.valueMinor) - Math.abs(a.valueMinor) || byLabel(a, b));

  return { buckets, totalMinor, count, unvaluedCount, overlapping: groupBy === 'tag' };
}

/**
 * Whether a fact belongs to a bucket — for splitting a group a second way
 * ("each category, by month") from the same facts the first split counted.
 */
export function inBucket(fact: LedgerFact, groupBy: GroupBy, bucket: Bucket): boolean {
  switch (groupBy) {
    case 'none':
      return true;
    case 'month':
    case 'week':
    case 'day':
      return (
        bucket.start !== undefined &&
        bucket.end !== undefined &&
        fact.occurredAt.getTime() >= bucket.start.getTime() &&
        fact.occurredAt.getTime() < bucket.end.getTime()
      );
    case 'category':
      return (fact.topCategoryId ?? 'none') === bucket.key;
    case 'subcategory':
      return (fact.categoryId ?? 'none') === bucket.key;
    case 'tag':
      return bucket.tagId !== undefined && fact.tagIds.includes(bucket.tagId);
    case 'account':
      return fact.accountId === bucket.accountId;
  }
}

/**
 * How many whole calendar months a span covers, or null when it does not
 * start and end on month boundaries — an "average per month" over a span
 * that ends a week into October would quietly count that week as a month.
 */
export function wholeMonths(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const aligned = (d: Date) => d.getDate() === 1 && d.getHours() === 0 && d.getMinutes() === 0;
  if (!aligned(start) || !aligned(end)) return null;
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  return months > 0 ? months : null;
}
