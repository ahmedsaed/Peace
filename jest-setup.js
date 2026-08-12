// Silence the reanimated warning about missing native module under Jest.
global.__reanimatedWorkletInit = () => {};

// expo-sqlite has no JS implementation under Node; unit tests should exercise
// pure logic (src/lib) and components, and leave real DB behaviour to E2E.
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execSync: jest.fn(),
    runSync: jest.fn(),
    getAllSync: jest.fn(() => []),
  }),
}));

/**
 * expo-crypto's AES lives in a native module that jest-expo stubs out, so
 * `AESEncryptionKey.import` is not a function under Node.
 *
 * This is NOT a fake — it is the same AES-256-GCM, run through Node's WebCrypto
 * instead of through Android's. That matters, because the test it exists for is
 * the one that proves a backup can be opened on a device that has never seen
 * the phone which wrote it. Stubbing that out would leave the single most
 * important guarantee in this feature unverified until someone lost a phone.
 *
 * What it does NOT prove is that Android's implementation agrees with Node's.
 * Both are AES-GCM, and expo-crypto's own web backend is this same API — but
 * the seal/open round trip is still checked on a real device by the E2E flow.
 */
jest.mock('expo-crypto', () => {
  const nodeCrypto = require('node:crypto');
  const subtle = nodeCrypto.webcrypto.subtle;
  const IV_BYTES = 12;

  class AESSealedData {
    constructor(bytes) {
      this._bytes = Uint8Array.from(bytes);
    }
    /** IV ++ ciphertext ++ tag, matching expo-crypto's own layout. */
    static fromCombined(bytes) {
      return new AESSealedData(bytes);
    }
    async combined() {
      return this._bytes;
    }
  }

  return {
    getRandomBytes: (n) => new Uint8Array(nodeCrypto.randomBytes(n)),
    getRandomBytesAsync: async (n) => new Uint8Array(nodeCrypto.randomBytes(n)),
    randomUUID: () => nodeCrypto.randomUUID(),
    AESSealedData,
    AESEncryptionKey: {
      import: (bytes) =>
        subtle.importKey('raw', Uint8Array.from(bytes), 'AES-GCM', false, ['encrypt', 'decrypt']),
    },
    aesEncryptAsync: async (plaintext, key) => {
      const iv = new Uint8Array(nodeCrypto.randomBytes(IV_BYTES));
      // WebCrypto appends the GCM tag to the ciphertext, which is exactly the
      // "ciphertext ++ tag" half of expo-crypto's combined form.
      const sealed = new Uint8Array(
        await subtle.encrypt({ name: 'AES-GCM', iv }, key, Uint8Array.from(plaintext))
      );
      const combined = new Uint8Array(iv.byteLength + sealed.byteLength);
      combined.set(iv, 0);
      combined.set(sealed, iv.byteLength);
      return new AESSealedData(combined);
    },
    aesDecryptAsync: async (sealedData, key) => {
      const bytes = await sealedData.combined();
      const iv = bytes.slice(0, IV_BYTES);
      const body = bytes.slice(IV_BYTES);
      return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv }, key, body));
    },
  };
});
