/**
 * Preference definitions and their text codec.
 *
 * Pure — no database import — so it is unit-testable and safe to use from
 * anywhere. Database access lives in src/db/settings.ts.
 *
 * SECRETS DO NOT BELONG IN SETTINGS. The settings table is included in backups
 * and exports; the Gemini API key goes in expo-secure-store instead.
 *
 * NOTHING IS DECLARED HERE AHEAD OF THE CODE THAT READS IT. `viewMode` was —
 * a daily/weekly/monthly/yearly range for the Records and Analysis screens —
 * and it sat unread for the whole life of the app because the app turned out to
 * be month-shaped in a way that setting fought: budgets are keyed by month,
 * carry-forward is month to month, and recurring windows are months. It was
 * deleted rather than wired, because a preference the design has outgrown is
 * worse than no preference at all. Ranges can come back as a feature, with the
 * setting that goes with them.
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
  /**
   * Put each day's net beside its date in the records list.
   *
   * Transfers are left out — moving money between your own accounts is not a
   * day's spending, and counting it would make the day you shuffled savings
   * across read exactly like the day you spent them.
   */
  showTotal: true as boolean,
  /** Which Gemini model the AI features call. Not a secret. */
  geminiModel: 'gemini-flash-latest' as string,
  /**
   * Whose SMS messages are worth reading — "CIB", "QNB", a short code.
   *
   * In settings rather than secure storage because it is not a credential and
   * it SHOULD travel in a backup: a restored ledger that still knows which
   * banks to watch is right. Matched case-insensitively as a substring, so one
   * entry covers "CIB", "CIB Bank" and "CIB-Alerts".
   *
   * EMPTY MEANS NOTHING IS READ, never everything. The list starting empty is
   * what stops granting the permission from sending every text message the user
   * receives to Google.
   */
  bankSenders: [] as string[],

  /**
   * How often to copy the database to Google Drive. `off` until connected.
   *
   * These three live in `settings` rather than in secure storage because none
   * of them is a credential — and because they SHOULD travel in a backup. A
   * restored ledger that remembers it was backing up weekly is right; the
   * passphrase, which must not be in the file it encrypts, lives in
   * `secrets.ts` instead.
   */
  driveCadence: 'off' as 'off' | 'daily' | 'weekly' | 'monthly',
  /**
   * Epoch ms of the last SUCCESSFUL upload, 0 for never.
   *
   * Read by the settings row, which reports its age and complains when it is
   * overdue. That is the whole reliability story for a backup that runs when it
   * can rather than on a guaranteed schedule: it cannot promise it ran, so it
   * has to make it obvious when it did not.
   */
  driveLastBackupAt: 0 as number,
  /** The connected account, shown so it is obvious WHERE backups are going. */
  driveAccount: '' as string,
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
