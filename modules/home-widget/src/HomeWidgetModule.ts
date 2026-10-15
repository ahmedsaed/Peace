import { requireOptionalNativeModule } from 'expo';

declare class HomeWidgetModule {
  /** Store the snapshot and redraw every placed widget. False without a context. */
  setSnapshot(json: string): boolean;
}

/** Optional, so jest and an APK that predates the module read "unsupported". */
const native = requireOptionalNativeModule<HomeWidgetModule>('HomeWidget');

/** Hand the widgets a new snapshot. Never throws: a widget is never load-bearing. */
export function setWidgetSnapshot(json: string): boolean {
  try {
    return native?.setSnapshot(json) ?? false;
  } catch (e) {
    console.warn('[widget] could not update the home-screen widget', e);
    return false;
  }
}
