/**
 * The one secret this app stores.
 *
 * It used to hold four: a Google client id, a client secret, and the OAuth
 * tokens minted from them. Switching to the native Google Sign-In SDK deleted
 * all three — an Android OAuth client is identified by package name and signing
 * certificate rather than by a secret, and the grant lives against the Google
 * account on the device, so there is no refresh token for this app to keep
 * safe. Credentials you never hold are credentials you cannot leak.
 *
 * What remains is the backup passphrase, and it lives here rather than in the
 * `settings` table for a reason that is worth stating plainly: SETTINGS ARE
 * COPIED INTO EVERY BACKUP. A passphrase stored there would be written inside
 * the very file it encrypts — a sealed backup containing its own key is not
 * encrypted in any meaningful sense — and would be handed to anyone who opened
 * the plain local backup.
 *
 * Storing it at all is a convenience so that an automatic backup can seal
 * without prompting. It is NOT the copy that matters: the one that matters is
 * the one in the user's head, because that is the only one that survives the
 * phone. See `seal.ts`.
 */

import * as SecureStore from 'expo-secure-store';

const PASSPHRASE_KEY = 'peace.drive.passphrase';

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
