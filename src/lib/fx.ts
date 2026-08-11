/**
 * Fetching an exchange rate.
 *
 * THE NETWORK IS A CONVENIENCE HERE, NEVER A REQUIREMENT. It fills in a number
 * the user could always type, and every failure path ends with the field simply
 * staying manual. Peace is local-first: a plane, a dead signal or a dead API
 * must never stop a record being saved.
 *
 * Source: Frankfurter (frankfurter.dev), which republishes central-bank
 * reference rates. No API key, no quota, and — the reason it was chosen over
 * the obvious alternatives — its v2 dataset covers EGP. The v1 endpoint carries
 * only the ECB's 31 currencies, which does not include the Egyptian pound and
 * would therefore have been useless for the one conversion this app actually
 * needs.
 */

const BASE_URL = 'https://api.frankfurter.dev/v2/rate';

/** How long a fetched rate is worth reusing before asking again. */
export const RATE_TTL_MS = 6 * 60 * 60 * 1000;

export type FetchedRate = {
  rate: number;
  /** The date the rate is FOR, which is not the date it was fetched. */
  date: string;
  base: string;
  quote: string;
};

export class RateError extends Error {}

export function rateUrl(base: string, quote: string): string {
  return `${BASE_URL}/${encodeURIComponent(base.toUpperCase())}/${encodeURIComponent(
    quote.toUpperCase()
  )}`;
}

/**
 * Validate a response before trusting it with someone's ledger.
 *
 * A rate that arrives as a string, a zero, or a negative number would sail
 * through a naive `body.rate` and write a nonsense amount that looks
 * deliberate. Everything is checked, and anything unexpected is refused rather
 * than coerced.
 */
export function parseRate(body: unknown): FetchedRate {
  if (typeof body !== 'object' || body === null) {
    throw new RateError('The rate service returned something unexpected.');
  }

  const { rate, date, base, quote } = body as Record<string, unknown>;

  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new RateError('The rate service returned an unusable rate.');
  }
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new RateError('The rate service returned no usable date.');
  }

  return {
    rate,
    date,
    base: typeof base === 'string' ? base.toUpperCase() : '',
    quote: typeof quote === 'string' ? quote.toUpperCase() : '',
  };
}

/**
 * How stale the rate is, in whole days, against the day it is being used on.
 *
 * Central banks do not publish at weekends or on holidays, so a rate dated
 * Friday is the correct one to use on a Sunday — it is not an error, and the
 * screen says the date rather than pretending the number is live.
 */
export function ageInDays(rateDate: string, today: Date): number {
  const [y, m, d] = rateDate.split('-').map(Number);
  const rate = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((now - rate) / 86_400_000);
}

/** `11 Aug` — short, because it sits inline under the amount. */
export function formatRateDate(rateDate: string): string {
  const [y, m, d] = rateDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * Fetch one pair.
 *
 * The timeout is the important part: without it a captive portal or a hung
 * connection leaves the button spinning forever, and the user cannot tell
 * whether to wait or to type the number themselves.
 */
export async function fetchRate(
  base: string,
  quote: string,
  { timeoutMs = 8000, fetchImpl = fetch }: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<FetchedRate> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(rateUrl(base, quote), { signal: controller.signal });
    if (!response.ok) {
      throw new RateError(
        response.status === 404
          ? `No published rate for ${base.toUpperCase()} to ${quote.toUpperCase()}.`
          : `The rate service is unavailable (${response.status}).`
      );
    }
    return parseRate(await response.json());
  } catch (error) {
    if (error instanceof RateError) throw error;
    // Offline, DNS failure, timeout, malformed JSON — all the same to the USER,
    // and all recoverable by typing the number. Not all the same to whoever has
    // to work out why it is failing, though: the first version collapsed them
    // into one friendly sentence and left nothing to debug from, which cost an
    // hour the first time it failed on a device that plainly had a network.
    console.warn('[fx] rate fetch failed', rateUrl(base, quote), error);
    throw new RateError('Could not reach the rate service. Type the rate instead.');
  } finally {
    clearTimeout(timer);
  }
}
