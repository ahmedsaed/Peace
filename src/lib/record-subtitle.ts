import type { RecordRow } from '../db/repo/records';
import { formatTags } from './tag';

/**
 * The second line of a row in the records list: where the money was, then
 * what was written about it, then its labels.
 *
 * Pure, so each kind of row has a test saying what it shows. The note was once
 * left off transfers, which made "Loan → Bank" the whole story of a payment the
 * user had described in words, on every transfer they ever logged.
 */
export function recordSubtitle(
  row: Pick<
    RecordRow,
    | 'accountName'
    | 'counterAccountName'
    | 'note'
    | 'tags'
    | 'isTransfer'
    | 'isRefund'
    | 'isAdjustment'
    | 'reversesId'
  >
): string {
  const note = row.note ? ` · “${row.note}”` : '';

  /**
   * The labels, after everything else on the line.
   *
   * LAST because it is the part that may be cut: the account and the note are
   * what identify a row, and a tag is how you found it in the first place. The
   * `#` is what stops `Cash · "Winter jacket" · kitchen` reading as one longer
   * note — see `formatTags`.
   */
  const labels = row.tags.length > 0 ? ` · ${formatTags(row.tags)}` : '';

  if (row.isTransfer) {
    // A transfer that exists to undo another says so before the note: it is
    // what tells this row apart from an ordinary transfer between the same two
    // accounts going the same way.
    const reversal = row.reversesId !== null ? ' · reversal' : '';
    return `${row.accountName} → ${row.counterAccountName ?? '—'}${reversal}${note}${labels}`;
  }
  if (row.isRefund) return `${row.accountName} · refunded${note}${labels}`;
  if (row.isAdjustment) return `${row.accountName} · not counted as spending${labels}`;
  return `${row.accountName}${note}${labels}`;
}
