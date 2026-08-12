/**
 * Getting a Google Drive access token.
 *
 * This uses the native Google Sign-In SDK, and the reason is not the account
 * picker — it is that an ANDROID OAuth client HAS NO CLIENT SECRET. It is
 * identified by package name plus the SHA-1 of the signing certificate, both of
 * which are properties of the installed APK rather than data the app has to
 * carry. So there is nothing to paste into Settings, nothing to bake in from CI
 * secrets, and nothing extractable from the APK.
 *
 * It also means there is NO REFRESH TOKEN to store. The grant lives against the
 * Google account on the device, and `getTokens` mints a fresh access token from
 * it — so the whole "keep a refresh token safe, notice when it is revoked,
 * remember that a refresh response does not resend it" apparatus simply does
 * not exist here. That apparatus was written first, against the OAuth device
 * flow, and deleting it was the point of switching.
 *
 * The tradeoff paid for that: a native module, and an OAuth client per signing
 * certificate — one for the debug keystore used by `expo run:android`, one for
 * the release keystore that signs the APKs actually installed. An APK signed
 * with a certificate Google does not know about fails sign-in with
 * DEVELOPER_ERROR and nothing more specific, which is why that case is called
 * out by name below.
 */

import {
  GoogleSignin,
  statusCodes,
  isErrorWithCode,
} from '@react-native-google-signin/google-signin';

/**
 * The app's own hidden folder. Invisible in the user's Drive, unreadable by any
 * other app, and removed by Google when they disconnect Peace.
 *
 * Narrow by construction: this grant is INCAPABLE of reading the rest of the
 * user's Drive, whatever happens to the token afterwards.
 */
export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    /** True when the user has to do something; false when retrying may work. */
    readonly needsUser: boolean = true
  ) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

let configured = false;

/**
 * Idempotent, because every entry point has to be able to assume it has run.
 *
 * `webClientId` is deliberately ABSENT. It is required only for `offlineAccess`
 * — an authorization code for a SERVER to exchange for its own refresh token.
 * Peace has no server; asking for offline access would mint a credential with
 * nowhere to live and widen the grant for nothing.
 */
export function configureGoogleDrive(): void {
  if (configured) return;
  GoogleSignin.configure({ scopes: [DRIVE_APPDATA_SCOPE] });
  configured = true;
}

/** Translate the SDK's codes into something a screen can show. */
function describe(error: unknown): GoogleAuthError {
  if (isErrorWithCode(error)) {
    switch (error.code) {
      case statusCodes.SIGN_IN_CANCELLED:
        return new GoogleAuthError('Sign-in cancelled.', true);
      case statusCodes.IN_PROGRESS:
        return new GoogleAuthError('Sign-in is already in progress.', false);
      case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
        return new GoogleAuthError(
          'This device has no usable Google Play Services, so Drive backup cannot run here.',
          true
        );
      case statusCodes.SIGN_IN_REQUIRED:
        return new GoogleAuthError('Connect a Google account to back up to Drive.', true);
    }
    // DEVELOPER_ERROR is the one that wastes an afternoon: it means the APK's
    // signing certificate is not registered against an Android OAuth client, and
    // the SDK reports it with no further detail. A debug build and a release
    // build are signed differently and each needs its own client.
    if (String(error.code) === 'DEVELOPER_ERROR' || String(error.code) === '10') {
      return new GoogleAuthError(
        "Google does not recognise this build's signing certificate. Register its SHA-1 as an Android OAuth client.",
        true
      );
    }
  }
  console.warn('[drive] google sign-in failed', error);
  return new GoogleAuthError('Could not reach Google to sign in.', false);
}

/** The interactive connect. Returns the account that was chosen. */
export async function connect(): Promise<string> {
  configureGoogleDrive();
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (response.type === 'cancelled') {
      throw new GoogleAuthError('Sign-in cancelled.', true);
    }
    return response.data.user.email;
  } catch (error) {
    if (error instanceof GoogleAuthError) throw error;
    throw describe(error);
  }
}

/**
 * Restore the connection without showing anything.
 *
 * Returns null rather than throwing when there is no saved grant — "not
 * connected" is an ordinary state on every launch before the user has set this
 * up, and treating it as an error would put a failure on the console every time
 * the app starts.
 */
export async function reconnectSilently(): Promise<string | null> {
  configureGoogleDrive();
  try {
    const response = await GoogleSignin.signInSilently();
    return response.type === 'success' ? response.data.user.email : null;
  } catch {
    return null;
  }
}

export function currentAccount(): string | null {
  return GoogleSignin.getCurrentUser()?.user.email ?? null;
}

/**
 * Stop backing up.
 *
 * `signOut`, NOT `revokeAccess`. Revoking withdraws the grant entirely, and
 * Google deletes the app-data folder when that happens — so a user tapping
 * "Disconnect" to pause backups would silently destroy every backup they had.
 * Disconnecting and deleting must never be the same gesture.
 */
export async function disconnect(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch (error) {
    console.warn('[drive] sign-out failed', error);
  }
}

export async function accessToken(): Promise<string> {
  configureGoogleDrive();
  try {
    return (await GoogleSignin.getTokens()).accessToken;
  } catch (error) {
    throw describe(error);
  }
}

/**
 * Run a Drive call with a token, and survive that token going stale.
 *
 * THIS IS THE ENTIRE TOKEN LIFECYCLE. An access token lasts about an hour, and
 * the SDK caches it — so the copy handed out here can be past its expiry with
 * no way to tell in advance. The documented remedy is to notice the 401, evict
 * that exact token from the cache, and ask again.
 *
 * Retried ONCE. A second 401 is not a stale token; it is a revoked grant or a
 * scope that was never granted, and retrying that forever would turn a
 * permanent failure into a silent loop.
 */
export async function withDriveToken<T>(
  call: (token: string) => Promise<T>,
  isUnauthorized: (error: unknown) => boolean
): Promise<T> {
  const token = await accessToken();
  try {
    return await call(token);
  } catch (error) {
    if (!isUnauthorized(error)) throw error;

    await GoogleSignin.clearCachedAccessToken(token);
    return call(await accessToken());
  }
}
