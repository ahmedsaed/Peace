import DateTimePicker from '@react-native-community/datetimepicker';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Pressable, Switch, Text, View } from 'react-native';

import palette from '@/constants/palette';
import { describeNext, onDay } from '@/lib/reminder';
import { formatTimeLabel } from '@/lib/period';
import {
  hasReminderPermission,
  nextReminderAt,
  requestReminderPermission,
  syncReminders,
} from '@/state/reminders';
import { useSettingsStore } from '@/state/settings';

/**
 * The nightly reminder, and what Android is actually doing about it.
 *
 * NO PUSH SERVICE AND NO SERVER. The schedule is handed to Android and posted
 * by the OS whether or not this app is running, which is the only reason a
 * local-first ledger can have reminders at all.
 *
 * THE LINE THAT MATTERS IS THE READBACK. Everything else on this card is
 * intent: a switch, a time. What a person actually needs to know is whether a
 * notification is going to arrive, and this app cannot promise that — a
 * force-stop, an OEM battery manager or a permission revoked three screens deep
 * in system settings all silence it without touching a single setting here. So
 * the card asks Android what it is holding and repeats the answer. A switch
 * reading "on" above a schedule that was dropped is the one failure this
 * feature is most prone to, and visibility is the only defence against it.
 */
export function ReminderCard() {
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);

  const [permitted, setPermitted] = useState(true);
  const [next, setNext] = useState<Date | null>(null);
  const [picking, setPicking] = useState(false);

  /**
   * Both facts, asked of Android rather than of this app.
   *
   * READS ONLY; the caller writes. Not a style choice — a callback that sets
   * state is a callback an effect may not call, and this one has to run on
   * mount as well as on every foreground.
   */
  const refresh = useCallback(async () => {
    const [granted, at] = await Promise.all([hasReminderPermission(), nextReminderAt()]);
    return { granted, at };
  }, []);

  /**
   * On mount, and on every return to the foreground.
   *
   * Notification permission is revoked on a SYSTEM screen — the state that
   * matters changes while this component is backgrounded. Without this the card
   * would go on promising a reminder the user had just switched off in Android,
   * which is worse than saying nothing.
   *
   * `alive` because two awaits against the OS is long enough for the screen to
   * be gone before the answer lands.
   */
  useEffect(() => {
    let alive = true;

    const apply = async () => {
      const { granted, at } = await refresh();
      if (!alive) return;
      setPermitted(granted);
      setNext(at);

      // SELF-HEALING, and it earns its keep on exactly one path: settings
      // travel inside a backup, so a ledger restored onto a new phone arrives
      // with this switch ON and the Android permission — which belongs to the
      // install, not the data — ungranted. Nothing would ever arrive, and the
      // switch would be sitting there claiming otherwise. The same correction
      // covers a permission revoked in system settings months later.
      if (!granted && useSettingsStore.getState().settings.remindersOn) {
        update('remindersOn', false);
      }
    };

    void apply();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void apply();
    });

    return () => {
      alive = false;
      subscription.remove();
    };
  }, [refresh, update]);

  /** The same read, for the handlers below, which are already async. */
  const reread = useCallback(async () => {
    const { granted, at } = await refresh();
    setPermitted(granted);
    setNext(at);
  }, [refresh]);

  const time = { hour: settings.reminderHour, minute: settings.reminderMinute };
  const clock = formatTimeLabel(onDay(new Date(), time));

  /**
   * Turning it on asks Android, and a refusal turns it back off.
   *
   * NOT left on with a warning beside it. A switch sitting in the "on" position
   * over a permission that will never let anything through is a control
   * describing an intention rather than a state — and the user has no way to
   * tell it apart from a reminder that simply has not come round yet. The
   * switch means "notifications will arrive", so it is only allowed to be on
   * when they can.
   */
  async function toggle(on: boolean) {
    if (!on) {
      update('remindersOn', false);
      await syncReminders();
      await reread();
      return;
    }

    const granted = await requestReminderPermission();
    setPermitted(granted);
    update('remindersOn', granted);
    await syncReminders();
    await reread();
  }

  async function setQuiet(on: boolean) {
    update('remindOnQuietDays', on);
    await syncReminders();
    await reread();
  }

  async function pick(hour: number, minute: number) {
    update('reminderHour', hour);
    update('reminderMinute', minute);
    await syncReminders();
    await reread();
  }

  return (
    <View className="rounded-xl bg-surface p-4" testID="reminder-card">
      <Text className="mb-1 text-base font-semibold text-ink">Daily reminder</Text>
      <Text className="mb-3 text-sm leading-5 text-muted">
        A nudge to write down what the day cost, with anything still waiting — bank messages to
        read, repeats due. Scheduled on this phone; nothing is sent anywhere.
      </Text>

      <View className="flex-row items-center justify-between border-t border-line pt-3">
        <View className="flex-1 pr-3">
          <Text className="text-sm text-ink">Remind me</Text>
          <Text className="text-xs leading-4 text-muted">A nudge at the time below.</Text>
        </View>
        <Switch
          value={settings.remindersOn}
          onValueChange={(on) => void toggle(on)}
          testID="reminder-toggle"
          accessibilityLabel="Remind me"
          trackColor={{ false: palette.line, true: palette.accent }}
          thumbColor={palette.ink}
        />
      </View>

      {settings.remindersOn ? (
        <>
          {/* Whether the skip happens at all is the user's call, not this
              app's. Skipping suits somebody who reads the notification as "you
              have not logged anything"; a person building the habit wants the
              same cue at the same time, and an app that goes quiet on their
              good days removes it exactly when it is working. */}
          <View className="mt-3 flex-row items-center justify-between border-t border-line pt-3">
            <View className="flex-1 pr-3">
              <Text className="text-sm text-ink">Even on quiet days</Text>
              <Text className="text-xs leading-4 text-muted">
                {settings.remindOnQuietDays
                  ? 'Asks every day, however much you have already recorded.'
                  : 'Stays quiet when you have already recorded something and nothing is waiting.'}
              </Text>
            </View>
            <Switch
              value={settings.remindOnQuietDays}
              onValueChange={(next) => void setQuiet(next)}
              testID="reminder-quiet-toggle"
              accessibilityLabel="Even on quiet days"
              trackColor={{ false: palette.line, true: palette.accent }}
              thumbColor={palette.ink}
            />
          </View>

          {/* The VALUE is the control, exactly as the record screen's date and
              time are: a filled pill you press, not a label with the answer
              off to the right. Same radius and press state, `bg-raised` rather
              than `bg-surface` only because this one sits on a surface card
              and a surface pill on it would have no edge. */}
          <View className="mt-3 flex-row items-center justify-between border-t border-line pt-3">
            <Text className="text-sm text-ink">Time</Text>
            <Pressable
              onPress={() => setPicking(true)}
              testID="reminder-time"
              accessibilityRole="button"
              accessibilityLabel={`Reminder time, ${clock}`}
              className="items-center rounded-lg bg-raised px-4 py-1.5 active:opacity-70">
              <Text className="text-sm text-ink">{clock}</Text>
            </Pressable>
          </View>

          {/* The readback — see the note at the top of this file. Not derived
              from the setting above it: this is what Android says it will do. */}
          <Text className="pt-3 text-xs leading-4 text-muted" testID="reminder-next">
            {describeNext(next, new Date())}
          </Text>
        </>
      ) : null}

      {/* Whenever Android is refusing, regardless of what the switch says.
          Gating this on the switch being off would tie the explanation to the
          order two state updates happen to land in — and a refusal with no
          sentence beside it looks like the switch failed to move. */}
      {!permitted ? (
        <View className="mt-3 border-t border-line pt-3" testID="reminder-blocked">
          <Text className="text-xs leading-4 text-muted">
            Android is blocking notifications for Peace, so the reminder cannot arrive. Allow them
            and switch this back on.
          </Text>
          <Pressable
            onPress={() => void Linking.openSettings()}
            testID="reminder-open-settings"
            accessibilityRole="button"
            className="mt-2 self-start rounded-lg border border-line px-3 py-1.5 active:opacity-70">
            <Text className="text-sm text-accent">Open Android settings…</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Same call shape as the record screen's date and time controls —
          `onValueChange` with a dismissal of its own, and a 12-hour dial to
          match `formatTimeLabel`. A second spelling of this picker would be a
          second set of props to keep in step with the library. */}
      {picking ? (
        <DateTimePicker
          value={onDay(new Date(), time)}
          mode="time"
          is24Hour={false}
          onValueChange={(_event: unknown, picked: Date) => {
            setPicking(false);
            void pick(picked.getHours(), picked.getMinutes());
          }}
          onDismiss={() => setPicking(false)}
        />
      ) : null}
    </View>
  );
}
