/**
 * The Gemini API key, and the model it names.
 *
 * WHY THIS IS A SETTING AND NOT A BUILD CONSTANT. A key baked into the APK is a
 * key anybody who installs it can extract and bill to the person who built it.
 * The user pastes their own, it goes to `expo-secure-store`, and it is never
 * written to the `settings` table — that table travels inside every backup, and
 * a billable credential riding along in a file you mail to yourself is a
 * credential you have published. See `secrets.ts`.
 *
 * Shaped after the passphrase editor in `drive-backup.tsx` on purpose: the same
 * job (a secret, entered inline, masked once saved) should not have two
 * different shapes in one app.
 *
 * The MODEL is chosen from a list Google returns rather than typed. A typed
 * model name is a 404 waiting to happen, and there is no way to discover the
 * right spelling from inside the app.
 */

import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ModelRow } from '@/components/model-picker';
import palette from '@/constants/palette';
import { GeminiError } from '@/lib/gemini';
import { getGeminiKey, maskKey } from '@/lib/secrets';
import { useGeminiKeyStore } from '@/state/gemini-key';
import { runBankCatchUp } from '@/state/bank';
import { useSettingsStore } from '@/state/settings';

/**
 * The key and the model, as rows inside Settings' AI section.
 */
export function GeminiKeyRows() {
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);

  const saveKey = useGeminiKeyStore((state) => state.save);
  const [saved, setSaved] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read once. The keystore is async and the row must not flash "Not set"
  // before the answer arrives, which would read as the key having been lost.
  useEffect(() => {
    let alive = true;
    void getGeminiKey().then((key) => {
      if (!alive) return;
      setSaved(key);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const onSave = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Through the store, so Penny's card below learns of it on this screen.
      await saveKey(draft);
      setSaved(await getGeminiKey());
      setEditing(false);
      setDraft('');

      /**
       * Read whatever was waiting for exactly this.
       *
       * Bank messages captured before there was a key sit `pending` for want of
       * one. Leaving them until the next foreground means adding a key appears
       * to do nothing, which is the same complaint the capture event fixed.
       */
      void runBankCatchUp({
        senders: settings.bankSenders,
        homeCurrency: settings.homeCurrency,
        geminiModel: settings.geminiModel,
        guidance: settings.bankGuidance,
        aiEnabled: settings.aiEnabled,
      });
    } catch (e) {
      // A refused key arrives as a GeminiError already worded for this
      // screen. Anything else is the keystore refusing, on a device with a
      // broken keychain: friendly sentence here, real error in the log.
      if (e instanceof GeminiError) {
        setError(e.message);
      } else {
        console.warn('[settings] could not save the Gemini key', e);
        setError('Could not save that key on this device.');
      }
    } finally {
      setBusy(false);
    }
  }, [
    draft,
    saveKey,
    settings.bankSenders,
    settings.homeCurrency,
    settings.geminiModel,
    settings.bankGuidance,
    settings.aiEnabled,
  ]);

  return (
    <>
      {/* The key, as a row. Tapping it opens the editor right here rather than
          on a page of its own — it is two fields and a button, and the switch
          it serves is directly above it. */}
      <Pressable
        onPress={() => setEditing(true)}
        disabled={!loaded || editing}
        testID="gemini-key-edit"
        accessibilityRole="button"
        accessibilityLabel={saved ? 'Change the Gemini key' : 'Add a Gemini key'}
        className={`flex-row items-center gap-3 px-4 py-3.5 active:bg-raised ${
          editing ? '' : 'border-b border-line'
        }`}>
        <View className="flex-1">
          <Text className="text-[15px] text-ink">Gemini key</Text>
          <Text className="text-xs leading-4 text-muted">
            Your own, from Google AI Studio. Kept on this phone, never in a backup.
          </Text>
        </View>
        <Text
          className={`text-sm ${saved ? 'text-ink' : 'text-accent'}`}
          testID="gemini-key-state">
          {/* Nothing at all until the keystore has answered — "Not set" shown
              while loading reads as the key having been lost. */}
          {loaded ? maskKey(saved) : ' '}
        </Text>
        {editing ? null : <Icon name="chevron" size={14} color={palette.muted} />}
      </Pressable>

      {editing ? (
        <View className="border-b border-line px-4 pb-4">
          <TextInput
            value={draft}
            onChangeText={(next) => {
              setDraft(next);
              setError(null);
            }}
            placeholder="Paste your key, or leave blank to remove it"
            placeholderTextColor={palette.muted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            className={`mb-2 rounded-lg border px-3 py-2.5 text-ink ${
              error ? 'border-expense' : 'border-line'
            }`}
            testID="gemini-key-input"
          />
          {/* Directly under the field it is about. At the foot of the card it
              sat below the fold with the keyboard up, and a Save that seemed
              to do nothing was all anyone saw. */}
          {error ? (
            <Text className="mb-2 text-sm leading-5 text-expense" testID="gemini-key-error">
              {error}
            </Text>
          ) : (
            <Text className="mb-3 text-xs leading-5 text-muted">
              Checked with Google before it is saved. Make one at aistudio.google.com — reading a
              receipt is one request, and the free tier covers ordinary use.
            </Text>
          )}
          <View className="flex-row gap-2">
            <SmallButton
              label={busy ? 'Checking…' : 'Save'}
              onPress={onSave}
              disabled={busy}
              primary
              testID="gemini-key-save"
            />
            <SmallButton
              label="Cancel"
              onPress={() => {
                setEditing(false);
                setDraft('');
                setError(null);
              }}
              disabled={busy}
              testID="gemini-key-cancel"
            />
          </View>
        </View>
      ) : null}

      {/**
       * The model row appears ONLY once a key exists.
       *
       * Same rule as the rest of Settings: a control for something that cannot
       * run is a control that silently does nothing. Choosing a model before
       * there is a key to call it with is exactly that.
       */}
      {saved ? (
        <View className="border-b border-line px-4 py-3.5">
          {/* Selecting writes straight through to the settings store, which is
              a write-through cache over SQLite — so the record screen picks up
              the new model without this component telling it anything. */}
          <ModelRow
            label="Model"
            value={settings.geminiModel}
            onChange={(id) => update('geminiModel', id)}
            sheetTitle="Gemini model"
            testIDPrefix="gemini-model"
          />
        </View>
      ) : null}
    </>
  );
}

function SmallButton({
  label,
  onPress,
  disabled,
  primary,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      className={`rounded-lg px-4 py-2.5 active:opacity-80 ${
        primary ? 'bg-accent' : 'border border-line'
      } ${disabled ? 'opacity-40' : ''}`}>
      <Text className={`text-sm font-semibold ${primary ? 'text-accent-ink' : 'text-muted'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
