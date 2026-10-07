import { GeminiError } from '../lib/gemini';

/**
 * Trying a model step again when the failure was the kind that passes.
 *
 * Rate limits (429, RESOURCE_EXHAUSTED), a busy model (503 "high demand",
 * which `flash-latest` answers often enough to be the common case), a dropped
 * connection, a fumbled tool call — `GeminiError.transient` already marks
 * exactly these, and every one of them is likely to work a few seconds later.
 * A bad key, a disabled API or a refused prompt never will, and retrying those
 * only spends requests on the same answer.
 *
 * WAITS GROW, and Google's own number wins. A rate-limited reply often says
 * when the quota frees up (`retryDelay`); asking sooner is another refusal.
 * When that wait is longer than anyone will sit watching a chat — a daily
 * quota used up — it stops and says so rather than spinning for an hour.
 *
 * Nothing is written until a step SUCCEEDS, so a retried step cannot leave
 * half a turn behind; the only thing to undo is the text streamed so far,
 * which the caller clears in `onRetry`.
 */

export const RETRY_DELAYS_MS = [2_000, 5_000, 12_000];
/** Longer than this and it is a quota, not a hiccup. */
export const MAX_WAIT_MS = 60_000;

export type RetryNotice = { attempt: number; waitMs: number; message: string };

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new GeminiError('Stopped.', true));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new GeminiError('Stopped.', true));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function minutes(ms: number): string {
  const m = Math.ceil(ms / 60_000);
  return m <= 1 ? 'a minute' : m < 60 ? `${m} minutes` : 'a while';
}

export async function withRetries<T>(
  attempt: () => Promise<T>,
  {
    delays = RETRY_DELAYS_MS,
    signal,
    onRetry,
    wait = sleep,
  }: {
    delays?: number[];
    signal?: AbortSignal;
    onRetry?: (notice: RetryNotice) => void;
    /** Injected so tests do not sleep. */
    wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  } = {}
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (error) {
      const retryable = error instanceof GeminiError && error.transient && !signal?.aborted;
      if (!retryable || i >= delays.length) throw error;

      const asked = error.retryAfterMs ?? 0;
      if (asked > MAX_WAIT_MS) {
        throw new GeminiError(`Gemini's limit for this key is used up for now. Try again in ${minutes(asked)}.`);
      }
      const waitMs = Math.max(delays[i], asked);
      onRetry?.({ attempt: i + 1, waitMs, message: error.message });
      await wait(waitMs, signal);
    }
  }
}
