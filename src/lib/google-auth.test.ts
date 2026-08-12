/**
 * The token lifecycle, which is the only logic in `google-auth.ts` — everything
 * else is a thin call into the native SDK.
 *
 * An access token lasts about an hour and the SDK caches it, so the copy handed
 * to a Drive call can already be past its expiry with no way to tell in
 * advance. The remedy is to notice the 401, evict THAT token from the cache and
 * ask again — and to do it exactly once, because a second 401 is a revoked
 * grant rather than a stale token.
 */

// The factory must build the mock ITSELF. `jest.mock` is hoisted above the
// imports, so a mock held in an outer `const` is still in its temporal dead
// zone when the factory runs — which surfaces as "cannot read properties of
// undefined" from inside the module under test, rather than as anything to do
// with hoisting.
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
    signIn: jest.fn(),
    signInSilently: jest.fn(),
    signOut: jest.fn(async () => null),
    revokeAccess: jest.fn(async () => null),
    getCurrentUser: jest.fn(() => null),
    getTokens: jest.fn(),
    clearCachedAccessToken: jest.fn(async () => null),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
    SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED',
  },
  isErrorWithCode: (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error,
}));

// `import/first` is disabled deliberately: these imports MUST sit below
// `jest.mock`, and running eslint --fix would move them above it and silently
// un-mock the native module.
/* eslint-disable import/first */
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import {
  connect,
  disconnect,
  DRIVE_APPDATA_SCOPE,
  GoogleAuthError,
  reconnectSilently,
  withDriveToken,
} from './google-auth';
/* eslint-enable import/first */

const mockGoogleSignin = GoogleSignin as unknown as Record<string, jest.Mock>;

const unauthorized = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { status?: number }).status === 401;

const user = (email: string) => ({ type: 'success' as const, data: { user: { email } } });

beforeEach(() => {
  jest.clearAllMocks();
  mockGoogleSignin.getTokens.mockResolvedValue({ accessToken: 'fresh', idToken: 'id' });
});

describe('what is asked of Google', () => {
  it('requests only the app-data scope, and never offline access', async () => {
    mockGoogleSignin.signIn.mockResolvedValue(user('a@b.com'));
    await connect();

    expect(mockGoogleSignin.configure).toHaveBeenCalledWith({ scopes: [DRIVE_APPDATA_SCOPE] });
    // `webClientId` and `offlineAccess` would mint a server credential with
    // nowhere to live — there is no server — and widen the grant for nothing.
    const params = mockGoogleSignin.configure.mock.calls[0][0];
    expect(params).not.toHaveProperty('webClientId');
    expect(params).not.toHaveProperty('offlineAccess');
  });

  it('returns the account that was chosen', async () => {
    mockGoogleSignin.signIn.mockResolvedValue(user('ahmed@example.com'));
    await expect(connect()).resolves.toBe('ahmed@example.com');
  });

  it('reads a cancelled sign-in as cancellation, not as a failure', async () => {
    mockGoogleSignin.signIn.mockResolvedValue({ type: 'cancelled', data: null });
    await expect(connect()).rejects.toThrow(/cancelled/i);
  });

  /**
   * The error that wastes an afternoon. It means the APK's signing certificate
   * is not registered against an Android OAuth client, and the SDK says nothing
   * more than a number.
   */
  it('explains DEVELOPER_ERROR as an unregistered signing certificate', async () => {
    mockGoogleSignin.signIn.mockRejectedValue({ code: 'DEVELOPER_ERROR' });
    await expect(connect()).rejects.toThrow(/signing certificate/i);
  });

  it('explains a device with no Play Services', async () => {
    mockGoogleSignin.hasPlayServices.mockRejectedValueOnce({
      code: 'PLAY_SERVICES_NOT_AVAILABLE',
    });
    await expect(connect()).rejects.toThrow(/Play Services/);
  });

  it('throws GoogleAuthError so the UI can tell it from a Drive failure', async () => {
    mockGoogleSignin.signIn.mockRejectedValue({ code: 'SIGN_IN_CANCELLED' });
    await expect(connect()).rejects.toBeInstanceOf(GoogleAuthError);
  });
});

describe('reconnecting silently on launch', () => {
  it('returns the account when there is a saved grant', async () => {
    mockGoogleSignin.signInSilently.mockResolvedValue(user('ahmed@example.com'));
    await expect(reconnectSilently()).resolves.toBe('ahmed@example.com');
  });

  /**
   * "Not connected" is the ordinary state on every launch before the user sets
   * this up. Throwing would put a failure on the console at every app start.
   */
  it('returns null rather than throwing when nothing is saved', async () => {
    mockGoogleSignin.signInSilently.mockResolvedValue({
      type: 'noSavedCredentialFound',
      data: null,
    });
    await expect(reconnectSilently()).resolves.toBeNull();
  });

  it('returns null when the SDK throws, rather than breaking launch', async () => {
    mockGoogleSignin.signInSilently.mockRejectedValue(new Error('offline'));
    await expect(reconnectSilently()).resolves.toBeNull();
  });
});

/**
 * Disconnecting must not destroy anything. `revokeAccess` withdraws the grant,
 * and Google DELETES the app-data folder when that happens — so a user tapping
 * "Disconnect" to pause backups would silently lose every backup they had.
 */
describe('disconnecting', () => {
  it('signs out and does NOT revoke access', async () => {
    await disconnect();
    expect(mockGoogleSignin.signOut).toHaveBeenCalled();
    expect(mockGoogleSignin.revokeAccess).not.toHaveBeenCalled();
  });

  it('does not throw when sign-out fails — there is nothing to recover', async () => {
    mockGoogleSignin.signOut.mockRejectedValueOnce(new Error('no'));
    await expect(disconnect()).resolves.toBeUndefined();
  });
});

describe('running a Drive call with a token', () => {
  it('passes the token through and returns the result', async () => {
    const call = jest.fn(async (token: string) => `ok:${token}`);
    await expect(withDriveToken(call, unauthorized)).resolves.toBe('ok:fresh');
    expect(call).toHaveBeenCalledTimes(1);
    expect(mockGoogleSignin.clearCachedAccessToken).not.toHaveBeenCalled();
  });

  it('evicts the STALE token specifically, then retries with a new one', async () => {
    mockGoogleSignin.getTokens
      .mockResolvedValueOnce({ accessToken: 'stale', idToken: 'id' })
      .mockResolvedValueOnce({ accessToken: 'renewed', idToken: 'id' });

    const call = jest
      .fn()
      .mockRejectedValueOnce({ status: 401 })
      .mockResolvedValueOnce('ok');

    await expect(withDriveToken(call, unauthorized)).resolves.toBe('ok');

    // The token that failed is the one evicted — clearing anything else would
    // leave the bad one in the cache to fail again.
    expect(mockGoogleSignin.clearCachedAccessToken).toHaveBeenCalledWith('stale');
    expect(call).toHaveBeenNthCalledWith(1, 'stale');
    expect(call).toHaveBeenNthCalledWith(2, 'renewed');
  });

  /**
   * A second 401 is a revoked grant or a scope never granted, not a stale
   * token. Retrying that forever turns a permanent failure into a silent loop.
   */
  it('retries exactly once and then gives up', async () => {
    const call = jest.fn().mockRejectedValue({ status: 401 });
    await expect(withDriveToken(call, unauthorized)).rejects.toMatchObject({ status: 401 });
    expect(call).toHaveBeenCalledTimes(2);
    expect(mockGoogleSignin.clearCachedAccessToken).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failure that is not about the token', async () => {
    // A 403 quota error retried with a fresh token is just a second 403, and
    // it would double every upload attempt against a full Drive.
    const call = jest.fn().mockRejectedValue({ status: 403 });
    await expect(withDriveToken(call, unauthorized)).rejects.toMatchObject({ status: 403 });
    expect(call).toHaveBeenCalledTimes(1);
    expect(mockGoogleSignin.clearCachedAccessToken).not.toHaveBeenCalled();
  });
});
