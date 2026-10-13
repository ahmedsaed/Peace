import { useGeminiKeyStore } from './gemini-key';

// The secure store, as an in-memory slot.
let mockStored: string | null = null;
jest.mock('@/lib/secrets', () => ({
  getGeminiKey: async () => (mockStored === null || mockStored.trim() === '' ? null : mockStored),
  setGeminiKey: async (key: string | null) => {
    mockStored = key?.trim() ? key.trim() : null;
  },
}));

beforeEach(() => {
  mockStored = null;
  useGeminiKeyStore.setState({ hasKey: null });
});

/**
 * Penny's card said "Add a Gemini key above" under a key saved a moment
 * earlier on the same screen: it read the key on focus, and adding one is not
 * a focus change. What it watches now has to move the moment the key is saved.
 */
describe('whether there is a Gemini key', () => {
  it('is unknown until it has been asked, so nothing flashes "no key"', () => {
    expect(useGeminiKeyStore.getState().hasKey).toBeNull();
  });

  it('turns true the moment a key is saved, with no re-read by anyone', async () => {
    await useGeminiKeyStore.getState().refresh();
    expect(useGeminiKeyStore.getState().hasKey).toBe(false);

    await useGeminiKeyStore.getState().save('AIzaSyD-1234');
    expect(useGeminiKeyStore.getState().hasKey).toBe(true);
  });

  it('turns false when the key is cleared, and whitespace is not a key', async () => {
    await useGeminiKeyStore.getState().save('AIzaSyD-1234');
    await useGeminiKeyStore.getState().save('   ');
    expect(useGeminiKeyStore.getState().hasKey).toBe(false);
  });

  it('reports what the secure store holds, not what it was told', async () => {
    mockStored = 'AIzaSyD-already-there';
    await useGeminiKeyStore.getState().refresh();
    expect(useGeminiKeyStore.getState().hasKey).toBe(true);
  });
});
