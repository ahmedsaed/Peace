/**
 * @jest-environment node
 */
import { eq } from 'drizzle-orm';

import { ledgerFacts } from '../../db/repo/ledger-query';
import { listRules } from '../../db/repo/recurring';
import { tagsForRecord } from '../../db/repo/tags';
import { getRecord } from '../../db/repo/transactions';
import { budgets, categories, tags, transactions } from '../../db/schema';
import { buildLedger, CASH, ctxFor, CLOTHING, COFFEE, FOOD, type Ledger } from '../test-ledger';
import { applyWrite, declarations, isWrite, prepareWrite, runRead, TOOLS, undoWrite } from './index';
import type { ToolContext } from './types';

type Cited = { amount: number; currency: string; cite: string };

let ledger: Ledger;
let ctx: ToolContext;
beforeEach(() => {
  ledger = buildLedger();
  ctx = ctxFor(ledger.db);
});

/** The minor units behind a cite, read back from the book that issued it. */
function minor(cited: unknown): number {
  const ref = (cited as Cited).cite.slice(2, -2);
  return ctx.figures.get(ref)!.minor;
}

const read = (name: string, args: Record<string, unknown>) => runRead({ name, args }, ctx);

describe('the tool catalogue', () => {
  it('declares every tool once, with a description Gemini can use', () => {
    const names = declarations().map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    for (const d of declarations()) {
      expect(d.name).toMatch(/^[a-z_]+$/);
      expect(d.description.length).toBeGreaterThan(20);
    }
  });

  it('classifies anything that changes data as a write', () => {
    const writes = TOOLS.filter((t) => t.kind === 'write').map((t) => t.declaration.name);
    for (const name of writes) expect(name).toMatch(/^(create|update|delete|set)_/);
    // And nothing that only reads sneaks into that set.
    for (const name of ['summarize', 'find_records', 'show_chart', 'make_report']) expect(isWrite(name)).toBe(false);
  });

  it('answers an unknown tool with an error the model can read, not a throw', () => {
    expect(runRead({ name: 'drop_tables', args: {} }, ctx).response).toEqual({
      error: 'There is no tool called drop_tables.',
    });
  });
});

describe('ledgerFacts', () => {
  it('leaves out transfers and balance corrections and keeps refunds on the expense side', () => {
    const facts = ledgerFacts(ledger.db, { start: null, end: null });
    const ids = facts.map((f) => f.id);
    expect(ids).not.toContain(ledger.ids.atm);
    expect(facts.every((f) => f.side === 'expense' || f.side === 'income')).toBe(true);
    expect(facts.find((f) => f.id === ledger.ids.refund)!.side).toBe('expense');
  });

  it('matches a parent category to its children', () => {
    const facts = ledgerFacts(ledger.db, { start: null, end: null, categoryId: FOOD });
    expect(facts.map((f) => f.id).sort()).toEqual([ledger.ids.coffeeAug, ledger.ids.coffeeOct].sort());
  });

  it('escapes LIKE wildcards, so "50%" finds the note that really says it', () => {
    const facts = ledgerFacts(ledger.db, { start: null, end: null, text: '50%' });
    expect(facts.map((f) => f.id)).toEqual([ledger.ids.coffeeOct]);
  });
});

describe('summarize', () => {
  it('answers "how much did gas cost me in December"', () => {
    const { response } = read('summarize', { measure: 'expense', category: 'Fuel', month: '2025-12' });
    expect(response.range).toBe('December 2025');
    expect(minor(response.total)).toBe(150000);
    expect(response.records_counted).toBe(2);
  });

  it('nets a refund against its category and ignores the transfer and the correction', () => {
    const { response } = read('summarize', { measure: 'expense', month: '2026-10', group_by: 'category' });
    // 150 coffee + 800 shoes - 300 refund. The ATM transfer and the cash
    // correction are not spending.
    expect(minor(response.total)).toBe(65000);
    const groups = response.groups as { label: string; value: Cited; percent: number }[];
    expect(groups.map((g) => [g.label, minor(g.value)])).toEqual([
      ['Clothing', 50000],
      ['Food', 15000],
    ]);
    // Shares come from the largest-remainder rule and add to exactly 100.
    expect(groups.reduce((sum, g) => sum + g.percent, 0)).toBeCloseTo(100, 5);
  });

  it('gives month-to-month changes with an empty month in the middle', () => {
    const { response } = read('summarize', {
      measure: 'expense',
      category: COFFEE,
      group_by: 'month',
      from: '2026-08',
      to: '2026-10',
    });
    const groups = response.groups as { label: string; value: Cited; change_from_previous?: Cited }[];
    expect(groups.map((g) => minor(g.value))).toEqual([12000, 0, 15000]);
    expect(groups[0].change_from_previous).toBeUndefined();
    expect(minor(groups[2].change_from_previous)).toBe(15000);
    // No percentages on a time series: they are not shares of anything.
    expect(groups[0]).not.toHaveProperty('percent');
  });

  it('separates income from spending', () => {
    const { response } = read('summarize', { measure: 'income', month: '2026-10' });
    expect(minor(response.total)).toBe(2000000);
  });

  it('returns a readable error for a category that does not exist', () => {
    const { response } = read('summarize', { measure: 'expense', category: 'Gasoline' });
    expect(response.error).toMatch(/no category called "Gasoline"/);
    expect(response.error).toMatch(/Fuel/);
  });

  it('refuses to guess between two categories with the same name', () => {
    // The seed has an expense "Other" and an income "Other".
    const { response } = read('summarize', { measure: 'expense', category: 'Other' });
    expect(response.error).toMatch(/More than one category/);
  });
});

describe('find_records', () => {
  it('totals EVERY match, not just the rows it returns', () => {
    const { response } = read('find_records', { category: 'Fuel', limit: 1 });
    expect(response.match_count).toBe(3);
    expect(response.returned).toBe(1);
    expect(minor(response.total_spent)).toBe(230000);
  });

  it('honours an explicit span the search screen has no chip for', () => {
    const { response } = read('find_records', { category: 'Fuel', month: '2025-12' });
    const records = response.records as { id: string; date: string }[];
    expect(records.map((r) => r.id)).toEqual([ledger.ids.fuelDec2, ledger.ids.fuelDec1]);
    expect(records[0].date).toBe('2025-12-28');
  });

  it('reports a refund as expense, never as income', () => {
    const { response } = read('find_records', { text: 'Returned' });
    const [row] = response.records as { kind: string; refund?: boolean; amount: Cited }[];
    expect(row.kind).toBe('expense');
    expect(row.refund).toBe(true);
    expect(minor(row.amount)).toBe(30000);
  });

  it('puts a list on screen only when asked', () => {
    expect(read('find_records', { category: 'Fuel' }).display).toBeUndefined();
    const shown = read('find_records', { category: 'Fuel', show: true, title: 'Fuel' });
    expect(shown.display).toEqual(expect.objectContaining({ kind: 'records', matchCount: 3, title: 'Fuel' }));
  });
});

describe('show_chart', () => {
  it('draws the coffee comparison from the ledger, not from the model', () => {
    const { display, response } = read('show_chart', {
      title: 'Coffee by month',
      chart: 'line',
      measure: 'expense',
      group_by: 'month',
      category: 'Coffee',
      from: '2026-08',
      to: '2026-10',
    });
    expect(response.shown_to_user).toBe(true);
    expect(display?.kind).toBe('chart');
    if (display?.kind !== 'chart') return;
    expect(display.chart.type).toBe('line');
    expect(display.chart.points.map((p) => p.valueMinor)).toEqual([12000, 0, 15000]);
    // Each bar knows its own span, for tapping into it.
    expect(new Date(display.chart.points[1].start!)).toEqual(new Date(2026, 8, 1));
    expect(display.chart.filter.categoryId).toBe(COFFEE);
  });

  it('turns a donut it cannot draw honestly into bars', () => {
    const months = read('show_chart', { title: 'x', chart: 'donut', measure: 'expense', group_by: 'month', month: '2026-10' });
    const net = read('show_chart', { title: 'x', chart: 'donut', measure: 'net', group_by: 'category', month: '2026-10' });
    const tags = read('show_chart', { title: 'x', chart: 'donut', measure: 'expense', group_by: 'tag' });
    for (const outcome of [months, net, tags]) {
      expect(outcome.display?.kind === 'chart' && outcome.display.chart.type).toBe('bar');
    }
  });

  it('colours category slices the way the rest of the app does', () => {
    const { display } = read('show_chart', { title: 'x', measure: 'expense', group_by: 'category', month: '2026-10' });
    if (display?.kind !== 'chart') throw new Error('no chart');
    const clothing = ledger.db.select().from(categories).where(eq(categories.id, CLOTHING)).get()!;
    expect(display.chart.type).toBe('donut');
    expect(display.chart.points.find((p) => p.categoryId === CLOTHING)?.color).toBe(clothing.color);
  });

  it('needs something to group by', () => {
    expect(read('show_chart', { title: 'x', measure: 'expense' }).response.error).toMatch(/group_by/);
  });
});

describe('the other reads', () => {
  it('get_balances includes archived accounts and the total held', () => {
    const { response } = read('get_balances', {});
    const cash = (response.accounts as { id: string; balance: Cited }[]).find((a) => a.id === CASH)!;
    // Reconciled to E£40,000 after everything else.
    expect(minor(cash.balance)).toBe(4_000_000);
  });

  it('get_budgets reports a limit against what was spent', () => {
    ledger.db.insert(budgets).values({ id: 'b1', categoryId: CLOTHING, period: '2026-10', amountMinor: 60000, currency: 'EGP' }).run();
    const { response } = read('get_budgets', { month: '2026-10' });
    const [row] = response.budgeted as { category: string; spent: Cited; remaining: Cited }[];
    expect(row.category).toBe('Clothing');
    expect(minor(row.spent)).toBe(50000);
    expect(minor(row.remaining)).toBe(10000);
  });

  it('make_report computes its own header and the charts its sections ask for', () => {
    const summary = read('summarize', { measure: 'expense', month: '2026-10' });
    const cite = (summary.response.total as Cited).cite;
    const { display } = read('make_report', {
      title: 'October',
      month: '2026-10',
      sections: [
        { heading: 'Spending', body: `You spent ${cite}.`, chart: { measure: 'expense', group_by: 'category' } },
        { heading: 'Notes', body: '- Nothing unusual' },
      ],
    });
    if (display?.kind !== 'report') throw new Error('no report');
    const { report } = display;
    expect(report.summary).toEqual({ incomeMinor: 2000000, expenseMinor: 65000, netMinor: 1935000, unvaluedCount: 0 });
    expect(report.sections[0].chart?.points.map((p) => p.valueMinor)).toEqual([50000, 15000]);
    expect(report.sections[1].chart).toBeUndefined();
    // The cited figure travels with the report, so the PDF can render it later.
    expect(Object.values(report.figures)).toEqual([{ minor: 65000, currency: 'EGP' }]);
  });

  it('lets a report section chart a longer span than the report', () => {
    const { display } = read('make_report', {
      title: 'October',
      month: '2026-10',
      sections: [{ heading: 'Trend', body: '', chart: { measure: 'expense', group_by: 'month', from: '2026-08', to: '2026-10' } }],
    });
    if (display?.kind !== 'report') throw new Error('no report');
    expect(display.report.sections[0].chart?.points.map((p) => p.key)).toEqual(['2026-08', '2026-09', '2026-10']);
  });
});

describe('writes', () => {
  const prepare = (name: string, args: Record<string, unknown>) => prepareWrite({ name, args }, ctx);
  const apply = (name: string, args: Record<string, unknown>) => applyWrite({ name, args }, ctx);
  const countRows = () => ledger.db.select().from(transactions).all().length;

  it('prepares without changing anything', () => {
    const before = countRows();
    const prepared = prepare('create_record', { type: 'expense', amount: 45.5, account: 'Cash', category: 'Coffee', tags: ['Trip', 'Office'] });
    expect(countRows()).toBe(before);
    if (!('preview' in prepared)) throw new Error(prepared.error);
    expect(prepared.preview.title).toBe('Add this expense?');
    expect(prepared.preview.lines[0].figure).toEqual({ minor: -4550, currency: 'EGP' });
    // An existing tag and a new one are told apart before anything is created.
    expect(prepared.preview.lines.find((l) => l.label === 'Tags')?.value).toBe('Trip, Office (new)');
    expect(ledger.db.select().from(tags).all().map((t) => t.name)).toEqual(['Trip']);
  });

  it('creates a record through the same repository the screens use', () => {
    const { response } = apply('create_record', {
      type: 'expense',
      amount: '45.50',
      account: 'Cash',
      category: 'Coffee',
      date: '2026-10-06',
      tags: ['Office'],
    });
    const row = getRecord(ledger.db, response.id as string)!;
    expect(row.amountMinor).toBe(-4550);
    expect(row.categoryId).toBe(COFFEE);
    expect(row.homeAmountMinor).toBe(-4550);
    // Noon on a past day, so no timezone reading can move it.
    expect(row.occurredAt).toEqual(new Date(2026, 9, 6, 12));
    expect(tagsForRecord(ledger.db, row.id).map((t) => t.name)).toEqual(['Office']);
  });

  it('files an income category only under income', () => {
    expect(prepare('create_record', { type: 'income', amount: 10, account: 'Cash', category: 'Coffee' })).toEqual({
      error: expect.stringMatching(/no income category called "Coffee"/),
    });
  });

  it('refuses a foreign-currency account rather than inventing a rate', () => {
    const outcome = prepare('create_record', { type: 'expense', amount: 10, account: 'Dollar card' });
    expect(outcome).toEqual({ error: expect.stringMatching(/exchange rate/) });
  });

  it('refuses "yes" where it needs true', () => {
    expect(prepare('update_tag', { tag: 'Trip', archived: 'yes' })).toEqual({ error: '"archived" must be true or false.' });
  });

  it('re-categorises in bulk and validates every row against the category kind', () => {
    const ids = [ledger.ids.fuelNov, ledger.ids.fuelDec1];
    const prepared = prepare('update_records', { ids, category: 'Transportation' });
    if (!('preview' in prepared)) throw new Error(prepared.error);
    expect(prepared.preview.title).toBe('Change 2 records?');
    apply('update_records', { ids, category: 'Transportation', add_tags: ['Car'] });
    for (const id of ids) {
      const row = getRecord(ledger.db, id)!;
      expect(row.categoryId).toBe('seed:cat:transport');
      // The home value survived the edit — updateRecord clears it without one.
      expect(row.homeAmountMinor).toBe(row.amountMinor);
    }
    expect(tagsForRecord(ledger.db, ledger.ids.fuelDec1).map((t) => t.name)).toEqual(['Car', 'Trip']);

    expect(prepare('update_records', { ids: [ledger.ids.salary], category: 'Fuel' })).toEqual({
      error: expect.stringMatching(/expense category/),
    });
  });

  it('keeps a refund a refund when it is edited', () => {
    apply('update_records', { ids: [ledger.ids.refund], note: 'Returned both' });
    const row = getRecord(ledger.db, ledger.ids.refund)!;
    expect(row.isRefund).toBe(true);
    expect(row.amountMinor).toBe(30000);
  });

  it('will not set one amount across many records', () => {
    expect(prepare('update_records', { ids: [ledger.ids.fuelNov, ledger.ids.fuelDec1], amount: 10 })).toEqual({
      error: expect.stringMatching(/one record at a time/),
    });
  });

  it('edits only the note, date and tags of a transfer', () => {
    expect(prepare('update_records', { ids: [ledger.ids.atm], category: 'Food' })).toEqual({
      error: expect.stringMatching(/transfer/),
    });
    apply('update_records', { ids: [ledger.ids.atm], note: 'Cash for the week' });
    const legs = ledger.db.select().from(transactions).where(eq(transactions.note, 'Cash for the week')).all();
    expect(legs).toHaveLength(2);
  });

  it('names ids that do not exist instead of skipping them', () => {
    expect(prepare('delete_records', { ids: [ledger.ids.shoes, 'nope'] })).toEqual({
      error: expect.stringMatching(/nope/),
    });
  });

  it('deletes and undoes, tags included', () => {
    const before = countRows();
    const prepared = prepare('delete_records', { ids: [ledger.ids.fuelDec1, ledger.ids.atm] });
    if (!('preview' in prepared)) throw new Error(prepared.error);
    expect(prepared.preview.danger).toBe(true);

    const outcome = apply('delete_records', { ids: [ledger.ids.fuelDec1, ledger.ids.atm] });
    // The transfer takes both its legs with it.
    expect(countRows()).toBe(before - 3);
    undoWrite(ledger.db, outcome.undo!);
    expect(countRows()).toBe(before);
    expect(tagsForRecord(ledger.db, ledger.ids.fuelDec1).map((t) => t.name)).toEqual(['Trip']);
  });

  it('will not delete a category records still use, and says how to clear the way', () => {
    expect(prepare('delete_category', { category: 'Fuel' })).toEqual({
      error: expect.stringMatching(/3 record\(s\).*update_records/),
    });
  });

  it('creates, renames and archives categories within the two-level rule', () => {
    const { response } = apply('create_category', { name: 'Snacks', kind: 'expense', parent: 'Food' });
    const created = ledger.db.select().from(categories).where(eq(categories.id, response.id as string)).get()!;
    expect(created.parentId).toBe(FOOD);
    expect(prepare('create_category', { name: 'Chips', kind: 'expense', parent: 'Snacks' })).toEqual({
      error: expect.stringMatching(/two levels/),
    });
    expect(prepare('create_category', { name: 'snacks', kind: 'expense', parent: 'Food' })).toEqual({
      error: expect.stringMatching(/already a category/),
    });
    apply('update_category', { category: 'Snacks', archived: true });
    expect(ledger.db.select().from(categories).where(eq(categories.id, created.id)).get()!.archived).toBe(true);
  });

  it('manages tags and accounts', () => {
    expect(prepare('create_tag', { name: 'trip' })).toEqual({ error: expect.stringMatching(/already exists/) });
    apply('update_tag', { tag: 'Trip', name: 'Holiday' });
    expect(ledger.db.select().from(tags).all().map((t) => t.name)).toEqual(['Holiday']);

    const { response } = apply('create_account', { name: 'Visa', type: 'card', opening_balance: -1500 });
    const visa = ledger.db.query.accounts.findFirst({ where: (a, { eq: is }) => is(a.id, response.id as string) }).sync();
    expect(visa).toEqual(expect.objectContaining({ name: 'Visa', type: 'card', currency: 'EGP' }));
    const prepared = prepare('delete_account', { account: 'Cash' });
    expect(prepared).toEqual({ error: expect.stringMatching(/cannot be deleted/) });
  });

  it('keeps a negative opening balance for a card that is owed', () => {
    const { response } = apply('create_account', { name: 'Visa', type: 'card', opening_balance: -1500.25 });
    const account = ledger.db.query.accounts.findFirst({ where: (a, { eq: is }) => is(a.id, response.id as string) }).sync();
    expect(account?.openingBalance).toBe(-150025);
  });

  it('creates, pauses and deletes recurring rules', () => {
    const { response } = apply('create_recurring', {
      name: 'Rent',
      type: 'expense',
      amount: 12000,
      account: 'Bank',
      category: 'Home',
      frequency: 'monthly',
      starts_on: '2026-11-01',
    });
    const [rule] = listRules(ledger.db);
    expect(rule.id).toBe(response.id);
    expect(rule.amountMinor).toBe(1200000);
    apply('update_recurring', { rule: 'Rent', active: false });
    expect(listRules(ledger.db)[0].active).toBe(false);
    apply('delete_recurring', { rule: 'Rent' });
    expect(listRules(ledger.db)).toEqual([]);
  });

  it('sets a budget on a top-level category only', () => {
    apply('set_budget', { category: 'Clothing', month: '2026-11', amount: 1000 });
    expect(ledger.db.select().from(budgets).all()).toEqual([
      expect.objectContaining({ categoryId: CLOTHING, period: '2026-11', amountMinor: 100000 }),
    ]);
    expect(prepare('set_budget', { category: 'Coffee', amount: 100 })).toEqual({
      error: expect.stringMatching(/top-level/),
    });
    apply('set_budget', { category: 'Clothing', month: '2026-11', amount: 0 });
    expect(ledger.db.select().from(budgets).all()).toEqual([]);
  });

  it('validates again at apply time, because the ledger may have moved', () => {
    const args = { ids: [ledger.ids.shoes], note: 'x' };
    expect('preview' in prepare('update_records', args)).toBe(true);
    ledger.db.delete(transactions).where(eq(transactions.id, ledger.ids.shoes)).run();
    expect(apply('update_records', args).response.error).toMatch(/No record has the id/);
  });
});
