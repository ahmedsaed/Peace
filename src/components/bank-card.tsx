/**
 * Reading bank messages — the Settings card.
 *
 * THREE THINGS HAVE TO BE TRUE before a single message is read, and each is a
 * separate decision the user makes: Android must allow the listener, Peace must
 * be switched on, and a bank must be named. The card shows all three because
 * any one of them being off means nothing happens, and "why is this not
 * working" should be answerable by looking at it.
 *
 * THE SENDER LIST STARTS EMPTY AND THAT IS LOAD-BEARING. An empty list reads
 * nothing rather than everything — otherwise granting notification access would
 * send every text message the user receives to Google.
 */

import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import { isCapturing, isPermitted, openListenerSettings, setCapturing } from '@/db/bank-inbox';
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
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);

  // Read during the first render rather than in an effect: these are cheap
  // synchronous native calls, and setting them from inside an effect body is
  // what `react-hooks/set-state-in-effect` exists to stop.
  const [permitted, setPermitted] = useState(safeIsPermitted);
  const [capturing, setCapturingState] = useState(safeIsCapturing);
  const [draft, setDraft] = useState('');

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
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

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

  return (
    <View className="rounded-xl bg-surface p-4" testID="bank-card">
      <Text className="mb-1 text-base font-semibold text-ink">Read bank messages</Text>
      <Text className="mb-3 text-sm leading-5 text-muted">
        Peace can read the SMS notifications your bank posts and offer them as records for you to
        approve. It reads notifications, never your inbox, and only from senders you name below.
      </Text>

      {/* Step one. Not a switch, because this is granted on a system screen and
          a switch that cannot switch itself is a lie about who is in control. */}
      <View className="mb-3 flex-row items-center justify-between">
        <Text className="text-sm text-muted">Notification access</Text>
        {permitted ? (
          <Text className="text-sm text-income" testID="bank-permission-state">
            Allowed
          </Text>
        ) : (
          <Pressable
            onPress={() => {
              try {
                openListenerSettings();
              } catch {
                // Nothing sensible to do; the row still says "Not allowed".
              }
            }}
            testID="bank-permission-grant"
            accessibilityRole="button"
            className="rounded-lg border border-line px-3 py-1.5 active:opacity-70">
            <Text className="text-sm text-accent">Allow…</Text>
          </Pressable>
        )}
      </View>

      {/* Step two, and it exists separately on purpose: revoking notification
          access is buried several screens deep in system settings, and turning
          the feature off has to be one tap here. */}
      <View className="mb-3 flex-row items-center justify-between border-t border-line pt-3">
        <View className="flex-1 pr-3">
          <Text className="text-sm text-ink">Capture messages</Text>
          <Text className="text-xs leading-4 text-muted">
            {permitted
              ? 'Nothing is captured while this is off.'
              : 'Allow notification access first.'}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            const next = !capturing;
            try {
              setCapturing(next);
              setCapturingState(next);
            } catch {
              // Leave the displayed state alone rather than claiming a change.
            }
          }}
          disabled={!permitted}
          testID="bank-capture-toggle"
          accessibilityRole="switch"
          accessibilityState={{ checked: capturing }}
          className={`h-8 w-14 justify-center rounded-full px-1 ${
            capturing ? 'bg-accent' : 'bg-line'
          } ${permitted ? '' : 'opacity-40'}`}>
          <View
            className={`h-6 w-6 rounded-full bg-ground ${capturing ? 'self-end' : 'self-start'}`}
          />
        </Pressable>
      </View>

      {/* Step three. */}
      <View className="border-t border-line pt-3">
        <Text className="mb-2 text-sm text-ink">Senders to read</Text>

        {senders.length === 0 ? (
          <Text className="mb-2 text-xs leading-4 text-muted" testID="bank-senders-empty">
            None yet — nothing will be read. Add the name your bank&apos;s messages arrive under,
            such as CIB or QNB. Part of it is enough.
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

        <View className="flex-row gap-2">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={addSender}
            placeholder="CIB"
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
      </View>
    </View>
  );
}
