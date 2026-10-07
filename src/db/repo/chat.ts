import { and, desc, eq, gt, lt } from 'drizzle-orm';
import { type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import * as schema from '../schema';
import { chatMessages } from '../schema';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/**
 * The assistant's conversation on disk.
 *
 * One table, read from the END. The screen opens on the newest page and asks
 * for older ones as it scrolls up, because a conversation is append-only and
 * somebody who has used this for a year is not going to read the beginning on
 * every open. The model sees only what follows the last divider.
 */

export type ChatKind = 'user' | 'model' | 'tools' | 'divider' | 'error';

export type StoredRow = {
  seq: number;
  kind: ChatKind;
  content: unknown;
  meta: unknown;
  createdAt: Date;
};

function parse(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // A row that will not parse must not take the whole conversation with it.
    console.warn('[chat] a stored message could not be read');
    return null;
  }
}

function toRow(row: schema.ChatMessageRow): StoredRow {
  return {
    seq: row.seq,
    kind: row.kind,
    content: parse(row.content),
    meta: parse(row.meta),
    createdAt: row.createdAt,
  };
}

export function appendMessage(db: Db, kind: ChatKind, content: unknown, meta: unknown, at = new Date()): StoredRow {
  const inserted = db
    .insert(chatMessages)
    .values({
      kind,
      content: content === null || content === undefined ? null : JSON.stringify(content),
      meta: meta === null || meta === undefined ? null : JSON.stringify(meta),
      createdAt: at,
    })
    .returning()
    .get();
  return toRow(inserted);
}

export function updateMessageMeta(db: Db, seq: number, meta: unknown): void {
  db.update(chatMessages).set({ meta: JSON.stringify(meta) }).where(eq(chatMessages.seq, seq)).run();
}

export function getMessage(db: Db, seq: number): StoredRow | undefined {
  const row = db.select().from(chatMessages).where(eq(chatMessages.seq, seq)).get();
  return row ? toRow(row) : undefined;
}

/** The newest `limit` rows, oldest first, so they read top to bottom. */
export function latestMessages(db: Db, limit: number): StoredRow[] {
  return db.select().from(chatMessages).orderBy(desc(chatMessages.seq)).limit(limit).all().map(toRow).reverse();
}

/** The page above the oldest row on screen, oldest first. */
export function messagesBefore(db: Db, seq: number, limit: number): StoredRow[] {
  return db
    .select()
    .from(chatMessages)
    .where(lt(chatMessages.seq, seq))
    .orderBy(desc(chatMessages.seq))
    .limit(limit)
    .all()
    .map(toRow)
    .reverse();
}

/** Rows after `seq`, for the screen to pick up what a running turn wrote. */
export function messagesAfter(db: Db, seq: number): StoredRow[] {
  return db.select().from(chatMessages).where(gt(chatMessages.seq, seq)).orderBy(chatMessages.seq).all().map(toRow);
}

/**
 * Everything since the last reset, oldest first, capped at `limit` rows.
 *
 * The cap bounds what one request costs in tokens however long a conversation
 * runs without a reset; the caller trims the front to a clean turn boundary.
 */
export function sessionMessages(db: Db, limit: number): StoredRow[] {
  const divider = db
    .select({ seq: chatMessages.seq })
    .from(chatMessages)
    .where(eq(chatMessages.kind, 'divider'))
    .orderBy(desc(chatMessages.seq))
    .limit(1)
    .get();
  return db
    .select()
    .from(chatMessages)
    .where(divider ? and(gt(chatMessages.seq, divider.seq)) : undefined)
    .orderBy(desc(chatMessages.seq))
    .limit(limit)
    .all()
    .map(toRow)
    .reverse();
}
