import { formatModelRef, legacyModelChoices, parseModelRef, sameModel } from './model-ref';

describe('a stored model choice', () => {
  it('round-trips', () => {
    const ref = { provider: 'deepseek' as const, model: 'deepseek-flash' };
    expect(parseModelRef(formatModelRef(ref))).toEqual(ref);
  });

  /** OpenRouter's ids carry slashes and colons of their own. */
  it('splits on the first colon only', () => {
    expect(parseModelRef('openrouter:qwen/qwen3-vl:free')).toEqual({
      provider: 'openrouter',
      model: 'qwen/qwen3-vl:free',
    });
  });

  it('reads nothing chosen as nothing chosen, never as a default', () => {
    expect(parseModelRef('')).toBeNull();
    expect(formatModelRef(null)).toBe('');
  });

  it('refuses a provider this build does not know, or no model', () => {
    expect(parseModelRef('anthropic:claude')).toBeNull();
    expect(parseModelRef('gemini:')).toBeNull();
    expect(parseModelRef(':gemini-flash-latest')).toBeNull();
    // A bare model name from before providers is not a choice of provider.
    expect(parseModelRef('gemini-flash-latest')).toBeNull();
  });

  it('compares provider and model both', () => {
    expect(sameModel({ provider: 'gemini', model: 'm' }, { provider: 'gemini', model: 'm' })).toBe(true);
    expect(sameModel({ provider: 'gemini', model: 'm' }, { provider: 'openrouter', model: 'm' })).toBe(false);
    expect(sameModel(null, null)).toBe(false);
  });
});

describe('an install from before providers', () => {
  it('keeps every job on the Gemini models it was using', () => {
    expect(legacyModelChoices('gemini-2.5-pro', 'gemini-flash-latest')).toEqual({
      receiptsModel: 'gemini:gemini-2.5-pro',
      bankModel: 'gemini:gemini-2.5-pro',
      voiceModel: 'gemini:gemini-2.5-pro',
      // Gemini hears: no transcription step to read after.
      voiceReadModel: '',
      pennyModel: 'gemini:gemini-flash-latest',
      // Gemini sees: Penny's files stay with Penny.
      pennyFilesModel: 'gemini:gemini-flash-latest',
    });
  });
});
