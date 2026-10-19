import { requireOptionalNativeModule } from 'expo';

declare class NightModeModule {
  /** False where Android has no per-app night mode (before 12) or no context. */
  persist(scheme: 'dark' | 'light' | 'unspecified'): boolean;
}

/** Optional, so jest and an APK that predates the module read "unsupported". */
const native = requireOptionalNativeModule<NightModeModule>('NightMode');

/**
 * Remember dark or light with Android itself, for the next launch's splash.
 * `unspecified` hands the choice back to the phone. Never throws.
 */
export function persistNightMode(scheme: 'dark' | 'light' | 'unspecified'): boolean {
  try {
    return native?.persist(scheme) ?? false;
  } catch (e) {
    console.warn('[theme] could not persist the night mode', e);
    return false;
  }
}
