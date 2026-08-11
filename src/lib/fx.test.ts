import { ageInDays, fetchRate, formatRateDate, parseRate, RateError, rateUrl } from './fx';

describe('rateUrl', () => {
  it('builds the v2 single-pair path', () => {
    expect(rateUrl('usd', 'egp')).toBe('https://api.frankfurter.dev/v2/rate/USD/EGP');
  });
});

describe('parseRate', () => {
  it('accepts a well-formed response', () => {
    expect(parseRate({ date: '2026-08-11', base: 'USD', quote: 'EGP', rate: 49.845 })).toEqual({
      rate: 49.845,
      date: '2026-08-11',
      base: 'USD',
      quote: 'EGP',
    });
  });

  /**
   * Every one of these would sail through a naive `body.rate` and write a
   * nonsense amount into the ledger that looks deliberate.
   */
  it.each([
    ['a string rate', { date: '2026-08-11', rate: '49.845' }],
    ['zero', { date: '2026-08-11', rate: 0 }],
    ['a negative rate', { date: '2026-08-11', rate: -49 }],
    ['infinity', { date: '2026-08-11', rate: Number.POSITIVE_INFINITY }],
    ['NaN', { date: '2026-08-11', rate: Number.NaN }],
    ['no rate at all', { date: '2026-08-11' }],
  ])('refuses %s', (_label, body) => {
    expect(() => parseRate(body)).toThrow(RateError);
  });

  it('refuses a response with no usable date', () => {
    // The date is what tells the user how fresh the number is. Without it the
    // rate is unattributable, which is worse than absent.
    expect(() => parseRate({ rate: 49.845 })).toThrow(/date/);
    expect(() => parseRate({ rate: 49.845, date: 'yesterday' })).toThrow(/date/);
  });

  it('refuses a non-object body', () => {
    for (const body of [null, undefined, 'oops', 42, []]) {
      expect(() => parseRate(body)).toThrow(RateError);
    }
  });
});

describe('ageInDays', () => {
  it('is zero on the day the rate is for', () => {
    expect(ageInDays('2026-08-11', new Date(2026, 7, 11, 23, 59))).toBe(0);
  });

  /**
   * Central banks do not publish at weekends, so a Friday rate IS the right one
   * to use on a Sunday. The screen shows the date rather than treating this as
   * an error.
   */
  it('counts a weekend gap in whole days', () => {
    expect(ageInDays('2026-08-07', new Date(2026, 7, 9))).toBe(2);
  });

  it('is not thrown off by the time of day', () => {
    expect(ageInDays('2026-08-10', new Date(2026, 7, 11, 0, 1))).toBe(1);
    expect(ageInDays('2026-08-10', new Date(2026, 7, 11, 23, 59))).toBe(1);
  });
});

describe('formatRateDate', () => {
  it('is short enough to sit inline under the amount', () => {
    expect(formatRateDate('2026-08-11')).toBe('11 Aug');
  });
});

describe('fetchRate', () => {
  const ok = (body: unknown) =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);

  it('returns the parsed rate', async () => {
    const rate = await fetchRate('USD', 'EGP', {
      fetchImpl: () => ok({ date: '2026-08-11', base: 'USD', quote: 'EGP', rate: 49.845 }),
    });
    expect(rate.rate).toBe(49.845);
  });

  it('explains a pair the service does not publish', async () => {
    await expect(
      fetchRate('USD', 'ZZZ', {
        fetchImpl: () =>
          Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response),
      })
    ).rejects.toThrow(/No published rate for USD to ZZZ/);
  });

  /**
   * The point of the whole module: every failure has to end somewhere the user
   * can still act — by typing the number. None of these may escape as a raw
   * network error.
   */
  it('turns any network failure into an instruction', async () => {
    for (const failure of [
      () => Promise.reject(new TypeError('Network request failed')),
      () => Promise.reject(new DOMException('Aborted', 'AbortError')),
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.reject(new SyntaxError('bad json')),
        } as unknown as Response),
    ]) {
      await expect(fetchRate('USD', 'EGP', { fetchImpl: failure })).rejects.toThrow(
        /Type the rate instead/
      );
    }
  });

  it('gives up rather than hanging forever', async () => {
    // A captive portal leaves the request pending indefinitely; without the
    // timeout the button spins and the user cannot tell whether to wait.
    const start = Date.now();
    await expect(
      fetchRate('USD', 'EGP', {
        timeoutMs: 30,
        fetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            (init?.signal as AbortSignal | undefined)?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            );
          }),
      })
    ).rejects.toThrow(RateError);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
