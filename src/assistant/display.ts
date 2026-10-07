import type { StoredRow } from '../db/repo/chat';
import { attachmentsOf, type ChatAttachment } from './attachments';
import type { ErrorMeta, ModelMeta, Proposal, ToolsMeta } from './engine';
import type { Figure } from './figures';
import { textOf, type Content } from './gemini-chat';
import type { Display } from './tools/types';

/**
 * Stored rows into what the screen lists.
 *
 * The rows are Gemini's own turns; the screen wants something else — a user
 * bubble, a reply, a chart, a card asking for approval. One model row can be
 * several of those (some prose, then a call that drew a chart), and a tools
 * row is invisible apart from what it drew. Pure, so the mapping is tested
 * rather than discovered on a device.
 */

export type Item =
  | { type: 'user'; key: string; text: string; at: Date; files: ChatAttachment[] }
  | { type: 'reply'; key: string; text: string; figures: Record<string, Figure> }
  | { type: 'activity'; key: string; labels: string[] }
  | { type: 'proposal'; key: string; seq: number; proposal: Proposal; expired: boolean }
  | { type: 'display'; key: string; display: Display }
  | { type: 'divider'; key: string; at: Date }
  | { type: 'error'; key: string; message: string; retryable: boolean };

export function toItems(rows: StoredRow[]): Item[] {
  const items: Item[] = [];
  // A card left undecided when the conversation was reset belongs to a turn
  // nothing will ever resume. Approving it would change the ledger with no
  // model to tell and no reply to explain it, so it is shown as expired.
  const lastDivider = rows.reduce((seq, row) => (row.kind === 'divider' ? row.seq : seq), -1);

  rows.forEach((row) => {
    const key = String(row.seq);
    switch (row.kind) {
      case 'user': {
        const text = textOf(row.content as Content);
        const files = attachmentsOf(row);
        if (text || files.length > 0) items.push({ type: 'user', key, text, at: row.createdAt, files });
        break;
      }
      case 'model': {
        const meta = (row.meta ?? {}) as ModelMeta;
        const text = textOf(row.content as Content);
        if (text) items.push({ type: 'reply', key: `${key}:text`, text, figures: meta.figures ?? {} });
        if (meta.activity && meta.activity.length > 0) {
          items.push({ type: 'activity', key: `${key}:activity`, labels: meta.activity });
        }
        // A proposal refused before it reached the user has nothing to approve;
        // the model's next words explain it.
        for (const proposal of meta.proposals ?? []) {
          if (proposal.preview.title === '') continue;
          items.push({
            type: 'proposal',
            key: `${key}:p${proposal.index}`,
            seq: row.seq,
            proposal,
            expired: proposal.status === 'pending' && row.seq < lastDivider,
          });
        }
        break;
      }
      case 'tools': {
        const meta = (row.meta ?? { displays: [] }) as ToolsMeta;
        meta.displays.forEach((display, i) => items.push({ type: 'display', key: `${key}:d${i}`, display }));
        break;
      }
      case 'divider':
        items.push({ type: 'divider', key, at: row.createdAt });
        break;
      case 'error': {
        const meta = (row.meta ?? {}) as ErrorMeta;
        items.push({ type: 'error', key, message: meta.message ?? 'Something went wrong.', retryable: !!meta.retryable });
        break;
      }
    }
  });

  return items;
}

/**
 * Whether the conversation is stuck on a failure the user can retry: an error
 * is the last thing that happened, with no newer question after it.
 */
export function canRetry(rows: StoredRow[]): boolean {
  const last = rows.at(-1);
  return last?.kind === 'error' && !!(last.meta as ErrorMeta | null)?.retryable;
}

/** True when nothing has been said since the last reset — the screen offers starters. */
export function sessionIsEmpty(rows: StoredRow[]): boolean {
  const last = rows.at(-1);
  return last === undefined || last.kind === 'divider';
}
