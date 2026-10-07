/**
 * @jest-environment node
 */
import { appendMessage, latestMessages, messagesBefore, sessionMessages } from '../db/repo/chat';
import { getRecord } from '../db/repo/transactions';
import { transactions } from '../db/schema';
import { ask, CONTEXT_ROWS, decide, MAX_STEPS, reset, run, toContents, type Deps, type ModelMeta, type ToolsMeta } from './engine';
import type { Content, Part } from './gemini-chat';
import { buildLedger, NOW, type Ledger } from './test-ledger';

/**
 * A scripted model. Each entry is either the parts to answer with, or a
 * function of the request — so a test can read the tool results it was sent
 * and cite them, exactly as the real model has to.
 */
type Script = (Part[] | ((contents: Content[], system: string) => Part[]))[];

function scripted(script: Script) {
  const requests: { contents: Content[]; system: string }[] = [];
  const step: Deps['step'] = async ({ contents, system }) => {
    requests.push({ contents: structuredClone(contents), system });
    const next = script.shift();
    if (!next) throw new Error('the model was asked more often than scripted');
    const parts = typeof next === 'function' ? next(contents, system) : next;
    return { role: 'model', parts };
  };
  return { step, requests };
}

let ledger: Ledger;
beforeEach(() => {
  ledger = buildLedger();
});

function deps(step: Deps['step']): Deps {
  return { db: ledger.db, homeCurrency: 'EGP', now: () => NOW, step };
}

const call = (name: string, args: Record<string, unknown>, extra: Partial<Part> = {}): Part => ({
  functionCall: { name, args },
  ...extra,
});

/** The cite token for `field` in the newest function response of `name`. */
function citeIn(contents: Content[], name: string, field: string): string {
  for (const content of [...contents].reverse()) {
    for (const part of content.parts) {
      if (part.functionResponse?.name === name) {
        return (part.functionResponse.response[field] as { cite: string }).cite;
      }
    }
  }
  throw new Error(`no ${name} response`);
}

describe('a read-only turn', () => {
  it('runs the tool, feeds the result back, and stores a reply that cites it', async () => {
    const { step, requests } = scripted([
      [call('summarize', { measure: 'expense', category: 'Fuel', month: '2025-12' })],
      (contents) => [{ text: `Fuel cost you ${citeIn(contents, 'summarize', 'total')} in December 2025.` }],
    ]);
    const d = deps(step);
    ask(d, 'How much did gas cost me in December?');
    expect(await run(d)).toBe('done');

    // The second request carried the function response back to the model.
    const answered = requests[1].contents.at(-1)!;
    expect(answered.role).toBe('user');
    expect(answered.parts[0].functionResponse?.name).toBe('summarize');

    const rows = sessionMessages(ledger.db, 50);
    expect(rows.map((r) => r.kind)).toEqual(['user', 'model', 'tools', 'model']);
    const reply = rows.at(-1)!;
    // The figure travels with the reply, so rendering it later needs nothing else.
    expect(Object.values((reply.meta as ModelMeta).figures!)).toEqual([{ minor: 150000, currency: 'EGP' }]);
    expect((rows[1].meta as ModelMeta).activity).toEqual(['Adding up']);
  });

  it('tells the model today’s date and every category id', async () => {
    const { step, requests } = scripted([[{ text: 'Hello.' }]]);
    ask(deps(step), 'hi');
    await run(deps(step));
    expect(requests[0].system).toContain('Wednesday 2026-10-07');
    expect(requests[0].system).toContain('Fuel [seed:cat:fuel]');
  });

  it('keeps a chart a tool drew with the tools row, for the screen', async () => {
    const { step } = scripted([
      [call('show_chart', { title: 'Coffee', measure: 'expense', group_by: 'month', category: 'Coffee', from: '2026-08', to: '2026-10' })],
      [{ text: 'There it is.' }],
    ]);
    ask(deps(step), 'coffee month to month');
    await run(deps(step));
    const tools = sessionMessages(ledger.db, 50).find((r) => r.kind === 'tools')!;
    const [display] = (tools.meta as ToolsMeta).displays;
    expect(display.kind).toBe('chart');
  });

  it('replays the model’s parts verbatim, thought signatures included', async () => {
    const { step, requests } = scripted([
      [call('get_balances', {}, { thoughtSignature: 'c2lnbmF0dXJl' })],
      [{ text: 'Done.' }],
    ]);
    ask(deps(step), 'balances?');
    await run(deps(step));
    const replayed = requests[1].contents.find((c) => c.role === 'model')!;
    expect(replayed.parts[0].thoughtSignature).toBe('c2lnbmF0dXJl');
  });

  it('answers a parallel batch in one row, in call order', async () => {
    const { step, requests } = scripted([
      [call('get_balances', {}), call('list_recurring', {})],
      [{ text: 'ok' }],
    ]);
    ask(deps(step), 'overview');
    await run(deps(step));
    const answers = requests[1].contents.at(-1)!.parts.map((p) => p.functionResponse?.name);
    expect(answers).toEqual(['get_balances', 'list_recurring']);
  });

  it('gives up after MAX_STEPS rather than looping forever', async () => {
    const script: Script = Array.from({ length: MAX_STEPS }, () => [call('get_balances', {})]);
    const { step } = scripted(script);
    ask(deps(step), 'loop');
    expect(await run(deps(step))).toBe('done');
    const last = sessionMessages(ledger.db, 100).at(-1)!;
    expect(last.kind).toBe('error');
    expect((last.meta as { retryable: boolean }).retryable).toBe(true);
  });
});

describe('a write', () => {
  const deleteShoes = (ids: Record<string, string>) => [call('delete_records', { ids: [ids.shoes] })];

  it('parks on a proposal and touches nothing until it is approved', async () => {
    const { step, requests } = scripted([deleteShoes(ledger.ids), [{ text: 'Deleted.' }]]);
    const d = deps(step);
    ask(d, 'delete the shoes');
    expect(await run(d)).toBe('awaiting');
    expect(getRecord(ledger.db, ledger.ids.shoes)).toBeDefined();
    expect(requests).toHaveLength(1);

    // Running again while it waits does nothing at all.
    expect(await run(d)).toBe('awaiting');

    const model = sessionMessages(ledger.db, 50).find((r) => r.kind === 'model')!;
    const [proposal] = (model.meta as ModelMeta).proposals!;
    expect(proposal.status).toBe('pending');
    expect(proposal.preview.danger).toBe(true);

    const outcome = decide(d, model.seq, proposal.index, true);
    expect(outcome.complete).toBe(true);
    expect(outcome.undo?.kind).toBe('records');
    expect(getRecord(ledger.db, ledger.ids.shoes)).toBeUndefined();

    expect(await run(d)).toBe('done');
    const told = requests[1].contents.at(-1)!.parts[0].functionResponse!.response;
    expect(told).toEqual({ approved: true, done: true });
  });

  it('tells the model when the user declined, and leaves the ledger alone', async () => {
    const { step, requests } = scripted([deleteShoes(ledger.ids), [{ text: 'Left it.' }]]);
    const d = deps(step);
    ask(d, 'delete the shoes');
    await run(d);
    const model = sessionMessages(ledger.db, 50).find((r) => r.kind === 'model')!;
    decide(d, model.seq, 0, false);
    await run(d);
    expect(getRecord(ledger.db, ledger.ids.shoes)).toBeDefined();
    expect(requests[1].contents.at(-1)!.parts[0].functionResponse!.response).toEqual({
      approved: false,
      declined_by_user: true,
    });
  });

  it('does not apply twice when Approve is tapped twice', async () => {
    const { step } = scripted([[call('create_tag', { name: 'Once' })], [{ text: 'ok' }]]);
    const d = deps(step);
    ask(d, 'tag');
    await run(d);
    const model = sessionMessages(ledger.db, 50).find((r) => r.kind === 'model')!;
    decide(d, model.seq, 0, true);
    expect(decide(d, model.seq, 0, true)).toEqual({ complete: true });
  });

  it('refuses a proposal left pending across a reset', async () => {
    const { step } = scripted([deleteShoes(ledger.ids)]);
    const d = deps(step);
    ask(d, 'delete the shoes');
    await run(d);
    const model = sessionMessages(ledger.db, 50).find((r) => r.kind === 'model')!;
    reset(d);
    expect(decide(d, model.seq, 0, true).error).toMatch(/reset/);
    expect(getRecord(ledger.db, ledger.ids.shoes)).toBeDefined();
  });

  it('runs the reads in a mixed batch only once every write is decided', async () => {
    const before = ledger.db.select().from(transactions).all().length;
    const { step, requests } = scripted([
      [call('create_record', { type: 'expense', amount: 10, account: 'Cash' }), call('summarize', { measure: 'expense', month: '2026-10' })],
      [{ text: 'ok' }],
    ]);
    const d = deps(step);
    ask(d, 'add and total');
    await run(d);
    const model = sessionMessages(ledger.db, 50).find((r) => r.kind === 'model')!;
    decide(d, model.seq, 0, true);
    await run(d);
    expect(ledger.db.select().from(transactions).all()).toHaveLength(before + 1);
    // The total was computed AFTER the approved record went in.
    const summary = requests[1].contents.at(-1)!.parts[1].functionResponse!.response;
    const ref = (summary.total as { cite: string }).cite.slice(2, -2);
    const tools = sessionMessages(ledger.db, 50).find((r) => r.kind === 'tools')!;
    expect((tools.meta as ToolsMeta).figures[ref]).toEqual({ minor: 66000, currency: 'EGP' });
  });

  it('never shows a card for a write that could not have been approved', async () => {
    const { step, requests } = scripted([
      [call('create_record', { type: 'expense', amount: 10, account: 'Nowhere' })],
      [{ text: 'That account does not exist.' }],
    ]);
    const d = deps(step);
    ask(d, 'add');
    expect(await run(d)).toBe('done');
    const model = sessionMessages(ledger.db, 50).find((r) => r.kind === 'model')!;
    expect((model.meta as ModelMeta).proposals![0].status).toBe('failed');
    expect(requests[1].contents.at(-1)!.parts[0].functionResponse!.response.error).toMatch(/no account called/);
  });
});

describe('the session', () => {
  it('sends only what follows the last reset', async () => {
    const first = scripted([[{ text: 'one' }]]);
    ask(deps(first.step), 'first question');
    await run(deps(first.step));
    reset(deps(first.step));

    const second = scripted([[{ text: 'two' }]]);
    ask(deps(second.step), 'second question');
    await run(deps(second.step));
    expect(second.requests[0].contents).toEqual([{ role: 'user', parts: [{ text: 'second question' }] }]);
  });

  it('resumes an interrupted turn from disk', async () => {
    // The app was killed after the user asked and before the model answered.
    ask(deps(scripted([]).step), 'still there?');
    const { step } = scripted([[{ text: 'Yes.' }]]);
    expect(await run(deps(step))).toBe('done');
    expect(sessionMessages(ledger.db, 10).at(-1)!.kind).toBe('model');
  });

  it('trims the front to a user message so history never opens on a function response', () => {
    const rows = [
      { seq: 1, kind: 'tools' as const, content: { role: 'user', parts: [{ functionResponse: { name: 'x', response: {} } }] }, meta: null, createdAt: NOW },
      { seq: 2, kind: 'model' as const, content: { role: 'model', parts: [{ text: 'a' }] }, meta: null, createdAt: NOW },
      { seq: 3, kind: 'error' as const, content: null, meta: null, createdAt: NOW },
      { seq: 4, kind: 'user' as const, content: { role: 'user', parts: [{ text: 'q' }] }, meta: null, createdAt: NOW },
    ];
    expect(toContents(rows)).toEqual([{ role: 'user', parts: [{ text: 'q' }] }]);
    expect(CONTEXT_ROWS).toBeGreaterThan(20);
  });

  it('pages the full history from the end, oldest first within a page', () => {
    for (let i = 1; i <= 7; i++) appendMessage(ledger.db, 'user', { role: 'user', parts: [{ text: `m${i}` }] }, null);
    const page = latestMessages(ledger.db, 3);
    expect(page.map((r) => (r.content as Content).parts[0].text)).toEqual(['m5', 'm6', 'm7']);
    const older = messagesBefore(ledger.db, page[0].seq, 3);
    expect(older.map((r) => (r.content as Content).parts[0].text)).toEqual(['m2', 'm3', 'm4']);
  });
});
