/**
 * Money helpers. The invariant for this whole app: amounts move around as
 * integer minor units, and only become strings at the render boundary.
 */

/** Number of minor units in one major unit, per ISO 4217. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'XAF', 'XOF']);
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'OMR', 'TND', 'LYD']);

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

  const formatted = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: showSign ? 'always' : 'auto',
  }).format(minorToMajor(minor, currency));

  return formatted;
}

/** Sum minor units safely. Integers only, so no drift. */
export function sumMinor(amounts: number[]): number {
  return amounts.reduce((acc, n) => acc + n, 0);
}
