// Silence the reanimated warning about missing native module under Jest.
global.__reanimatedWorkletInit = () => {};

// expo-sqlite has no JS implementation under Node; unit tests should exercise
// pure logic (src/lib) and components, and leave real DB behaviour to E2E.
//
// `getFirstSync` answers the foreign-keys PRAGMA truthfully and returns nothing
// for everything else. It is here because `db/client.ts` runs that PRAGMA at
// IMPORT time and shouts if it is off — so without it, merely importing any
// component that reaches the settings store (which is any component that shows
// money) fails the whole suite before a single test runs. Answering it with the
// value the real app has is a stub of the environment, not of the behaviour
// under test; a query returning a row here would be a fake.
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execSync: jest.fn(),
    runSync: jest.fn(),
    getAllSync: jest.fn(() => []),
    getFirstSync: jest.fn((sql) =>
      String(sql).includes('foreign_keys') ? { foreign_keys: 1 } : undefined
    ),
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
