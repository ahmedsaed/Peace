import { GeminiError, retryDelayOf } from '../lib/gemini';
import { MAX_WAIT_MS, RETRY_DELAYS_MS, withRetries, type RetryNotice } from './retry';

const noWait = jest.fn(async () => {});

function failing(errors: Error[], value = 'ok') {
  let n = 0;
  return jest.fn(async () => {
    if (n < errors.length) throw errors[n++];
    return value;
  });
}

beforeEach(() => noWait.mockClear());

describe('withRetries', () => {
  it('tries a rate-limited step again, waiting longer each time', async () => {
    const busy = new GeminiError('Gemini is rate-limiting this key.', true);
    const step = failing([busy, busy]);
    const notices: RetryNotice[] = [];
    await expect(withRetries(step, { wait: noWait, onRetry: (n) => notices.push(n) })).resolves.toBe('ok');
    expect(step).toHaveBeenCalledTimes(3);
    expect(noWait.mock.calls.map((c) => (c as unknown[])[0])).toEqual([RETRY_DELAYS_MS[0], RETRY_DELAYS_MS[1]]);
    expect(notices.map((n) => n.attempt)).toEqual([1, 2]);
  });

  it('never retries what will not pass — a bad key fails at once', async () => {
    const step = failing([new GeminiError('That Gemini API key was refused.', false)]);
    await expect(withRetries(step, { wait: noWait })).rejects.toThrow('refused');
    expect(step).toHaveBeenCalledTimes(1);
  });

  it('gives up after the last delay with the real error', async () => {
    const busy = new GeminiError('Gemini is unavailable right now.', true);
    const step = failing([busy, busy, busy, busy, busy]);
    await expect(withRetries(step, { wait: noWait })).rejects.toBe(busy);
    expect(step).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1);
  });

  it('waits as long as Google asked, when that is longer', async () => {
    const step = failing([new GeminiError('limited', true, 9_000)]);
    await withRetries(step, { wait: noWait });
    expect(noWait).toHaveBeenCalledWith(9_000, undefined);
  });

  it('says the quota is used up instead of waiting an hour', async () => {
    const step = failing([new GeminiError('limited', true, MAX_WAIT_MS * 30)]);
    await expect(withRetries(step, { wait: noWait })).rejects.toThrow(/used up for now. Try again in 30 minutes/);
    expect(noWait).not.toHaveBeenCalled();
  });

  it('does not retry once the user pressed Stop', async () => {
    const controller = new AbortController();
    controller.abort();
    const step = failing([new GeminiError('Stopped.', true)]);
    await expect(withRetries(step, { wait: noWait, signal: controller.signal })).rejects.toThrow('Stopped.');
    expect(step).toHaveBeenCalledTimes(1);
  });

  it('really waits, and a Stop during the wait ends it', async () => {
    const controller = new AbortController();
    const step = failing([new GeminiError('busy', true)]);
    const pending = withRetries(step, { signal: controller.signal, delays: [60_000] });
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toThrow('Stopped.');
  });
});

describe('retryDelayOf', () => {
  it('reads RetryInfo out of a Google error body', () => {
    const body = {
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [] },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '23s' },
        ],
      },
    };
    expect(retryDelayOf(body)).toBe(23_000);
    expect(retryDelayOf({ error: { details: [{ retryDelay: '1.5s' }] } })).toBe(1_500);
    expect(retryDelayOf({})).toBeNull();
  });
});
