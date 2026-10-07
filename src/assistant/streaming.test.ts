/**
 * @jest-environment node
 */
import { GeminiError, SseParser } from '../lib/gemini';
import { chatStepStreaming, mergeParts, streamingVisible } from './gemini-chat';

describe('SseParser', () => {
  it('returns events only once a blank line closes them, however the bytes were cut', () => {
    const sse = new SseParser();
    expect(sse.push('data: {"a":')).toEqual([]);
    expect(sse.push('1}\n')).toEqual([]);
    expect(sse.push('\ndata: {"b":2}\n\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('does not split an event on a \\r\\n that arrived in two pieces', () => {
    // Normalising each piece on its own turned "\r" + "\n" into two line
    // breaks — a blank line — and ended the event halfway through its JSON.
    const sse = new SseParser();
    expect(sse.push('data: {"a":1,\r')).toEqual([]);
    expect(sse.push('\ndata: "b":2}\r\n\r\n')).toEqual(['{"a":1,\n"b":2}']);
  });

  it('ignores comments and other fields', () => {
    const sse = new SseParser();
    expect(sse.push(': keep-alive\nevent: x\ndata: 1\n\n')).toEqual(['1']);
  });
});

describe('mergeParts', () => {
  it('joins prose fragments into one part', () => {
    const merged = mergeParts(mergeParts([], [{ text: 'You spent ' }]), [{ text: '{{t1f1}}.' }]);
    expect(merged).toEqual([{ text: 'You spent {{t1f1}}.' }]);
  });

  it('keeps a signature that arrives on a final empty part', () => {
    const merged = mergeParts([{ text: 'Done' }], [{ text: '', thoughtSignature: 'sig' }]);
    expect(merged).toEqual([{ text: 'Done', thoughtSignature: 'sig' }]);
    // …and never folds new text into a part that already carries one.
    expect(mergeParts(merged, [{ text: ' more' }])).toHaveLength(2);
  });

  it('keeps calls whole and in order, and thoughts apart from prose', () => {
    const merged = mergeParts([], [
      { text: 'plan', thought: true },
      { text: 'Looking. ' },
      { functionCall: { name: 'summarize', args: {} }, thoughtSignature: 's1' },
      { functionCall: { name: 'get_balances', args: {} } },
    ]);
    expect(merged.map((p) => p.functionCall?.name ?? (p.thought ? 'thought' : 'text'))).toEqual([
      'thought',
      'text',
      'summarize',
      'get_balances',
    ]);
    expect(merged[2].thoughtSignature).toBe('s1');
  });
});

describe('streamingVisible', () => {
  it('holds back a cite token until it closes', () => {
    expect(streamingVisible('You spent {{t3')).toBe('You spent ');
    expect(streamingVisible('You spent {')).toBe('You spent ');
    expect(streamingVisible('You spent {{t3f1}} on')).toBe('You spent {{t3f1}} on');
  });

  it('closes an unfinished bold run', () => {
    expect(streamingVisible('That is **a lot')).toBe('That is **a lot**');
    expect(streamingVisible('**done** here')).toBe('**done** here');
  });
});

/** A fake streaming response that delivers `pieces` one read at a time. */
function streamed(pieces: string[], status = 200) {
  const encoder = new TextEncoder();
  return jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const piece of pieces) controller.enqueue(encoder.encode(piece));
        controller.close();
      },
    }),
  })) as unknown as typeof fetch;
}

const event = (parts: unknown[], finishReason?: string) =>
  `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts }, ...(finishReason ? { finishReason } : {}) }] })}\r\n\r\n`;

describe('chatStepStreaming', () => {
  const request = { system: 's', contents: [], tools: [] };

  it('reports the prose as it grows and resolves to the whole turn', async () => {
    const seen: string[] = [];
    const fetchImpl = streamed([
      event([{ text: 'You spent ' }]),
      event([{ text: '{{t1f1}} on ' }]).slice(0, 30),
      event([{ text: '{{t1f1}} on ' }]).slice(30),
      event([{ text: 'fuel.' }], 'STOP'),
    ]);
    const content = await chatStepStreaming('k', 'm', request, { fetchImpl, onText: (t) => seen.push(t) });
    expect(seen).toEqual(['You spent', 'You spent {{t1f1}} on', 'You spent {{t1f1}} on fuel.']);
    expect(content).toEqual({ role: 'model', parts: [{ text: 'You spent {{t1f1}} on fuel.' }] });
  });

  it('asks the streaming endpoint for SSE, with the key in a header', async () => {
    const fetchImpl = streamed([event([{ text: 'hi' }], 'STOP')]);
    await chatStepStreaming('key-1', 'gemini-x', request, { fetchImpl });
    const [url, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/gemini-x:streamGenerateContent\?alt=sse$/);
    expect(url).not.toContain('key-1');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('key-1');
  });

  it('delivers a streamed function call intact, signature and all', async () => {
    const fetchImpl = streamed([
      event([{ functionCall: { name: 'summarize', args: { measure: 'expense' } }, thoughtSignature: 'abc' }], 'STOP'),
    ]);
    const content = await chatStepStreaming('k', 'm', request, { fetchImpl });
    expect(content.parts).toEqual([
      { functionCall: { name: 'summarize', args: { measure: 'expense' } }, thoughtSignature: 'abc' },
    ]);
  });

  it('rejects a stream that ran out of room, as an unstreamed reply would be', async () => {
    const fetchImpl = streamed([event([{ text: 'half' }], 'MAX_TOKENS')]);
    await expect(chatStepStreaming('k', 'm', request, { fetchImpl })).rejects.toThrow(/ran out of room/);
  });

  it('maps an HTTP failure to the same sentence as the unstreamed path', async () => {
    const fetchImpl = streamed([], 503);
    await expect(chatStepStreaming('k', 'm', request, { fetchImpl })).rejects.toThrow(
      'Gemini is unavailable right now. Try again in a minute.'
    );
  });

  it('gives up on a stream that goes quiet', async () => {
    const fetchImpl = jest.fn(async (_url: string, init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal!.addEventListener('abort', () => controller.error(new Error('aborted')));
        },
      }),
    })) as unknown as typeof fetch;
    const failure = chatStepStreaming('k', 'm', request, { fetchImpl, idleMs: 20 });
    await expect(failure).rejects.toBeInstanceOf(GeminiError);
    await expect(failure).rejects.toMatchObject({ transient: true });
  });
});
