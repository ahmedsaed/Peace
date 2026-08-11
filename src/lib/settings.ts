/**
 * Preference definitions and their text codec.
 *
 * Pure — no database import — so it is unit-testable and safe to use from
 * anywhere. Database access lives in src/db/settings.ts.
 *
 * SECRETS DO NOT BELONG IN SETTINGS. The settings table is included in backups
 * and exports; the Gemini API key goes in expo-secure-store instead.
 */

export const SETTING_DEFAULTS = {
  /** ISO 4217. Everything in reporting is converted to this. */
  homeCurrency: 'EGP' as string,
  /**
   * Account pre-selected on a new record, or '' for "whichever comes first".
   *
   * Empty string rather than null so it rides the plain-string codec below —
   * and because "no default" and "the default was deleted" should behave
   * identically. The record screen falls back to the first account either way,
   * so a stale id can never leave the form with no account selected.
   */
  defaultAccountId: '' as string,
  /**
   * Show what each month started with, and the running total.
   *
   * NOT a budget feature. Budget carry-over — an unspent limit growing next
   * month's limit — was considered and rejected: a limit that gets easier every
   * time you fail to use it is not a limit, and the questions it forces (does
   * it compound, does an overspend carry as a debt) all exist because the idea
   * fights itself. What genuinely carries between months is money, so this
   * reports a running cash position and leaves every budget alone.
   */
  carryOver: true as boolean,
  /** Default range for the Records and Analysis screens. */
  viewMode: 'monthly' as 'daily' | 'weekly' | 'monthly' | 'yearly',
  /** Show the running total in list headers. */
  showTotal: true as boolean,
  /** Which Gemini model the AI features call. Not a secret. */
  geminiModel: 'gemini-flash-latest' as string,
};

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = typeof SETTING_DEFAULTS;

/** Values are stored in a text column; strings pass through, everything else is JSON. */
export function encodeSetting<K extends SettingKey>(key: K, value: Settings[K]): string {
  return typeof SETTING_DEFAULTS[key] === 'string' ? String(value) : JSON.stringify(value);
}

export function decodeSetting<K extends SettingKey>(
  key: K,
  raw: string | null | undefined
): Settings[K] {
  const fallback = SETTING_DEFAULTS[key];
  if (raw === null || raw === undefined) return fallback;

  if (typeof fallback === 'string') return raw as Settings[K];

  try {
    const parsed = JSON.parse(raw);
    // A value of the wrong type is as bad as no value — an old build could have
    // written a string where a boolean is now expected.
    if (typeof parsed !== typeof fallback) return fallback;
    return parsed as Settings[K];
  } catch {
    // A corrupt row must never brick the app.
    return fallback;
  }
}
