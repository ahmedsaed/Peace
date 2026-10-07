import { donutSegments, rankSlices } from '../lib/analysis';
import { barLayout, labelIndices, linePath, linePoints, scaleFor, shortLabel, type Frame } from './chart-geometry';
import type { Figure } from './figures';
import { parseBlocks, type Inline } from './markdown';
import type { ChartSpec, ReportSpec } from './tools/types';

/**
 * A report as one self-contained HTML page, for `expo-print` to turn into a PDF.
 *
 * Pure — the formatter is passed in — so the whole document is testable in
 * Node, including the rule that matters most: every amount in it is a figure
 * the app computed or the model cited, never text the model typed.
 *
 * PRINTED ON PAPER, so it is light, whatever the app looks like. A dark page
 * is a page of toner.
 *
 * Amounts here are NOT masked. A report is an export, like the CSV: it is the
 * user deliberately taking their figures somewhere, and a PDF full of bullets
 * would be a file that has lost its data.
 */

export type Format = (minor: number, currency: string) => string;

const INK = '#1F1A14';
const MUTED = '#6E6455';
const LINE = '#E4DCCB';
const EXPENSE = '#C2553F';
const INCOME = '#4F8A2E';
const ACCENT = '#B57A16';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineHtml(inline: Inline, figures: Record<string, Figure>, format: Format): string {
  let html: string;
  if (inline.kind === 'figure') {
    const figure = figures[inline.ref];
    // An unresolvable cite is shown as a gap, never as the token itself and
    // never as a guess.
    html = figure ? `<span class="fig">${escapeHtml(format(figure.minor, figure.currency))}</span>` : '—';
  } else {
    html = escapeHtml(inline.text).replace(/\n/g, '<br/>');
  }
  return inline.bold ? `<strong>${html}</strong>` : html;
}

export function proseHtml(text: string, figures: Record<string, Figure>, format: Format): string {
  const out: string[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length > 0) out.push(`<ul>${list.join('')}</ul>`);
    list = [];
  };
  for (const block of parseBlocks(text)) {
    const body = block.inlines.map((i) => inlineHtml(i, figures, format)).join('');
    if (block.kind === 'bullet') {
      list.push(`<li>${body}</li>`);
      continue;
    }
    flushList();
    out.push(block.kind === 'heading' ? `<h3>${body}</h3>` : `<p>${body}</p>`);
  }
  flushList();
  return out.join('\n');
}

function colorFor(chart: ChartSpec, value: number, override?: string): string {
  if (override) return override;
  if (chart.measure === 'income') return INCOME;
  if (chart.measure === 'expense') return EXPENSE;
  return value < 0 ? EXPENSE : INCOME;
}

/** A chart as an SVG string — the same geometry the screen draws with. */
export function chartSvg(chart: ChartSpec, format: Format, width = 520, height = 220): string {
  const title = `<text x="0" y="14" font-size="13" font-weight="600" fill="${INK}">${escapeHtml(chart.title)}</text>`;

  if (chart.type === 'donut') {
    const size = height - 30;
    const slices = rankSlices(
      chart.points.map((p) => ({
        id: p.key,
        label: p.label,
        color: p.color ?? ACCENT,
        icon: null,
        amountMinor: Math.max(0, p.valueMinor),
      })),
      { otherColor: '#B9AE9A' }
    );
    const ring = { cx: size / 2, cy: 24 + size / 2, outer: size / 2, inner: size / 2 - 30 };
    const paths = donutSegments(ring, slices).map((s) => `<path d="${s.path}" fill="${s.slice.color}"/>`);
    const legend = slices.map((slice, i) => {
      const y = 36 + i * 20;
      return (
        `<rect x="${size + 24}" y="${y - 9}" width="10" height="10" rx="2" fill="${slice.color}"/>` +
        `<text x="${size + 40}" y="${y}" font-size="11" fill="${INK}">${escapeHtml(slice.label)}</text>` +
        `<text x="${width}" y="${y}" font-size="11" fill="${MUTED}" text-anchor="end">${escapeHtml(
          format(slice.amountMinor, chart.currency)
        )} · ${slice.percent.toFixed(1)}%</text>`
      );
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${title}${paths.join('')}${legend.join('')}</svg>`;
  }

  const frame: Frame = { width, height, left: 64, right: 8, top: 28, bottom: 24 };
  const values = chart.points.map((p) => p.valueMinor);
  const scale = scaleFor(values, frame);
  const grid = scale.ticks
    .map((tick) => {
      const y = scale.y(tick);
      return (
        `<line x1="${frame.left}" x2="${width - frame.right}" y1="${y}" y2="${y}" stroke="${LINE}" stroke-width="1"/>` +
        `<text x="${frame.left - 6}" y="${y + 4}" font-size="9" fill="${MUTED}" text-anchor="end">${escapeHtml(
          format(tick, chart.currency)
        )}</text>`
      );
    })
    .join('');

  const shown = new Set(labelIndices(values.length, 12));
  let marks: string;
  let xs: number[];
  if (chart.type === 'line') {
    const points = linePoints(values, frame, scale);
    xs = points.map((p) => p.x);
    marks =
      `<path d="${linePath(points)}" fill="none" stroke="${colorFor(chart, 1)}" stroke-width="2"/>` +
      points.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${colorFor(chart, values[p.index])}"/>`).join('');
  } else {
    const bars = barLayout(values, frame, scale);
    xs = bars.map((b) => b.x + b.width / 2);
    marks = bars
      .map(
        (b) =>
          `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="2" fill="${colorFor(
            chart,
            values[b.index],
            chart.points[b.index].color
          )}"/>`
      )
      .join('');
  }
  const labels = chart.points
    .map((p, i) =>
      shown.has(i)
        ? `<text x="${xs[i]}" y="${height - 6}" font-size="9" fill="${MUTED}" text-anchor="middle">${escapeHtml(
            shortLabel(p.label)
          )}</text>`
        : ''
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${title}${grid}${marks}${labels}</svg>`;
}

export function reportHtml(report: ReportSpec, format: Format): string {
  const money = (minor: number) => escapeHtml(format(minor, report.currency));
  const generated = new Date(report.generatedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${generated.getFullYear()}-${pad(generated.getMonth() + 1)}-${pad(generated.getDate())}`;

  const top = report.topCategories
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.label)}</td>
        <td class="bar"><div style="width:${Math.max(0, Math.min(100, row.percent))}%"></div></td>
        <td class="num">${row.percent.toFixed(1)}%</td>
        <td class="num">${money(row.valueMinor)}</td>
      </tr>`
    )
    .join('');

  const sections = report.sections
    .map(
      (section) => `<section>
        <h2>${escapeHtml(section.heading)}</h2>
        ${proseHtml(section.body, report.figures, format)}
        ${section.chart ? `<div class="chart">${chartSvg(section.chart, format)}</div>` : ''}
      </section>`
    )
    .join('\n');

  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
  @page { margin: 36px; }
  body { font-family: -apple-system, Roboto, "Segoe UI", sans-serif; color: ${INK}; font-size: 12px; line-height: 1.5; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  h2 { font-size: 15px; margin: 22px 0 6px; padding-bottom: 4px; border-bottom: 1px solid ${LINE}; }
  h3 { font-size: 13px; margin: 12px 0 4px; }
  .meta { color: ${MUTED}; margin-bottom: 16px; }
  .trio { display: flex; gap: 10px; margin: 8px 0 14px; }
  .trio div { flex: 1; border: 1px solid ${LINE}; border-radius: 8px; padding: 8px 10px; }
  .trio span { display: block; color: ${MUTED}; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
  .trio b { font-size: 15px; }
  .in { color: ${INCOME}; } .out { color: ${EXPENSE}; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 0; border-bottom: 1px solid ${LINE}; }
  td.num { text-align: right; white-space: nowrap; padding-left: 10px; }
  td.bar { width: 35%; padding-left: 10px; } td.bar div { height: 6px; background: ${ACCENT}; border-radius: 3px; }
  .chart { margin-top: 10px; page-break-inside: avoid; }
  .fig { font-weight: 600; }
  .note { color: ${MUTED}; font-size: 10px; margin-top: 6px; }
  section { page-break-inside: avoid; }
  footer { margin-top: 28px; color: ${MUTED}; font-size: 9px; }
</style></head>
<body>
  <h1>${escapeHtml(report.title)}</h1>
  <div class="meta">${escapeHtml(report.rangeLabel)} · ${escapeHtml(report.currency)}</div>
  <div class="trio">
    <div><span>Income</span><b class="in">${money(report.summary.incomeMinor)}</b></div>
    <div><span>Spending</span><b class="out">${money(report.summary.expenseMinor)}</b></div>
    <div><span>Net</span><b>${money(report.summary.netMinor)}</b></div>
  </div>
  ${top ? `<table>${top}</table>` : ''}
  <div class="note">Transfers between your own accounts and balance corrections are not counted. Refunds reduce spending.${
    report.summary.unvaluedCount > 0
      ? ` ${report.summary.unvaluedCount} record(s) have no ${escapeHtml(report.currency)} value and are left out.`
      : ''
  }</div>
  ${sections}
  <footer>Made with Peace on ${stamp}. Figures computed from the ledger; the text was written by Gemini.</footer>
</body></html>`;
}
