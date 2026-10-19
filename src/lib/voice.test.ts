import { readVoice, transcribe } from './gemini';
import {
  buildTranscribePrompt,
  buildVoicePrompt,
  clipClock,
  isEmptyVoiceReading,
  parseTranscript,
  parseVoiceReading,
  VoiceError,
} from './voice';

// A Tuesday. Local time, midday, so no timezone moves it across a day.
const TODAY = new Date(2026, 9, 20, 12, 0);

describe('the record prompt', () => {
  const prompt = buildVoicePrompt({
    today: TODAY,
    accountNames: ['CIB Visa', 'Cash'],
    categoryNames: ['Food', 'Fuel'],
    homeCurrency: 'EGP',
  });

  // "Yesterday" means nothing without today, and a model left to guess counts
  // from its training date.
  it('says what day it is, weekday included', () => {
    expect(prompt).toContain('Today is Tuesday, 2026-10-20.');
  });

  it("offers the ledger's own accounts and categories to choose from", () => {
    expect(prompt).toContain('My accounts: CIB Visa, Cash.');
    expect(prompt).toContain('The categories to choose from: Food, Fuel.');
    expect(prompt).toContain('home currency is EGP');
  });

  it('expects Arabic and English in one sentence, and keeps each in its own script', () => {
    expect(prompt).toMatch(/mixes Arabic .* and English/);
    expect(prompt).toContain('Write Arabic in Arabic');
    expect(prompt).toContain('Do not translate');
  });

  it('puts the user\'s own rules after the contract, and leaves the heading out when there are none', () => {
    expect(prompt).not.toContain("account holder's own rules");
    const ruled = buildVoicePrompt({
      today: TODAY,
      accountNames: [],
      categoryNames: [],
      homeCurrency: 'EGP',
      guidance: '"The card" means CIB Visa.',
    });
    expect(ruled.indexOf('"The card" means CIB Visa.')).toBeGreaterThan(ruled.indexOf('date: yyyy-mm-dd'));
    expect(ruled).toContain('My accounts: none.');
  });
});

describe('the transcription prompt', () => {
  // The text lands in Penny's composer as what the person SAID. A tidied-up
  // question is a model putting words in their mouth.
  it('asks for the words, not an answer or a cleaner question', () => {
    const prompt = buildTranscribePrompt();
    expect(prompt).toContain('word for word');
    expect(prompt).toContain('Do');
    expect(prompt).toMatch(/not translate, summarise, answer or correct/);
  });

  it('reads the text back, and treats nothing heard as empty', () => {
    expect(parseTranscript({ text: '  كام صرفت على fuel الشهر ده؟ ' })).toBe('كام صرفت على fuel الشهر ده؟');
    expect(parseTranscript({ text: null })).toBe('');
    expect(parseTranscript({})).toBe('');
    expect(() => parseTranscript('hello')).toThrow(VoiceError);
  });
});

describe('reading what was said', () => {
  const read = (raw: Record<string, unknown>, currency = 'EGP') => parseVoiceReading(raw, currency, TODAY);

  it('keeps every field a mixed-language sentence offers', () => {
    const reading = read({
      transcript: 'دفعت 250 lunch مع Sara من الـ CIB Visa',
      type: 'expense',
      amount: 250,
      currency: null,
      account: 'CIB Visa',
      category: 'Food',
      note: 'lunch مع Sara',
      date: null,
    });
    expect(reading).toEqual({
      transcript: 'دفعت 250 lunch مع Sara من الـ CIB Visa',
      type: 'expense',
      amountMinor: 25_000,
      currency: null,
      account: 'CIB Visa',
      toAccount: null,
      category: 'Food',
      note: 'lunch مع Sara',
      occurredOn: null,
    });
  });

  // Money is integer minor units, scaled by the currency's own places.
  it('scales by the currency that was said, else by the fallback', () => {
    expect(read({ amount: 12.5, currency: 'usd' }).amountMinor).toBe(1_250);
    expect(read({ amount: 1500, currency: 'JPY' }).amountMinor).toBe(1_500);
    expect(read({ amount: 3.5 }, 'KWD').amountMinor).toBe(3_500);
    // The float trap: 1.005 * 100 is 100.49999…, which would lose a unit.
    expect(read({ amount: 1.005 }).amountMinor).toBe(101);
  });

  it('keeps the amount unsigned — the type decides the side', () => {
    expect(read({ amount: -40, type: 'income' }).amountMinor).toBe(4_000);
  });

  it('drops an amount that is not a sane number', () => {
    expect(read({ amount: '250' }).amountMinor).toBeNull();
    expect(read({ amount: 0 }).amountMinor).toBeNull();
    expect(read({ amount: 5e12 }).amountMinor).toBeNull();
    expect(read({ amount: Number.NaN }).amountMinor).toBeNull();
  });

  it('only accepts a currency that looks like a code', () => {
    expect(read({ currency: 'dollars' }).currency).toBeNull();
    expect(read({ currency: 'جنيه' }).currency).toBeNull();
    expect(read({ currency: 'eur' }).currency).toBe('EUR');
  });

  it('only accepts the three record types', () => {
    expect(read({ type: 'refund' }).type).toBeNull();
    expect(read({ type: 'transfer', to_account: 'Cash' }).type).toBe('transfer');
  });

  // A destination is meaningless on anything but a transfer, and keeping one
  // would let a stray name steer the form.
  it('keeps a destination only on a transfer', () => {
    expect(read({ type: 'transfer', to_account: 'Cash' }).toAccount).toBe('Cash');
    expect(read({ type: 'expense', to_account: 'Cash' }).toAccount).toBeNull();
  });

  describe('dates, which speech only ever gives relatively', () => {
    it('keeps yesterday and a day a few months back', () => {
      expect(read({ date: '2026-10-19' }).occurredOn).toBe('2026-10-19');
      expect(read({ date: '2026-06-01' }).occurredOn).toBe('2026-06-01');
      expect(read({ date: '2026-10-20' }).occurredOn).toBe('2026-10-20');
    });

    it('drops a day in the future — a model counting from the wrong week', () => {
      expect(read({ date: '2026-10-21' }).occurredOn).toBeNull();
    });

    it('drops a day more than a year back — a model counting from the wrong year', () => {
      expect(read({ date: '2025-10-19' }).occurredOn).toBeNull();
      expect(read({ date: '2025-10-20' }).occurredOn).toBe('2025-10-20');
    });

    it('drops a day that does not exist, or is not shaped like one', () => {
      expect(read({ date: '2026-02-30' }).occurredOn).toBeNull();
      expect(read({ date: 'yesterday' }).occurredOn).toBeNull();
      expect(read({ date: '19/10/2026' }).occurredOn).toBeNull();
    });
  });

  it('caps a field a model has started generating into', () => {
    expect(read({ note: 'x'.repeat(5_000) }).note).toHaveLength(200);
  });

  it('refuses only a reply that is not an object', () => {
    expect(() => parseVoiceReading(null, 'EGP', TODAY)).toThrow(VoiceError);
    expect(() => parseVoiceReading('lunch', 'EGP', TODAY)).toThrow(VoiceError);
  });

  // A transcript alone fills nothing in; the screen says so rather than
  // pretending it did something.
  it('counts a reading with only a transcript as empty', () => {
    expect(isEmptyVoiceReading(read({ transcript: 'umm' }))).toBe(true);
    expect(isEmptyVoiceReading(read({ note: 'fuel' }))).toBe(false);
  });
});

describe('the timer', () => {
  it('reads minutes and seconds', () => {
    expect(clipClock(0)).toBe('0:00');
    expect(clipClock(7_900)).toBe('0:07');
    expect(clipClock(60_000)).toBe('1:00');
    expect(clipClock(-5)).toBe('0:00');
  });
});

describe('the requests', () => {
  const reply = (payload: unknown) => ({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] }, finishReason: 'STOP' }],
  });
  const ok = (body: unknown) =>
    jest.fn(async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response);
  const sent = (fetchImpl: jest.Mock) =>
    JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  const CLIP = { base64: 'AAAA', mimeType: 'audio/m4a' };

  it('sends the clip inline after the instructions, and reads the fields back', async () => {
    const fetchImpl = ok(reply({ type: 'expense', amount: 80, note: 'بنزين', category: 'Fuel' }));
    const reading = await readVoice('key', 'gemini-flash-latest', CLIP, {
      today: TODAY,
      accountNames: ['Cash'],
      categoryNames: ['Fuel'],
      homeCurrency: 'EGP',
      fallbackCurrency: 'EGP',
      fetchImpl,
    });

    const body = sent(fetchImpl);
    expect(body.contents[0].parts[0].text).toContain('Today is Tuesday');
    expect(body.contents[0].parts[1]).toEqual({ inline_data: { mime_type: 'audio/m4a', data: 'AAAA' } });
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', temperature: 0 });
    expect(reading).toMatchObject({ type: 'expense', amountMinor: 8_000, note: 'بنزين', category: 'Fuel' });
  });

  it('transcribes for Penny with its own prompt and schema', async () => {
    const fetchImpl = ok(reply({ text: 'how much on fuel this month' }));
    const text = await transcribe('key', 'gemini-flash-latest', CLIP, { fetchImpl });

    const body = sent(fetchImpl);
    expect(body.contents[0].parts[0].text).toContain('Transcribe');
    expect(body.generationConfig.responseSchema.properties).toHaveProperty('text');
    expect(text).toBe('how much on fuel this month');
  });

  // Penny's composer is where somebody stranded by an outage would type, so
  // that is what the sentence tells them to do.
  it('tells Penny\'s user to type when Gemini is down', async () => {
    const fetchImpl = jest.fn(
      async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response
    );
    await expect(transcribe('key', 'm', CLIP, { fetchImpl })).rejects.toThrow('Type the question instead.');
  });
});
