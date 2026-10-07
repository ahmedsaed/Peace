/**
 * Money in the assistant's replies is CITED, never typed.
 *
 * Every amount a tool returns is registered here and handed to the model as
 * `{"amount": 1240.5, "currency": "EGP", "cite": "{{t41f3}}"}`. The model is
 * told to write the cite token wherever it means that amount, and the screen
 * swaps each token for a figure rendered through `useMoney`.
 *
 * Two rules that hold only because of this:
 *
 *   MASKING. Money reaches a screen only through `useMoney`, so hiding amounts
 *   covers every figure everywhere. A model writing "E£1,240" in prose would
 *   be the one figure that stays legible while the header says amounts are
 *   hidden — the failure that rule exists to make impossible.
 *
 *   ARITHMETIC. A cited figure came out of the database through the same
 *   predicates every screen uses. A typed figure is whatever the model added up,
 *   and the model is a typist, not an accountant.
 *
 * Refs are `t<turn>f<n>`: the turn is the user message's own sequence number,
 * so refs are unique across the whole history without a counter to keep.
 */

export type Figure = { minor: number; currency: string };

/** What a tool result carries in place of a bare number. */
export type CitedAmount = { amount: number; currency: string; cite: string };

/**
 * `{{t3f2}}`, or `{{t3f2|abs}}` for the SIZE of an amount without its sign.
 * Expenses are negative in the ledger, so a cited saving or overspend read
 * "a cut of -E£18,675" — right figure, wrong sentence. `|abs` lets the prose
 * say how much without the model ever typing the number.
 */
const TOKEN = /\{\{\s*([A-Za-z0-9_.]+)\s*(\|\s*abs\s*)?\}\}/g;

export class FigureBook {
  private readonly added = new Map<string, Figure>();
  private next = 1;

  constructor(
    private readonly prefix: string,
    private readonly decimalsFor: (currency: string) => number,
    private readonly known: Map<string, Figure> = new Map()
  ) {}

  /** Register an amount and return what the model should be shown. */
  cite(minor: number, currency: string): CitedAmount {
    const ref = `${this.prefix}f${this.next++}`;
    // `+ 0` so a negated zero cannot reach the screen as "-E£0.00".
    const figure = { minor: minor + 0, currency: currency.toUpperCase() };
    this.added.set(ref, figure);
    const decimals = this.decimalsFor(figure.currency);
    return {
      amount: Number((figure.minor / 10 ** decimals).toFixed(decimals)),
      currency: figure.currency,
      cite: `{{${ref}}}`,
    };
  }

  get(ref: string): Figure | undefined {
    return this.added.get(ref) ?? this.known.get(ref);
  }

  /** Only what THIS book registered — what gets stored with the tool row. */
  registered(): Record<string, Figure> {
    return Object.fromEntries(this.added);
  }
}

export type Segment = { kind: 'text'; text: string } | { kind: 'figure'; ref: string; abs: boolean };

/** Split prose into text and cite tokens, in order. */
export function splitFigures(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    out.push({ kind: 'figure', ref: match[1], abs: match[2] !== undefined });
    last = at + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** The refs a reply cites, resolved against what is known, for storing with it. */
export function citedFigures(
  text: string,
  lookup: (ref: string) => Figure | undefined
): Record<string, Figure> {
  const out: Record<string, Figure> = {};
  for (const segment of splitFigures(text)) {
    if (segment.kind !== 'figure') continue;
    const figure = lookup(segment.ref);
    if (figure) out[segment.ref] = figure;
  }
  return out;
}

/**
 * Mask figures the model typed instead of citing, when amounts are hidden.
 *
 * THE FALLBACK, not the mechanism — the prompt asks for cites, and this exists
 * because "asked nicely" is not a guarantee. It fails CLOSED on what looks like
 * money: a number beside a currency sign or code, or one written with a
 * thousands separator or two decimals. It leaves dates, years, counts and
 * percentages alone, because "12 Dec", "2025", "3 records" and "40%" are not
 * amounts — and a proportion is deliberately not masked anywhere in this app.
 */
const CURRENCY = String.raw`(?:[A-Z]{3}|E£|[$€£¥₹])`;
const NUMBER = String.raw`\d[\d,]*(?:\.\d+)?`;
const STRAY = new RegExp(
  [
    // E£ 1,240.50 / EGP 1240 / $12
    String.raw`${CURRENCY}\s?-?${NUMBER}`,
    // 1,240.50 EGP / 12 $
    String.raw`-?${NUMBER}\s?${CURRENCY}`,
    // 1,240 or 1,240.50 — a thousands separator is an amount's tell
    String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?`,
    // 12.50 — two decimals, but not part of a date like 2025.12.01
    String.raw`(?<![\d.])\d+\.\d{2}(?![\d.])`,
  ].join('|'),
  'g'
);

export function maskStrayFigures(text: string, mask: string): string {
  return text.replace(STRAY, mask);
}
