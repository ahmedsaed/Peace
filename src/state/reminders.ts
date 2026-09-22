import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { db } from '@/db/client';
import { reviewableCaptures } from '@/db/repo/bank-captures';
import { wroteAnythingOn } from '@/db/repo/records';
import { dueProposals } from '@/db/repo/recurring';
import { getSetting } from '@/db/settings';
import { planReminders, type ReminderSubject } from '@/lib/reminder';
import { useSetting } from '@/state/settings';

/**
 * Arming the nightly reminder, and keeping what it says true.
 *
 * See `lib/reminder.ts` for the rules; this is the half that talks to Android
 * and therefore the half that cannot be unit tested. It is kept deliberately
 * thin: every decision lives in the pure module, and this loops over what that
 * module returns.
 *
 * THE SCHEDULE IS REBUILT, NEVER PATCHED. Working out which of fourteen armed
 * notifications is still correct after a bank message arrives is a diff nobody
 * can hold in their head, and the failure mode — one stale entry among thirteen
 * fresh ones — would be invisible until it fired. Cancelling ours and laying
 * the whole window down again is cheap, idempotent, and has one outcome.
 *
 * WHAT RE-ARMS IT is the other half of the design. The counts are frozen at
 * schedule time, so anything that changes them has to rebuild: launching,
 * returning to the foreground, and the settings themselves changing. The app
 * being opened is the mechanism here exactly as it is for the Drive backup —
 * and it is a better fit than it is there, because every event that LOWERS a
 * count (reading a message, settling a repeat, writing a record) happens with
 * the app in front of somebody, and the return to foreground after it catches
 * every one without this module having to know they exist.
 */

/** Marks a scheduled notification as ours, so a cancel does not overreach. */
const KIND = 'peace-reminder';

/**
 * Its own channel, so the reminder can be silenced without silencing the app.
 *
 * `DEFAULT` importance, not `HIGH` or `MAX`: those produce a heads-up banner
 * that takes over whatever the phone is doing. A nightly nudge to write down
 * lunch has not earned an interruption — it belongs in the shade, where it is
 * waiting when the phone is next picked up.
 */
const CHANNEL_ID = 'reminders';

/**
 * Not shown while somebody is already looking at the app.
 *
 * The notification's entire request is "open Peace", so posting it over an open
 * Peace is the app interrupting itself to ask for something it already has.
 * The schedule is rebuilt on the way back to the foreground anyway, so nothing
 * is lost by swallowing it.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function ensureChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
  });
}

/**
 * Ask for permission, and report what Android actually said.
 *
 * Asked when the switch is turned on and never on launch: a permission prompt
 * on first open, before the app has explained what it would use it for, is how
 * an app spends the one "no" it is allowed.
 */
export async function requestReminderPermission(): Promise<boolean> {
  // The channel has to exist first — on Android 13+ the system prompt is driven
  // by the channel, and asking without one grants a permission attached to
  // nothing.
  await ensureChannel();

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;

  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

export async function hasReminderPermission(): Promise<boolean> {
  const status = await Notifications.getPermissionsAsync();
  return status.granted;
}

/** Only the notifications this module scheduled. */
async function ours(): Promise<Notifications.NotificationRequest[]> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  return all.filter((request) => request.content.data?.kind === KIND);
}

/**
 * When Android will next post one, read back from Android.
 *
 * The settings row shows THIS rather than the stored setting, because "the
 * switch says on and nothing ever arrives" is the failure this feature is most
 * prone to — a force-stop, an OEM battery manager, a revoked permission — and
 * none of those change the setting. A readback is the only thing that can tell
 * the truth about a schedule this app does not own.
 */
export async function nextReminderAt(): Promise<Date | null> {
  const dates = (await ours())
    .map((request) => {
      const trigger = request.trigger as { type?: string; value?: number } | null;
      return typeof trigger?.value === 'number' ? new Date(trigger.value) : null;
    })
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  return dates[0] ?? null;
}

async function cancelOurs(): Promise<void> {
  for (const request of await ours()) {
    await Notifications.cancelScheduledNotificationAsync(request.identifier);
  }
}

/**
 * Take down reminders that have already been posted.
 *
 * Each night's notification carries its own tag, so three days away leaves
 * three copies of the same question stacked in the shade — and by the time
 * somebody is reading them, every one is answered by the app they have just
 * opened. Tapping one clears it (`AUTO_CANCEL`); arriving any other way should
 * clear it too, or the app is leaving litter behind asking for something it has
 * already been given.
 *
 * Filtered rather than `dismissAllNotificationsAsync`, which would also take
 * down anything else this app ever learns to post.
 */
async function dismissDelivered(): Promise<void> {
  try {
    for (const delivered of await Notifications.getPresentedNotificationsAsync()) {
      if (delivered.request.content.data?.kind === KIND) {
        await Notifications.dismissNotificationAsync(delivered.request.identifier);
      }
    }
  } catch (error) {
    // ITS OWN CATCH, and that is the point. Tidying the shade is the least
    // important thing this module does, and it runs FIRST — sharing the outer
    // handler would let a failure here swallow the scheduling underneath it and
    // silently turn the whole feature off. A caught failure costs a stale
    // notification; an uncaught one costs every reminder.
    console.warn('[reminders] could not clear delivered reminders', error);
  }
}

/**
 * What the app knows right now, for freezing into tonight's notification.
 *
 * Read from SQLITE rather than from the zustand stores. This runs on launch,
 * before the bank inbox store has necessarily reloaded, and a store that has
 * not loaded hands back its built-in defaults — which here would be a confident
 * "nothing waiting" written into a notification that then says so out loud.
 */
export function readSubject(now = new Date()): ReminderSubject {
  return {
    waiting: reviewableCaptures(db, 500).length,
    due: dueProposals(db).proposals.length,
    recordedToday: wroteAnythingOn(db, now),
  };
}

/**
 * Lay the whole window down again, or take it all away.
 *
 * Idempotent and safe to call as often as anything might have changed. Reads
 * the settings from SQLite for the same reason `readSubject` does.
 *
 * SERIALISED, because two callers genuinely do arrive at once.
 *
 * Turning the switch on syncs from the settings card AND changes a setting the
 * layout hook is watching, so two rebuilds start within a frame of each other.
 * Run concurrently they interleave: one cancels the window the other has just
 * laid down, and the survivor is a partial schedule nobody asked for. A chain
 * rather than a `running` flag because the card AWAITS its sync before reading
 * the schedule back — dropping the second call would leave it reporting the
 * state from before the switch was touched.
 */
let queue: Promise<void> = Promise.resolve();

export function syncReminders(now?: Date): Promise<void> {
  queue = queue.then(() => runSync(now ?? new Date()));
  return queue;
}

async function runSync(now: Date): Promise<void> {
  try {
    // Unconditionally, and before the branches: whatever the settings say, a
    // reminder still sitting in the shade has been answered by the app being
    // open. This runs on every foreground, which is exactly the moment that
    // becomes true.
    await dismissDelivered();

    if (!getSetting('remindersOn')) {
      await cancelOurs();
      return;
    }

    // A permission withdrawn in system settings leaves our flag untouched, so
    // this is checked on every sync rather than only at the switch. Scheduling
    // into a revoked permission throws on some versions and silently succeeds
    // on others; neither posts anything.
    if (!(await hasReminderPermission())) {
      await cancelOurs();
      return;
    }

    await ensureChannel();
    await cancelOurs();

    const time = { hour: getSetting('reminderHour'), minute: getSetting('reminderMinute') };
    const onQuietDays = getSetting('remindOnQuietDays');
    for (const entry of planReminders(readSubject(now), time, now, { onQuietDays })) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: entry.title,
          body: entry.body,
          data: { kind: KIND },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: entry.at,
          channelId: CHANNEL_ID,
        },
      });
    }
  } catch (error) {
    // Never load-bearing. A reminder that could not be armed must not stop the
    // app starting or a setting being saved — and the settings row reads the
    // schedule back from Android, so a failure here shows up as "nothing
    // scheduled" rather than as silence.
    console.warn('[reminders] could not update the schedule', error);
  }
}

/**
 * Renders nothing; exists so the hook sits INSIDE `DatabaseProvider`.
 *
 * Same placement rule as `DriveCatchUp`: the provider gates on migrations, and
 * a sync mounted above it would read the settings before the database was
 * ready and arm a schedule from the built-in defaults.
 */
export function ReminderSchedule(): null {
  useReminderSchedule();
  return null;
}

export function useReminderSchedule(): void {
  const on = useSetting('remindersOn');
  const hour = useSetting('reminderHour');
  const minute = useSetting('reminderMinute');
  const onQuietDays = useSetting('remindOnQuietDays');

  const resync = useCallback(() => {
    void syncReminders();
  }, []);

  // On launch and whenever the settings change — every one of them, since each
  // changes what the window should contain. The counts are read fresh inside
  // `syncReminders`, so this does not need to watch those.
  useEffect(resync, [resync, on, hour, minute, onQuietDays]);

  // Read through a ref inside the listener so the subscription is created once
  // rather than rebuilt every time a setting changes.
  const latest = useRef(resync);
  useEffect(() => {
    latest.current = resync;
  }, [resync]);

  useEffect(() => {
    // Returning to the foreground is what catches every event that LOWERS a
    // count — a message read, a repeat settled, a record written — without this
    // module having to know any of them happened.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') latest.current();
    });
    return () => subscription.remove();
  }, []);
}
