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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { PickerSheet, type PickerOption } from '@/components/picker-sheet';
import palette from '@/constants/palette';
import { GeminiError, listModels, type GeminiModel } from '@/lib/gemini';
import { getGeminiKey, maskKey, setGeminiKey } from '@/lib/secrets';
import { useSettingsStore } from '@/state/settings';

export function GeminiKeyCard() {
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);

  const [saved, setSaved] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [models, setModels] = useState<GeminiModel[] | null>(null);
  const [listing, setListing] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  /**
   * Ask Google which models this key can call, then let the user pick one.
   *
   * A dropdown rather than a free-text field, because a typed model name is a
   * 404 waiting to happen and there is no way to discover the right spelling
   * from inside the app. Fetched on demand rather than at launch: it costs a
   * request, it is only needed on the rare occasion somebody changes it, and a
   * Settings screen that makes a network call just by opening is a Settings
   * screen that fails to open on a plane.
   */
  const onPickModel = useCallback(async () => {
    setListing(true);
    setModelError(null);
    try {
      const key = await getGeminiKey();
      if (key === null) {
        setModelError('Add a key first.');
        return;
      }
      setModels(await listModels(key));
    } catch (e) {
      // Listing failing must not strand anyone on a broken model — whatever is
      // already set keeps working, and the message says what went wrong.
      setModelError(e instanceof GeminiError ? e.message : 'Could not list the models.');
    } finally {
      setListing(false);
    }
  }, []);

  /**
   * What the sheet offers.
   *
   * The model currently in use is ALWAYS present, even when the fetched list
   * does not contain it — otherwise opening the picker on a retired model would
   * show no selection at all and leave the user unsure what they are running.
   */
  const modelOptions: PickerOption[] = useMemo(() => {
    const fetched = models ?? [];
    const rows = fetched.map((m) => ({
      id: m.id,
      label: m.label,
      icon: 'sparkle',
      detail: m.id,
    }));
    if (!rows.some((r) => r.id === settings.geminiModel)) {
      rows.unshift({
        id: settings.geminiModel,
        label: settings.geminiModel,
        icon: 'sparkle',
        detail: 'In use',
      });
    }
    return rows;
  }, [models, settings.geminiModel]);

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
      await setGeminiKey(draft);
      setSaved(await getGeminiKey());
      setEditing(false);
      setDraft('');
    } catch (e) {
      // The keystore can refuse on a device with a broken keychain. Friendly
      // sentence here, real error in the log.
      console.warn('[settings] could not save the Gemini key', e);
      setError('Could not save that key on this device.');
    } finally {
      setBusy(false);
    }
  }, [draft]);

  return (
    <View className="rounded-xl bg-surface p-4" testID="gemini-card">
      <Text className="mb-1 text-base font-semibold text-ink">Read receipts</Text>
      <Text className="mb-3 text-sm leading-5 text-muted">
        With a Gemini API key, Peace can read a photographed receipt and fill in the amount, date
        and shop. Your key is kept on this device and never goes into a backup.
      </Text>

      <View className="mb-3 flex-row items-center justify-between">
        <Text className="text-sm text-muted">API key</Text>
        <Text className="text-sm text-ink" testID="gemini-key-state">
          {/* Nothing at all until the keystore has answered — "Not set" shown
              while loading reads as the key having been lost. */}
          {loaded ? maskKey(saved) : ' '}
        </Text>
      </View>

      {editing ? (
        <>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Paste your key, or leave blank to remove it"
            placeholderTextColor={palette.muted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            className="mb-2 rounded-lg border border-line px-3 py-2.5 text-ink"
            testID="gemini-key-input"
          />
          <Text className="mb-3 text-xs leading-5 text-muted">
            Make one at aistudio.google.com. Reading a receipt is one request; the free tier covers
            ordinary use.
          </Text>
          {error ? (
            <Text className="mb-2 text-xs text-expense" testID="gemini-key-error">
              {error}
            </Text>
          ) : null}
          <View className="flex-row gap-2">
            <SmallButton label="Save" onPress={onSave} disabled={busy} primary testID="gemini-key-save" />
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
        </>
      ) : (
        <SmallButton
          label={saved ? 'Change key' : 'Add a key'}
          onPress={() => setEditing(true)}
          disabled={!loaded}
          testID="gemini-key-edit"
        />
      )}

      {/**
       * The model row appears ONLY once a key exists.
       *
       * Same rule as the rest of Settings: a control for something that cannot
       * run is a control that silently does nothing. Choosing a model before
       * there is a key to call it with is exactly that.
       */}
      {saved ? (
        <View className="mt-4 border-t border-line pt-4">
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-sm text-muted">Model</Text>
            <Text className="text-sm text-ink" testID="gemini-model-state">
              {settings.geminiModel}
            </Text>
          </View>

          <SmallButton
            label={listing ? 'Loading models…' : 'Change model'}
            disabled={listing}
            testID="gemini-model-edit"
            onPress={onPickModel}
          />
          {modelError ? (
            <Text className="mt-2 text-xs text-expense" testID="gemini-model-error">
              {modelError}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Selecting writes straight through to the settings store, which is a
          write-through cache over SQLite — so the record screen picks up the
          new model without this component telling it anything. */}
      <PickerSheet
        visible={models !== null}
        title="Gemini model"
        options={modelOptions}
        selectedId={settings.geminiModel}
        onSelect={(id) => {
          update('geminiModel', id);
          setModels(null);
        }}
        onClose={() => setModels(null)}
        testID="sheet-gemini-model"
      />
    </View>
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
