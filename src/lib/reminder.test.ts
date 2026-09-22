import {
  GENERIC_BODY,
  describeNext,
  nextOccurrence,
  onDay,
  planReminders,
  reminderBody,
  skipsNext,
  WINDOW_DAYS,
  type ReminderSubject,
} from './reminder';

const at = (iso: string) => new Date(iso);
const NINE_PM = { hour: 21, minute: 0 };

const subject = (over: Partial<ReminderSubject> = {}): ReminderSubject => ({
  waiting: 0,
  due: 0,
  recordedToday: false,
  ...over,
});

describe('what the reminder says', () => {
  it('leads with work waiting rather than with the question', () => {
    // Somebody with unread bank messages should be told that, not asked how
    // their day went — the app has already done half that work.
    expect(reminderBody(subject({ waiting: 4 }))).toBe('4 bank messages waiting to be read.');
    expect(reminderBody(subject({ due: 2 }))).toBe('2 repeats due today.');
    expect(reminderBody(subject({ waiting: 3, due: 1 }))).toBe(
      '3 bank messages to read and 1 repeat due.'
    );
  });

  it('counts in the singular when there is one of something', () => {
    expect(reminderBody(subject({ waiting: 1 }))).toBe('1 bank message waiting to be read.');
    expect(reminderBody(subject({ due: 1 }))).toBe('1 repeat due today.');
  });

  it('falls back to the plain nudge when there is nothing to report', () => {
    expect(reminderBody(subject())).toBe('Nothing recorded yet today.');
  });

  it('does not claim an empty day when the ledger has already been written to', () => {
    // Reached only when something else keeps the reminder alive on a day that
    // was already dealt with — saying "nothing recorded yet" there is a lie the
    // user can see through, which costs the app more than the nudge is worth.
    expect(reminderBody(subject({ recordedToday: true }))).toBe(GENERIC_BODY);
  });
});

describe('when the next one falls', () => {
  it('takes today when the time is still ahead', () => {
    expect(nextOccurrence(NINE_PM, at('2026-09-22T18:30:00'))).toEqual(at('2026-09-22T21:00:00'));
  });

  it('rolls to tomorrow once it has passed', () => {
    expect(nextOccurrence(NINE_PM, at('2026-09-22T22:15:00'))).toEqual(at('2026-09-23T21:00:00'));
  });

  it('rolls forward on the exact minute rather than firing into the past', () => {
    // Arming a notification for the instant that has just passed either fires
    // at once or is dropped, and both read as a bug.
    expect(nextOccurrence(NINE_PM, at('2026-09-22T21:00:00'))).toEqual(at('2026-09-23T21:00:00'));
  });
});

describe('staying quiet on a day already dealt with', () => {
  it('skips tonight when nothing is waiting and something was recorded', () => {
    const now = at('2026-09-22T18:00:00');
    expect(skipsNext(subject({ recordedToday: true }), nextOccurrence(NINE_PM, now), now)).toBe(
      true
    );
  });

  it('still fires when there is work waiting, however diligent the day was', () => {
    const now = at('2026-09-22T18:00:00');
    const busy = subject({ recordedToday: true, waiting: 2 });
    expect(skipsNext(busy, nextOccurrence(NINE_PM, now), now)).toBe(false);
  });

  it('skips nothing at all when the user has asked to be asked every day', () => {
    // The default reads the notification as "you have not logged anything". For
    // somebody building the habit it is a fixed daily cue, and going quiet on
    // their good days removes it exactly when it is working. Both readings are
    // legitimate, so the app does not pick one.
    const now = at('2026-09-22T18:00:00');
    const quiet = subject({ recordedToday: true });
    expect(skipsNext(quiet, nextOccurrence(NINE_PM, now), now, true)).toBe(false);
  });

  it('never skips an occurrence that is not today', () => {
    // THE GUARD THAT IS EASY TO MISS: `recordedToday` is a fact about today. At
    // 22:15 the next reminder is TOMORROW, which knows nothing about what was
    // written today — skipping it would silence a day on yesterday's evidence.
    const now = at('2026-09-22T22:15:00');
    const next = nextOccurrence(NINE_PM, now);
    expect(skipsNext(subject({ recordedToday: true }), next, now)).toBe(false);
  });
});

describe('the schedule handed to Android', () => {
  it('arms a full window ahead, so an unopened app keeps reminding', () => {
    const plan = planReminders(subject(), NINE_PM, at('2026-09-22T18:00:00'));
    expect(plan).toHaveLength(WINDOW_DAYS);
    expect(plan[0].at).toEqual(at('2026-09-22T21:00:00'));
    expect(plan[1].at).toEqual(at('2026-09-23T21:00:00'));
  });

  it('names a number only on the day it actually knew one', () => {
    // A snapshot taken tonight says nothing true about a Thursday nine days
    // out, so every entry past the first names no number at all.
    const plan = planReminders(subject({ waiting: 3 }), NINE_PM, at('2026-09-22T18:00:00'));
    expect(plan[0].body).toBe('3 bank messages waiting to be read.');
    expect(plan.slice(1).every((entry) => entry.body === GENERIC_BODY)).toBe(true);
  });

  it('drops tonight from the window when tonight is being skipped', () => {
    const plan = planReminders(subject({ recordedToday: true }), NINE_PM, at('2026-09-22T18:00:00'));
    expect(plan).toHaveLength(WINDOW_DAYS - 1);
    expect(plan[0].at).toEqual(at('2026-09-23T21:00:00'));
    // And the day that survives is still a real reminder, not the skipped one
    // shifted along.
    expect(plan[0].body).toBe(GENERIC_BODY);
  });

  it('keeps tonight in the window when quiet days are switched on', () => {
    const plan = planReminders(subject({ recordedToday: true }), NINE_PM, at('2026-09-22T18:00:00'), {
      onQuietDays: true,
    });
    expect(plan).toHaveLength(WINDOW_DAYS);
    expect(plan[0].at).toEqual(at('2026-09-22T21:00:00'));
    // And it still says the honest thing about a day already written to, rather
    // than claiming nothing has been recorded.
    expect(plan[0].body).toBe(GENERIC_BODY);
  });

  it('keeps the wall clock across a date change rather than adding 24 hours', () => {
    // Adding a day in milliseconds lands an hour out across a DST boundary, and
    // a reminder that drifts by an hour twice a year reads as the app losing
    // the setting. Every entry re-derives the clock from the date.
    const plan = planReminders(subject(), NINE_PM, at('2026-09-22T18:00:00'));
    for (const entry of plan) {
      expect(entry.at.getHours()).toBe(21);
      expect(entry.at.getMinutes()).toBe(0);
    }
  });

  it('places the time on the right day when asked directly', () => {
    expect(onDay(at('2026-09-22T03:12:00'), { hour: 7, minute: 5 })).toEqual(
      at('2026-09-22T07:05:00')
    );
  });
});

describe('what the settings row reports', () => {
  it('reads back the schedule rather than the setting', () => {
    const now = at('2026-09-22T18:00:00');
    // "around", not "at": these are inexact alarms and Android gives each one a
    // delivery window — about two minutes on an imminent one, an hour on one a
    // day out. Promising a minute this app cannot hold to is the one thing this
    // row must not do.
    expect(describeNext(at('2026-09-22T21:00:00'), now)).toBe(
      'Next reminder today around 9:00 PM'
    );
    expect(describeNext(at('2026-09-23T21:00:00'), now)).toBe(
      'Next reminder tomorrow around 9:00 PM'
    );
    expect(describeNext(at('2026-09-30T21:00:00'), now)).toBe('Next reminder 30/9 around 9:00 PM');
  });

  it('says so when Android is holding nothing', () => {
    // The failure this feature is most prone to: a switch reading "on" over a
    // schedule that was dropped. The only defence is showing the readback.
    expect(describeNext(null, at('2026-09-22T18:00:00'))).toBe(
      'Nothing scheduled — reopen Peace to set it again'
    );
  });
});
