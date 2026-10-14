import type { DigitOrder, OperatorSide } from './keypad-layout';

export type WeekStart = 'phone' | 'sunday' | 'monday' | 'saturday';

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
   * The editable half of each prompt — the finance logic, not the contract.
   *
   * What a "total" means, which card is which, what to ignore: that is domain
   * knowledge about one person's money, and they know it better than this file
   * does. The system half — report what you see, prefer a null to an invention,
   * answer in this JSON shape — stays in code, because an instruction that could
   * break the output contract turns a bad sentence into an unparseable reply.
   *
   * Empty means "use the shipped default", so clearing the box is a reset rather
   * than a way to send the model nothing at all.
   */
  receiptGuidance: '' as string,
  bankGuidance: '' as string,

  /**
   * Use AI at all — the master switch over everything that sends to Gemini.
   *
   * Off is a PAUSE, not a removal: the key stays in secure storage, and each
   * feature keeps its own setting, so turning it back on puts everything back
   * as it was. While it is off nothing is sent to Google — the receipt-reading
   * button is gone, bank messages are still captured but wait unread, and Penny
   * is gone from the header and the side menu.
   *
   * ON by default: it only ever matters once a key exists, and somebody who
   * already has a key and Penny switched on must not find them silently
   * disabled by an upgrade.
   */
  aiEnabled: true as boolean,
  /**
   * Read receipts with AI — on its own, so somebody who wants Penny or bank
   * messages need not have a reading button on every photo they attach.
   *
   * ON by default for the same reason as `aiEnabled`: it only does anything
   * once there is a key, and turning a feature off on upgrade would be the app
   * changing its mind behind somebody's back.
   */
  receiptsEnabled: true as boolean,
  /**
   * The assistant — a chat that answers from the ledger. OFF until switched on.
   *
   * Off by default for the same reason the bank sender list starts empty:
   * every question sends what the tools read to answer it — totals, record
   * notes, account names — to Google. That is acceptable, but only once
   * somebody has read the sentence saying so, and the switch that turns it on
   * sits directly beneath that sentence. Turning it on IS the acknowledgement.
   */
  assistantEnabled: false as boolean,
  /**
   * Which model the assistant talks to, separate from `geminiModel`.
   *
   * Reading a receipt and running a multi-step conversation with tools are
   * different jobs with different trade-offs — a cheap fast model is right for
   * the first and may fumble the second — so they are chosen apart.
   */
  assistantModel: 'gemini-flash-latest' as string,
  /**
   * The folder reports were last saved to, as a Storage Access Framework uri.
   *
   * Remembered so "Save" is one tap after the first time. Android keeps the
   * grant across launches; if it has been revoked, or the folder is gone, the
   * save asks again rather than failing. Not a control in Settings — it is
   * changed by saving somewhere else.
   */
  reportFolderUri: '' as string,

  /**
   * The newest release seen on GitHub, and when it was last looked for.
   *
   * CACHED because the answer changes at most once a merge and the check is
   * pure courtesy — asking on every drawer open would be network traffic for
   * nothing. Stored rather than held in memory so the drawer can say something
   * on the FIRST open after a launch, before any request has finished.
   *
   * A build number rather than a version: `1.0.0` has been released five times.
   * Zero means nothing has been found yet, which is also what a failed check
   * leaves behind — there is deliberately no way to distinguish "no update"
   * from "could not ask", because the app does the same thing either way.
   */
  latestBuildSeen: 0 as number,
  latestVersionSeen: '' as string,
  latestReleaseUrl: '' as string,
  lastUpdateCheckAt: 0 as number,

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

  /**
   * Replace every amount on screen with a mask, for reading the app in public.
   *
   * PERSISTED, which is the whole point — someone who works in an open-plan
   * office wants it on, not on again after every launch. That makes the way
   * back out the important part: the eye lives in the app header on every tab
   * rather than behind a settings row, so a masked ledger always shows you the
   * control that unmasks it. A persisted state you cannot see the switch for is
   * indistinguishable from a broken app.
   *
   * SHOULDER PRIVACY ONLY. It does not touch screenshots, screen recording or
   * the recents thumbnail — that is `FLAG_SECURE`, which also blocks the
   * screenshots people legitimately want. Naming this "privacy mode" would
   * promise the stronger thing.
   */
  hideAmounts: false as boolean,

  /**
   * The nightly nudge to write down what the day cost. OFF until asked for.
   *
   * Off by default is not timidity: a notification is the one thing an app can
   * do to somebody who is not looking at it, and an expense tracker that starts
   * talking uninvited gets uninstalled rather than muted.
   *
   * These three are settings rather than secrets and SHOULD travel in a backup
   * — a restored ledger that still reminds you at nine is right. What does not
   * travel is the Android permission, which belongs to the install; see
   * `state/reminders.ts` for why the switch reads the OS back instead of
   * trusting this flag.
   */
  remindersOn: false as boolean,
  /**
   * When to ask, in local wall-clock time. 21:00 — late enough that the day is
   * mostly spent, early enough not to be a sleep interruption.
   *
   * Two numbers rather than a "21:00" string so nothing has to parse a clock,
   * and so a malformed value cannot survive the codec: a number key rejects a
   * string outright and falls back to the default.
   */
  reminderHour: 21 as number,
  reminderMinute: 0 as number,
  /**
   * Ask even on a day already dealt with.
   *
   * The default skips those, on the reasoning that nagging somebody who has
   * already done the thing is how a reminder gets switched off. But that reads
   * the notification as "you have not logged anything", and for somebody
   * building the habit it is the opposite — a fixed daily cue, whose whole
   * value is that it does NOT disappear on the days it is working. Neither
   * reading is wrong, which is why this is a switch rather than a decision made
   * here.
   */
  remindOnQuietDays: false as boolean,
  /**
   * 7-8-9 on top (`calculator`) or 1-2-3 on top (`phone`).
   *
   * A preference of the hands, not of taste: somebody who types amounts on a
   * dialler all day presses the wrong key on a calculator layout, and a wrong
   * digit is the most expensive mistake the record screen can make.
   */
  keypadDigits: 'calculator' as DigitOrder,
  /** Which edge of the keypad the + − × ÷ column sits on. */
  keypadOperators: 'left' as OperatorSide,

  /**
   * The day each month starts on, 1–28 (`lib/period.ts`).
   *
   * For whoever is paid on the 25th: their month runs payday to payday, and a
   * calendar month splits every budget across two of them. Read by every
   * screen that thinks in months — Records, Budgets, Analysis, carry-forward,
   * search's month chips and Penny — through one `periodBounds`, so none of
   * them can disagree about which month a record is in.
   */
  monthStartDay: 1 as number,
  /**
   * The first day of the week: the phone's own, or chosen.
   *
   * Read by exactly two things, because nothing else in the app is week-shaped:
   * the calendar in every date picker, and Penny's week-by-week answers.
   */
  weekStart: 'phone' as WeekStart,

  /**
   * Has this ledger been through the welcome screens?
   *
   * THE DEFAULT IS `true`, and that is the migration. Every install from before
   * onboarding existed — and every backup written by one — has no row for this,
   * and somebody with a year of records must not be greeted as a stranger, on
   * upgrade or on restoring a file. Only a ledger opened for the very first
   * time writes an explicit `false` (`src/lib/first-run.ts`), so "missing"
   * can only ever mean "from before there was a question to ask".
   */
  onboardingDone: true as boolean,
  /**
   * Setup steps finished on purpose, by name (`SETUP_STEPS` in `lib/setup.ts`).
   *
   * Only the steps with no state of their own to read back need this — a
   * currency that was CONFIRMED looks exactly like one left at the detected
   * value. The optional features answer from what they actually are: a
   * reminder is set up when reminders are on, not when a screen was visited.
   */
  setupDone: [] as string[],
  /**
   * Show "Finish setting up" on the Records screen.
   *
   * Off by default for the same reason `onboardingDone` defaults on: an
   * existing ledger never saw the steps it would be counting. A first launch
   * turns it on; dismissing the card, or finishing every step, turns it off.
   */
  setupCard: false as boolean,
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
