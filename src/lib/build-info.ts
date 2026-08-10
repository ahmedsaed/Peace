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
