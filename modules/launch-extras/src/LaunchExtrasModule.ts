import { requireOptionalNativeModule } from 'expo';

declare class LaunchExtrasModule {
  /** String intent extras whose key starts with `peace.`. */
  read(): Record<string, string>;
}

/**
 * Optional, so a JS bundle running against an APK that predates the module —
 * or under jest — reads "no extras" instead of failing the launch.
 */
const native = requireOptionalNativeModule<LaunchExtrasModule>('LaunchExtras');

export function readLaunchExtras(): Record<string, string> {
  try {
    return native?.read() ?? {};
  } catch {
    return {};
  }
}
