import type { LedgerFact } from '../db/repo/ledger-query';
import { aggregate, BUCKET_LIMITS, contribution } from './aggregate';
import { ToolInputError } from './dates';

let n = 0;
function fact(over: Partial<LedgerFact> & { valueMinor: number | null; occurredAt: Date }): LedgerFact {
  n++;
  return {
    id: `f${n}`,
    side: over.valueMinor !== null && over.valueMinor > 0 && !over.isRefund ? 'income' : 'expense',
    isRefund: false,
    amountMinor: over.valueMinor ?? 0,
    currency: 'EGP',
    categoryId: 'food',
    categoryName: 'Food',
    topCategoryId: 'food',
    topCategoryName: 'Food',
    accountId: 'cash',
    accountName: 'Cash',
    note: null,
    tagIds: [],
    tagNames: [],
    ...over,
  };
}

const d = (y: number, m: number, day = 10) => new Date(y, m - 1, day, 12);

describe('contribution', () => {
  it('reports spending as a positive amount and lets a refund subtract', () => {
    const purchase = fact({ valueMinor: -500, occurredAt: d(2026, 1) });
    const refund = fact({ valueMinor: 200, isRefund: true, side: 'expense', occurredAt: d(2026, 1) });
    expect(contribution(purchase, 'expense')).toBe(500);
    expect(contribution(refund, 'expense')).toBe(-200);
    // The refund is NOT income, however positive its amount.
    expect(contribution(refund, 'income')).toBe('skip');
  });

  it('never produces negative zero', () => {
    const zero = fact({ valueMinor: 0, side: 'expense', occurredAt: d(2026, 1) });
    expect(Object.is(contribution(zero, 'expense'), -0)).toBe(false);
  });
});

describe('aggregate by month', () => {
  it('keeps an empty month as zero rather than dropping it', () => {
    // Coffee in January and March only. Dropping February would draw the line
    // straight across it — the opposite of what happened.
    const facts = [
      fact({ valueMinor: -300, occurredAt: d(2026, 1) }),
      fact({ valueMinor: -500, occurredAt: d(2026, 3) }),
    ];
    const result = aggregate(facts, {
      measure: 'expense',
      groupBy: 'month',
      start: new Date(2026, 0, 1),
      end: new Date(2026, 3, 1),
    });
    expect(result.buckets.map((b) => [b.key, b.valueMinor])).toEqual([
      ['2026-01', 300],
      ['2026-02', 0],
      ['2026-03', 500],
    ]);
    expect(result.buckets[1].label).toBe('Feb 2026');
    expect(result.totalMinor).toBe(800);
  });

  it('buckets an 11pm purchase on the 31st into its own month', () => {
    const late = fact({ valueMinor: -100, occurredAt: new Date(2025, 11, 31, 23, 30) });
    const result = aggregate([late], {
      measure: 'expense',
      groupBy: 'month',
      start: new Date(2025, 11, 1),
      end: new Date(2026, 1, 1),
    });
    expect(result.buckets.map((b) => b.valueMinor)).toEqual([100, 0]);
  });

  it('runs from the first fact to the last when the span is open', () => {
    const facts = [fact({ valueMinor: -1, occurredAt: d(2025, 11) }), fact({ valueMinor: -1, occurredAt: d(2026, 1) })];
    const result = aggregate(facts, { measure: 'expense', groupBy: 'month' });
    expect(result.buckets.map((b) => b.key)).toEqual(['2025-11', '2025-12', '2026-01']);
  });

  it('refuses a span that would draw hundreds of bars', () => {
    expect(() =>
      aggregate([], {
        measure: 'expense',
        groupBy: 'day',
        start: new Date(2025, 0, 1),
        end: new Date(2026, 0, 1),
      })
    ).toThrow(ToolInputError);
    expect(BUCKET_LIMITS.day).toBeLessThan(365);
  });

  it('clips a partial first week to the span, so drilling in stays inside the question', () => {
    // 1 Jan 2026 is a Thursday; its week starts on Monday 29 Dec.
    const result = aggregate([], {
      measure: 'expense',
      groupBy: 'week',
      start: new Date(2026, 0, 1),
      end: new Date(2026, 0, 12),
    });
    expect(result.buckets[0].start).toEqual(new Date(2026, 0, 1));
    expect(result.buckets[0].label).toBe('Week of 29 Dec');
    expect(result.buckets.at(-1)!.end).toEqual(new Date(2026, 0, 12));
  });
});

describe('aggregate by category, tag and account', () => {
  it('groups by the top-level category and labels the uncategorised', () => {
    const facts = [
      fact({ valueMinor: -300, occurredAt: d(2026, 1), categoryId: 'coffee', categoryName: 'Coffee' }),
      fact({ valueMinor: -200, occurredAt: d(2026, 1) }),
      fact({
        valueMinor: -900,
        occurredAt: d(2026, 1),
        categoryId: null,
        categoryName: null,
        topCategoryId: null,
        topCategoryName: null,
      }),
    ];
    const result = aggregate(facts, { measure: 'expense', groupBy: 'category' });
    expect(result.buckets.map((b) => [b.label, b.valueMinor])).toEqual([
      ['Uncategorised', 900],
      ['Food', 500],
    ]);
  });

  it('names a sub-category with its parent', () => {
    const facts = [fact({ valueMinor: -300, occurredAt: d(2026, 1), categoryId: 'coffee', categoryName: 'Coffee' })];
    const result = aggregate(facts, { measure: 'expense', groupBy: 'subcategory' });
    expect(result.buckets[0].label).toBe('Food › Coffee');
  });

  it('drops a category whose refunds exactly cancelled it', () => {
    const facts = [
      fact({ valueMinor: -300, occurredAt: d(2026, 1) }),
      fact({ valueMinor: 300, side: 'expense', isRefund: true, occurredAt: d(2026, 1) }),
    ];
    expect(aggregate(facts, { measure: 'expense', groupBy: 'category' }).buckets).toEqual([]);
  });

  it('marks tag groups as overlapping and keeps the total honest', () => {
    const facts = [
      fact({ valueMinor: -100, occurredAt: d(2026, 1), tagIds: ['a', 'b'], tagNames: ['Trip', 'Work'] }),
      fact({ valueMinor: -50, occurredAt: d(2026, 1) }),
    ];
    const result = aggregate(facts, { measure: 'expense', groupBy: 'tag' });
    expect(result.overlapping).toBe(true);
    expect(result.buckets.map((b) => b.valueMinor)).toEqual([100, 100]);
    // The total counts each record once, untagged included.
    expect(result.totalMinor).toBe(150);
  });

  it('nets income against spending and counts what it could not value', () => {
    const facts = [
      fact({ valueMinor: 1000, occurredAt: d(2026, 1) }),
      fact({ valueMinor: -400, occurredAt: d(2026, 1) }),
      fact({ valueMinor: null, side: 'expense', occurredAt: d(2026, 1) }),
    ];
    const result = aggregate(facts, { measure: 'net', groupBy: 'account' });
    expect(result.totalMinor).toBe(600);
    expect(result.unvaluedCount).toBe(1);
    expect(result.buckets).toEqual([
      expect.objectContaining({ label: 'Cash', valueMinor: 600, count: 2, accountId: 'cash' }),
    ]);
  });

  it('orders ties by name so the same data never reorders itself', () => {
    const facts = [
      fact({ valueMinor: -100, occurredAt: d(2026, 1), accountId: 'z', accountName: 'Zed' }),
      fact({ valueMinor: -100, occurredAt: d(2026, 1), accountId: 'a', accountName: 'Alpha' }),
    ];
    const result = aggregate(facts, { measure: 'expense', groupBy: 'account' });
    expect(result.buckets.map((b) => b.label)).toEqual(['Alpha', 'Zed']);
  });
});
