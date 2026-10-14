import DateTimePicker from '@react-native-community/datetimepicker';
import { getLocales } from 'expo-localization';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Image, Linking, Pressable, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { PickerSheet, type PickerOption } from '@/components/picker-sheet';
import { KeypadPreview } from '@/components/setup/keypad-preview';
import {
  FieldError,
  fieldBorder,
  Note,
  PrimaryButton,
  QuietButton,
  SecondaryButton,
  StepFrame,
} from '@/components/setup/frame';
import { Wordmark } from '@/components/wordmark';
import { SECTIONS } from '@/constants/sections';
import { openListenerSettings, setCapturing } from '@/db/bank-inbox';
import { db } from '@/db/client';
import { adoptCurrency, listAccountsWithBalance, updateAccount } from '@/db/repo/accounts';
import { accountBalance, setBalanceToday } from '@/db/repo/adjust';
import { CURRENCIES, currencyName } from '@/lib/currencies';
import { detectCurrency } from '@/lib/first-run';
import { GeminiError } from '@/lib/gemini';
import { connect } from '@/lib/google-auth';
import { minorToMajor, parseAmountToMinor } from '@/lib/money';
import { formatTimeLabel } from '@/lib/period';
import { onDay } from '@/lib/reminder';
import { SETUP_STEPS, STEP_LABELS, stepDone, type SetupFacts, type SetupStep } from '@/lib/setup';
import { useGeminiKeyStore } from '@/state/gemini-key';
import { useMoney } from '@/state/money';
import { requestReminderPermission, syncReminders } from '@/state/reminders';
import { bankAccess } from '@/state/setup';
import { useSettingsStore } from '@/state/settings';
import { useTheme } from '@/state/theme';

/** Each step's colour — shared with Settings, so a section looks like its step. */
const COLOR: Record<SetupStep | 'done', string> = {
  currency: SECTIONS.money.color,
  accounts: SECTIONS.accounts.color,
  keypad: SECTIONS.keypad.color,
  reminder: SECTIONS.reminder.color,
  ai: SECTIONS.ai.color,
  bank: SECTIONS.bank.color,
  backup: SECTIONS.backup.color,
  done: '#2E7D46',
};

export type StepProps = {
  /** "Step 2 of 7" in the full flow; absent when opened on its own. */
  eyebrow?: string;
  /** Finished on purpose — recorded, then the next step. */
  onDone: () => void;
  /** Left for later — NOT recorded, so the Records card still offers it. */
  onSkip: () => void;
};

// ---------------------------------------------------------------- welcome --

const PROMISES = [
  {
    icon: 'shield',
    title: 'Lives on this phone',
    body: 'No account and no server. Your records stay here.',
  },
  {
    icon: 'key',
    title: 'Nothing leaves unless you say so',
    body: 'Reminders, AI and backups are each off until you turn them on.',
  },
  {
    icon: 'heart',
    title: 'Free, and open source',
    body: 'No ads, no tracking, no subscription.',
  },
];

export function WelcomeStep({
  onStart,
  onRestore,
  onSkipAll,
}: {
  onStart: () => void;
  onRestore: () => void;
  onSkipAll: () => void;
}) {
  const palette = useTheme();
  return (
    <View className="flex-1" testID="setup-welcome">
      <View className="flex-row justify-end px-4 pt-2">
        <QuietButton label="Skip setup" onPress={onSkipAll} testID="setup-skip-all" />
      </View>

      <View className="flex-1 justify-center px-8">
        <Animated.View entering={FadeInDown.duration(500)} className="items-center">
          <Image
            source={require('../../../assets/images/logo-mark.png')}
            style={{ width: 88, height: 88 }}
            accessibilityIgnoresInvertColors
          />
          <View className="mt-2">
            <Wordmark size={60} />
          </View>
          <Text className="mt-1 text-center text-base text-muted">
            Peace of mind. Piece of cake.
          </Text>
        </Animated.View>

        <View className="mt-12 gap-6">
          {PROMISES.map((promise, i) => (
            <Animated.View
              key={promise.title}
              entering={FadeInDown.duration(420).delay(250 + i * 110)}
              className="flex-row gap-4">
              <View className="h-11 w-11 items-center justify-center rounded-full bg-surface">
                <Icon name={promise.icon} size={20} color={palette.ink} />
              </View>
              <View className="flex-1">
                <Text className="text-[15px] font-semibold text-ink">{promise.title}</Text>
                <Text className="mt-0.5 text-sm leading-5 text-muted">{promise.body}</Text>
              </View>
            </Animated.View>
          ))}
        </View>
      </View>

      <Animated.View entering={FadeInDown.duration(420).delay(650)} className="gap-1 px-6 pb-6">
        <PrimaryButton label="Get started" onPress={onStart} testID="setup-start" />
        <QuietButton
          label="I have a backup to restore"
          onPress={onRestore}
          testID="setup-restore"
        />
      </Animated.View>
    </View>
  );
}

// --------------------------------------------------------------- currency --

export function CurrencyStep({ eyebrow, onDone, onSkip }: StepProps) {
  const palette = useTheme();
  const money = useMoney();
  const home = useSettingsStore((s) => s.settings.homeCurrency);
  const update = useSettingsStore((s) => s.update);
  const [picking, setPicking] = useState(false);
  // Said only while it is true: after "Change", the region is not the source.
  const detected = useMemo(() => detectCurrency(getLocales()), []);

  // The detected currency may not be on the curated list; it is offered anyway,
  // because it is the one this phone said it uses.
  const options: PickerOption[] = useMemo(() => {
    const listed = CURRENCIES.some((c) => c.code === home)
      ? CURRENCIES
      : [{ code: home, name: currencyName(home) }, ...CURRENCIES];
    return listed.map((c) => ({
      id: c.code,
      label: c.name,
      icon: 'cash',
      detail: c.code,
    }));
  }, [home]);

  const choose = (code: string) => {
    // The starter accounts were seeded in the guess; they follow the correction.
    adoptCurrency(db, home, code);
    update('homeCurrency', code);
    setPicking(false);
  };

  return (
    <StepFrame
      emblem="cash"
      color={COLOR.currency}
      eyebrow={eyebrow}
      title="What do you spend in?"
      body="Totals, budgets and charts are all shown in this currency. Records in other currencies are converted at the rate you enter with them."
      testID="setup-currency"
      actions={
        <>
          <PrimaryButton
            label={`Use ${currencyName(home)}`}
            onPress={onDone}
            testID="setup-currency-confirm"
          />
          <QuietButton onPress={onSkip} testID="setup-currency-skip" />
        </>
      }>
      <Pressable
        onPress={() => setPicking(true)}
        testID="setup-currency-change"
        accessibilityRole="button"
        accessibilityLabel={`${currencyName(home)}, change`}
        className="rounded-2xl bg-surface p-5 active:bg-raised">
        <Text
          className="text-[34px] font-semibold text-ink"
          style={{ fontVariant: ['tabular-nums'] }}>
          {money(1234500, home)}
        </Text>
        <View className="mt-3 flex-row items-center justify-between">
          <View>
            <Text className="text-base text-ink" testID="setup-currency-name">
              {currencyName(home)}
            </Text>
            <Text className="text-xs text-muted">
              {home} · {home === detected ? 'from your phone\u2019s region' : 'your choice'}
            </Text>
          </View>
          <View className="flex-row items-center gap-1">
            <Text className="text-sm text-accent">Change</Text>
            <Icon name="chevron" size={12} color={palette.accent} />
          </View>
        </View>
      </Pressable>

      <PickerSheet
        visible={picking}
        title="Home currency"
        options={options}
        selectedId={home}
        onSelect={choose}
        onClose={() => setPicking(false)}
        testID="sheet-setup-currency"
      />
    </StepFrame>
  );
}

// --------------------------------------------------------------- accounts --

type Draft = {
  id: string;
  name: string;
  /** What it holds TODAY, as typed. Not the opening balance — see `save`. */
  opening: string;
  /** The same figure as the ledger has it, so an untouched field writes nothing. */
  nowMinor: number;
  currency: string;
  icon: string;
  color: string;
};

/** A balance as the text it would have been typed as. */
const asTyped = (minor: number, currency: string) =>
  minor === 0 ? '' : String(minorToMajor(minor, currency));

export function AccountsStep({ eyebrow, onDone, onSkip }: StepProps) {
  const palette = useTheme();
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    // The CURRENT balance, not the opening one. On a fresh ledger they are the
    // same; after a restore the opening balance is usually zero and the money
    // is in the records, so showing it put a 0 beside every account.
    listAccountsWithBalance(db).map((a) => {
      const nowMinor = accountBalance(db, a.id);
      return {
        id: a.id,
        name: a.name,
        opening: asTyped(nowMinor, a.currency),
        nowMinor,
        currency: a.currency,
        icon: a.icon ?? 'wallet',
        color: a.color ?? palette.raised,
      };
    })
  );
  /** Which field of which account is wrong — the outline goes on THAT one. */
  const [problem, setProblem] = useState<{
    id: string;
    field: 'name' | 'opening';
    message: string;
  } | null>(null);

  const edit = (id: string, patch: Partial<Draft>) => {
    setDrafts((all) => all.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    if (problem?.id === id) setProblem(null);
  };

  const save = () => {
    setProblem(null);
    const parsed = drafts.map((d) => ({
      ...d,
      openingMinor: d.opening.trim() === '' ? 0 : parseAmountToMinor(d.opening, d.currency),
    }));
    const nameless = parsed.find((d) => d.name.trim() === '');
    if (nameless) {
      setProblem({
        id: nameless.id,
        field: 'name',
        message: 'An account needs a name.',
      });
      return;
    }
    const bad = parsed.find((d) => d.openingMinor === null);
    if (bad) {
      setProblem({
        id: bad.id,
        field: 'opening',
        message: `"${bad.opening}" is not an amount. Use digits, with a point for any decimals.`,
      });
      return;
    }
    for (const d of parsed) {
      updateAccount(db, d.id, { name: d.name });
      if (d.openingMinor !== d.nowMinor) setBalanceToday(db, d.id, d.openingMinor ?? 0);
    }
    onDone();
  };

  return (
    <StepFrame
      emblem="wallet"
      color={COLOR.accounts}
      eyebrow={eyebrow}
      title="Where your money sits"
      body="Two accounts to start with. Rename them to match yours, and say what each holds today — or leave it blank and start counting from now."
      testID="setup-accounts"
      actions={
        <>
          <PrimaryButton label="Save accounts" onPress={save} testID="setup-accounts-save" />
          <QuietButton onPress={onSkip} testID="setup-accounts-skip" />
        </>
      }>
      <View className="gap-3">
        {drafts.map((d, i) => {
          const bad = problem?.id === d.id ? problem : null;
          return (
            <View key={d.id}>
              <View className="flex-row items-center gap-3 rounded-2xl bg-surface p-3">
                <View
                  className="h-11 w-11 items-center justify-center rounded-full"
                  style={{ backgroundColor: d.color }}>
                  <Icon name={d.icon} size={20} color="#FFFFFF" />
                </View>
                <TextInput
                  value={d.name}
                  onChangeText={(name) => edit(d.id, { name })}
                  placeholder="Name"
                  placeholderTextColor={palette.muted}
                  className={`flex-1 rounded-xl px-2 py-2 text-base text-ink ${fieldBorder(bad?.field === 'name')}`}
                  testID={`setup-account-name-${i}`}
                />
                <View
                  className={`w-32 flex-row items-center rounded-xl bg-ground px-3 ${fieldBorder(
                    bad?.field === 'opening'
                  )}`}>
                  <TextInput
                    value={d.opening}
                    onChangeText={(opening) => edit(d.id, { opening })}
                    placeholder="0"
                    placeholderTextColor={palette.muted}
                    keyboardType="decimal-pad"
                    className="flex-1 py-2.5 text-right text-base text-ink"
                    style={{ fontVariant: ['tabular-nums'] }}
                    testID={`setup-account-opening-${i}`}
                  />
                  <Text className="ml-1.5 text-xs text-muted">{d.currency}</Text>
                </View>
              </View>
              <FieldError message={bad?.message ?? null} testID={`setup-account-error-${i}`} />
            </View>
          );
        })}
      </View>
      <Note>
        Cards, savings and accounts in other currencies can be added from the Accounts tab.
      </Note>
    </StepFrame>
  );
}

// ----------------------------------------------------------------- keypad --

export function KeypadStep({ eyebrow, onDone, onSkip }: StepProps) {
  const digits = useSettingsStore((s) => s.settings.keypadDigits);
  const operators = useSettingsStore((s) => s.settings.keypadOperators);
  const update = useSettingsStore((s) => s.update);

  return (
    <StepFrame
      emblem="keypad"
      color={COLOR.keypad}
      eyebrow={eyebrow}
      title="Which keypad do your thumbs know?"
      body="A calculator puts 7 8 9 on top; a phone puts 1 2 3 there. Pick the one you would type a number on without looking."
      testID="setup-keypad"
      actions={
        <>
          <PrimaryButton label="Continue" onPress={onDone} testID="setup-keypad-confirm" />
          <QuietButton onPress={onSkip} testID="setup-keypad-skip" />
        </>
      }>
      <View className="flex-row gap-3">
        <KeypadPreview
          digits="calculator"
          operators={operators}
          selected={digits !== 'phone'}
          label="Calculator"
          onPress={() => update('keypadDigits', 'calculator')}
          testID="setup-keypad-calculator"
        />
        <KeypadPreview
          digits="phone"
          operators={operators}
          selected={digits === 'phone'}
          label="Phone"
          onPress={() => update('keypadDigits', 'phone')}
          testID="setup-keypad-phone"
        />
      </View>

      <Text className="mb-2 mt-6 text-[11px] uppercase tracking-widest text-muted">
        + − × ÷ go on the
      </Text>
      <View className="flex-row rounded-xl bg-surface p-1">
        {(['left', 'right'] as const).map((side) => (
          <Pressable
            key={side}
            onPress={() => update('keypadOperators', side)}
            testID={`setup-keypad-operators-${side}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: operators === side }}
            className={`flex-1 items-center rounded-lg py-2.5 ${
              operators === side ? 'bg-raised' : ''
            }`}>
            <Text className={operators === side ? 'font-semibold text-ink' : 'text-muted'}>
              {side === 'left' ? 'Left' : 'Right'}
            </Text>
          </Pressable>
        ))}
      </View>
    </StepFrame>
  );
}

// --------------------------------------------------------------- reminder --

export function ReminderStep({ eyebrow, onDone, onSkip }: StepProps) {
  const palette = useTheme();
  const hour = useSettingsStore((s) => s.settings.reminderHour);
  const minute = useSettingsStore((s) => s.settings.reminderMinute);
  const update = useSettingsStore((s) => s.update);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);

  const when = onDay(new Date(), { hour, minute });

  /**
   * The permission is asked HERE, on "yes", and nowhere earlier — and a
   * refusal leaves the reminder off, exactly like the Settings switch: the
   * setting means "notifications will arrive", so it may only be on when they
   * can.
   */
  const enable = async () => {
    setBusy(true);
    try {
      const granted = await requestReminderPermission();
      update('remindersOn', granted);
      await syncReminders();
      if (granted) onDone();
      else setRefused(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepFrame
      emblem="bell"
      color={COLOR.reminder}
      eyebrow={eyebrow}
      title="A nudge at the end of the day"
      body="One quiet notification in the evening, so the day's spending gets written down while you still remember it. It stays quiet on days you have already written something."
      testID="setup-reminder"
      actions={
        <>
          <PrimaryButton
            label={`Remind me at ${formatTimeLabel(when)}`}
            onPress={enable}
            busy={busy}
            testID="setup-reminder-enable"
          />
          <QuietButton onPress={onSkip} testID="setup-reminder-skip" />
        </>
      }>
      <Pressable
        onPress={() => setPicking(true)}
        testID="setup-reminder-time"
        accessibilityRole="button"
        className="flex-row items-center justify-between rounded-2xl bg-surface p-5 active:bg-raised">
        <View>
          <Text className="text-xs uppercase tracking-widest text-muted">Every evening at</Text>
          <Text
            className="mt-1 text-[34px] font-semibold text-ink"
            style={{ fontVariant: ['tabular-nums'] }}>
            {formatTimeLabel(when)}
          </Text>
        </View>
        <View className="flex-row items-center gap-1">
          <Text className="text-sm text-accent">Change</Text>
          <Icon name="chevron" size={12} color={palette.accent} />
        </View>
      </Pressable>
      {refused ? (
        <Note tone="bad" testID="setup-reminder-refused">
          Android did not allow notifications, so the reminder stays off. You can allow them later
          from Settings.
        </Note>
      ) : (
        <Note>Android will ask whether Peace may send notifications.</Note>
      )}

      {picking ? (
        <DateTimePicker
          value={when}
          mode="time"
          is24Hour={false}
          onValueChange={(_event: unknown, picked: Date) => {
            setPicking(false);
            update('reminderHour', picked.getHours());
            update('reminderMinute', picked.getMinutes());
          }}
          onDismiss={() => setPicking(false)}
        />
      ) : null}
    </StepFrame>
  );
}

// --------------------------------------------------------------------- ai --

const KEY_PAGE = 'https://aistudio.google.com/apikey';

export function AiStep({ eyebrow, onDone, onSkip }: StepProps) {
  const palette = useTheme();
  const save = useGeminiKeyStore((s) => s.save);
  const hasKey = useGeminiKeyStore((s) => s.hasKey);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await save(draft.trim());
      onDone();
    } catch (e) {
      if (e instanceof GeminiError) {
        setError(e.message);
      } else {
        console.warn('[setup] saving the Gemini key failed', e);
        setError(
          'The key could not be saved on this phone. Try again, or add it later in Settings.'
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepFrame
      emblem="sparkle"
      color={COLOR.ai}
      eyebrow={eyebrow}
      title="Let AI do the typing"
      body="Photograph a receipt and the amount fills itself in. Bank alerts become records to approve. Ask Penny where the money went. All of it runs on your own Google Gemini key — free to create, and only Google sees what you send."
      testID="setup-ai"
      actions={
        <>
          <PrimaryButton
            label={busy ? 'Checking the key…' : 'Save key'}
            onPress={submit}
            disabled={draft.trim() === ''}
            busy={busy}
            testID="setup-ai-save"
          />
          <QuietButton onPress={onSkip} testID="setup-ai-skip" />
        </>
      }>
      {hasKey ? (
        <Note tone="good" testID="setup-ai-present">
          A key is already saved. Paste a new one to replace it.
        </Note>
      ) : null}
      <TextInput
        value={draft}
        onChangeText={(next) => {
          setDraft(next);
          setError(null);
        }}
        placeholder="Paste your API key"
        placeholderTextColor={palette.muted}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        className={`rounded-2xl bg-surface px-4 py-4 text-base text-ink ${fieldBorder(!!error)}`}
        testID="setup-ai-key"
      />
      <FieldError message={error} testID="setup-ai-error" />
      <Pressable
        onPress={() => void Linking.openURL(KEY_PAGE)}
        testID="setup-ai-get-key"
        accessibilityRole="link"
        className="mt-3 flex-row items-center gap-1 self-start py-1 active:opacity-60">
        <Text className="text-sm text-accent">Get a key from Google AI Studio</Text>
        <Icon name="chevron" size={12} color={palette.accent} />
      </Pressable>
      <Note>
        Checked with Google before it is saved, then kept in this phone&apos;s secure storage —
        never in a backup.
      </Note>
    </StepFrame>
  );
}

// ------------------------------------------------------------------- bank --

/**
 * The prominent disclosure Google Play requires before notification access is
 * requested — and the only route to that request.
 *
 * Play's rule: say what is accessed, how it is used and whether it leaves the
 * device, in the app, BEFORE the system settings screen, and get an explicit
 * yes. So each of those has its own line here rather than living in the privacy
 * policy alone, and the button that opens Android's page says "Agree". The
 * Settings card sends anyone who skipped this back to this same screen; there
 * is no second way in.
 */
const DISCLOSURE = [
  {
    title: 'What Peace can see',
    body: 'Android grants notification access as one permission, so while it is allowed Peace receives every notification posted on this phone.',
  },
  {
    title: 'What it keeps',
    body: 'Only notifications from the bank senders you name below. Everything else is ignored as it arrives and never stored.',
  },
  {
    title: 'Where it goes',
    body: 'The text of a matching message is sent to Google Gemini, with your own API key, to read the amount and where it was spent. Nothing goes to Merope or anyone else.',
  },
  {
    title: 'How long',
    body: 'A message stays on this phone until you approve or dismiss the record it suggests, then it is deleted. Turn this off at any time in Settings.',
  },
];

export function BankStep({ eyebrow, onDone, onSkip }: StepProps) {
  const palette = useTheme();
  const senders = useSettingsStore((s) => s.settings.bankSenders);
  const update = useSettingsStore((s) => s.update);
  const hasKey = useGeminiKeyStore((s) => s.hasKey);
  const [access, setAccess] = useState(bankAccess);
  const [draft, setDraft] = useState('');

  /**
   * Access is granted on Android's own page, so the answer arrives on the way
   * BACK into the app. Capturing switches on with it: allowing access after
   * reading the disclosure is the yes, and asking a second time would only be
   * a second switch to forget.
   */
  /**
   * Access is granted on Android's own page, so the answer arrives while this
   * step is NOT what Android considers foreground. Asked on returning to the
   * app AND, until it is granted, once a second while the step is open: on a
   * device the foreground event alone left this step saying "allow access"
   * over access that had been granted, and the user stuck on it. The check is
   * one synchronous native call, and it stops the moment access is there.
   *
   * Capturing switches on with it: allowing access after reading the
   * disclosure is the yes, and asking a second time would only be a second
   * switch to forget.
   */
  useEffect(() => {
    const check = () => {
      const now = bankAccess();
      if (now.permitted && !now.capturing) {
        try {
          setCapturing(true);
          now.capturing = true;
        } catch {
          // The row below still says what state it is in.
        }
      }
      setAccess((was) =>
        was.permitted === now.permitted && was.capturing === now.capturing ? was : now
      );
    };
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') check();
    });
    const poll = access.permitted ? null : setInterval(check, 1000);
    return () => {
      subscription.remove();
      if (poll) clearInterval(poll);
    };
  }, [access.permitted]);

  const add = () => {
    const value = draft.trim();
    setDraft('');
    if (value === '' || senders.some((s) => s.toLowerCase() === value.toLowerCase())) return;
    update('bankSenders', [...senders, value]);
  };

  const allow = () => {
    try {
      openListenerSettings();
    } catch (e) {
      console.warn('[setup] could not open notification access settings', e);
    }
  };

  return (
    <StepFrame
      emblem="bank"
      color={COLOR.bank}
      eyebrow={eyebrow}
      title="Turn bank alerts into records"
      body="When your bank texts you about a payment, Peace can offer it as a record — you check it and tap once."
      testID="setup-bank"
      actions={
        access.permitted ? (
          <>
            <PrimaryButton
              label={senders.length === 0 ? 'Name a bank first' : 'Done'}
              onPress={onDone}
              disabled={senders.length === 0}
              testID="setup-bank-done"
            />
            <QuietButton onPress={onSkip} testID="setup-bank-skip" />
          </>
        ) : (
          <>
            <PrimaryButton
              label="Agree and allow access"
              onPress={allow}
              testID="setup-bank-allow"
            />
            <QuietButton onPress={onSkip} testID="setup-bank-skip" />
          </>
        )
      }>
      <View className="rounded-2xl border border-line bg-surface" testID="setup-bank-disclosure">
        {DISCLOSURE.map((item, i) => (
          <View key={item.title} className={`p-4 ${i > 0 ? 'border-t border-line' : ''}`}>
            <Text className="text-sm font-semibold text-ink">{item.title}</Text>
            <Text className="mt-1 text-sm leading-5 text-muted">{item.body}</Text>
          </View>
        ))}
      </View>

      <Text className="mb-2 mt-6 text-[11px] uppercase tracking-widest text-muted">
        Banks to read
      </Text>
      {senders.length > 0 ? (
        <View className="mb-2 flex-row flex-wrap gap-2" testID="setup-bank-senders">
          {senders.map((sender) => (
            <Pressable
              key={sender}
              onPress={() =>
                update(
                  'bankSenders',
                  senders.filter((s) => s !== sender)
                )
              }
              accessibilityRole="button"
              accessibilityLabel={`Remove ${sender}`}
              className="flex-row items-center gap-1.5 rounded-full bg-raised px-3 py-1.5 active:opacity-70">
              <Text className="text-sm text-ink">{sender}</Text>
              <Icon name="close" size={10} color={palette.muted} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <View className="flex-row gap-2">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          placeholder="As it appears on the alert"
          placeholderTextColor={palette.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="done"
          className="flex-1 rounded-xl bg-surface px-4 py-3 text-base text-ink"
          testID="setup-bank-sender"
        />
        <Pressable
          onPress={add}
          testID="setup-bank-sender-add"
          accessibilityRole="button"
          className="justify-center rounded-xl border border-line px-4 active:bg-surface">
          <Text className="text-[15px] text-ink">Add</Text>
        </Pressable>
      </View>

      {access.permitted ? (
        <Note tone="good" testID="setup-bank-granted">
          Notification access is allowed
          {access.capturing ? ' and Peace is listening.' : '.'}
        </Note>
      ) : (
        <Note>Android opens its notification access page. Find Peace there and switch it on.</Note>
      )}
      {hasKey === false ? (
        <Note>Messages wait, unread, until there is an AI key to read them with.</Note>
      ) : null}
    </StepFrame>
  );
}

// ----------------------------------------------------------------- backup --

export function BackupStep({ eyebrow, onDone, onSkip }: StepProps) {
  const account = useSettingsStore((s) => s.settings.driveAccount);
  const cadence = useSettingsStore((s) => s.settings.driveCadence);
  const update = useSettingsStore((s) => s.update);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectDrive = async () => {
    setBusy(true);
    setError(null);
    try {
      const email = await connect();
      update('driveAccount', email);
      if (cadence === 'off') update('driveCadence', 'weekly');
      onDone();
    } catch (e) {
      console.warn('[setup] Drive connection failed', e);
      setError(e instanceof Error ? e.message : 'Google Drive could not be connected.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepFrame
      emblem="cloud"
      color={COLOR.backup}
      eyebrow={eyebrow}
      title="Keep a copy somewhere else"
      body="Your ledger lives only on this phone, so a lost phone would take it along. Back up to your own Google Drive once a week, or save copies yourself whenever you like."
      testID="setup-backup"
      actions={
        <>
          {account ? (
            <PrimaryButton label="Continue" onPress={onDone} testID="setup-backup-continue" />
          ) : (
            <PrimaryButton
              label="Back up to Google Drive"
              onPress={connectDrive}
              busy={busy}
              testID="setup-backup-drive"
            />
          )}
          {account ? null : (
            <SecondaryButton
              label="I'll save my own copies"
              onPress={onDone}
              testID="setup-backup-manual"
            />
          )}
          <QuietButton onPress={onSkip} testID="setup-backup-skip" />
        </>
      }>
      <View className="gap-3">
        <BackupOption
          icon="cloud"
          title="Google Drive, weekly"
          body="Into a private app folder only Peace can read. Encrypt it with a passphrase in Backup & export."
        />
        <BackupOption
          icon="folder"
          title="Your own copies"
          body="Backup & export in the menu saves one file holding everything, receipts included."
        />
      </View>
      {account ? (
        <Note tone="good" testID="setup-backup-connected">
          Backing up to {account}.
        </Note>
      ) : null}
      {error ? (
        <Note tone="bad" testID="setup-backup-error">
          {error}
        </Note>
      ) : null}
    </StepFrame>
  );
}

function BackupOption({ icon, title, body }: { icon: string; title: string; body: string }) {
  const palette = useTheme();
  return (
    <View className="flex-row gap-3 rounded-2xl bg-surface p-4">
      <Icon name={icon} size={20} color={palette.muted} />
      <View className="flex-1">
        <Text className="text-[15px] font-semibold text-ink">{title}</Text>
        <Text className="mt-0.5 text-sm leading-5 text-muted">{body}</Text>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------- done --

export function DoneStep({ facts, onFinish }: { facts: SetupFacts; onFinish: () => void }) {
  const palette = useTheme();
  const left = SETUP_STEPS.filter((step) => !stepDone(step, facts)).length;
  return (
    <StepFrame
      emblem="check"
      color={COLOR.done}
      title="You're all set."
      body={
        left === 0
          ? 'Everything is set up. Peace of mind — and from here, a piece of cake.'
          : 'Whatever you left for later waits on the Records screen, one tap away.'
      }
      testID="setup-done"
      actions={<PrimaryButton label="Start recording" onPress={onFinish} testID="setup-finish" />}>
      <View className="overflow-hidden rounded-2xl bg-surface">
        {SETUP_STEPS.map((step, i) => {
          const done = stepDone(step, facts);
          return (
            <View
              key={step}
              className={`flex-row items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-line' : ''}`}>
              <View
                className={`h-6 w-6 items-center justify-center rounded-full ${
                  done ? 'bg-income' : 'bg-line'
                }`}>
                {done ? <Icon name="check" size={14} color={palette.ground} /> : null}
              </View>
              <Text className={`flex-1 text-[15px] ${done ? 'text-ink' : 'text-muted'}`}>
                {STEP_LABELS[step]}
              </Text>
              <Text className="text-xs text-muted" testID={`setup-summary-${step}`}>
                {done ? 'Done' : 'Later'}
              </Text>
            </View>
          );
        })}
      </View>
    </StepFrame>
  );
}
