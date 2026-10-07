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
    const minor = figure ? (inline.abs ? Math.abs(figure.minor) : figure.minor) : 0;
    html = figure ? `<span class="fig">${escapeHtml(format(minor, figure.currency))}</span>` : '—';
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
    // Inset from the left edge, so the ring does not sit flush against the
    // page margin while the legend has air on the right.
    const ring = { cx: 16 + size / 2, cy: 24 + size / 2, outer: size / 2, inner: size / 2 - 30 };
    const paths = donutSegments(ring, slices).map((s) => `<path d="${s.path}" fill="${s.slice.color}"/>`);
    // The legend is centred on the RING, not hung from the top: a short legend
    // pinned to the top-left beside a big circle reads as a list that ran out.
    const legendTop = Math.max(36, ring.cy - (slices.length * 20) / 2 + 10);
    const legend = slices.map((slice, i) => {
      const y = legendTop + i * 20;
      return (
        `<rect x="${size + 48}" y="${y - 9}" width="10" height="10" rx="2" fill="${slice.color}"/>` +
        `<text x="${size + 64}" y="${y}" font-size="11" fill="${INK}">${escapeHtml(slice.label)}</text>` +
        `<text x="${width}" y="${y}" font-size="11" fill="${MUTED}" text-anchor="end">${escapeHtml(
          format(slice.amountMinor, chart.currency)
        )} · ${slice.percent.toFixed(1)}%</text>`
      );
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" style="display:block;height:auto">${title}${paths.join('')}${legend.join('')}</svg>`;
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
          // Ticks are round numbers by construction, so ".00" is width spent
          // on nothing — the reason the axis crowded the plot.
          format(tick, chart.currency).replace(/[.,]0+(?=\D*$)/, '')
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

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" style="display:block;height:auto">${title}${grid}${marks}${labels}</svg>`;
}

/**
 * Percentage change, or null when there is nothing to compare with — a rise
 * "from zero" is not a percentage, and printing "+Infinity%" or "+100%" for
 * it would be a number that means nothing while looking exact.
 */
export function percentChange(now: number, before: number): number | null {
  if (before === 0) return null;
  return Math.round(((now - before) / Math.abs(before)) * 100);
}

/**
 * The change line under a cover figure, coloured by whether it is GOOD news —
 * which depends on the figure. Spending going up is red; income going up is
 * green. One colour for "up" would paint a raise as a warning.
 */
function delta(now: number, before: number, upIsGood: boolean, label: string): string {
  const change = percentChange(now, before);
  if (change === null) return `<span class="delta">no ${escapeHtml(label)} figure to compare</span>`;
  if (change === 0) return `<span class="delta">same as ${escapeHtml(label)}</span>`;
  const good = change > 0 === upIsGood;
  return `<span class="delta ${good ? 'good' : 'bad'}">${change > 0 ? '▲' : '▼'} ${Math.abs(change)}% vs ${escapeHtml(label)}</span>`;
}

/** One line of prose — a highlight's value or a takeaway — with its figures. */
function inlineHtml1(text: string, figures: Record<string, Figure>, format: Format): string {
  return parseBlocks(text)
    .map((block) => block.inlines.map((i) => inlineHtml(i, figures, format)).join(''))
    .join(' ');
}

export function reportHtml(report: ReportSpec, format: Format): string {
  const money = (minor: number) => escapeHtml(format(minor, report.currency));
  const generated = new Date(report.generatedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${generated.getFullYear()}-${pad(generated.getMonth() + 1)}-${pad(generated.getDate())}`;
  const prev = report.previous;

  const tiles = [
    { label: 'Income', value: report.summary.incomeMinor, before: prev?.incomeMinor, upIsGood: true, tone: 'in' },
    { label: 'Spending', value: report.summary.expenseMinor, before: prev?.expenseMinor, upIsGood: false, tone: 'out' },
    { label: 'Net', value: report.summary.netMinor, before: prev?.netMinor, upIsGood: true, tone: '' },
  ]
    .map(
      (tile) => `<div class="tile">
        <span class="k">${tile.label}</span>
        <b class="${tile.tone}">${money(tile.value)}</b>
        ${prev && tile.before !== undefined ? delta(tile.value, tile.before, tile.upIsGood, prev.label) : ''}
      </div>`
    )
    .join('');

  const top = report.topCategories
    .map((row) => {
      const change = row.previousMinor === undefined ? null : percentChange(row.valueMinor, row.previousMinor);
      return `<tr>
        <td>${escapeHtml(row.label)}</td>
        <td class="bar"><div style="width:${Math.max(0, Math.min(100, row.percent))}%"></div></td>
        <td class="num muted">${row.percent.toFixed(1)}%</td>
        <td class="num">${money(row.valueMinor)}</td>
        ${
          prev
            ? `<td class="num ${change === null ? 'muted' : change > 0 ? 'bad' : change < 0 ? 'good' : 'muted'}">${
                change === null ? 'new' : `${change > 0 ? '+' : ''}${change}%`
              }</td>`
            : ''
        }
      </tr>`;
    })
    .join('');

  const takeaways = (report.takeaways ?? [])
    .map((line) => `<li>${inlineHtml1(line, report.figures, format)}</li>`)
    .join('');

  const sections = report.sections
    .map((section, i) => {
      const highlights = (section.highlights ?? [])
        .map(
          (h) => `<div class="hl">
            <span class="k">${escapeHtml(h.label)}</span>
            <b>${inlineHtml1(h.value, report.figures, format)}</b>
            ${h.detail ? `<span class="d">${inlineHtml1(h.detail, report.figures, format)}</span>` : ''}
          </div>`
        )
        .join('');
      return `<section>
        <h2><span class="n">${pad(i + 1)}</span>${inlineHtml1(section.heading, report.figures, format)}</h2>
        ${highlights ? `<div class="hls">${highlights}</div>` : ''}
        ${proseHtml(section.body, report.figures, format)}
        ${section.chart ? `<div class="chart">${chartSvg(section.chart, format)}</div>` : ''}
      </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
  @page { margin: 32px 36px; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Roboto, "Segoe UI", sans-serif; color: ${INK}; font-size: 12px; line-height: 1.55; margin: 0; }
  .cover { border-top: 6px solid ${ACCENT}; padding-top: 14px; margin-bottom: 18px; }
  .brand { color: ${ACCENT}; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; }
  h1 { font-size: 24px; line-height: 1.2; margin: 6px 0 2px; }
  .meta { color: ${MUTED}; }
  .overview { font-size: 14px; line-height: 1.6; margin: 14px 0 0; }
  .takeaways { background: #FBF5E9; border-left: 3px solid ${ACCENT}; border-radius: 6px; padding: 10px 14px 10px 30px; margin: 14px 0 0; }
  .takeaways li { margin: 3px 0; }
  .tiles { display: flex; gap: 10px; margin: 18px 0 14px; }
  .tile { flex: 1; border: 1px solid ${LINE}; border-radius: 10px; padding: 10px 12px; }
  .k { display: block; color: ${MUTED}; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.1em; }
  .tile b { display: block; font-size: 17px; margin: 2px 0; }
  .delta { font-size: 10px; color: ${MUTED}; }
  .good { color: ${INCOME}; } .bad { color: ${EXPENSE}; } .muted { color: ${MUTED}; }
  .in { color: ${INCOME}; } .out { color: ${EXPENSE}; }
  h3.sub { font-size: 11px; color: ${MUTED}; text-transform: uppercase; letter-spacing: 0.1em; margin: 18px 0 4px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 5px 0; border-bottom: 1px solid ${LINE}; }
  td.num { text-align: right; white-space: nowrap; padding-left: 10px; }
  td.bar { width: 30%; padding-left: 10px; } td.bar div { height: 6px; background: ${ACCENT}; border-radius: 3px; }
  h2 { font-size: 15px; margin: 26px 0 8px; display: flex; align-items: baseline; gap: 8px; }
  h2 .n { color: ${ACCENT}; font-size: 11px; font-weight: 700; }
  h3 { font-size: 13px; margin: 12px 0 4px; }
  .hls { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 10px; }
  .hl { flex: 1 1 0; min-width: 110px; background: #F6F2EA; border-radius: 8px; padding: 8px 10px; }
  .hl b { display: block; font-size: 14px; margin-top: 2px; }
  .hl .d { display: block; color: ${MUTED}; font-size: 10px; margin-top: 2px; }
  .chart { margin: 12px 0 4px; width: 100%; page-break-inside: avoid; }
  .fig { font-weight: 600; }
  .note { color: ${MUTED}; font-size: 9.5px; margin-top: 6px; }
  section { page-break-inside: avoid; }
  footer { margin-top: 30px; padding-top: 8px; border-top: 1px solid ${LINE}; color: ${MUTED}; font-size: 9px; }
</style></head>
<body>
  <div class="cover">
    <div class="brand">Peace · Report</div>
    <h1>${inlineHtml1(report.title, report.figures, format)}</h1>
    <div class="meta">${escapeHtml(report.rangeLabel)} · ${escapeHtml(report.currency)}</div>
    ${report.overview ? `<p class="overview">${inlineHtml1(report.overview, report.figures, format)}</p>` : ''}
    ${takeaways ? `<ol class="takeaways">${takeaways}</ol>` : ''}
  </div>
  <div class="tiles">${tiles}</div>
  ${top ? `<h3 class="sub">Where it went</h3><table>${top}</table>` : ''}
  <div class="note">Transfers between your own accounts and balance corrections are not counted. Refunds reduce spending.${
    report.summary.unvaluedCount > 0
      ? ` ${report.summary.unvaluedCount} record(s) have no ${escapeHtml(report.currency)} value and are left out.`
      : ''
  }</div>
  ${sections}
  <footer>Made with Peace on ${stamp}. Every figure is computed from your ledger; the words were written by Gemini.</footer>
</body></html>`;
}
