/**
 * Reading bank messages — the Settings card.
 *
 * THREE THINGS HAVE TO BE TRUE before a single message is read: Android must
 * allow the listener, Peace must be capturing, and a bank must be named. The
 * first two are ONE switch at the top — "is Peace reading bank messages" — and
 * the third is the list beneath it, shown only while the switch is on. Shaped
 * like Penny's and the receipts card: switch beside the sentence, options
 * below it, nothing below it while it is off.
 *
 * THE SENDER LIST STARTS EMPTY AND THAT IS LOAD-BEARING. An empty list reads
 * nothing rather than everything — otherwise granting notification access would
 * send every text message the user receives to Google.
 */

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, Switch, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/icon';
import { useSwitchColors, useTheme } from '@/state/theme';
import { isCapturing, isPermitted, setCapturing } from '@/db/bank-inbox';
import { PromptEditor } from '@/components/prompt-editor';
import { useAi } from '@/state/ai';
import { useBankInbox } from '@/state/bank';
import { useSettingsStore } from '@/state/settings';

/**
 * The two native reads, each surviving a build that has no module.
 *
 * A JS bundle can run against native code that predates it — an over-the-air
 * update, or a stale APK — and a missing module must report "off" rather than
 * taking the Settings screen down with it.
 */
function safeIsPermitted(): boolean {
  try {
    return isPermitted();
  } catch {
    return false;
  }
}

function safeIsCapturing(): boolean {
  try {
    return isCapturing();
  } catch {
    return false;
  }
}

export function BankMessagesCard() {
  const palette = useTheme();
  const switchColors = useSwitchColors();
  const router = useRouter();
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);

  // Read during the first render rather than in an effect: these are cheap
  // synchronous native calls, and setting them from inside an effect body is
  // what `react-hooks/set-state-in-effect` exists to stop.
  const [permitted, setPermitted] = useState(safeIsPermitted);
  const [capturing, setCapturingState] = useState(safeIsCapturing);
  const [draft, setDraft] = useState('');
  /**
   * Captured but not yet read.
   *
   * Shown because the alternative is the app silently doing nothing: with no
   * API key, messages pile up unread and NOTHING anywhere says so — the records
   * list has no row for them either, because a message is only offered once it
   * has been read. Found on a device, when the list was empty and the message
   * was in the database the whole time.
   *
   * From the STORE so it drops the moment the catch-up reads them, even while
   * this screen is the one being looked at.
   */
  const waiting = useBankInbox((state) => state.waiting);
  const reloadInbox = useBankInbox((state) => state.reload);

  /**
   * Re-checked on every return to the foreground.
   *
   * Granting notification access LEAVES THE APP — it happens on a system
   * settings screen — so the state that matters changes while this component is
   * backgrounded. Without this the card would still say "not allowed" after the
   * user had just allowed it, which reads as the grant having failed.
   */
  const refresh = useCallback(() => {
    setPermitted(safeIsPermitted());
    setCapturingState(safeIsCapturing());
    reloadInbox();
  }, [reloadInbox]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  /**
   * And on every return to THIS PAGE.
   *
   * Turning the switch on without access goes through setup's disclosure,
   * which sends the user to Android and back. The foreground event above fires
   * while setup is still on top — before setup has switched capture on — so
   * this card read "off" and never looked again, and the user landed back on a
   * switch that disagreed with what they had just done.
   */
  useFocusEffect(refresh);

  const senders = settings.bankSenders;

  const addSender = () => {
    const value = draft.trim();
    if (value === '') return;
    // Case-insensitive duplicate check: "CIB" and "cib" are the same bank, and
    // two entries would match the same messages twice for no benefit.
    if (senders.some((s) => s.toLowerCase() === value.toLowerCase())) {
      setDraft('');
      return;
    }
    update('bankSenders', [...senders, value]);
    setDraft('');
  };

  /**
   * The switch means "Peace is reading bank messages", so it is on only when
   * BOTH are true: Android allows notification access, and capture is on.
   *
   * Turning it on without access goes through setup's disclosure — Play
   * requires the prominent disclosure before every request for this access, and
   * there is no second way in. That step turns capture on itself once access
   * is granted, and this card re-reads both on the way back.
   */
  // And only while reading can happen at all — a key and Use AI. Without
  // them the switch is off and muted; Android's access and the capture flag
  // are left exactly as they are, so nothing needs redoing once a key exists.
  const ai = useAi();
  const on = permitted && capturing && ai.bank;
  const toggle = (next: boolean) => {
    if (next && !permitted) {
      router.push('/setup?step=bank');
      return;
    }
    try {
      setCapturing(next);
      setCapturingState(next);
    } catch {
      // Leave the displayed state alone rather than claiming a change.
    }
  };

  return (
    <View className="rounded-xl bg-surface p-4" testID="bank-card">
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <Text className="text-[15px] leading-6 text-ink">
            Peace reads the payment alerts your bank posts and offers each one as a record to approve.
            Only from the banks you name below — never your inbox.
          </Text>
        </View>
        <Switch
          value={on}
          onValueChange={toggle}
          disabled={!ai.ready}
          testID="bank-enabled"
          accessibilityLabel="Read bank messages"
          {...switchColors}
        />
      </View>

      {!on && !ai.ready ? null : !on ? (
        <Text className="mt-3 text-xs leading-5 text-muted" testID="bank-off">
          {permitted
            ? 'Off: nothing is captured. Notification access is still allowed in Android — turn it off there if you will not use this again.'
            : 'Turning this on first explains exactly what Peace can see, then opens Android’s notification access page.'}
        </Text>
      ) : (
        <View className="mt-4 border-t border-line pt-4">
          <Text className="mb-2 text-sm text-ink">Banks to read</Text>

          {senders.length === 0 ? (
            <Text className="mb-2 text-xs leading-4 text-muted" testID="bank-senders-empty">
              None yet — nothing will be read. Add the name your bank&apos;s messages arrive under,
              as it shows at the top of the notification. Part of it is enough.
            </Text>
          ) : (
            <View className="mb-2 flex-row flex-wrap gap-2" testID="bank-senders">
              {senders.map((sender) => (
                <Pressable
                  key={sender}
                  onPress={() =>
                    update(
                      'bankSenders',
                      senders.filter((s) => s !== sender)
                    )
                  }
                  testID={`bank-sender-${sender.replace(/[^A-Za-z0-9]/g, '')}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${sender}`}
                  className="flex-row items-center gap-1.5 rounded-full border border-line px-3 py-1.5 active:opacity-70">
                  <Text className="text-sm text-ink">{sender}</Text>
                  <Icon name="close" size={10} color={palette.muted} />
                </Pressable>
              ))}
            </View>
          )}

          {waiting > 0 ? (
            <Text className="mb-2 text-xs leading-4 text-expense" testID="bank-waiting">
              {waiting === 1 ? '1 message is' : `${waiting} messages are`} waiting to be read.
            </Text>
          ) : null}

          <View className="flex-row gap-2">
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={addSender}
              placeholder="Bank name"
              placeholderTextColor={palette.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
              className="flex-1 rounded-lg border border-line px-3 py-2.5 text-ink"
              testID="bank-sender-input"
            />
            <Pressable
              onPress={addSender}
              testID="bank-sender-add"
              accessibilityRole="button"
              className="justify-center rounded-lg bg-accent px-4 active:opacity-80">
              <Text className="text-sm font-semibold text-accent-ink">Add</Text>
            </Pressable>
          </View>

          <View className="mt-4">
            <PromptEditor
              label="Your rules"
              hint="Which card is which, and anything particular to your banks' wording. Peace hands the model your account names, so naming one here is what puts the record on the right card — and its currency."
              example={'The card ending 0042 is my Travel card.\nMessages about an "instalment plan" are not purchases.'}
              value={settings.bankGuidance}
              onChange={(next) => update('bankGuidance', next)}
              testID="bank-guidance"
            />
          </View>
        </View>
      )}
    </View>
  );
}
