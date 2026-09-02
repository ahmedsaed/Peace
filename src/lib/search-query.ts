/**
 * The search query, as a value.
 *
 * Pure — no database import — so every rule about what a query MEANS is
 * testable without a device. The repository turns this into SQL; nothing here
 * knows that SQL exists.
 *
 * The amount bounds are held as the user typed them rather than as parsed
 * numbers, because a half-typed "12." has to survive a re-render without the
 * field fighting the person using it. Parsing happens once, at the boundary,
 * in `amountBoundsMinor`.
 */

import { parseAmountToMinor } from './money';

/** Which side of the ledger. `null` means "all", not "none". */
export type RecordKind = 'expense' | 'income' | 'transfer';

export type DateRange = 'any' | 'month' | 'quarter' | 'year';

export type SearchQuery = {
  /** Matched against the note, the category name and the account names. */
  text: string;
  kind: RecordKind | null;
  /**
   * The account a row is ON. For a transfer that is the account the money left,
   * because search shows the outgoing leg — see `counterAccountId` for the
   * other end.
   */
  accountId: string | null;
  /**
   * The account a transfer went TO.
   *
   * Only transfers have one: `counter_account_id` is NULL on every other row,
   * so this narrows to transfers whether or not `kind` says so. It exists
   * because search lists only the OUTGOING leg — without it "everything that
   * landed in Savings" is a question the screen cannot ask, since the leg
   * carrying that answer is the one deliberately hidden.
   */
  counterAccountId: string | null;
  /** A parent category also matches its children — see the repository. */
  categoryId: string | null;
  /**
   * Records carrying ALL of these tags.
   *
   * AND, like every other control in the panel: account AND category AND range
   * all narrow, and one row that gathered instead would be the odd one out.
   * Counted as ONE filter on the badge for the same reason min and max are —
   * "tagged kitchen and urgent" is a single idea, and badging it as two
   * overstates how narrow the search is.
   */
  tagIds: string[];
  minAmount: string;
  maxAmount: string;
  range: DateRange;
};

export const EMPTY_QUERY: SearchQuery = {
  text: '',
  kind: null,
  accountId: null,
  counterAccountId: null,
  categoryId: null,
  tagIds: [],
  minAmount: '',
  maxAmount: '',
  range: 'any',
};

export const RANGE_LABELS: Record<DateRange, string> = {
  any: 'Any time',
  month: 'This month',
  quarter: 'Last 3 months',
  year: 'This year',
};

export const KIND_LABELS: Record<RecordKind, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
};

/**
 * How many filters are narrowing the results, for the badge on the filter
 * button. The text field is not counted — it is visible on screen, so counting
 * it would claim a hidden filter that is not hidden.
 */
export function activeFilterCount(query: SearchQuery): number {
  let count = 0;
  if (query.kind !== null) count++;
  if (query.accountId !== null) count++;
  if (query.counterAccountId !== null) count++;
  if (query.categoryId !== null) count++;
  if (query.tagIds.length > 0) count++;
  if (query.range !== 'any') count++;
  // Min and max are one filter between them: "between 100 and 200" is a single
  // idea, and badging it as 2 overstates how narrow the search is.
  if (query.minAmount.trim() !== '' || query.maxAmount.trim() !== '') count++;
  return count;
}

/**
 * Change the type filter, dropping whatever the new type cannot express.
 *
 * A transfer has no category — `category_id` is NULL on both legs by
 * definition — and nothing but a transfer has a counter account. So each of
 * those two filters is meaningless under the other type, and leaving one set
 * while its control is off screen is worse than useless: the results empty out,
 * the badge counts a filter that cannot be seen, and the only way back is
 * "Clear filters", which throws away the rest of the query too.
 *
 * Done here rather than in the screen so the rule is tested, and so the two
 * fields cannot both be set — which would be a query matching nothing, spelled
 * two different ways.
 */
export function withKind(query: SearchQuery, kind: RecordKind | null): SearchQuery {
  // Tags are untouched on purpose. Unlike a category, a tag applies to every
  // kind of row there is — a transfer made FOR the kitchen is part of the
  // kitchen — so no type can make one meaningless.
  return {
    ...query,
    kind,
    categoryId: kind === 'transfer' ? null : query.categoryId,
    counterAccountId: kind === 'transfer' ? query.counterAccountId : null,
  };
}

/**
 * Whether there is anything to search FOR.
 *
 * An empty query must not run. Returning every record ever entered is not a
 * search result, it is the records list with the month navigator removed — and
 * on a ledger of any age it is also the slowest thing the app could do on the
 * keystroke that clears the field.
 */
export function isRunnable(query: SearchQuery): boolean {
  return query.text.trim() !== '' || activeFilterCount(query) > 0;
}

/**
 * Wrap the user's text as a LIKE pattern, escaping the wildcards.
 *
 * SQLite's LIKE treats `%` and `_` as wildcards, so searching for "50_off"
 * would silently match "50-off" and "50%" would match every record in the
 * database while looking like a perfectly ordinary failed search. The escape
 * character itself has to be escaped first, or `\` in a note breaks the
 * pattern. Callers must pair this with `ESCAPE '\'`.
 */
export function likePattern(text: string): string {
  const escaped = text.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${escaped}%`;
}

/**
 * The amount bounds, in minor units, as an unsigned magnitude.
 *
 * UNSIGNED because the user is reading the list, where an expense shows as
 * "E£250" — nobody searching for a 250-pound lunch thinks of it as -250. The
 * repository compares against `abs(amount_minor)` to match.
 *
 * Reversed bounds are swapped rather than returned as written. "More than 500
 * and less than 100" matches nothing and is never what anyone meant; silently
 * returning an empty result would look like missing data.
 */
export function amountBoundsMinor(
  query: SearchQuery,
  currency: string
): { min: number | null; max: number | null } {
  const parse = (raw: string) => {
    if (raw.trim() === '') return null;
    const minor = parseAmountToMinor(raw, currency);
    // Unparseable input is treated as absent rather than as zero. Zero is a
    // real bound that would exclude nothing on the min side and everything on
    // the max side — a typo must not empty the screen.
    if (minor === null) return null;
    return Math.abs(minor);
  };

  const min = parse(query.minAmount);
  const max = parse(query.maxAmount);
  if (min !== null && max !== null && min > max) return { min: max, max: min };
  return { min, max };
}

/**
 * Calendar bounds for a range preset, or null for "any time".
 *
 * Half-open [start, end) on LOCAL calendar boundaries, the same convention
 * `periodBounds` uses — an 11pm purchase belongs to the day the user lived, not
 * to tomorrow because UTC rolled over.
 */
export function rangeBounds(range: DateRange, now: Date): { start: Date; end: Date } | null {
  const year = now.getFullYear();
  const month = now.getMonth();

  switch (range) {
    case 'any':
      return null;
    case 'month':
      return { start: new Date(year, month, 1), end: new Date(year, month + 1, 1) };
    case 'quarter':
      // Three calendar months INCLUDING this one, so in March it reaches back
      // to 1 January. `new Date(y, -1, 1)` rolls the year over on its own.
      return { start: new Date(year, month - 2, 1), end: new Date(year, month + 1, 1) };
    case 'year':
      return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) };
  }
}
