import {
  GeminiError,
  buildRequest,
  describeFailure,
  endpoint,
  extractJson,
  listModels,
  parseModelList,
  readReceipt,
  reasonOf,
} from './gemini';

const IMAGE = 'aGVsbG8='; // "hello" in base64 — the bytes never matter here.

/** The envelope Gemini actually wraps its answer in. */
const reply = (payload: unknown, over: Record<string, unknown> = {}) => ({
  candidates: [
    {
      content: { parts: [{ text: JSON.stringify(payload) }], role: 'model' },
      finishReason: 'STOP',
      ...over,
    },
  ],
});

const ok = (body: unknown) =>
  jest.fn(async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response);

const status = (code: number, body: unknown = {}) =>
  jest.fn(
    async () => ({ ok: false, status: code, json: async () => body }) as unknown as Response
  );

/** Exactly the shape Google returns, captured from a live 400. */
const googleError = (code: number, message: string, reason?: string) => ({
  error: {
    code,
    message,
    status: 'INVALID_ARGUMENT',
    details: reason
      ? [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'googleapis.com' }]
      : [],
  },
});

const READING = { total: 120.5, currency: 'EGP', date: '2026-08-13', merchant: 'Grocery Mart' };

describe('the request', () => {
  it('asks for structured output against the schema', () => {
    // The whole reason this feature does not parse prose: the model answers
    // with the fields, not a sentence about them.
    const body = buildRequest(IMAGE, 'image/jpeg', []) as Record<string, any>;
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema.properties.total).toBeDefined();
  });

  /**
   * Reading a receipt has ONE right answer. Sampling variety is exactly what is
   * not wanted here — the same photo read twice must not give two totals.
   */
  it('asks for no creativity at all', () => {
    expect((buildRequest(IMAGE, 'image/jpeg', []) as any).generationConfig.temperature).toBe(0);
  });

  it('sends the image inline, with its real mime type', () => {
    const parts = (buildRequest(IMAGE, 'image/png', []) as any).contents[0].parts;
    expect(parts[1].inline_data).toEqual({ mime_type: 'image/png', data: IMAGE });
  });

  it('carries the user\'s own category names in the prompt', () => {
    const parts = (buildRequest(IMAGE, 'image/jpeg', ['Groceries']) as any).contents[0].parts;
    expect(parts[0].text).toContain('Groceries');
  });

  /** The model id is user-editable, so a stray slash must not rewrite the path. */
  it('encodes the model name into the url', () => {
    expect(endpoint('gemini-flash-latest')).toMatch(/models\/gemini-flash-latest:generateContent$/);
    expect(endpoint('../../evil')).not.toContain('../');
  });
});

/**
 * Every shape of disappointing reply, all of which arrive as HTTP 200.
 */
describe('digging the reading out of the envelope', () => {
  it('finds the payload in a normal reply', () => {
    expect(extractJson(reply(READING))).toEqual(READING);
  });

  it('names a safety block rather than reporting an empty reading', () => {
    expect(() => extractJson({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(/SAFETY/);
  });

  it('says so when there are no candidates at all', () => {
    expect(() => extractJson({ candidates: [] })).toThrow(/no reading/i);
  });

  /**
   * A TRUNCATED ANSWER IS WORSE THAN NO ANSWER. `MAX_TOKENS` cuts the JSON off
   * mid-string, which either fails to parse or — far worse — parses into an
   * object missing its later fields, so the receipt silently arrives with no
   * date and nobody knows why.
   */
  it('refuses a reading that was cut off', () => {
    const truncated = reply(READING, { finishReason: 'MAX_TOKENS' });
    expect(() => extractJson(truncated)).toThrow(/stopped early \(MAX_TOKENS\)/);
  });

  it('accepts the finish reasons that mean it actually finished', () => {
    expect(extractJson(reply(READING, { finishReason: 'STOP' }))).toEqual(READING);
    expect(() => extractJson(reply(READING, { finishReason: undefined }))).not.toThrow();
  });

  it('refuses an empty or missing text part', () => {
    expect(() => extractJson({ candidates: [{ content: { parts: [] } }] })).toThrow(/empty/i);
    expect(() => extractJson({ candidates: [{ content: { parts: [{ text: '  ' }] } }] })).toThrow(
      /empty/i
    );
    expect(() => extractJson({ candidates: [{}] })).toThrow(/empty/i);
  });

  it('refuses text that is not JSON, which the schema should have prevented', () => {
    const prose = { candidates: [{ content: { parts: [{ text: 'The total is 120 EGP' }] } }] };
    expect(() => extractJson(prose)).toThrow(/could not be read/);
  });

  it('refuses a body that is not an object', () => {
    expect(() => extractJson('nope')).toThrow(GeminiError);
  });
});

/**
 * The model list, so the setting is a dropdown rather than a typed name — a
 * typed model name is a 404 waiting to happen and there is no way to discover
 * the right spelling from inside the app.
 */
describe('listing the models a key can call', () => {
  const model = (name: string, methods: string[], extra: Record<string, unknown> = {}) => ({
    name,
    displayName: `Display ${name}`,
    description: 'A model.',
    supportedGenerationMethods: methods,
    ...extra,
  });

  it('keeps only what can actually generate content', () => {
    // The filter is the API's OWN declaration of what a model does, so it stays
    // right as Google adds and retires them — where a hand-kept list of names
    // to exclude goes stale the first week nobody updates it.
    const parsed = parseModelList({
      models: [
        model('models/gemini-flash-latest', ['generateContent', 'countTokens']),
        model('models/text-embedding-004', ['embedContent']),
        model('models/aqa', ['generateAnswer']),
      ],
    });

    expect(parsed.map((m) => m.id)).toEqual(['gemini-flash-latest']);
  });

  it('strips the models/ prefix, because that is what the endpoint wants', () => {
    const [first] = parseModelList({
      models: [model('models/gemini-2.5-pro', ['generateContent'])],
    });
    expect(first.id).toBe('gemini-2.5-pro');
    expect(endpoint(first.id)).toContain('models/gemini-2.5-pro:generateContent');
  });

  it('falls back to the id when there is no display name', () => {
    const [first] = parseModelList({
      models: [{ name: 'models/x', supportedGenerationMethods: ['generateContent'] }],
    });
    expect(first.label).toBe('x');
  });

  it('returns nothing rather than throwing on a shape it does not know', () => {
    expect(parseModelList(null)).toEqual([]);
    expect(parseModelList({})).toEqual([]);
    expect(parseModelList({ models: 'lots' })).toEqual([]);
    expect(parseModelList({ models: [null, 42, {}] })).toEqual([]);
  });

  it('fetches with the key in a header and asks for a big page', async () => {
    const fetchImpl = ok({ models: [model('models/gemini-flash-latest', ['generateContent'])] });
    const models = await listModels('super-secret', { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain('super-secret');
    expect(url).toContain('pageSize=');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('super-secret');
    expect(models).toHaveLength(1);
  });

  it('refuses to call at all with no key', async () => {
    const fetchImpl = ok({ models: [] });
    await expect(listModels('  ', { fetchImpl })).rejects.toThrow(/No Gemini API key/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blames the key when the key is what is wrong', async () => {
    const body = googleError(400, 'API key not valid.', 'API_KEY_INVALID');
    await expect(listModels('bad', { fetchImpl: status(400, body) })).rejects.toThrow(
      /key was refused/i
    );
  });

  it('says so when a key works but offers nothing usable', async () => {
    // Distinct from a network failure: the key is fine and there is simply
    // nothing to choose, which is a different thing to tell someone.
    const fetchImpl = ok({ models: [model('models/text-embedding-004', ['embedContent'])] });
    await expect(listModels('key', { fetchImpl })).rejects.toThrow(/no usable models/i);
  });
});

describe('reading a receipt end to end', () => {
  it('returns fields the record screen can use', async () => {
    const reading = await readReceipt('key', 'gemini-flash-latest', IMAGE, 'image/jpeg', {
      fetchImpl: ok(reply(READING)),
    });

    expect(reading.amountMinor).toBe(12_050);
    expect(reading.occurredOn).toBe('2026-08-13');
    expect(reading.merchant).toBe('Grocery Mart');
  });

  /**
   * THE KEY GOES IN A HEADER, NOT THE QUERY STRING.
   *
   * A key in a URL is the one that ends up in a proxy log, a crash report or a
   * console line — and this module logs the URL when a read fails.
   */
  it('never puts the key in the url', async () => {
    const fetchImpl = ok(reply(READING));
    await readReceipt('super-secret', 'gemini-flash-latest', IMAGE, 'image/jpeg', { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain('super-secret');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('super-secret');
  });

  it('refuses to call at all with no key', async () => {
    const fetchImpl = ok(reply(READING));
    await expect(
      readReceipt('   ', 'gemini-flash-latest', IMAGE, 'image/jpeg', { fetchImpl })
    ).rejects.toThrow(/No Gemini API key/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  /** Each HTTP failure points at the thing the user can actually change. */
  it.each([
    [401, /key was refused/i],
    [403, /key was refused/i],
    [404, /model does not exist/i],
    [429, /rate-limiting/i],
    [500, /unavailable/i],
  ])('explains a %s in terms of what to fix', async (code, expected) => {
    await expect(
      readReceipt('key', 'm', IMAGE, 'image/jpeg', { fetchImpl: status(code) })
    ).rejects.toThrow(expected);
  });

  /**
   * THE ONE THE STATUS CODE GETS WRONG, found by running it against the real
   * API with a fake key.
   *
   * An invalid key comes back 400 INVALID_ARGUMENT, not 401 or 403 — so mapping
   * on the status alone sent someone whose KEY was wrong off to check their
   * MODEL NAME, which is the single least useful thing to tell them. The reason
   * is in the body; the body is what gets read.
   */
  it('blames the KEY for a 400 that is really a bad key', async () => {
    const body = googleError(400, 'API key not valid. Please pass a valid API key.', 'API_KEY_INVALID');

    await expect(
      readReceipt('bad', 'gemini-flash-latest', IMAGE, 'image/jpeg', {
        fetchImpl: status(400, body),
      })
    ).rejects.toThrow(/key was refused/i);
  });

  it('passes Google\'s own sentence through for a 400 it does not recognise', async () => {
    // "Unable to submit request because it has an empty model name" names the
    // fix exactly; flattening it into a generic apology would lose that.
    const body = googleError(400, 'Unable to submit request because it has an empty model name.');

    await expect(
      readReceipt('key', '', IMAGE, 'image/jpeg', { fetchImpl: status(400, body) })
    ).rejects.toThrow(/empty model name/);
  });

  it('falls back to the status when the error body will not parse', async () => {
    // A proxy or a captive portal answering with HTML. The reading still fails
    // with something a person can act on rather than a JSON exception.
    const broken = jest.fn(
      async () =>
        ({
          ok: false,
          status: 502,
          json: async () => {
            throw new Error('not json');
          },
        }) as unknown as Response
    );

    await expect(
      readReceipt('key', 'm', IMAGE, 'image/jpeg', { fetchImpl: broken })
    ).rejects.toThrow(/unavailable/i);
  });

  it('reads the reason out of the details array', () => {
    expect(reasonOf(googleError(400, 'x', 'API_KEY_INVALID'))).toBe('API_KEY_INVALID');
    expect(reasonOf(googleError(400, 'x'))).toBeNull();
    expect(reasonOf(null)).toBeNull();
    expect(reasonOf({ error: {} })).toBeNull();
  });

  it('names a disabled API rather than blaming the key itself', () => {
    // Different fix entirely: the key is real, the project has not switched the
    // API on. "Check your key" would send someone to regenerate a working key.
    expect(describeFailure(403, googleError(403, 'x', 'SERVICE_DISABLED'))).toMatch(/not enabled/);
  });

  /**
   * Without a timeout a captive portal leaves the button spinning and the user
   * cannot tell whether to wait or to type the amount themselves.
   */
  it('gives up rather than spinning forever', async () => {
    const hang = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        })
    ) as unknown as typeof fetch;

    await expect(
      readReceipt('key', 'm', IMAGE, 'image/jpeg', { fetchImpl: hang, timeoutMs: 10 })
    ).rejects.toThrow(/Could not reach Gemini/);
  });

  /**
   * Friendly sentence for the user, real error for whoever has to fix it. The
   * first version of the rate fetch collapsed the two and cost an hour the
   * first time it failed on a device that plainly had a working network.
   */
  it('logs the real failure while telling the user to type it by hand', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const boom = jest.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as unknown as typeof fetch;

    await expect(
      readReceipt('key', 'm', IMAGE, 'image/jpeg', { fetchImpl: boom })
    ).rejects.toThrow(/Enter the record by hand/);

    expect(warn).toHaveBeenCalledWith(
      '[gemini] receipt read failed',
      expect.stringContaining('generateContent'),
      expect.any(Error)
    );
    // And the key is not in what was logged, because it is in a header.
    expect(JSON.stringify(warn.mock.calls)).not.toContain('key');
    warn.mockRestore();
  });
});
