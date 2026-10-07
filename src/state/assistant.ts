import { fetch as streamingFetch } from 'expo/fetch';
import { create } from 'zustand';

import { chatStepStreaming } from '@/assistant/gemini-chat';
import { withRetries } from '@/assistant/retry';
import {
  ask,
  decide as decideProposal,
  recordFailure,
  reset as resetSession,
  run,
  type Deps,
  type ModelMeta,
} from '@/assistant/engine';
import { undoWrite, type Undo } from '@/assistant/tools';
import { attachmentAsBase64, type StagedAttachment } from '@/db/attachments';
import { db } from '@/db/client';
import { latestMessages, messagesBefore, type StoredRow } from '@/db/repo/chat';
import { GeminiError } from '@/lib/gemini';
import { getGeminiKey } from '@/lib/secrets';
import { useSettingsStore } from '@/state/settings';

/**
 * The assistant's conversation, in memory.
 *
 * A STORE, not screen state, for the reason the bank inbox is one: an answer
 * is a network round trip or several, and it lands whenever it lands — often
 * after the user has gone to look at the records the question was about. The
 * turn keeps running here, writes its rows to SQLite as it goes, and whatever
 * screen is showing the conversation repaints from this.
 *
 * SQLite stays the truth. `rows` is a window onto the end of it, grown
 * upwards a page at a time as the user scrolls back.
 */

export const PAGE = 30;

type PendingUndo = { undo: Undo; message: string; token: number };

type AssistantStore = {
  rows: StoredRow[];
  hasOlder: boolean;
  loaded: boolean;
  busy: boolean;
  /** What the running turn is doing, for the line under the last message. */
  activity: string | null;
  /**
   * The reply as it arrives, before it is a row. Null between steps — while a
   * tool runs there is nothing being written, and an empty bubble would say
   * otherwise.
   */
  streaming: string | null;
  pendingUndo: PendingUndo | null;
  load: () => void;
  loadOlder: () => void;
  send: (text: string, files?: StagedAttachment[]) => Promise<void>;
  retry: () => Promise<void>;
  stop: () => void;
  decide: (seq: number, index: number, approve: boolean) => Promise<void>;
  reset: () => void;
  undo: () => void;
  clearUndo: () => void;
};

let controller: AbortController | null = null;

function upsert(rows: StoredRow[], row: StoredRow): StoredRow[] {
  const at = rows.findIndex((r) => r.seq === row.seq);
  if (at < 0) return [...rows, row];
  const next = rows.slice();
  next[at] = row;
  return next;
}

export const useAssistantStore = create<AssistantStore>((set, get) => {
  function deps(apiKey: string, signal: AbortSignal): Deps {
    const settings = useSettingsStore.getState().settings;
    return {
      db,
      homeCurrency: settings.homeCurrency,
      now: () => new Date(),
      /**
       * STREAMED, through `expo/fetch`: React Native's own fetch buffers the
       * whole body, which would deliver every word at once at the end. The
       * words go to `streaming` as they arrive; the finished turn still comes
       * back whole and is stored exactly as the unstreamed path stores it.
       */
      /**
       * Retried on what passes — a rate limit, a busy model, a dropped line —
       * and said out loud while it waits, so a pause reads as "waiting on
       * Gemini" and not as the app hanging. See `assistant/retry.ts`.
       */
      step: (request) =>
        withRetries(
          () =>
            chatStepStreaming(apiKey, settings.assistantModel, request, {
              signal,
              fetchImpl: streamingFetch as unknown as typeof fetch,
              onText: (soFar) => set({ streaming: soFar }),
            }),
          {
            signal,
            onRetry: ({ waitMs }) =>
              // Whatever streamed before the failure is thrown away with it.
              set({ streaming: null, activity: `Gemini is busy — trying again in ${Math.round(waitMs / 1000)}s` }),
          }
        ),
      loadAttachment: (fileName) => attachmentAsBase64(fileName),
      onRow: (row) => {
        const activity =
          row.kind === 'model' ? ((row.meta as ModelMeta | null)?.activity?.join(' · ') ?? null) : get().activity;
        // The row now holds what was streaming, so the draft bubble goes.
        set((state) => ({ rows: upsert(state.rows, row), activity: activity ?? 'Thinking', streaming: null }));
      },
    };
  }

  /**
   * Drive the loop until it answers, parks on a proposal, or fails.
   *
   * Every failure becomes a row in the conversation — friendly sentence on
   * screen, real error in the log — because a spinner that simply stops is the
   * one outcome nobody can act on.
   */
  async function drive(): Promise<void> {
    if (get().busy) return;
    const apiKey = await getGeminiKey();
    const local = new AbortController();
    controller = local;
    set({ busy: true, activity: 'Thinking' });
    const d = deps(apiKey ?? '', local.signal);
    try {
      if (apiKey === null) throw new GeminiError('No Gemini API key is saved. Add one in Settings.');
      await run(d, local.signal);
    } catch (error) {
      if (error instanceof GeminiError) {
        recordFailure(d, error.message, error.transient);
      } else {
        console.warn('[assistant] turn failed', error);
        recordFailure(d, 'Something went wrong answering that. Try again.', true);
      }
    } finally {
      if (controller === local) controller = null;
      set({ busy: false, activity: null, streaming: null });
    }
  }

  return {
    rows: [],
    hasOlder: false,
    loaded: false,
    busy: false,
    activity: null,
    streaming: null,
    pendingUndo: null,

    load: () => {
      const rows = latestMessages(db, PAGE);
      set({ rows, hasOlder: rows.length === PAGE, loaded: true });
    },

    loadOlder: () => {
      const { rows, hasOlder } = get();
      if (!hasOlder || rows.length === 0) return;
      const older = messagesBefore(db, rows[0].seq, PAGE);
      set({ rows: [...older, ...rows], hasOlder: older.length === PAGE });
    },

    send: async (text, files = []) => {
      const trimmed = text.trim();
      if ((trimmed === '' && files.length === 0) || get().busy) return;
      const row = ask({ db, now: () => new Date() }, trimmed, files);
      set((state) => ({ rows: upsert(state.rows, row) }));
      await drive();
    },

    retry: async () => {
      await drive();
    },

    stop: () => {
      controller?.abort();
    },

    decide: async (seq, index, approve) => {
      const d = deps('', new AbortController().signal);
      const outcome = decideProposal(d, seq, index, approve);
      if (outcome.undo) {
        const n = outcome.undo.rows.filter((r) => !r.transferPairId || r.amountMinor < 0).length;
        set({
          pendingUndo: {
            undo: outcome.undo,
            message: n === 1 ? 'Record deleted' : `${n} records deleted`,
            token: Date.now(),
          },
        });
      }
      if (outcome.complete) await drive();
    },

    reset: () => {
      if (get().busy) return;
      const row = resetSession({ db, now: () => new Date() });
      set((state) => ({ rows: upsert(state.rows, row) }));
    },

    undo: () => {
      const pending = get().pendingUndo;
      if (!pending) return;
      try {
        undoWrite(db, pending.undo);
      } catch (error) {
        console.warn('[assistant] undo failed', error);
      }
      set({ pendingUndo: null });
    },

    clearUndo: () => set({ pendingUndo: null }),
  };
});
