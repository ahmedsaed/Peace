import { type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type { Slice, SubSlice } from '../../lib/analysis';
import { addMonths, type Period } from '../../lib/period';
import * as schema from '../schema';
import { periodSummary } from './records';
import { categoriesOfKind, totalsByCategory, type CategoryKind } from './spend';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/** Fallback for a category saved with no colour of its own. */
const NO_COLOR = '#6B5B4A';

export type Breakdown = {
  /** Every category with something in it, unranked — the chart ranks them. */
  slices: Slice[];
  /** Everything in `slices`, so the screen never re-adds them itself. */
  totalMinor: number;
  /** Money of this kind with no category. Reported, never silently folded in. */
  uncategorisedMinor: number;
  /**
   * Money that came back in a category with nothing (net) spent in it this
   * month — the refund for last month's shop. A wedge cannot be negative, so
   * it is reported beside the ring instead of being drawn as spending.
   */
  refundedMinor: number;
  unvaluedCount: number;
};

/**
 * One month, split by top-level category, each broken down by its
 * sub-categories.
 *
 * The RING is still the parents. Nineteen of them already make a crowded
 * ring, and slicing it by thirty-three leaves would make it unreadable; it
 * also keeps this screen agreeing with Budgets, which can only ever be set on
 * a parent. The sub-categories are a breakdown INSIDE a parent's wedge — the
 * same month under the same grouping, with more said about it — so the two
 * screens still show one set of figures.
 *
 * Totals are rolled up from SIGNED per-category sums. Rolling up magnitudes
 * would make a sub-category holding only a refund count as spending, and the
 * lines under a parent would add up to more than the parent.
 */
export function categoryBreakdown(
  db: Db,
  period: Period,
  kind: CategoryKind,
  homeCurrency = 'EGP',
  /**
   * Narrow the whole breakdown to one tag.
   *
   * "Where did the kitchen money go" is the question a project raises, and it
   * is a CATEGORY question asked of a subset — which is why it can still be a
   * ring. See `tagBreakdown` for why the tags themselves cannot be one.
   */
  tagId: string | null = null
): Breakdown {
  const { byCategory, uncategorised, unvalued } = totalsByCategory(
    db,
    period,
    kind,
    homeCurrency,
    tagId
  );

  // Archived categories included: money filed under one has still been spent.
  const all = categoriesOfKind(db, kind);
  const childrenOf = new Map<string, schema.Category[]>();
  for (const category of all) {
    if (!category.parentId) continue;
    childrenOf.set(category.parentId, [...(childrenOf.get(category.parentId) ?? []), category]);
  }

  const slices: Slice[] = [];
  let totalMinor = 0;
  let refundedMinor = 0;

  for (const parent of all) {
    if (parent.parentId) continue;
    const color = parent.color ?? NO_COLOR;

    const children: SubSlice[] = (childrenOf.get(parent.id) ?? [])
      .filter((child) => byCategory.has(child.id))
      .map((child) => ({
        id: child.id,
        label: child.name,
        color,
        icon: child.icon,
        amountMinor: byCategory.get(child.id)!,
        own: false,
      }));
    const ownMinor = byCategory.get(parent.id) ?? 0;
    const amountMinor = children.reduce((sum, c) => sum + c.amountMinor, ownMinor);

    if (amountMinor < 0) refundedMinor -= amountMinor;
    if (amountMinor <= 0) continue;

    // Money filed on the parent itself is a line of its own as soon as there
    // is any breakdown at all, or the lines would not add up to the wedge.
    const subs: SubSlice[] =
      children.length > 0 && ownMinor !== 0
        ? [
            ...children,
            {
              id: `${parent.id}-own`,
              label: `${parent.name}, no sub-category`,
              color,
              icon: parent.icon,
              amountMinor: ownMinor,
              own: true,
            },
          ]
        : children;

    slices.push({ id: parent.id, label: parent.name, color, icon: parent.icon, amountMinor, subs });
    totalMinor += amountMinor;
  }

  return {
    slices,
    totalMinor,
    uncategorisedMinor: uncategorised,
    refundedMinor,
    unvaluedCount: unvalued,
  };
}

export type CashFlowPoint = {
  period: Period;
  /** Unsigned. */
  incomeMinor: number;
  /** Unsigned — the bar has a direction, the number does not need a sign. */
  expenseMinor: number;
  /** Signed: negative means the month cost more than it brought in. */
  netMinor: number;
};

/**
 * Income against spending for the last `months` months, oldest first.
 *
 * Deliberately N separate queries rather than one `GROUP BY strftime(...)`.
 * Grouping in SQL would need SQLite's `localtime` modifier, which reads the
 * *process* timezone — so the same database would bucket differently on a
 * device set to Cairo and on CI set to UTC, and an 11pm purchase on the 31st
 * would land in the wrong month. `periodBounds` already computes local calendar
 * boundaries correctly and is tested; six indexed range queries cost nothing
 * next to being right.
 */
export function cashFlow(
  db: Db,
  endPeriod: Period,
  { months = 6, homeCurrency = 'EGP' }: { months?: number; homeCurrency?: string } = {}
): CashFlowPoint[] {
  const points: CashFlowPoint[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const period = addMonths(endPeriod, -i);
    const summary = periodSummary(db, period, homeCurrency);
    points.push({
      period,
      // periodSummary returns expenses signed negative, as the ledger stores
      // them. A bar length is a magnitude.
      incomeMinor: Math.abs(summary.incomeMinor),
      expenseMinor: Math.abs(summary.expenseMinor),
      netMinor: summary.balanceMinor,
    });
  }

  return points;
}

/** The tallest bar in a cash-flow chart, used to scale the rest. */
export function cashFlowPeak(points: CashFlowPoint[]): number {
  return points.reduce((peak, p) => Math.max(peak, p.incomeMinor, p.expenseMinor), 0);
}
