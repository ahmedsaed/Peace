/**
 * Money helpers. The invariant for this whole app: amounts move around as
 * integer minor units, and only become strings at the render boundary.
 */

/** Number of minor units in one major unit, per ISO 4217. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'XAF', 'XOF']);
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'OMR', 'TND', 'LYD']);

/**
 * Currencies whose Intl "symbol" resolves to the bare ISO code on the ICU builds
 * we actually ship on (notably Hermes on Android). Add an entry when a currency
 * renders as a code instead of a symbol on a real device — not based on how it
 * looks in Node, which has fuller ICU data and will mislead you.
 */
const SYMBOL_OVERRIDES: Record<string, string> = {
  EGP: 'E£',
};

export function decimalsFor(currency: string): number {
  const c = currency.toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

/**
 * Parse user input ("12.34", "1,234.5", "-8") into signed minor units.
 * Returns null when the input is not a valid amount, so callers can show a
 * validation error rather than silently writing NaN into the ledger.
 */
export function parseAmountToMinor(input: string, currency = 'USD'): number | null {
  const cleaned = input.replace(/[\s,_]/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;

  const decimals = decimalsFor(currency);
  const negative = cleaned.startsWith('-');
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  const [whole = '0', fraction = ''] = unsigned.split('.');

  // Pad/truncate the fraction to the currency's precision without ever
  // touching floating point.
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  const digits = `${whole || '0'}${paddedFraction}`;
  const value = Number(digits);
  if (!Number.isSafeInteger(value)) return null;

  return negative ? -value : value;
}

/** Convert minor units back to a major-unit number (for charts, not for math). */
export function minorToMajor(minor: number, currency = 'USD'): number {
  return minor / 10 ** decimalsFor(currency);
}

/** Format signed minor units for display, e.g. -1234 -> "-$12.34". */
export function formatMinor(
  minor: number,
  currency = 'USD',
  opts: { showSign?: boolean; locale?: string } = {}
): string {
  const { showSign = false, locale = 'en-US' } = opts;
  const decimals = decimalsFor(currency);
  const value = minorToMajor(minor, currency);
  const code = currency.toUpperCase();

  const base: Intl.NumberFormatOptions = {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: showSign ? 'always' : 'auto',
  };

  // `currencyDisplay: 'narrowSymbol'` works in Node but NOT on Hermes/Android,
  // where the bundled ICU has no narrow symbol for EGP — and it fails *silently*,
  // returning "EGP 12,500.00" rather than throwing. So never trust it: rewrite
  // the currency part ourselves using SYMBOL_OVERRIDES.
  const parts = new Intl.NumberFormat(locale, base).formatToParts(value);
  const override = SYMBOL_OVERRIDES[code];
  if (!override) return parts.map((p) => p.value).join('');

  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.type !== 'currency') {
      out.push(part.value);
      continue;
    }
    out.push(override);
    // en-US renders the ISO code with a trailing space ("EGP 12,500.00").
    // A symbol should hug its number, so drop that separator.
    const next = parts[i + 1];
    if (next?.type === 'literal' && next.value.trim() === '') i++;
  }
  return out.join('');
}

/**
 * Group the integer part of a *partially typed* amount with thousand
 * separators, for the keypad display: "1234.5" -> "1,234.5".
 *
 * Deliberately not `Intl.NumberFormat`: this runs on every keystroke against a
 * string that is often not yet a valid number. `Number("1234.")` is 1234, so
 * formatting it would eat the decimal point the moment it was typed, and
 * `"0.50"` would collapse to `"0.5"` while the user was still entering the
 * second digit. The fraction is therefore passed through untouched, exactly as
 * typed, and only the integer part is grouped.
 *
 * Display only — never parse this back. The calculator's `entry` stays raw.
 */
export function groupDigits(entry: string): string {
  // Anything that is not a plain unsigned decimal is left alone rather than
  // mangled: an error string or a future format should render as-is.
  if (!/^\d*\.?\d*$/.test(entry)) return entry;

  const dot = entry.indexOf('.');
  const whole = dot === -1 ? entry : entry.slice(0, dot);
  const rest = dot === -1 ? '' : entry.slice(dot);

  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + rest;
}

/**
 * Round half AWAY FROM ZERO, which `Math.round` does not do.
 *
 * `Math.round(-0.5)` is -0, because it rounds toward +∞. Applied to money that
 * makes a converted expense and a converted income of the same size come out a
 * unit apart, so a spend and its refund would no longer cancel.
 */
export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Convert minor units from one currency to another.
 *
 * `rate` is the natural human one — how many MAJOR units of `to` you get for
 * one MAJOR unit of `from`. "50" for USD→EGP means fifty pounds to the dollar.
 *
 * The `10 ** (decTo - decFrom)` term is the part that is easy to miss and
 * impossible to notice in an EGP-only app: minor units are not comparable
 * across currencies. Yen has no decimal places, so ¥1000 is 1000 minor units
 * while E£1000 is 100,000 — multiplying by the rate alone would be wrong by a
 * factor of a hundred. Dinars go the other way, with three.
 *
 * Returns an integer, because the result is money and money is integer minor
 * units everywhere else in this app.
 */
export function convertMinor(
  amountMinor: number,
  from: string,
  to: string,
  rate: number
): number {
  if (from.toUpperCase() === to.toUpperCase() && rate === 1) return amountMinor;
  const scale = 10 ** (decimalsFor(to) - decimalsFor(from));

  // `toPrecision(15)` before rounding, because binary floating point cannot
  // hold a decimal rate exactly: E£50.00 at 3.03 yen to the pound comes out as
  // 151.49999999999997 rather than 151.5, and rounds DOWN to ¥151. Trimming to
  // 15 significant digits — well inside a double's ~17 — discards the noise
  // without touching any figure a currency rate could legitimately carry.
  const exact = Number((amountMinor * rate * scale).toPrecision(15));
  return roundHalfAwayFromZero(exact);
}

/** Sum minor units safely. Integers only, so no drift. */
export function sumMinor(amounts: number[]): number {
  return amounts.reduce((acc, n) => acc + n, 0);
}
