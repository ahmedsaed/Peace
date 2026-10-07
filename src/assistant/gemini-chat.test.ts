import { GeminiError } from '../lib/gemini';
import { buildChatRequest, callsOf, chatStep, extractTurn, textOf } from './gemini-chat';

const reply = (parts: unknown[], finishReason = 'STOP') => ({
  candidates: [{ content: { role: 'model', parts }, finishReason }],
});

describe('extractTurn', () => {
  it('returns the parts exactly as received', () => {
    const parts = [{ functionCall: { name: 'summarize', args: { measure: 'expense' } }, thoughtSignature: 'abc' }];
    expect(extractTurn(reply(parts))).toEqual({ role: 'model', parts });
  });

  it('names each disappointing 200', () => {
    expect(() => extractTurn({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(/refused/);
    expect(() => extractTurn({ candidates: [] })).toThrow(/no answer/);
    expect(() => extractTurn(reply([{ text: 'half' }], 'MAX_TOKENS'))).toThrow(/ran out of room/);
    expect(() => extractTurn(reply([], 'STOP'))).toThrow(/empty/);
  });

  it('treats a fumbled tool call as worth retrying', () => {
    try {
      extractTurn(reply([], 'MALFORMED_FUNCTION_CALL'));
      throw new Error('did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(GeminiError);
      expect((error as GeminiError).transient).toBe(true);
    }
  });
});

describe('the request', () => {
  it('carries the system prompt, history and tools in Gemini’s shape', () => {
    const body = buildChatRequest('be brief', [{ role: 'user', parts: [{ text: 'hi' }] }], [
      { name: 'summarize', description: 'adds up' },
    ]) as Record<string, unknown>;
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'be brief' }] });
    expect(body.tools).toEqual([{ functionDeclarations: [{ name: 'summarize', description: 'adds up' }] }]);
    expect(body.toolConfig).toEqual({ functionCallingConfig: { mode: 'AUTO' } });
  });

  it('sends the key in a header, never the URL', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => reply([{ text: 'hi' }]) }));
    await chatStep('key-123', 'gemini-flash-latest', { system: 's', contents: [], tools: [] }, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain('key-123');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('key-123');
  });

  it('says to try again, not to type a record by hand, when Gemini is down', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    await expect(
      chatStep('k', 'm', { system: 's', contents: [], tools: [] }, { fetchImpl: fetchImpl as unknown as typeof fetch })
    ).rejects.toThrow('Gemini is unavailable right now. Try again in a minute.');
  });

  it('stops waiting when the caller aborts', async () => {
    const controller = new AbortController();
    const fetchImpl = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))))
    );
    const pending = chatStep('k', 'm', { system: 's', contents: [], tools: [] }, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow('Stopped.');
  });
});

describe('reading a turn', () => {
  it('separates calls from prose and hides thoughts', () => {
    const content = {
      role: 'model' as const,
      parts: [{ text: 'thinking…', thought: true }, { text: 'Here.' }, { functionCall: { name: 'x' } }],
    };
    expect(textOf(content)).toBe('Here.');
    expect(callsOf(content)).toEqual([{ name: 'x' }]);
  });
});
