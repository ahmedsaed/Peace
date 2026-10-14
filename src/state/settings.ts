import { create } from 'zustand';

import { getCalendars } from 'expo-localization';

import { getSetting, setSetting } from '@/db/settings';
import { configurePeriods, type Weekday } from '@/lib/period';
import { SETTING_DEFAULTS, type SettingKey, type Settings, type WeekStart } from '@/lib/settings';

/**
 * The phone's first day of the week. expo-localization counts 1 = Sunday;
 * `Date.getDay()` counts 0 = Sunday. Monday when the phone will not say.
 */
function phoneWeekStart(): Weekday {
  try {
    const first = getCalendars()[0]?.firstWeekday;
    return typeof first === 'number' && first >= 1 && first <= 7 ? ((first - 1) as Weekday) : 1;
  } catch {
    return 1;
  }
}

export function resolveWeekStart(choice: WeekStart): Weekday {
  if (choice === 'sunday') return 0;
  if (choice === 'monday') return 1;
  if (choice === 'saturday') return 6;
  return phoneWeekStart();
}

/**
 * Hand the period settings to `lib/period.ts`, which every month- and
 * week-shaped query reads. Here, beside the store, because this is the one
 * place both settings are read and written — so the two cannot drift.
 */
function applyPeriods(settings: Settings): void {
  configurePeriods({
    monthStart: settings.monthStartDay,
    weekStart: resolveWeekStart(settings.weekStart),
  });
}

/**
 * Settings, in memory, so a change repaints every screen that depends on it.
 *
 * The database is still the source of truth — this is a write-through cache,
 * not a second copy. Without it, changing the home currency would update the
 * settings screen and leave the accounts total formatted in the old one until
 * the app restarted, which is exactly the "not always up to date" behaviour
 * that makes an app untrustworthy.
 *
 * Reads go through the store; writes go to SQLite first and only then to state,
 * so a failed write cannot leave the UI claiming something the database does
 * not agree with.
 */
type SettingsStore = {
  settings: Settings;
  /** False until the table has been read once. */
  loaded: boolean;
  load: () => void;
  update: <K extends SettingKey>(key: K, value: Settings[K]) => void;
};

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: { ...SETTING_DEFAULTS },
  loaded: false,

  load: () => {
    const loadedSettings = {} as Settings;
    for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
      // A per-key read rather than one SELECT: `getSetting` already resolves a
      // missing or corrupt row to the declared default, and duplicating that
      // decoding here is how the two would eventually disagree.
      loadedSettings[key] = getSetting(key) as never;
    }
    applyPeriods(loadedSettings);
    set({ settings: loadedSettings, loaded: true });
  },

  update: (key, value) => {
    setSetting(key, value);
    set((state) => {
      const settings = { ...state.settings, [key]: value };
      if (key === 'monthStartDay' || key === 'weekStart') applyPeriods(settings);
      return { settings };
    });
  },
}));

/** Read one setting. Components re-render only when that value changes. */
export function useSetting<K extends SettingKey>(key: K): Settings[K] {
  return useSettingsStore((state) => state.settings[key]);
}
