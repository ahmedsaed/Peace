import { fetch as streamingFetch } from 'expo/fetch';
import { create } from 'zustand';

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
import { chatStepStreaming } from '@/ai';
import { AiError } from '@/ai/error';
import { endpointForJob } from '@/ai/job';
import { readDocument } from '@/ai/read';
import { isTextMime } from '@/lib/attachment';
import type { Content } from '@/ai/content';
import { PROVIDERS, type Endpoint, type ProviderId } from '@/ai/providers';
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

/**
 * Whether the conversation since the last divider has turns another provider
 * wrote. Translating it works almost always; when the new provider refuses it
 * anyway, the way out is a new conversation, and the failure says so.
 */
function startedElsewhere(rows: StoredRow[], provider: ProviderId): boolean {
  const since = rows.slice(rows.findLastIndex((r) => r.kind === 'divider') + 1);
  return since.some(
    (r) => r.kind === 'model' && ((r.content as Content | null)?.native?.provider ?? 'gemini') !== provider
  );
}

/**
 * Files Penny's own model will not see, read into text by her files model.
 *
 * Only when the two are DIFFERENT models: the same one sees the file itself,
 * which is better than any description of it. A file that cannot be read goes
 * with the reason in its place, so Penny says so rather than inventing it.
 */
async function readForPenny(
  files: StagedAttachment[],
  say: (activity: string | null) => void
): Promise<(StagedAttachment & { reading?: string })[]> {
  const { pennyModel, pennyFilesModel } = useSettingsStore.getState().settings;
  if (files.length === 0 || pennyFilesModel === '' || pennyFilesModel === pennyModel) return files;
  const job = await endpointForJob(pennyFilesModel, 'read files for Penny');
  const out: (StagedAttachment & { reading?: string })[] = [];
  for (const file of files) {
    if (isTextMime(file.mimeType)) {
      out.push(file);
      continue;
    }
    say('Reading the attachment');
    let reading: string;
    try {
      if ('problem' in job) throw new AiError(job.problem);
      reading = await readDocument(job.endpoint, await attachmentAsBase64(file.fileName), file.mimeType);
    } catch (error) {
      if (!(error instanceof AiError)) console.warn('[assistant] reading an attachment failed', error);
      reading = `(It could not be read: ${error instanceof AiError ? error.message : 'something went wrong'})`;
    }
    out.push({ ...file, reading });
  }
  say(null);
  return out;
}

export const useAssistantStore = create<AssistantStore>((set, get) => {
  function deps(endpoint: Endpoint, signal: AbortSignal): Deps {
    const settings = useSettingsStore.getState().settings;
    return {
      db,
      homeCurrency: settings.homeCurrency,
      rules: settings.assistantGuidance,
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
            chatStepStreaming(endpoint, request, {
              signal,
              fetchImpl: streamingFetch as unknown as typeof fetch,
              onText: (soFar) => set({ streaming: soFar }),
            }),
          {
            signal,
            provider: PROVIDERS[endpoint.provider].name,
            onRetry: ({ waitMs }) =>
              // Whatever streamed before the failure is thrown away with it.
              set({ streaming: null, activity: `${PROVIDERS[endpoint.provider].name} is busy — trying again in ${Math.round(waitMs / 1000)}s`,
              }),
          }
        ),
      loadAttachment: (fileName) => attachmentAsBase64(fileName),
      onRow: (row) => {
        // What is happening NOW, read from the row just written. A model row
        // with calls means those tools are running; once their answers are in
        // (a tools row) the wait is Penny thinking about them — showing the last
        // tool's name there left "Writing a report…" on screen while the reply
        // was being written.
        const activity =
          row.kind === 'model' ? ((row.meta as ModelMeta | null)?.activity?.join(' · ') ?? null) : null;
        // The row now holds what was streaming, so the draft bubble goes.
        set((state) => ({ rows: upsert(state.rows, row), activity: activity ?? 'Penny is thinking', streaming: null }));
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
    const job = await endpointForJob(useSettingsStore.getState().settings.pennyModel, 'talk to Penny');
    const local = new AbortController();
    controller = local;
    set({ busy: true, activity: 'Penny is thinking' });
    const d = deps('endpoint' in job ? job.endpoint : { provider: 'gemini', apiKey: '', model: '' }, local.signal);
    try {
      if ('problem' in job) throw new AiError(job.problem);
      await run(d, local.signal);
    } catch (error) {
      if (error instanceof AiError) {
        const switched = 'endpoint' in job && !error.transient && startedElsewhere(get().rows, job.endpoint.provider);
        recordFailure(
          d,
          switched
            ? `${error.message} This conversation began with another provider — if it keeps failing, start a new one.`
            : error.message,
          error.transient
        );
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
      const read = await readForPenny(files, (activity) => set({ activity }));
      const row = ask({ db, now: () => new Date() }, trimmed, read);
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
      // Deciding never calls a model, so it needs no endpoint.
      const d = deps({ provider: 'gemini', apiKey: '', model: '' }, new AbortController().signal);
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
