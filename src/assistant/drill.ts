import { ledgerFacts, type LedgerFact } from '../db/repo/ledger-query';
import { searchRecords } from '../db/repo/search';
import type { RecordRow } from '../db/repo/records';
import { decimalsFor, minorToMajor } from '../lib/money';
import { EMPTY_QUERY } from '../lib/search-query';
import { fromStored } from './tools/read';
import type { ChartPoint, ChartSpec, Db } from './tools/types';

/**
 * From a bar on a chart to the records inside it.
 *
 * The SAME facts the chart was summed from, narrowed to the bar, so the list a
 * tap opens adds up to the bar that was tapped. A search re-done from scratch
 * would have its own idea of what "coffee in September" means — it counts
 * transfers, for one — and the two would disagree on the screen whose whole
 * point is to explain a number.
 *
 * Read from the ledger as it is NOW. A chart is a snapshot of when it was
 * drawn; the records behind it may since have been edited, and the list shows
 * that rather than pretending otherwise.
 */
export function drillFacts(db: Db, chart: ChartSpec, point: ChartPoint | null, homeCurrency: string): LedgerFact[] {
  const filter = fromStored(chart.filter);
  if (point?.start !== undefined) filter.start = new Date(point.start);
  if (point?.end !== undefined) filter.end = new Date(point.end);

  return ledgerFacts(db, filter, homeCurrency).filter((fact) => {
    if (chart.measure === 'expense' && fact.side !== 'expense') return false;
    if (chart.measure === 'income' && fact.side !== 'income') return false;
    if (!point) return true;
    switch (chart.groupBy) {
      case 'category':
        return fact.topCategoryId === (point.categoryId ?? null);
      case 'subcategory':
        return fact.categoryId === (point.categoryId ?? null);
      case 'tag':
        return point.tagId !== undefined && fact.tagIds.includes(point.tagId);
      case 'account':
        return fact.accountId === point.accountId;
      default:
        return true;
    }
  });
}

/** The rows themselves, newest first, in the shape every record list draws. */
export function drillRows(db: Db, chart: ChartSpec, point: ChartPoint | null, homeCurrency: string): RecordRow[] {
  const ids = drillFacts(db, chart, point, homeCurrency).map((fact) => fact.id);
  return searchRecords(db, EMPTY_QUERY, { homeCurrency, ids, limit: 500 }).rows;
}

/**
 * A chart's numbers as a spreadsheet.
 *
 * Amounts in major units with the currency's own decimals, the way the main
 * CSV export writes them — never formatted with a symbol, never masked. An
 * export is data, and a mask that reached a file would be data loss.
 */
export function chartCsv(chart: ChartSpec): string[][] {
  const decimals = decimalsFor(chart.currency);
  const amount = (minor: number) => minorToMajor(minor, chart.currency).toFixed(decimals);
  const what = chart.measure === 'expense' ? 'spent' : chart.measure === 'income' ? 'earned' : 'net';
  return [
    [chart.groupBy, `${what} (${chart.currency})`, 'records'],
    ...chart.points.map((point) => [point.label, amount(point.valueMinor), String(point.count)]),
    // Tag groups overlap, so their sum is not the total; the total row is the
    // real one either way.
    ['Total', amount(chart.totalMinor), ''],
  ];
}
