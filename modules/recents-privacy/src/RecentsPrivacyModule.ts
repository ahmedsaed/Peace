import { requireOptionalNativeModule } from 'expo';

declare class RecentsPrivacyModule {
  /** False where Android has no way to do it (before 13) or no activity. */
  setHidden(hidden: boolean): boolean;
}

/** Optional, so jest and an APK that predates the module read "unsupported". */
const native = requireOptionalNativeModule<RecentsPrivacyModule>('RecentsPrivacy');

/** Blank the recent-apps preview, or show it again. Never throws. */
export function hideFromRecents(hidden: boolean): boolean {
  try {
    return native?.setHidden(hidden) ?? false;
  } catch {
    return false;
  }
}
