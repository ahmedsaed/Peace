import type { StoredRow } from '../db/repo/chat';
import type { Part } from './gemini-chat';

/**
 * Files the user hands the assistant — a receipt photo, a PDF invoice.
 *
 * STORED ONCE, WHERE RECORD RECEIPTS ARE. A chat attachment is written to the
 * same content-addressed folder as a record's receipt (`<sha256>.<ext>`), so
 * logging it as a record is one row pointing at the file that is already
 * there — no copy, and no second file to lose. The orphan sweep and the backup
 * both ask the conversation what it refers to, as they ask the ledger.
 *
 * The bytes never live in `chat_messages`. A user row carries the file's NAME
 * in its meta; the bytes are read from disk when a request is built, and only
 * for the most recent few files — re-sending every receipt of a long
 * conversation on every step would make each question slower and dearer than
 * the last.
 */

export type ChatAttachment = {
  /** What the model calls it: short, so it copies it exactly. `file12-1`. */
  id: string;
  fileName: string;
  originalName: string | null;
  mimeType: string;
  byteSize: number;
  sha256: string;
  width: number | null;
  height: number | null;
};

/** How many files a request carries inline. Older ones are described, not sent. */
export const INLINE_ATTACHMENTS = 4;

export function attachmentsOf(row: StoredRow): ChatAttachment[] {
  if (row.kind !== 'user') return [];
  const list = (row.meta as { attachments?: ChatAttachment[] } | null)?.attachments;
  return Array.isArray(list) ? list : [];
}

/** Every file in these rows, oldest first. */
export function sessionAttachments(rows: StoredRow[]): ChatAttachment[] {
  return rows.flatMap(attachmentsOf);
}

/** The files a request sends as bytes: the newest `INLINE_ATTACHMENTS`. */
export function inlineSet(rows: StoredRow[]): Set<string> {
  return new Set(
    sessionAttachments(rows)
      .slice(-INLINE_ATTACHMENTS)
      .map((a) => a.fileName)
  );
}

function label(a: ChatAttachment): string {
  return `${a.originalName ?? (a.mimeType.startsWith('image/') ? 'photo' : 'document')} (${a.mimeType})`;
}

/**
 * A user row's parts as the model sees them.
 *
 * Each file is introduced by a line naming its id — that id is how the model
 * asks for it to be kept with a record — followed by the bytes, or by a note
 * saying the file is no longer in view. The note matters: without it the model
 * would answer questions about a receipt it cannot see as if it could.
 */
export function userParts(
  text: string,
  attachments: ChatAttachment[],
  loaded: Map<string, string>
): Part[] {
  const parts: Part[] = [];
  for (const a of attachments) {
    const data = loaded.get(a.fileName);
    if (data) {
      parts.push({ text: `[Attached file id "${a.id}": ${label(a)}]` });
      parts.push({ inlineData: { mimeType: a.mimeType, data } });
    } else {
      parts.push({
        text: `[Earlier attachment id "${a.id}": ${label(a)} — no longer in view. Its id still works for attaching it to a record; to read it again, ask the user to re-attach it.]`,
      });
    }
  }
  if (text.trim() !== '') parts.push({ text });
  if (parts.length === 0) parts.push({ text: '' });
  return parts;
}
