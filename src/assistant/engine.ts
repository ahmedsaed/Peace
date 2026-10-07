import { accounts, categories, tags } from '../db/schema';
import {
  appendMessage,
  getMessage,
  sessionMessages,
  updateMessageMeta,
  type StoredRow,
} from '../db/repo/chat';
import { decimalsFor } from '../lib/money';
import { citedFigures, FigureBook, type Figure } from './figures';
import { callsOf, textOf, type Content, type FunctionCall, type Part } from './gemini-chat';
import { systemPrompt } from './prompt';
import {
  applyWrite,
  declarations,
  findTool,
  isWrite,
  prepareWrite,
  runRead,
  type Display,
  type Preview,
  type Undo,
} from './tools';
import type { Db, ToolContext } from './tools/types';

/**
 * The conversation loop.
 *
 * STATE LIVES ON DISK, NOT IN THIS FUNCTION. Every step writes its row before
 * the next one starts, and `run` works out what to do next by reading the
 * session back — so a turn interrupted by the app being killed, or one parked
 * on a proposal for a week, resumes from exactly where it stopped. There is no
 * in-memory "where were we" to lose.
 *
 * The shape of one turn:
 *
 *   user ─▶ model ─(calls)─▶ tools ─▶ model ─(calls)─▶ tools ─▶ model (prose)
 *
 * A model row whose calls include a WRITE stops the loop with its proposals
 * `pending`. Nothing else moves until every one is decided; then the reads in
 * that batch run, the decisions are written up as one tools row, and the loop
 * picks up again. Gemini wants every call in a batch answered together, which
 * is also why a batch is never half-executed.
 */

export const MAX_STEPS = 8;
/** Rows of history sent per request — bounds the cost of a long session. */
export const CONTEXT_ROWS = 80;

export type ProposalStatus = 'pending' | 'approved' | 'declined' | 'failed';

export type Proposal = {
  /** Position of the call within the model row's calls. */
  index: number;
  call: FunctionCall;
  preview: Preview;
  status: ProposalStatus;
  /** What applying it said, for a failed one. */
  error?: string;
};

export type ModelMeta = {
  figures?: Record<string, Figure>;
  activity?: string[];
  proposals?: Proposal[];
};

export type ToolsMeta = {
  figures: Record<string, Figure>;
  displays: Display[];
};

export type ErrorMeta = { message: string; retryable: boolean };

export type Deps = {
  db: Db;
  homeCurrency: string;
  now: () => Date;
  /** One request to the model. Injected so tests can script it. */
  step: (request: { system: string; contents: Content[]; tools: ReturnType<typeof declarations> }) => Promise<Content>;
  /** Called after every row is written, so the screen can repaint. */
  onRow?: (row: StoredRow) => void;
};

export type RunResult = 'done' | 'awaiting' | 'stopped';

function write(deps: Deps, kind: StoredRow['kind'], content: unknown, meta: unknown): StoredRow {
  const row = appendMessage(deps.db, kind, content, meta, deps.now());
  deps.onRow?.(row);
  return row;
}

/** Every figure registered this session, for resolving what a reply cites. */
function knownFigures(session: StoredRow[]): Map<string, Figure> {
  const known = new Map<string, Figure>();
  for (const row of session) {
    const figures = (row.meta as { figures?: Record<string, Figure> } | null)?.figures;
    if (!figures) continue;
    for (const [ref, figure] of Object.entries(figures)) known.set(ref, figure);
  }
  return known;
}

/**
 * The session as Gemini contents.
 *
 * Errors and dividers never reach the model. The front is trimmed to the first
 * USER TEXT row, because a history that opens on a function response (the cap
 * having cut its call off) is rejected outright.
 */
export function toContents(session: StoredRow[]): Content[] {
  const sendable = session.filter((row) => row.kind === 'user' || row.kind === 'model' || row.kind === 'tools');
  const first = sendable.findIndex((row) => row.kind === 'user');
  if (first < 0) return [];
  return sendable.slice(first).map((row) => row.content as Content);
}

function context(deps: Deps, prefix: string, known: Map<string, Figure>): ToolContext {
  return {
    db: deps.db,
    homeCurrency: deps.homeCurrency,
    now: deps.now(),
    figures: new FigureBook(prefix, decimalsFor, known),
  };
}

function shape(db: Db) {
  return {
    accounts: db.select().from(accounts).all(),
    categories: db.select().from(categories).all(),
    tags: db.select().from(tags).all(),
  };
}

/**
 * Answer every call in a model row and write the answers as one tools row.
 *
 * Reads run NOW, at the moment the batch is complete — not when the model
 * asked — so a chart drawn after an approved re-categorisation shows the
 * ledger the user just approved, not the one before it.
 */
function answerCalls(deps: Deps, modelRow: StoredRow, known: Map<string, Figure>): StoredRow {
  const calls = callsOf(modelRow.content as Content);
  const meta = (modelRow.meta ?? {}) as ModelMeta;
  const ctx = context(deps, `t${modelRow.seq}`, known);
  const displays: Display[] = [];

  const parts: Part[] = calls.map((call, index) => {
    let response: Record<string, unknown>;
    if (isWrite(call.name)) {
      const proposal = meta.proposals?.find((p) => p.index === index);
      if (!proposal) {
        response = { error: 'This change was not offered to the user.' };
      } else if (proposal.status === 'approved') {
        response = { approved: true, done: true };
      } else if (proposal.status === 'declined') {
        response = { approved: false, declined_by_user: true };
      } else if (proposal.status === 'failed') {
        response = { approved: true, error: proposal.error ?? 'It could not be applied.' };
      } else {
        response = { error: 'Still waiting for the user.' };
      }
    } else {
      const outcome = runRead(call, ctx);
      response = outcome.response;
      if (outcome.display) displays.push(outcome.display);
    }
    return {
      functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response },
    };
  });

  return write(deps, 'tools', { role: 'user', parts }, { figures: ctx.figures.registered(), displays } satisfies ToolsMeta);
}

/**
 * Record a model turn. A batch with no writes is answered straight away; one
 * with writes gets its proposals prepared and the loop parks.
 */
function recordModelTurn(
  deps: Deps,
  content: Content,
  known: Map<string, Figure>
): { row: StoredRow; parked: boolean } {
  const calls = callsOf(content);
  const text = textOf(content);
  const lookup = (ref: string) => known.get(ref);
  const meta: ModelMeta = {
    ...(text ? { figures: citedFigures(text, lookup) } : {}),
    ...(calls.length > 0
      ? { activity: [...new Set(calls.map((c) => findTool(c.name)?.activity ?? c.name))] }
      : {}),
  };

  const writes = calls.map((call, index) => ({ call, index })).filter(({ call }) => isWrite(call.name));
  if (writes.length === 0) return { row: write(deps, 'model', content, meta), parked: false };

  // Prepared against a context whose figures are thrown away: a preview's
  // amounts are rendered from the preview itself, never cited.
  const ctx = context(deps, 'preview', known);
  const proposals: Proposal[] = writes.map(({ call, index }) => {
    const prepared = prepareWrite(call, ctx);
    if ('error' in prepared) {
      // Refused before it reached the user — the model gets the reason and no
      // card is shown for something that could never have been approved.
      return {
        index,
        call,
        preview: { title: '', lines: [], danger: false, confirmLabel: '' },
        status: 'failed' as const,
        error: prepared.error,
      };
    }
    return { index, call, preview: prepared.preview, status: 'pending' as const };
  });

  const row = write(deps, 'model', content, { ...meta, proposals });
  return { row, parked: proposals.some((p) => p.status === 'pending') };
}

/** Where a session stands, read from its last meaningful row. */
function lastMeaningful(session: StoredRow[]): StoredRow | undefined {
  for (let i = session.length - 1; i >= 0; i--) {
    if (session[i].kind !== 'error') return session[i];
  }
  return undefined;
}

export async function run(deps: Deps, signal?: AbortSignal): Promise<RunResult> {
  for (let steps = 0; ; ) {
    if (signal?.aborted) return 'stopped';

    const session = sessionMessages(deps.db, CONTEXT_ROWS);
    const known = knownFigures(session);
    const last = lastMeaningful(session);
    if (!last || last.kind === 'divider') return 'done';

    if (last.kind === 'model') {
      const calls = callsOf(last.content as Content);
      if (calls.length === 0) return 'done';
      const proposals = ((last.meta ?? {}) as ModelMeta).proposals ?? [];
      if (proposals.some((p) => p.status === 'pending')) return 'awaiting';
      answerCalls(deps, last, known);
      continue;
    }

    // A user message or a tools row: the model's turn.
    if (steps >= MAX_STEPS) {
      write(deps, 'error', null, {
        message: `Stopped after ${MAX_STEPS} steps without an answer. Try a narrower question.`,
        retryable: true,
      } satisfies ErrorMeta);
      return 'done';
    }
    steps++;

    const content = await deps.step({
      system: systemPrompt(deps.now(), deps.homeCurrency, shape(deps.db)),
      contents: toContents(session),
      tools: declarations(),
    });
    if (signal?.aborted) return 'stopped';

    const { parked } = recordModelTurn(deps, content, known);
    if (parked) return 'awaiting';
  }
}

/**
 * Approve or decline one proposal.
 *
 * Applying happens HERE, synchronously, on the tap — not later in `run`. The
 * user tapped Approve on a card describing one thing; if the write fails, the
 * card has to say so right there rather than the failure surfacing two steps
 * later in a reply.
 *
 * Returns whatever the write left behind to undo, and whether the batch is now
 * complete (in which case the caller resumes `run`).
 */
export function decide(
  deps: Deps,
  seq: number,
  index: number,
  approve: boolean
): { complete: boolean; undo?: Undo; error?: string } {
  const row = getMessage(deps.db, seq);
  if (!row || row.kind !== 'model') return { complete: false };
  const meta = (row.meta ?? {}) as ModelMeta;
  const proposal = meta.proposals?.find((p) => p.index === index);
  // Already decided — a double tap, or a second device. Do nothing twice.
  if (!proposal || proposal.status !== 'pending') {
    return { complete: !meta.proposals?.some((p) => p.status === 'pending') };
  }

  let undo: Undo | undefined;
  if (approve) {
    const ctx = context(deps, 'apply', new Map());
    const outcome = applyWrite(proposal.call, ctx);
    const error = outcome.response.error;
    if (typeof error === 'string') {
      proposal.status = 'failed';
      proposal.error = error;
    } else {
      proposal.status = 'approved';
      undo = outcome.undo;
    }
  } else {
    proposal.status = 'declined';
  }

  updateMessageMeta(deps.db, seq, meta);
  const updated = getMessage(deps.db, seq);
  if (updated) deps.onRow?.(updated);
  return {
    complete: !meta.proposals?.some((p) => p.status === 'pending'),
    undo,
    error: proposal.status === 'failed' ? proposal.error : undefined,
  };
}

/** Start a turn from what the user typed. */
export function ask(deps: Deps, text: string): StoredRow {
  return write(deps, 'user', { role: 'user', parts: [{ text }] }, null);
}

export function reset(deps: Deps): StoredRow {
  return write(deps, 'divider', null, null);
}

export function recordFailure(deps: Deps, message: string, retryable: boolean): StoredRow {
  return write(deps, 'error', null, { message, retryable } satisfies ErrorMeta);
}
