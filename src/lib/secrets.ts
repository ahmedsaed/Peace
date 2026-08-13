/**
 * The two secrets this app stores.
 *
 * It used to hold four: a Google client id, a client secret, and the OAuth
 * tokens minted from them. Switching to the native Google Sign-In SDK deleted
 * all three — an Android OAuth client is identified by package name and signing
 * certificate rather than by a secret, and the grant lives against the Google
 * account on the device, so there is no refresh token for this app to keep
 * safe. Credentials you never hold are credentials you cannot leak.
 *
 * BOTH OF THESE LIVE HERE RATHER THAN IN `settings` FOR THE SAME REASON, and it
 * is worth stating plainly: SETTINGS ARE COPIED INTO EVERY BACKUP.
 *
 * For the backup passphrase that is fatal — it would be written inside the very
 * file it encrypts, and a sealed backup containing its own key is not encrypted
 * in any meaningful sense. Storing it at all is only a convenience so an
 * automatic backup can seal without prompting; the copy that matters is the one
 * in the user's head, because that is the one that survives the phone.
 *
 * For the Gemini API key it is nearly as bad: a backup is a file that gets
 * shared, mailed to yourself, and uploaded to Drive, and a billable Google
 * credential riding along inside it is a credential you have published. It is
 * also why the key is never baked into the APK — the user pastes their own into
 * Settings after installing.
 */

import * as SecureStore from 'expo-secure-store';

const PASSPHRASE_KEY = 'peace.drive.passphrase';
const GEMINI_KEY = 'peace.gemini.apikey';

/**
 * Null means "upload unsealed", which is a legitimate choice.
 *
 * A keystore that refuses to open reads as null too. That is the safe
 * direction: the backup goes up unsealed and visibly says so, rather than the
 * app failing to back up at all — but it must never silently seal with a
 * DIFFERENT key, which is why there is no fallback key anywhere in this file.
 */
export async function getPassphrase(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(PASSPHRASE_KEY);
  } catch (error) {
    console.warn('[secrets] could not read the backup passphrase', error);
    return null;
  }
}

export async function setPassphrase(passphrase: string | null): Promise<void> {
  if (passphrase === null || passphrase.length === 0) {
    await SecureStore.deleteItemAsync(PASSPHRASE_KEY);
    return;
  }
  await SecureStore.setItemAsync(PASSPHRASE_KEY, passphrase);
}

/** Whether new backups will be sealed, for the settings row to report. */
export async function sealingEnabled(): Promise<boolean> {
  return (await getPassphrase()) !== null;
}

/**
 * The Gemini key, or null when the user has not set one.
 *
 * Null is a completely ordinary state — reading receipts is optional, and the
 * record screen works exactly as it always has without it. The caller says so
 * and offers Settings rather than treating it as an error.
 */
export async function getGeminiKey(): Promise<string | null> {
  try {
    const stored = await SecureStore.getItemAsync(GEMINI_KEY);
    // An empty string in the store is the same as no key, and would otherwise
    // reach the API as a request guaranteed to 401.
    return stored === null || stored.trim() === '' ? null : stored;
  } catch (error) {
    console.warn('[secrets] could not read the Gemini API key', error);
    return null;
  }
}

export async function setGeminiKey(key: string | null): Promise<void> {
  const trimmed = key?.trim() ?? '';
  if (trimmed === '') {
    await SecureStore.deleteItemAsync(GEMINI_KEY);
    return;
  }
  await SecureStore.setItemAsync(GEMINI_KEY, trimmed);
}

/**
 * Enough of the key to recognise it, and not enough to use it.
 *
 * The Settings row has to show SOMETHING, or there is no way to tell a saved
 * key from an empty field — but printing it in full puts a live credential on
 * screen in every screenshot and every shoulder-surfer's view. The last four
 * characters are how everyone identifies a key they already have.
 */
export function maskKey(key: string | null): string {
  if (key === null || key.trim() === '') return 'Not set';
  const trimmed = key.trim();
  return trimmed.length <= 4 ? '••••' : `••••${trimmed.slice(-4)}`;
}
