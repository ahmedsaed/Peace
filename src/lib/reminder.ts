/**
 * The nightly nudge to write down what the day cost.
 *
 * NO SERVER, AND NO PUSH. A local notification is handed to Android's
 * AlarmManager and posted by the OS whether or not this app is running — the
 * same machinery a clock app uses. Push is the thing that needs FCM and a
 * backend; this needs neither, which is the only reason a local-first expense
 * tracker can have reminders at all.
 *
 * THE RULE THIS MODULE EXISTS TO MAKE STRUCTURAL: no JavaScript runs when a
 * notification fires. Whatever it says was decided when it was SCHEDULED, so
 * "3 bank messages waiting" is a snapshot, not a reading. That single fact
 * shapes everything below.
 *
 * Which is survivable because of an asymmetry worth stating plainly: the counts
 * can only ever be too LOW, never too high. Captures are dismissed and repeats
 * are settled only through the UI, and every one of those paths re-arms — while
 * a new bank message, or midnight making another occurrence due, raises them
 * with no JS involved. So a stale reminder under-reports and the app shows the
 * true number the moment it is opened. A reminder that over-reported would be
 * sending somebody to look for work that is not there.
 *
 * WHY A WINDOW OF ONE-SHOTS RATHER THAN A `DAILY` REPEAT. A repeating trigger
 * is one alarm that can never lapse, which is the reliable shape — but it fires
 * at the next occurrence of its time and cannot be told to sit today out. Both
 * things this reminder must do (carry today's counts, and stay quiet on a day
 * already dealt with) are decisions about ONE occurrence, so the schedule is a
 * rolling window of individual days, rebuilt from scratch every time the app
 * runs. The cost is that the window is finite: an app left unopened for
 * `WINDOW_DAYS` stops reminding. That is a real limit, and it is bounded by the
 * fact that opening the app is what the reminder is asking for — a fortnight of
 * ignoring it is an answer.
 */

import { formatTimeLabel } from '@/lib/period';

/**
 * How many days of reminders to keep armed ahead.
 *
 * Long enough that no ordinary gap in use can exhaust it, short enough that the
 * OS is not holding a year of alarms for an app somebody has abandoned.
 */
export const WINDOW_DAYS = 14;

/** When the reminder is wanted, in local wall-clock time. */
export type ReminderTime = { hour: number; minute: number };

/**
 * What the app knew at the moment the schedule was last rebuilt.
 *
 * Deliberately three plain numbers rather than the rows themselves: this is a
 * snapshot being frozen into a notification, and anything richer would invite
 * copy that goes stale in ways the asymmetry above does not cover.
 */
export type ReminderSubject = {
  /** Bank messages captured and not yet dealt with. */
  waiting: number;
  /** Repeats owed as of today and neither posted nor skipped. */
  due: number;
  /** Whether anything has been written to the ledger today. */
  recordedToday: boolean;
};

export type ReminderEntry = { at: Date; title: string; body: string };

/** The one question the notification is asking, on every day it asks it. */
export const REMINDER_TITLE = 'What did today cost?';

/**
 * The body for a day we know nothing about.
 *
 * Every entry past the first gets this, because a snapshot taken tonight says
 * nothing true about a Thursday nine days out. Naming no number is what keeps
 * it from ever being wrong.
 */
export const GENERIC_BODY = 'Open Peace and log anything you have not.';

/** Plural-aware "3 records" / "1 record", as the entity sheet does it. */
function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * What the nearest reminder says, given what was known when it was armed.
 *
 * The counts come first because they are WORK WAITING — something the app has
 * already done half of and needs a decision on — where the bare nudge is only a
 * question. Somebody with four bank messages sitting unanswered should be told
 * that, not asked how their day went.
 *
 * APPROVED, not read, and the distinction is the app's own. Reading is what the
 * model does to a captured message; APPROVING is what the person does, and it
 * is the word every other surface already uses — a capture is "offered as a
 * record to approve" and sits in no total "until you approve it". The
 * notification asks for the person's action, so it has to name the person's
 * verb. Settings still says "waiting to be read" over its own counter, and
 * correctly: that one counts messages the model has NOT yet read, which is a
 * different number about a different actor.
 */
export function reminderBody(subject: ReminderSubject): string {
  const { waiting, due } = subject;

  if (waiting > 0 && due > 0) {
    return `${plural(waiting, 'bank message')} to approve and ${plural(due, 'repeat')} due.`;
  }
  if (waiting > 0) return `${plural(waiting, 'bank message')} waiting to be approved.`;
  if (due > 0) return `${plural(due, 'repeat')} due today.`;

  return subject.recordedToday ? GENERIC_BODY : 'Nothing recorded yet today.';
}

/** Local midnight at the start of `date`'s day. */
function startOfDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

/**
 * `time` on the day `date` falls in — local, and computed in JS.
 *
 * Never via SQLite's `localtime` or a UTC offset: the same rules as bucketing
 * records by month. A reminder set for 21:00 means 21:00 where the phone is.
 */
export function onDay(date: Date, time: ReminderTime): Date {
  const at = startOfDay(date);
  at.setHours(time.hour, time.minute, 0, 0);
  return at;
}

/**
 * The first time `time` comes round strictly after `now`.
 *
 * Strictly, because arming a notification for the instant that has just passed
 * either fires immediately or is dropped, and both look like a bug.
 */
export function nextOccurrence(time: ReminderTime, now: Date): Date {
  const today = onDay(now, time);
  if (today.getTime() > now.getTime()) return today;

  const tomorrow = new Date(startOfDay(now));
  tomorrow.setDate(tomorrow.getDate() + 1);
  return onDay(tomorrow, time);
}

const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();

/**
 * Should the NEXT occurrence be left unscheduled?
 *
 * Only ever true for a reminder falling later TODAY, and only when there is
 * nothing at all to say: no messages waiting, no repeats due, and the ledger
 * already written to. A reminder on a day somebody has already shown up is
 * noise, and an app that nags people who are doing the thing it wants gets
 * switched off.
 *
 * `onQuietDays` turns that off, because the reasoning above is an assumption
 * about what a reminder is FOR and it is not everyone's. Skipping suits someone
 * who reads it as "you have not logged anything"; a person building the habit
 * wants the same prompt at the same time whether or not yesterday went well,
 * and an app that goes quiet on their good days is taking away the cue exactly
 * when it is working.
 *
 * The same-day guard is the part that is easy to miss. `recordedToday` is a
 * fact about today; if it is already past the reminder time the next occurrence
 * is TOMORROW, and tomorrow knows nothing about what was written today.
 */
export function skipsNext(
  subject: ReminderSubject,
  next: Date,
  now: Date,
  onQuietDays = false
): boolean {
  if (onQuietDays) return false;
  if (!sameDay(next, now)) return false;
  return subject.waiting === 0 && subject.due === 0 && subject.recordedToday;
}

/**
 * The whole schedule, rebuilt from nothing.
 *
 * Returned rather than applied so the decision is testable without a device —
 * the part of this feature that can be wrong is all here, and the part that
 * talks to Android is a loop over what this returns.
 */
export type ReminderPlanOptions = {
  /** How many days to arm ahead. */
  days?: number;
  /** Ask even on a day already dealt with. See `skipsNext`. */
  onQuietDays?: boolean;
};

export function planReminders(
  subject: ReminderSubject,
  time: ReminderTime,
  now: Date,
  { days = WINDOW_DAYS, onQuietDays = false }: ReminderPlanOptions = {}
): ReminderEntry[] {
  const first = nextOccurrence(time, now);
  const entries: ReminderEntry[] = [];

  for (let i = 0; i < days; i += 1) {
    const at = new Date(first);
    at.setDate(at.getDate() + i);

    // Re-derive the wall clock after moving the date: adding 24h across a DST
    // boundary lands an hour out, and a reminder that drifts by an hour twice a
    // year looks like the app losing the setting.
    const on = onDay(at, time);

    if (i === 0) {
      if (skipsNext(subject, on, now, onQuietDays)) continue;
      entries.push({ at: on, title: REMINDER_TITLE, body: reminderBody(subject) });
      continue;
    }

    entries.push({ at: on, title: REMINDER_TITLE, body: GENERIC_BODY });
  }

  return entries;
}

/**
 * The settings line, which reports what the OS is actually holding.
 *
 * Not what the setting says: a switch reading "on" over a schedule Android
 * dropped is the exact failure this feature is most prone to, and the only
 * defence is showing the readback rather than the intent.
 *
 * "AROUND", never "at". These are inexact alarms — Peace does not hold
 * `SCHEDULE_EXACT_ALARM`, which Android 14+ denies by default anyway — so
 * AlarmManager gives each one a delivery window and fires inside it. Measured
 * on a device: about two minutes of slack on an imminent alarm and a full HOUR
 * on one a day out. That is a good trade, because the alternative is sending
 * somebody into system settings to grant an alarm-clock permission for a nudge
 * about lunch. But a line promising 9:00 PM over a notification that lands at
 * 9:20 is the app being wrong about the one thing this row exists to report.
 */
export function describeNext(next: Date | null, now: Date): string {
  if (!next) return 'Nothing scheduled — reopen Peace to set it again';

  const clock = formatTimeLabel(next);
  if (sameDay(next, now)) return `Next reminder today around ${clock}`;

  const tomorrow = new Date(startOfDay(now));
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(next, tomorrow)) return `Next reminder tomorrow around ${clock}`;

  return `Next reminder ${next.getDate()}/${next.getMonth() + 1} around ${clock}`;
}
