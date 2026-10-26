import { anyKey, useAiKeysStore } from './ai-keys';

// The secure store, as in-memory slots per provider.
let mockStored: Record<string, string> = {};
jest.mock('@/lib/secrets', () => ({
  getApiKey: async (provider: string) => {
    const key = mockStored[provider];
    return key === undefined || key.trim() === '' ? null : key;
  },
  setApiKey: async (provider: string, key: string | null) => {
    if (key?.trim()) mockStored[provider] = key.trim();
    else delete mockStored[provider];
  },
}));

// Each provider, as a list of keys it would accept.
let mockValid = new Set<string>();
jest.mock('@/ai', () => {
  const { AiError } = jest.requireActual('@/ai/error');
  return {
    checkKey: async (provider: string, key: string) => {
      if (!mockValid.has(`${provider}:${key.trim()}`)) throw new AiError('That key was not accepted.');
    },
  };
});

beforeEach(() => {
  mockStored = {};
  mockValid = new Set(['gemini:AIzaSyD-1234', 'deepseek:sk-5678']);
  useAiKeysStore.setState({ keys: null });
});

const keys = () => useAiKeysStore.getState().keys;

/**
 * Penny's card said "Add a key above" under a key saved a moment earlier on
 * the same screen: it read the key on focus, and adding one is not a focus
 * change. What it watches now has to move the moment the key is saved.
 */
describe('which providers have a key', () => {
  it('is unknown until it has been asked, so nothing flashes "no key"', () => {
    expect(keys()).toBeNull();
    expect(anyKey(keys())).toBeNull();
  });

  it('turns true the moment a key is saved, with no re-read by anyone', async () => {
    await useAiKeysStore.getState().refresh();
    expect(anyKey(keys())).toBe(false);

    await useAiKeysStore.getState().save('deepseek', 'sk-5678');
    expect(keys()?.deepseek).toBe(true);
    expect(keys()?.gemini).toBe(false);
    expect(anyKey(keys())).toBe(true);
  });

  it('turns false when the key is cleared, and whitespace is not a key', async () => {
    await useAiKeysStore.getState().save('gemini', 'AIzaSyD-1234');
    await useAiKeysStore.getState().save('gemini', '   ');
    expect(keys()?.gemini).toBe(false);
  });

  it('reports what the secure store holds, not what it was told', async () => {
    mockStored = { openrouter: 'sk-or-already-there' };
    await useAiKeysStore.getState().refresh();
    expect(keys()?.openrouter).toBe(true);
  });
});

describe('saving a key', () => {
  it('refuses one the provider rejects, and keeps the key that was there', async () => {
    mockStored = { gemini: 'AIzaSyD-1234' };
    await expect(useAiKeysStore.getState().save('gemini', 'random text')).rejects.toThrow(/not accepted/);
    expect(mockStored.gemini).toBe('AIzaSyD-1234');
  });

  /** A Gemini key is not a DeepSeek key, however valid it is. */
  it('checks the key with the provider it is saved for', async () => {
    await expect(useAiKeysStore.getState().save('deepseek', 'AIzaSyD-1234')).rejects.toThrow();
    expect(mockStored.deepseek).toBeUndefined();
  });

  it('removes without asking anybody anything', async () => {
    mockValid = new Set();
    mockStored = { gemini: 'AIzaSyD-1234' };
    await useAiKeysStore.getState().save('gemini', '');
    expect(mockStored.gemini).toBeUndefined();
  });
});
