import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { newId } from '../../lib/id';
import { periodBounds, type Period } from '../../lib/period';
import { cleanTagName, tagKey, tagNameProblem } from '../../lib/tag';
import * as schema from '../schema';
import { tags, transactionTags, transactions, type Tag } from '../schema';
import { InvariantError } from './categories';
import { movesPosition, onExpenseSide, onIncomeSide } from './predicates';
import type { CategoryKind } from './spend';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/**
 * Every tag, archived ones last only if asked for.
 *
 * Ordered by name rather than by use: a picker whose order moves as you tag
 * things means the entry you reached for last time is somewhere else now.
 */
export function listTags(db: Db, { includeArchived = false } = {}): Tag[] {
  const rows = db.select().from(tags).orderBy(asc(tags.normalised)).all();
  return includeArchived ? rows : rows.filter((tag) => !tag.archived);
}

/**
 * Get the tag with this name, creating it only if there is not one already.
 *
 * Idempotent on the KEY, not on the name: typing "Kitchen" when "kitchen"
 * exists returns the existing tag rather than a second one. That has to be
 * decided here, in the same place the row is written — a picker that checked
 * first and then inserted would race with itself on a double tap and hit the
 * unique index instead.
 */
export function ensureTag(db: Db, name: string): Tag {
  const problem = tagNameProblem(name);
  if (problem === 'empty') throw new InvariantError('A tag needs a name.');
  if (problem === 'too-long') throw new InvariantError('That name is too long for a tag.');

  const key = tagKey(name);
  const existing = db.select().from(tags).where(eq(tags.normalised, key)).get();
  // An ARCHIVED tag comes back as itself. Re-using a finished project's name is
  // almost always meant to be the same project — and creating a second one
  // would fail the unique index anyway, so the alternative is an error message
  // about a tag the picker never showed.
  if (existing) return existing;

  const id = newId();
  db.insert(tags).values({ id, name: cleanTagName(name), normalised: key }).run();
  return db.select().from(tags).where(eq(tags.id, id)).get()!;
}

/** Rename in place, so every record keeps the tag it was given. */
export function renameTag(db: Db, id: string, name: string): Tag {
  const problem = tagNameProblem(name);
  if (problem === 'empty') throw new InvariantError('A tag needs a name.');
  if (problem === 'too-long') throw new InvariantError('That name is too long for a tag.');

  const key = tagKey(name);
  const clash = db.select().from(tags).where(eq(tags.normalised, key)).get();
  // Renaming onto an existing name would MERGE two tags, which is a different
  // operation with different consequences — every record of one silently
  // becomes a record of the other. Refused rather than guessed at.
  if (clash && clash.id !== id) {
    throw new InvariantError(`There is already a tag called "${clash.name}".`);
  }

  db.update(tags)
    .set({ name: cleanTagName(name), normalised: key, updatedAt: new Date() })
    .where(eq(tags.id, id))
    .run();
  return db.select().from(tags).where(eq(tags.id, id)).get()!;
}

/**
 * Out of the picker, still on its records.
 *
 * What the end of a project needs, and the reason tags exist rather than
 * sub-categories: the spending stays part of the thing it was part of.
 */
export function setTagArchived(db: Db, id: string, archived: boolean): void {
  db.update(tags).set({ archived, updatedAt: new Date() }).where(eq(tags.id, id)).run();
}

/** The tags on one record, in the order a picker would list them. */
export function tagsForRecord(db: Db, transactionId: string): Tag[] {
  return db
    .select({
      id: tags.id,
      name: tags.name,
      normalised: tags.normalised,
      archived: tags.archived,
      createdAt: tags.createdAt,
      updatedAt: tags.updatedAt,
    })
    .from(transactionTags)
    .innerJoin(tags, eq(tags.id, transactionTags.tagId))
    .where(eq(transactionTags.transactionId, transactionId))
    .orderBy(asc(tags.normalised))
    .all();
}

/**
 * Replace a record's tags with exactly this set.
 *
 * Replace rather than add, because that is what the picker means: the sheet
 * shows what is on the record and closes with the answer. Deleting first and
 * re-inserting inside one transaction keeps the record from ever being briefly
 * untagged in a way another query could observe.
 *
 * ON THE OUTGOING LEG for a transfer — the caller passes the id every list
 * renders. Tagging both legs would double every tag total silently.
 */
export function setRecordTags(db: Db, transactionId: string, tagIds: string[]): void {
  const wanted = [...new Set(tagIds)];
  db.transaction((tx) => {
    tx.delete(transactionTags).where(eq(transactionTags.transactionId, transactionId)).run();
    if (wanted.length > 0) {
      tx.insert(transactionTags)
        .values(wanted.map((tagId) => ({ transactionId, tagId })))
        .run();
    }
  });
}

/** How many records carry each of these tags. Used to say what archiving costs. */
export function tagUsage(db: Db, tagIds: string[]): Map<string, number> {
  if (tagIds.length === 0) return new Map();
  const rows = db
    .select({ tagId: transactionTags.tagId, count: sql<number>`count(*)` })
    .from(transactionTags)
    .where(inArray(transactionTags.tagId, tagIds))
    .groupBy(transactionTags.tagId)
    .all();
  return new Map(rows.map((row) => [row.tagId, Number(row.count ?? 0)]));
}

export type TagTotal = {
  id: string;
  name: string;
  /** Unsigned, like every figure on the analysis screen. */
  amountMinor: number;
  recordCount: number;
};

/**
 * What each tag came to this month — AMOUNTS, and deliberately no percentages.
 *
 * A ring of tags is the one chart on this screen that cannot be drawn honestly.
 * Categories are exclusive and cover everything, so their slices sum to the
 * total and `sharePercents` can make them sum to exactly 100. Tags do neither:
 * a record can carry two, and most carry none, so the parts would overlap each
 * other AND leave a remainder nothing accounts for. A legend that does not add
 * up reads as a bug on a screen whose whole job is accounting for money.
 *
 * So this is a ranked LIST. To see a tag as a ring, filter the screen by it —
 * within any filter, categories are still exclusive and still sum to 100%.
 *
 * Transfers and corrections are out, exactly as they are out of the ring above:
 * a tag on money moved between your own accounts is a real and useful label,
 * but it is not spending, and counting it here would put a number on this
 * screen that no other screen agrees with.
 */
export function tagBreakdown(
  db: Db,
  period: Period,
  kind: CategoryKind,
  homeCurrency = 'EGP'
): TagTotal[] {
  const { start, end } = periodBounds(period);
  const home = sql`${homeCurrency.toUpperCase()}`;
  const valued = sql<number>`case when upper(coalesce(${transactions.homeCurrency}, ${transactions.currency})) = ${home}
      then coalesce(${transactions.homeAmountMinor}, ${transactions.amountMinor}) else null end`;
  const direction = kind === 'expense' ? onExpenseSide() : onIncomeSide();

  const rows = db
    .select({
      id: tags.id,
      name: tags.name,
      total: sql<number>`coalesce(sum(${valued}), 0)`,
      recordCount: sql<number>`count(*)`,
    })
    .from(transactionTags)
    .innerJoin(tags, eq(tags.id, transactionTags.tagId))
    .innerJoin(transactions, eq(transactions.id, transactionTags.transactionId))
    .where(
      and(
        sql`${transactions.occurredAt} >= ${start.getTime()}`,
        sql`${transactions.occurredAt} < ${end.getTime()}`,
        movesPosition(),
        direction
      )
    )
    .groupBy(tags.id)
    .all();

  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      amountMinor: Math.abs(Number(row.total ?? 0)),
      recordCount: Number(row.recordCount ?? 0),
    }))
    .filter((row) => row.amountMinor !== 0)
    // Biggest first, ties broken by name so the same data never reorders itself
    // between two renders.
    .sort((a, b) => b.amountMinor - a.amountMinor || a.name.localeCompare(b.name));
}
