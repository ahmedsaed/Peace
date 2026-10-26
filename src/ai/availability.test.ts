import { describeBlock, jobBlock, voiceRequirements, type AbilityBook } from './availability';

const on = { aiEnabled: true, featureOn: true };
const one = (stored: string, needs: ('json' | 'tools' | 'images' | 'audio')[] = []) => [{ stored, needs }];
const checked = (images: 'yes' | 'no' | 'unknown') => ({
  checked: {
    at: 0,
    json: { result: 'yes' as const },
    tools: { result: 'yes' as const },
    images: { result: images },
    audio: { result: 'no' as const },
  },
});

describe('whether a feature can run', () => {
  it('runs with a chosen model whose provider has a key', () => {
    expect(jobBlock(one('deepseek:deepseek-flash'), { deepseek: true }, {}, on)).toBeNull();
  });

  /** A model nobody picked is a state of its own, never a fallback. */
  it('asks for a model when none was chosen', () => {
    expect(jobBlock(one(''), { gemini: true }, {}, on)).toEqual({ kind: 'no-model' });
  });

  /** A restored backup can name a provider this phone has no key for. */
  it('names the provider whose key is missing, not just "no key"', () => {
    const block = jobBlock(one('openrouter:qwen/qwen3-vl'), { gemini: true }, {}, on);
    expect(block).toEqual({ kind: 'no-key', provider: 'openrouter' });
    expect(describeBlock(block!)).toBe('No OpenRouter key');
  });

  it('puts AI being off before everything, and the feature switch next', () => {
    expect(jobBlock(one(''), {}, {}, { aiEnabled: false, featureOn: true })).toEqual({ kind: 'ai-off' });
    expect(jobBlock(one(''), {}, {}, { aiEnabled: true, featureOn: false })).toEqual({ kind: 'off' });
  });

  it('stops a feature the checks found its model cannot do, and says what', () => {
    const book: AbilityBook = { 'deepseek:deepseek-v4-pro': checked('no') };
    const block = jobBlock(one('deepseek:deepseek-v4-pro', ['json', 'images']), { deepseek: true }, book, on);
    expect(describeBlock(block!)).toBe('deepseek-v4-pro cannot see images');
  });

  /** A check that could not be asked must never read as the model lacking it. */
  it('lets a feature run when a check could not be asked, or was never run', () => {
    const book: AbilityBook = { 'deepseek:deepseek-flash': checked('unknown') };
    expect(jobBlock(one('deepseek:deepseek-flash', ['images']), { deepseek: true }, book, on)).toBeNull();
    expect(jobBlock(one('openai:gpt-5', ['images']), { openai: true }, {}, on)).toBeNull();
  });

  it("trusts the provider's own listing until the checks have answered", () => {
    const book: AbilityBook = { 'openrouter:a/b': { declared: { images: false } } };
    expect(jobBlock(one('openrouter:a/b', ['images']), { openrouter: true }, book, on)).toMatchObject({
      kind: 'cannot',
      need: 'images',
    });
  });
});

describe('what voice needs', () => {
  it('needs a model that hears, when one listens', () => {
    expect(voiceRequirements('gemini:g', '', {})).toEqual([{ stored: 'gemini:g', needs: ['json', 'audio'] }]);
  });

  /** A transcription model only writes the words down; something must read them. */
  it('needs a second model to read, when a transcription model listens', () => {
    const book: AbilityBook = { 'openai:gpt-4o-transcribe': { transcription: true } };
    const needs = voiceRequirements('openai:gpt-4o-transcribe', '', book);
    expect(jobBlock(needs, { openai: true }, book, on)).toEqual({ kind: 'no-model' });
    expect(jobBlock(voiceRequirements('openai:gpt-4o-transcribe', 'deepseek:deepseek-flash', book), { openai: true, deepseek: true }, book, on)).toBeNull();
  });
});
