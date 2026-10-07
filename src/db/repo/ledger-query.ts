import { and, eq, gte, lt, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { likePattern } from '../../lib/search-query';
import * as schema from '../schema';
import { accounts, categories, tags, transactionTags, transactions } from '../schema';
import { countsAsSpending, ledgerSide } from './predicates';
import { homeValue } from './records';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/**
 * The assistant's one way into the ledger's spending.
 *
 * WHY NOT `searchRecords`. Search answers "which rows", capped at 300 and with
 * date ranges limited to the presets its chips offer. The assistant asks "how
 * much, grouped how", over any span somebody can name — "December", "since
 * March", "last year". Grouping has to happen in JAVASCRIPT anyway (SQLite's
 * `localtime` reads the process timezone, so an 11pm purchase lands in the
 * wrong month on CI), so this returns one lean fact per row and leaves the
 * bucketing to `lib/aggregate.ts`, which is pure and tested.
 *
 * ONLY SPENDING. `countsAsSpending` drops transfer legs and balance
 * corrections, exactly as every total on every screen does — and the SIDE is
 * decided by `ledgerSide`, never by the sign, so a refund nets against the
 * category it came back to instead of reading as income. Those two rules are
 * the whole reason the model is never given SQL of its own.
 */

export type LedgerFilter = {
  /** Half-open [start, end) on local calendar boundaries. Null is unbounded. */
  start: Date | null;
  end: Date | null;
  /** A parent matches its sub-categories, as it does in search. */
  categoryId?: string | null;
  tagId?: string | null;
  accountId?: string | null;
  /** Matched against the note, category, account and tag names. */
  text?: string;
};

export type LedgerFact = {
  id: string;
  occurredAt: Date;
  side: 'expense' | 'income';
  isRefund: boolean;
  /** Signed as stored, in the home currency. Null when it cannot be valued. */
  valueMinor: number | null;
  /** As stored, in the record's own currency — for display, never for a sum. */
  amountMinor: number;
  currency: string;
  categoryId: string | null;
  categoryName: string | null;
  /** The top of the category's branch: the parent, or itself. */
  topCategoryId: string | null;
  topCategoryName: string | null;
  accountId: string;
  accountName: string;
  note: string | null;
  tagIds: string[];
  tagNames: string[];
};

function conditions(filter: LedgerFilter): SQL[] {
  const where: SQL[] = [countsAsSpending()];

  if (filter.start) where.push(gte(transactions.occurredAt, filter.start));
  if (filter.end) where.push(lt(transactions.occurredAt, filter.end));
  if (filter.accountId) where.push(eq(transactions.accountId, filter.accountId));

  if (filter.categoryId) {
    where.push(
      sql`${transactions.categoryId} in (
        select ${categories.id} from ${categories}
        where ${categories.id} = ${filter.categoryId} or ${categories.parentId} = ${filter.categoryId}
      )`
    );
  }

  if (filter.tagId) {
    where.push(
      sql`exists (select 1 from ${transactionTags}
            where ${transactionTags.transactionId} = ${transactions.id}
              and ${transactionTags.tagId} = ${filter.tagId})`
    );
  }

  const text = filter.text?.trim() ?? '';
  if (text !== '') {
    // Same escaping as search, for the same reason: "50%" must not match the
    // entire ledger while looking like an ordinary search.
    const pattern = likePattern(text);
    const like = (column: SQLWrapper) => sql`${column} like ${pattern} escape '\\'`;
    where.push(
      sql`(${like(sql`coalesce(${transactions.note}, '')`)}
        or ${like(sql`coalesce(${categories.name}, '')`)}
        or ${like(sql`coalesce(parent_category.name, '')`)}
        or ${like(accounts.name)}
        or exists (select 1 from ${transactionTags}
              join ${tags} on ${tags.id} = ${transactionTags.tagId}
              where ${transactionTags.transactionId} = ${transactions.id}
                and ${tags.name} like ${pattern} escape '\\'))`
    );
  }

  return where;
}

/** Tag ids and names for a row, newline-joined in one correlated subquery. */
const tagPairs = sql<string | null>`(
  select group_concat(${tags.id} || char(9) || ${tags.name}, char(10)) from ${transactionTags}
  join ${tags} on ${tags.id} = ${transactionTags.tagId}
  where ${transactionTags.transactionId} = ${transactions.id}
)`;

export function ledgerFacts(db: Db, filter: LedgerFilter, homeCurrency = 'EGP'): LedgerFact[] {
  const rows = db
    .select({
      id: transactions.id,
      occurredAt: transactions.occurredAt,
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
      isRefund: transactions.isRefund,
      isAdjustment: transactions.isAdjustment,
      transferPairId: transactions.transferPairId,
      valueMinor: homeValue(homeCurrency),
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      parentId: categories.parentId,
      parentName: sql<string | null>`parent_category.name`,
      accountId: transactions.accountId,
      accountName: accounts.name,
      note: transactions.note,
      tagPairs,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(
      sql`${categories} as parent_category`,
      sql`parent_category.id = ${categories.parentId}`
    )
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(...conditions(filter)))
    .orderBy(transactions.occurredAt)
    .all();

  const facts: LedgerFact[] = [];
  for (const row of rows) {
    const side = ledgerSide(row);
    // `countsAsSpending` is THE rule, and it already excluded both. Skipping
    // them again here would be a second copy that hides the first one being
    // broken — so a row that gets this far is a bug, and says so.
    if (side !== 'expense' && side !== 'income') {
      throw new Error(`ledgerFacts: a ${side} row passed countsAsSpending`);
    }

    const pairs = (row.tagPairs ? row.tagPairs.split('\n') : [])
      .map((pair) => pair.split('\t'))
      // By NAME, as every picker lists them — the joined string starts with the
      // id, so sorting it whole would order tags by their random ids.
      // Lower-cased rather than `localeCompare`, so Hermes and Node agree.
      .sort((a, b) => {
        const x = (a[1] ?? '').toLowerCase();
        const y = (b[1] ?? '').toLowerCase();
        return x < y ? -1 : x > y ? 1 : 0;
      });
    facts.push({
      id: row.id,
      occurredAt: row.occurredAt,
      side,
      isRefund: row.isRefund,
      valueMinor: row.valueMinor === null ? null : Number(row.valueMinor),
      amountMinor: row.amountMinor,
      currency: row.currency,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      topCategoryId: row.parentId ?? row.categoryId,
      topCategoryName: row.parentId ? row.parentName : row.categoryName,
      accountId: row.accountId,
      accountName: row.accountName,
      note: row.note,
      tagIds: pairs.map((pair) => pair[0]),
      tagNames: pairs.map((pair) => pair[1] ?? ''),
    });
  }
  return facts;
}
