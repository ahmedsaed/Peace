import Constants from 'expo-constants';

import type { BuildInfo } from './version';

/**
 * The values app.config.js baked in at bundle time.
 *
 * Isolated here so everything that formats them stays pure and testable —
 * `expo-constants` cannot be read in a unit test, and mocking it in every test
 * that wants a version string is worse than one boundary module.
 *
 * The fallbacks are not decoration: `expoConfig` is null when the manifest is
 * unavailable, and an About screen that crashes is a worse way to find that out
 * than one reading "unknown".
 */
export const buildInfo: BuildInfo = {
  version: Constants.expoConfig?.version ?? '0.0.0',
  buildNumber: Number(Constants.expoConfig?.extra?.buildNumber ?? 0),
  gitSha: String(Constants.expoConfig?.extra?.gitSha ?? 'unknown'),
  dirty: Boolean(Constants.expoConfig?.extra?.dirty),
};

/**
 * The Android application id this build was made with — read back rather than
 * written down, so the About screen cannot name a package the APK is not.
 */
/**
 * Which app this is — see FLAVORS in app.config.js. Anything unrecognised reads
 * as `oss`, the build that carries the GitHub update check: a build that cannot
 * say what it is should keep the way to find a newer one.
 */
export const flavor: 'oss' | 'play' =
  Constants.expoConfig?.extra?.flavor === 'play' ? 'play' : 'oss';

/**
 * Whether this build looks for its own updates on GitHub. The Play build never
 * does: Play delivers its updates, and its policy forbids any other route.
 */
export const selfUpdates = flavor === 'oss';

export const packageName: string = Constants.expoConfig?.android?.package ?? 'unknown';
