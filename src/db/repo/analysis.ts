import { type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type { Slice } from '../../lib/analysis';
import { addMonths, type Period } from '../../lib/period';
import * as schema from '../schema';
import { periodSummary } from './records';
import { topLevelCategories, totalsByTopCategory, type CategoryKind } from './spend';

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
  unvaluedCount: number;
};

/**
 * One month, split by top-level category.
 *
 * Rolled up rather than leaf-level: nineteen parents already make a crowded
 * ring, and thirty-three would make it unreadable. It also keeps this screen
 * agreeing with Budgets, which can only ever be set on a parent — two screens
 * showing the same month under different groupings is how a person stops
 * trusting both.
 */
export function categoryBreakdown(
  db: Db,
  period: Period,
  kind: CategoryKind,
  homeCurrency = 'EGP'
): Breakdown {
  const { byCategory, uncategorised, unvalued } = totalsByTopCategory(
    db,
    period,
    kind,
    homeCurrency
  );

  const slices: Slice[] = [];
  let totalMinor = 0;

  for (const category of topLevelCategories(db, kind)) {
    const amountMinor = byCategory.get(category.id) ?? 0;
    if (amountMinor === 0) continue;
    slices.push({
      id: category.id,
      label: category.name,
      color: category.color ?? NO_COLOR,
      icon: category.icon,
      amountMinor,
    });
    totalMinor += amountMinor;
  }

  return {
    slices,
    totalMinor,
    uncategorisedMinor: uncategorised,
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
