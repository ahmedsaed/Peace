/**
 * @jest-environment node
 *
 * The assistant against the REAL Gemini API. Skipped unless a key is supplied:
 *
 *   PEACE_GEMINI_KEY_FILE=.toolchain/gemini-key npx jest src/assistant/live
 *
 * WHY THIS EXISTS. The scripted tests prove the loop; only Google proves the
 * request is shaped the way Google wants — that the declarations validate,
 * that function responses go back under the right role, that a thinking
 * model's signatures survive the round trip — and only a real model proves
 * the prompt and the tool descriptions actually lead it to the right tool.
 * Every one of those failed silently somewhere before (see the 400-for-a-bad-
 * key rule in AGENTS.md). It costs a few cents and takes a minute.
 *
 * The key is read from a FILE, never from this repository, and never logged.
 */
import fs from 'node:fs';
import https from 'node:https';

import { sessionMessages } from '../db/repo/chat';
import { getRecord } from '../db/repo/transactions';
import { ask, decide, run, type Deps, type ModelMeta, type ToolsMeta } from './engine';
import { callsOf, chatStep, type Content } from './gemini-chat';
import { buildLedger, NOW, type Ledger } from './test-ledger';

const keyFile = process.env.PEACE_GEMINI_KEY_FILE;
const key = keyFile && fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').trim() : '';
const model = process.env.PEACE_GEMINI_MODEL ?? 'gemini-flash-latest';
const live = key ? describe : describe.skip;

jest.setTimeout(240_000);

/**
 * A fetch that really goes to the network. jest-expo installs Expo's own
 * `fetch`, which needs the native runtime — under Node it returns a response
 * with no status at all, and every request reads as "refused (undefined)".
 */
const nodeFetch = ((url: string, init: RequestInit = {}) =>
  new Promise((resolve, reject) => {
    const request = https.request(
      url,
      { method: init.method ?? 'GET', headers: init.headers as Record<string, string>, signal: init.signal ?? undefined },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () =>
          resolve({
            ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
            status: response.statusCode,
            json: async () => JSON.parse(body),
          })
        );
      }
    );
    request.on('error', reject);
    if (init.body) request.write(init.body);
    request.end();
  })) as unknown as typeof fetch;

let ledger: Ledger;
let deps: Deps;

beforeEach(() => {
  ledger = buildLedger();
  deps = {
    db: ledger.db,
    homeCurrency: 'EGP',
    now: () => NOW,
    step: (request) => chatStep(key, model, request, { fetchImpl: nodeFetch }),
  };
});

/** Every call the model made this session, in order. */
function calls(): { name: string; args: Record<string, unknown> }[] {
  return sessionMessages(ledger.db, 200)
    .filter((row) => row.kind === 'model')
    .flatMap((row) => callsOf(row.content as Content).map((c) => ({ name: c.name, args: c.args ?? {} })));
}

function replyFigures(): number[] {
  return sessionMessages(ledger.db, 200)
    .filter((row) => row.kind === 'model')
    .flatMap((row) => Object.values((row.meta as ModelMeta | null)?.figures ?? {}).map((f) => f.minor));
}

function displays() {
  return sessionMessages(ledger.db, 200)
    .filter((row) => row.kind === 'tools')
    .flatMap((row) => (row.meta as ToolsMeta).displays);
}

function lastReply(): string {
  const row = sessionMessages(ledger.db, 200).filter((r) => r.kind === 'model').at(-1)!;
  return (row.content as Content).parts.map((p) => p.text ?? '').join('');
}

/** `PEACE_LIVE_VERBOSE=1` prints each conversation — to READ the answers, not just count tools. */
afterEach(() => {
  if (!process.env.PEACE_LIVE_VERBOSE || !ledger) return;
  const lines = sessionMessages(ledger.db, 200).map((row) => {
    const content = row.content as Content | null;
    if (row.kind === 'user') return `USER: ${content?.parts.map((p) => p.text ?? '').join('')}`;
    if (row.kind === 'model') {
      const text = content?.parts.filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim();
      const called = callsOf(content!).map((c) => `${c.name}(${JSON.stringify(c.args)})`);
      const figures = JSON.stringify((row.meta as ModelMeta | null)?.figures ?? {});
      return `MODEL: ${[text, ...called].filter(Boolean).join(' | ')}${text ? `  figures=${figures}` : ''}`;
    }
    return `${row.kind.toUpperCase()}`;
  });
  console.log(lines.join('\n'));
});

async function turn(text: string) {
  ask(deps, text);
  return run(deps);
}

live(`the assistant on ${model}`, () => {
  it('answers "How much did gas cost me in December?" with the ledger’s figure, cited', async () => {
    expect(await turn('How much did gas cost me in December?')).toBe('done');
    const summary = calls().find((c) => c.name === 'summarize' || c.name === 'find_records');
    expect(summary).toBeDefined();
    // E£900 + E£600 of fuel in December 2025 — and the model CITED it rather
    // than typing it.
    expect(replyFigures()).toContain(150000);
    expect(lastReply()).not.toMatch(/1,?500(\.00)?/);
  });

  it('draws "Show a breakdown of income"', async () => {
    expect(await turn('Show a breakdown of income')).toBe('done');
    const charts = displays().filter((d) => d.kind === 'chart');
    expect(charts.length).toBeGreaterThan(0);
    if (charts[0].kind === 'chart') expect(charts[0].chart.measure).toBe('income');
  });

  it('compares coffee month to month, empty month included', async () => {
    expect(await turn('How does my coffee spending compare month to month?')).toBe('done');
    const chart = displays().find((d) => d.kind === 'chart');
    expect(chart?.kind).toBe('chart');
    if (chart?.kind !== 'chart') return;
    expect(chart.chart.groupBy).toBe('month');
    expect(chart.chart.filter.categoryId).toBe('seed:cat:coffee');
    expect(chart.chart.points.some((p) => p.valueMinor === 12000)).toBe(true);
    expect(chart.chart.points.some((p) => p.valueMinor === 15000)).toBe(true);
  });

  it("writes a report on this month's spending", async () => {
    expect(await turn("Write a report on this month's spending")).toBe('done');
    const report = displays().find((d) => d.kind === 'report');
    expect(report?.kind).toBe('report');
    if (report?.kind !== 'report') return;
    expect(report.report.rangeLabel).toBe('October 2026');
    expect(report.report.summary.expenseMinor).toBe(65000);
  });

  it('proposes a deletion, waits, and deletes only after approval', async () => {
    expect(await turn('Delete the shoes purchase from this month')).toBe('awaiting');
    expect(getRecord(ledger.db, ledger.ids.shoes)).toBeDefined();
    const row = sessionMessages(ledger.db, 200).filter((r) => r.kind === 'model').at(-1)!;
    const proposal = (row.meta as ModelMeta).proposals!.find((p) => p.status === 'pending')!;
    expect(proposal.call.name).toBe('delete_records');
    expect(proposal.call.args?.ids).toEqual([ledger.ids.shoes]);

    expect(decide(deps, row.seq, proposal.index, true).complete).toBe(true);
    expect(await run(deps)).toBe('done');
    expect(getRecord(ledger.db, ledger.ids.shoes)).toBeUndefined();
  });

  it('takes no for an answer', async () => {
    expect(await turn('Create a tag called "Weekend"')).toBe('awaiting');
    const row = sessionMessages(ledger.db, 200).filter((r) => r.kind === 'model').at(-1)!;
    const proposal = (row.meta as ModelMeta).proposals!.find((p) => p.status === 'pending')!;
    expect(proposal.call.name).toBe('create_tag');
    decide(deps, row.seq, proposal.index, false);
    expect(await run(deps)).toBe('done');
    expect(calls().filter((c) => c.name === 'create_tag')).toHaveLength(1);
  });
});
