import type { Content } from '../content';
import { forGemini, FOREIGN_SIGNATURE } from '../gemini/chat';
import { FLAVORS, type Flavor } from './flavors';
import { StreamFold, toJsonSchema, toMessages, turnFromMessage, userContent } from './translate';

const openai = FLAVORS.openai as Flavor;
const deepseek = FLAVORS.deepseek as Flavor;
const mistral = FLAVORS.mistral as Flavor;

describe('schemas', () => {
  const schema = {
    type: 'object',
    properties: {
      total: { type: 'number', nullable: true },
      direction: { type: 'string', enum: ['out', 'in'], nullable: true },
      note: { type: 'string' },
    },
    required: ['note'],
  } as const;

  /** Strict mode has no optional fields: one that may be absent may be null — a required one may not. */
  it('makes every field required and nullable where it was optional, for strict output', () => {
    expect(toJsonSchema(schema, true)).toEqual({
      type: 'object',
      properties: {
        total: { type: ['number', 'null'] },
        direction: { type: ['string', 'null'], enum: ['out', 'in', null] },
        note: { type: 'string' },
      },
      required: ['total', 'direction', 'note'],
      additionalProperties: false,
    });
  });

  it('keeps tool parameters as declared', () => {
    const out = toJsonSchema(schema, false) as { required: string[]; properties: Record<string, unknown> };
    expect(out.required).toEqual(['note']);
    expect(out.properties.note).toEqual({ type: 'string' });
  });
});

describe('files in a message', () => {
  it('sends an image as a data URL', () => {
    expect(userContent([{ text: 'read' }, { inlineData: { mimeType: 'image/png', data: 'AAA' } }], openai)).toEqual([
      { type: 'text', text: 'read' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
    ]);
  });

  it('writes a PDF the way each provider reads one', () => {
    const pdf = [{ inlineData: { mimeType: 'application/pdf', data: 'JVBE' } }];
    expect(userContent(pdf, openai)).toEqual([
      { type: 'file', file: { filename: 'document.pdf', file_data: 'data:application/pdf;base64,JVBE' } },
    ]);
    expect(userContent(pdf, mistral)).toEqual([
      { type: 'document_url', document_url: 'data:application/pdf;base64,JVBE' },
    ]);
  });

  /** Refused in words before anything is sent, not as a provider's 400. */
  it('says so when the provider cannot read a PDF at all', () => {
    expect(() => userContent([{ inlineData: { mimeType: 'application/pdf', data: 'x' } }], deepseek)).toThrow(
      /DeepSeek cannot read PDFs/
    );
  });

  it('sends a clip in the shape each provider wants', () => {
    const clip = [{ inlineData: { mimeType: 'audio/wav', data: 'UklG' } }];
    expect(userContent(clip, openai)).toEqual([{ type: 'input_audio', input_audio: { data: 'UklG', format: 'wav' } }]);
    expect(userContent(clip, mistral)).toEqual([{ type: 'input_audio', input_audio: 'UklG' }]);
  });

  it('sends plain text as a plain string', () => {
    expect(userContent([{ text: 'a' }, { text: 'b' }], openai)).toBe('a\n\nb');
  });
});

/** A conversation Gemini started, continued by another provider. */
const geminiHistory: Content[] = [
  { role: 'user', parts: [{ text: 'How much on food?' }] },
  {
    role: 'model',
    parts: [
      { text: 'plan', thought: true },
      { functionCall: { name: 'summarize', args: { measure: 'expense' } }, thoughtSignature: 'sig' },
      { functionCall: { name: 'get_balances', args: {} } },
    ],
  },
  {
    role: 'user',
    parts: [
      { functionResponse: { name: 'summarize', response: { total: 1 } } },
      { functionResponse: { name: 'get_balances', response: { total: 2 } } },
    ],
  },
  { role: 'model', parts: [{ text: 'You spent {{t1}}.' }] },
];

describe('a conversation as messages', () => {
  const messages = toMessages('be brief', geminiHistory, deepseek);

  it('opens with the system prompt', () => {
    expect(messages[0]).toEqual({ role: 'system', content: 'be brief' });
  });

  /** Gemini's calls have no ids; OpenAI's format cannot pair an answer without one. */
  it('gives id-less calls ids, and pairs their answers in order', () => {
    const assistant = messages[2] as { tool_calls: { id: string; function: { name: string; arguments: string } }[] };
    expect(assistant.tool_calls.map((c) => c.function.name)).toEqual(['summarize', 'get_balances']);
    expect(JSON.parse(assistant.tool_calls[0].function.arguments)).toEqual({ measure: 'expense' });
    const answers = messages.slice(3, 5) as { role: string; tool_call_id: string; content: string }[];
    expect(answers.map((a) => a.role)).toEqual(['tool', 'tool']);
    expect(answers.map((a) => a.tool_call_id)).toEqual(assistant.tool_calls.map((c) => c.id));
    expect(JSON.parse(answers[1].content)).toEqual({ total: 2 });
  });

  it("never sends Gemini's thoughts or signatures to anybody else", () => {
    expect(JSON.stringify(messages)).not.toContain('plan');
    expect(JSON.stringify(messages)).not.toContain('sig');
  });

  it('keeps ids a provider gave its own calls', () => {
    const own = toMessages('', [
      { role: 'model', parts: [{ functionCall: { name: 'x', id: 'call_9' } }], native: { provider: 'openai' } },
      { role: 'user', parts: [{ functionResponse: { name: 'x', id: 'call_9', response: {} } }] },
    ], openai);
    expect(own[2]).toEqual({ role: 'tool', tool_call_id: 'call_9', content: '{}' });
  });

  /** DeepSeek asks for its reasoning back once tools are involved — and only DeepSeek wants it. */
  it("replays a provider's reasoning to that provider alone", () => {
    const turn: Content = {
      role: 'model',
      parts: [{ functionCall: { name: 'x', id: 'c1' } }],
      native: { provider: 'deepseek', reasoning: 'need a tool' },
    };
    expect(toMessages('', [turn], deepseek)[1]).toMatchObject({ reasoning_content: 'need a tool' });
    expect(toMessages('', [turn], openai)[1]).not.toHaveProperty('reasoning_content');
  });
});

describe('a reply as a turn', () => {
  it('reads prose and calls, and marks whose turn it is', () => {
    const turn = turnFromMessage(
      {
        content: 'Looking.',
        reasoning_content: 'think',
        tool_calls: [{ id: 'c1', function: { name: 'summarize', arguments: '{"measure":"expense"}' } }],
      },
      'tool_calls',
      deepseek
    );
    expect(turn).toEqual({
      role: 'model',
      parts: [{ text: 'Looking.' }, { functionCall: { name: 'summarize', args: { measure: 'expense' }, id: 'c1' } }],
      native: { provider: 'deepseek', reasoning: 'think' },
    });
  });

  /** A call cut off mid-arguments must never be executed. */
  it('refuses a truncated reply, and a call whose arguments are not JSON', () => {
    expect(() => turnFromMessage({ content: 'half' }, 'length', openai)).toThrow(/ran out of room/);
    expect(() =>
      turnFromMessage({ tool_calls: [{ id: 'c', function: { name: 'x', arguments: '{"a":' } }] }, 'tool_calls', openai)
    ).toThrow(/fumbled/);
  });

  it('calls an empty reply transient', () => {
    expect(() => turnFromMessage({ content: '' }, 'stop', openai)).toThrow(
      expect.objectContaining({ transient: true })
    );
  });
});

describe('a streamed reply', () => {
  const event = (delta: Record<string, unknown>, finish: string | null = null) => ({
    choices: [{ delta, finish_reason: finish }],
  });

  it('joins prose, and builds each call from its pieces by index', () => {
    const fold = new StreamFold(deepseek);
    fold.push(event({ reasoning_content: 'th' }));
    fold.push(event({ reasoning_content: 'ink' }));
    expect(fold.push(event({ content: 'You ' }))).toBe('You ');
    expect(fold.push(event({ content: 'spent' }))).toBe('You spent');
    fold.push(event({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'summarize', arguments: '{"me' } }] }));
    fold.push(event({ tool_calls: [{ index: 0, function: { arguments: 'asure":"expense"}' } }] }));
    fold.push(event({}, 'tool_calls'));
    expect(fold.turn()).toEqual({
      role: 'model',
      parts: [{ text: 'You spent' }, { functionCall: { name: 'summarize', args: { measure: 'expense' }, id: 'c1' } }],
      native: { provider: 'deepseek', reasoning: 'think' },
    });
  });

  it('refuses a stream that ended on its length limit', () => {
    const fold = new StreamFold(openai);
    fold.push(event({ content: 'half' }, 'length'));
    expect(() => fold.turn()).toThrow(/ran out of room/);
  });
});

describe('a conversation going back to Gemini', () => {
  const foreign: Content[] = [
    { role: 'user', parts: [{ text: 'q' }] },
    {
      role: 'model',
      parts: [{ functionCall: { name: 'a', id: 'call_1' } }, { functionCall: { name: 'b', id: 'call_2' } }],
      native: { provider: 'deepseek', reasoning: 'r' },
    },
    {
      role: 'user',
      parts: [
        { functionResponse: { name: 'a', id: 'call_1', response: {} } },
        { functionResponse: { name: 'b', id: 'call_2', response: {} } },
      ],
    },
  ];
  const sent = forGemini(foreign);

  it('strips what Gemini does not know, and signs the first call with its placeholder', () => {
    expect(sent[1]).toEqual({
      role: 'model',
      parts: [{ functionCall: { name: 'a' }, thoughtSignature: FOREIGN_SIGNATURE }, { functionCall: { name: 'b' } }],
    });
    expect(sent[2].parts.map((p) => p.functionResponse)).toEqual([
      { name: 'a', response: {} },
      { name: 'b', response: {} },
    ]);
  });

  it("leaves Gemini's own turns exactly as received", () => {
    expect(forGemini(geminiHistory)).toEqual(geminiHistory);
  });
});
