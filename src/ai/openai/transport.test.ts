/**
 * @jest-environment node
 */
import { AiError } from '../error';
import { FLAVORS, type Flavor } from './flavors';
import { chatStepStreaming, checkKey, describeFailure, generateJson, isTransient, listModels, parseModelList } from './transport';

const openai = FLAVORS.openai as Flavor;
const deepseek = FLAVORS.deepseek as Flavor;
const openrouter = FLAVORS.openrouter as Flavor;

type Reply = { status: number; body: unknown; headers?: Record<string, string> };

/** A fetch that answers each call in turn, recording what was sent. */
function scripted(...replies: Reply[]) {
  const sent: { url: string; init: RequestInit; body: any }[] = [];
  const fetchImpl = jest.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, init, body: init.body ? JSON.parse(init.body as string) : null });
    const reply = replies.shift()!;
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: new Headers(reply.headers ?? {}),
      json: async () => reply.body,
    } as unknown as Response;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, sent };
}

const completion = (content: string, finish = 'stop') => ({
  status: 200,
  body: { choices: [{ message: { content }, finish_reason: finish }] },
});

const SCHEMA = { type: 'object', properties: { total: { type: 'number', nullable: true } } } as const;
const read = (flavor: Flavor, fetchImpl: typeof fetch) =>
  generateJson(flavor, 'sk-secret', 'm', [{ text: 'read this' }], SCHEMA, { timeoutMs: 1000, fetchImpl, label: 'test' });

describe('a structured reading', () => {
  it('asks for a strict schema where the provider takes one, with the key in a header', async () => {
    const { fetchImpl, sent } = scripted(completion('{"total":12.5}'));
    expect(await read(openai, fetchImpl)).toEqual({ total: 12.5 });
    expect(sent[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(sent[0].url).not.toContain('sk-secret');
    expect((sent[0].init.headers as Record<string, string>).authorization).toBe('Bearer sk-secret');
    expect(sent[0].body.response_format.type).toBe('json_schema');
    expect(sent[0].body.response_format.json_schema.strict).toBe(true);
    expect(sent[0].body.temperature).toBe(0);
  });

  /** DeepSeek answers `json_schema` with "This response_format type is unavailable now". */
  it('falls back to JSON mode with the schema in the prompt where that is all there is', async () => {
    const { fetchImpl, sent } = scripted(completion('```json\n{"total":3}\n```'));
    expect(await read(deepseek, fetchImpl)).toEqual({ total: 3 });
    expect(sent[0].body.response_format).toEqual({ type: 'json_object' });
    expect(sent[0].body.messages[0].content).toContain('JSON Schema');
  });

  /** OpenAI's reasoning models take no temperature but their own. */
  it('asks again without a temperature when the model refuses one', async () => {
    const { fetchImpl, sent } = scripted(
      { status: 400, body: { error: { message: "Unsupported value: 'temperature'", param: 'temperature' } } },
      completion('{"total":1}')
    );
    expect(await read(openai, fetchImpl)).toEqual({ total: 1 });
    expect(sent[1].body).not.toHaveProperty('temperature');
  });

  it('refuses a reading that was cut off', async () => {
    const { fetchImpl } = scripted(completion('{"tot', 'length'));
    await expect(read(openai, fetchImpl)).rejects.toThrow(/incomplete/);
  });

  it('routes OpenRouter only to hosts that honour every parameter', async () => {
    const { fetchImpl, sent } = scripted(completion('{"total":1}'));
    await read(openrouter, fetchImpl);
    expect(sent[0].body.provider).toEqual({ require_parameters: true });
  });
});

describe('failures', () => {
  /** The same 429 is "slow down" or "no money left", and only one clears by waiting. */
  it('never retries a key with no credit left', () => {
    const quota = { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } };
    expect(isTransient(429, quota)).toBe(false);
    expect(describeFailure(openai, 429, quota, '')).toMatch(/no credit left/);
    expect(isTransient(429, { error: { code: 'rate_limit_exceeded' } })).toBe(true);
    expect(isTransient(402, { error: { message: 'Insufficient Balance' } })).toBe(false);
    expect(describeFailure(deepseek, 402, {}, '')).toMatch(/DeepSeek says this key has no credit left/);
  });

  it("passes the provider's own sentence through for a request it refused", () => {
    expect(describeFailure(openai, 400, { error: { message: 'Invalid image.' } }, '')).toBe(
      'OpenAI refused the request: Invalid image.'
    );
  });

  it('carries the wait a provider asked for', async () => {
    const { fetchImpl } = scripted({ status: 429, body: {}, headers: { 'retry-after': '20' } });
    const failure = (await read(openai, fetchImpl).catch((e: unknown) => e)) as AiError;
    expect(failure).toBeInstanceOf(AiError);
    expect(failure.transient).toBe(true);
    expect(failure.retryAfterMs).toBe(20_000);
  });

  it('treats a network failure as transient, and names the provider', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(read(deepseek, fetchImpl)).rejects.toMatchObject({ transient: true, message: expect.stringMatching(/Could not reach DeepSeek/) });
    warn.mockRestore();
  });
});

describe('keys', () => {
  /** OpenRouter's model list is public: listing proves nothing about a key. */
  it('proves an OpenRouter key on the endpoint that needs one', async () => {
    const { fetchImpl, sent } = scripted({ status: 200, body: { data: {} } });
    await checkKey(openrouter, 'sk-or', { fetchImpl });
    expect(sent[0].url).toBe('https://openrouter.ai/api/v1/key');
  });

  it('refuses a key the provider rejects, in words about the key', async () => {
    const { fetchImpl } = scripted({ status: 401, body: {} });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(checkKey(openai, 'nope', { fetchImpl })).rejects.toThrow('OpenAI did not accept that key');
  });

  it('counts a rate-limited key as a working one', async () => {
    const { fetchImpl } = scripted({ status: 429, body: {} });
    await expect(checkKey(deepseek, 'k', { fetchImpl })).resolves.toBeUndefined();
  });
});

describe('model lists', () => {
  it("reads what DeepSeek's listing declares", () => {
    const models = parseModelList({
      data: [
        { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', input_modalities: ['text', 'image'] },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', input_modalities: ['text'] },
      ],
    });
    expect(models.map((m) => [m.id, m.abilities?.images])).toEqual([
      ['deepseek-flash', true],
      ['deepseek-v4-pro', false],
    ]);
  });

  it("reads OpenRouter's, and leaves out what cannot write text", () => {
    const models = parseModelList({
      data: [
        {
          id: 'qwen/qwen3-vl:free',
          name: 'Qwen3 VL',
          architecture: { input_modalities: ['text', 'image', 'file'], output_modalities: ['text'] },
          supported_parameters: ['tools', 'structured_outputs'],
        },
        { id: 'black-forest-labs/flux', architecture: { input_modalities: ['text'], output_modalities: ['image'] } },
      ],
    });
    expect(models).toHaveLength(1);
    expect(models[0].abilities).toEqual({ images: true, audio: false, pdf: true, tools: true, json: true });
  });

  it("leaves out Mistral's models that cannot chat", () => {
    const models = parseModelList({
      data: [
        { id: 'mistral-small-latest', capabilities: { completion_chat: true, vision: true, function_calling: true } },
        { id: 'mistral-embed', capabilities: { completion_chat: false } },
      ],
    });
    expect(models.map((m) => m.id)).toEqual(['mistral-small-latest']);
    expect(models[0].abilities).toMatchObject({ images: true, tools: true });
  });

  it("asks OpenRouter for its list without sending the key it does not need", async () => {
    const { fetchImpl, sent } = scripted({ status: 200, body: { data: [{ id: 'a/b' }] } });
    await listModels(openrouter, 'sk-or', { fetchImpl });
    expect((sent[0].init.headers as Record<string, string>).authorization).toBeUndefined();
  });
});

describe('a streamed turn', () => {
  function streaming(chunks: string[]) {
    const encoder = new TextEncoder();
    return jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
    })) as unknown as typeof fetch;
  }

  it('shows prose as it arrives and resolves to the finished turn', async () => {
    const line = (delta: object, finish: string | null = null) =>
      `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`;
    const fetchImpl = streaming([
      line({ content: 'You ' }),
      line({ content: 'spent ' }).slice(0, 10),
      line({ content: 'spent ' }).slice(10),
      line({ tool_calls: [{ index: 0, id: 'c', function: { name: 'x', arguments: '{}' } }] }, 'tool_calls'),
      'data: [DONE]\n\n',
    ]);
    const seen: string[] = [];
    const turn = await chatStepStreaming(deepseek, 'k', 'm', { system: 's', contents: [], tools: [] }, {
      fetchImpl,
      onText: (t) => seen.push(t),
    });
    expect(seen).toEqual(['You', 'You spent']);
    expect(turn.parts).toEqual([{ text: 'You spent ' }, { functionCall: { name: 'x', args: {}, id: 'c' } }]);
  });

  it('names an error the provider reports inside the stream', async () => {
    const fetchImpl = streaming([`data: ${JSON.stringify({ error: { message: 'overloaded' } })}\n\n`]);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      chatStepStreaming(openrouter, 'k', 'm', { system: 's', contents: [], tools: [] }, { fetchImpl })
    ).rejects.toMatchObject({ transient: true, message: expect.stringContaining('overloaded') });
  });
});
