/**
 * @jest-environment node
 */
import { formatMinor } from '../lib/money';
import { canRetry, sessionIsEmpty, toItems } from './display';
import { chartCsv, drillFacts, drillRows } from './drill';
import { parseBlocks } from './markdown';
import { chartSvg, proseHtml, reportHtml } from './report-html';
import { runRead } from './tools';
import type { ChartSpec, ReportSpec } from './tools/types';
import { buildLedger, ctxFor, type Ledger } from './test-ledger';
import type { StoredRow } from '../db/repo/chat';

const format = (minor: number, currency: string) => formatMinor(minor, currency);

let ledger: Ledger;
beforeEach(() => {
  ledger = buildLedger();
});

function chart(args: Record<string, unknown>): ChartSpec {
  const outcome = runRead({ name: 'show_chart', args: { title: 'T', ...args } }, ctxFor(ledger.db));
  if (outcome.display?.kind !== 'chart') throw new Error(JSON.stringify(outcome.response));
  return outcome.display.chart;
}

describe('parseBlocks', () => {
  it('reads paragraphs, bullets, numbers, headings, bold and figures', () => {
    const blocks = parseBlocks('Fuel was **{{t1f1}}**.\n\n- Shell twice\n2. Total once\n## Next');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'bullet', 'bullet', 'heading']);
    expect(blocks[0].inlines).toEqual([
      { kind: 'text', text: 'Fuel was ', bold: false },
      { kind: 'figure', ref: 't1f1', bold: true, abs: false },
      { kind: 'text', text: '.', bold: false },
    ]);
    expect(blocks[2].marker).toBe('2.');
  });

  it('drops single-asterisk emphasis instead of printing the asterisks', () => {
    const [block] = parseBlocks('This is *really* high.');
    expect(block.inlines).toEqual([{ kind: 'text', text: 'This is really high.', bold: false }]);
  });
});

describe('drilling into a chart', () => {
  it('lists exactly the records behind a bar, so they add up to it', () => {
    const spec = chart({ measure: 'expense', group_by: 'month', category: 'Fuel', from: '2025-11', to: '2025-12' });
    const december = spec.points[1];
    const facts = drillFacts(ledger.db, spec, december, 'EGP');
    expect(facts.map((f) => f.id).sort()).toEqual([ledger.ids.fuelDec1, ledger.ids.fuelDec2].sort());
    expect(-facts.reduce((sum, f) => sum + f.valueMinor!, 0)).toBe(december.valueMinor);
  });

  it('includes the refund in its category, and nets the same way the slice does', () => {
    const spec = chart({ measure: 'expense', group_by: 'category', month: '2026-10' });
    const clothing = spec.points.find((p) => p.label === 'Clothing')!;
    const rows = drillRows(ledger.db, spec, clothing, 'EGP');
    expect(rows.map((r) => r.id).sort()).toEqual([ledger.ids.shoes, ledger.ids.refund].sort());
    expect(-rows.reduce((sum, r) => sum + r.amountMinor, 0)).toBe(clothing.valueMinor);
  });

  it('never lists a transfer, which no chart counts', () => {
    const spec = chart({ measure: 'net', group_by: 'account', month: '2026-10' });
    for (const point of spec.points) {
      expect(drillRows(ledger.db, spec, point, 'EGP').some((r) => r.isTransfer)).toBe(false);
    }
  });

  it('finds a tag’s records across categories', () => {
    const spec = chart({ measure: 'expense', group_by: 'tag' });
    const rows = drillRows(ledger.db, spec, spec.points[0], 'EGP');
    expect(rows.map((r) => r.id).sort()).toEqual([ledger.ids.fuelDec1, ledger.ids.coffeeAug].sort());
  });
});

describe('chartCsv', () => {
  it('writes unmasked major units with the currency’s decimals, and the real total', () => {
    const spec = chart({ measure: 'expense', group_by: 'month', category: 'Coffee', from: '2026-08', to: '2026-10' });
    expect(chartCsv(spec)).toEqual([
      ['month', 'spent (EGP)', 'records'],
      ['Aug 2026', '120.00', '1'],
      ['Sep 2026', '0.00', '0'],
      ['Oct 2026', '150.00', '1'],
      ['Total', '270.00', ''],
    ]);
  });
});

describe('the PDF', () => {
  it('renders cited figures through the formatter and never prints a raw token', () => {
    const html = proseHtml('Spent {{a1}} and {{missing}}.', { a1: { minor: 65000, currency: 'EGP' } }, format);
    expect(html).toContain(format(65000, 'EGP'));
    expect(html).not.toContain('{{');
    expect(html).toContain('—');
  });

  it('renders |abs as the size of the amount', () => {
    const html = proseHtml('Over by {{a1|abs}}.', { a1: { minor: -55600, currency: 'EGP' } }, format);
    expect(html).toContain(format(55600, 'EGP'));
    expect(html).not.toContain(format(-55600, 'EGP'));
  });

  it('escapes what the model and the user typed', () => {
    expect(proseHtml('<script>alert(1)</script>', {}, format)).not.toContain('<script>');
  });

  it('draws every chart type without a NaN', () => {
    const specs = [
      chart({ measure: 'expense', group_by: 'month', from: '2026-08', to: '2026-10' }),
      chart({ chart: 'line', measure: 'expense', group_by: 'month', from: '2026-08', to: '2026-10' }),
      chart({ measure: 'expense', group_by: 'category', month: '2026-10' }),
      chart({ measure: 'net', group_by: 'month', month: '2026-09' }),
    ];
    for (const spec of specs) expect(chartSvg(spec, format)).not.toContain('NaN');
    expect(chartSvg(specs[2], format)).toContain('Clothing');
  });

  it('puts the computed header, the sections and their charts in one page', () => {
    const outcome = runRead(
      {
        name: 'make_report',
        args: {
          title: 'October <review>',
          month: '2026-10',
          sections: [{ heading: 'Where it went', body: '- Clothing, net of a refund', chart: { measure: 'expense', group_by: 'category' } }],
        },
      },
      ctxFor(ledger.db)
    );
    if (outcome.display?.kind !== 'report') throw new Error('no report');
    const report: ReportSpec = outcome.display.report;
    const html = reportHtml(report, format);
    expect(html).toContain('October &lt;review&gt;');
    expect(html).toContain('October 2026');
    expect(html).toContain(format(2000000, 'EGP'));
    expect(html).toContain(format(65000, 'EGP'));
    expect(html).toContain('<li>Clothing, net of a refund</li>');
    expect(html).toContain('<svg');
  });
});

describe('toItems', () => {
  const row = (seq: number, kind: StoredRow['kind'], content: unknown, meta: unknown = null): StoredRow => ({
    seq,
    kind,
    content,
    meta,
    createdAt: new Date(2026, 9, 7),
  });

  it('splits a model turn into its reply, its activity and its proposals', () => {
    const items = toItems([
      row(1, 'user', { role: 'user', parts: [{ text: 'hi' }] }),
      row(2, 'model', { role: 'model', parts: [{ text: 'Looking.' }, { functionCall: { name: 'delete_records' } }] }, {
        activity: ['Preparing a deletion'],
        proposals: [
          { index: 0, call: { name: 'delete_records' }, status: 'pending', preview: { title: 'Delete?', lines: [], danger: true, confirmLabel: 'Delete' } },
          { index: 1, call: { name: 'x' }, status: 'failed', preview: { title: '', lines: [], danger: false, confirmLabel: '' } },
        ],
      }),
      row(3, 'tools', { role: 'user', parts: [] }, { figures: {}, displays: [{ kind: 'records', title: 'R', ids: [], matchCount: 0, rangeLabel: '' }] }),
      row(4, 'divider', null),
    ]);
    expect(items.map((i) => i.type)).toEqual(['user', 'reply', 'activity', 'proposal', 'display', 'divider']);
  });

  it('expires a card left pending across a reset, so it cannot change the ledger unannounced', () => {
    const pending = {
      index: 0,
      call: { name: 'create_tag' },
      status: 'pending',
      preview: { title: 'Add?', lines: [], danger: false, confirmLabel: 'Add' },
    };
    const items = toItems([
      row(1, 'user', { role: 'user', parts: [{ text: 'tag' }] }),
      row(2, 'model', { role: 'model', parts: [{ functionCall: { name: 'create_tag' } }] }, { proposals: [pending] }),
      row(3, 'divider', null),
    ]);
    expect(items.find((i) => i.type === 'proposal')).toEqual(expect.objectContaining({ expired: true }));
    const live = toItems([row(2, 'model', { role: 'model', parts: [] }, { proposals: [pending] })]);
    expect(live.find((i) => i.type === 'proposal')).toEqual(expect.objectContaining({ expired: false }));
  });

  it('offers a retry only when the last thing that happened was a retryable failure', () => {
    const failed = [row(1, 'user', { role: 'user', parts: [{ text: 'q' }] }), row(2, 'error', null, { message: 'x', retryable: true })];
    expect(canRetry(failed)).toBe(true);
    expect(canRetry([...failed, row(3, 'user', { role: 'user', parts: [{ text: 'again' }] })])).toBe(false);
    expect(canRetry([row(1, 'error', null, { message: 'bad key', retryable: false })])).toBe(false);
  });

  it('knows an empty session after a reset', () => {
    expect(sessionIsEmpty([])).toBe(true);
    expect(sessionIsEmpty([row(1, 'divider', null)])).toBe(true);
    expect(sessionIsEmpty([row(1, 'user', { role: 'user', parts: [{ text: 'q' }] })])).toBe(false);
  });
});
