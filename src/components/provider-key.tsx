/**
 * One provider's API key, as a row in Settings › AI › Providers & keys.
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
 * KEYS ONLY. Which model does which job is chosen on each feature's own page,
 * from every provider that has a key here.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import { AiError } from '@/ai/error';
import { MODEL_SETTINGS, parseModelRef, type ModelSetting } from '@/ai/model-ref';
import { PROVIDERS, type ProviderId } from '@/ai/providers';
import { Icon } from '@/components/icon';
import { getApiKey, maskKey } from '@/lib/secrets';
import { useAiKeysStore } from '@/state/ai-keys';
import { runBankCatchUp } from '@/state/bank';
import { useSettingsStore } from '@/state/settings';
import { useTheme } from '@/state/theme';

/** What each job is called, for "Penny and Bank messages use DeepSeek". */
const JOB_NAMES: Record<ModelSetting, string> = {
  receiptsModel: 'Receipts',
  bankModel: 'Bank messages',
  voiceModel: 'Voice',
  voiceReadModel: 'Voice',
  pennyModel: 'Penny',
  pennyFilesModel: 'Penny',
};

/** Where each provider's key comes from, in the words its console uses. */
const KEY_SOURCE: Record<ProviderId, string> = {
  gemini: 'Google AI Studio',
  openai: 'the OpenAI platform',
  deepseek: 'the DeepSeek platform',
  mistral: 'Mistral’s console',
  openrouter: 'OpenRouter',
};

export function ProviderKeyRow({
  provider,
  last,
  testID,
}: {
  provider: ProviderId;
  last?: boolean;
  /** `gemini-key`: the row's parts are `-edit`, `-input`, `-save` and so on. */
  testID: string;
}) {
  const palette = useTheme();
  const info = PROVIDERS[provider];
  const settings = useSettingsStore((state) => state.settings);

  const saveKey = useAiKeysStore((state) => state.save);
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
    void getApiKey(provider).then((key) => {
      if (!alive) return;
      setSaved(key);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [provider]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Through the store, so every feature page learns of it on this screen.
      await saveKey(provider, draft);
      setSaved(await getApiKey(provider));
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
        bankModel: settings.bankModel,
        guidance: settings.bankGuidance,
        aiEnabled: settings.aiEnabled,
      });
    } catch (e) {
      // A refused key arrives as an AiError already worded for this screen.
      // Anything else is the keystore refusing, on a device with a broken
      // keychain: friendly sentence here, real error in the log.
      if (e instanceof AiError) {
        setError(e.message);
      } else {
        console.warn(`[settings] could not save the ${info.name} key`, e);
        setError('Could not save that key on this device.');
      }
    } finally {
      setBusy(false);
    }
  }, [draft, info.name, provider, saveKey, settings]);

  /**
   * Removing a key that features still use says which, before it happens —
   * they stop working the moment it is gone, and "why did Penny stop?" a week
   * later has no answer on Penny's page.
   */
  const onSave = useCallback(() => {
    if (draft.trim() !== '' || saved === null) {
      void save();
      return;
    }
    const using = [
      ...new Set(
        MODEL_SETTINGS.filter((key) => parseModelRef(settings[key])?.provider === provider).map(
          (key) => JOB_NAMES[key]
        )
      ),
    ];
    if (using.length === 0) {
      void save();
      return;
    }
    const list = using.length === 1 ? using[0] : `${using.slice(0, -1).join(', ')} and ${using.at(-1)}`;
    Alert.alert(
      `Remove the ${info.name} key?`,
      `${list} ${using.length === 1 ? 'uses' : 'use'} ${info.name}, and will stop working until you choose another model or add a key again.`,
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void save() },
      ]
    );
  }, [draft, info.name, provider, save, saved, settings]);

  return (
    <>
      {/* The key, as a row. Tapping it opens the editor right here rather than
          on a page of its own — it is two fields and a button. */}
      <Pressable
        onPress={() => setEditing(true)}
        disabled={!loaded || editing}
        testID={`${testID}-edit`}
        accessibilityRole="button"
        accessibilityLabel={saved ? `Change the ${info.name} key` : `Add a ${info.name} key`}
        className={`flex-row items-center gap-3 px-4 py-3.5 active:bg-raised ${
          editing || last ? '' : 'border-b border-line'
        }`}>
        <View className="flex-1">
          <Text className="text-[15px] text-ink">{info.name}</Text>
          <Text className="text-xs leading-4 text-muted">From {KEY_SOURCE[provider]}.</Text>
        </View>
        <Text className={`text-sm ${saved ? 'text-ink' : 'text-accent'}`} testID={`${testID}-state`}>
          {/* Nothing at all until the keystore has answered — "Not set" shown
              while loading reads as the key having been lost. */}
          {loaded ? maskKey(saved) : ' '}
        </Text>
        {editing ? null : <Icon name="chevron" size={14} color={palette.muted} />}
      </Pressable>

      {editing ? (
        <View className={`px-4 pb-4 ${last ? '' : 'border-b border-line'}`}>
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
            testID={`${testID}-input`}
          />
          {/* Directly under the field it is about. At the foot of the card it
              sat below the fold with the keyboard up, and a Save that seemed
              to do nothing was all anyone saw. */}
          {error ? (
            <Text className="mb-2 text-sm leading-5 text-expense" testID={`${testID}-error`}>
              {error}
            </Text>
          ) : (
            <Text className="mb-3 text-xs leading-5 text-muted">
              Checked with {info.name} before it is saved. Make one at{' '}
              {info.keyPage.replace(/^https:\/\//, '')}.
            </Text>
          )}
          <View className="flex-row gap-2">
            <SmallButton
              label={busy ? 'Checking…' : 'Save'}
              onPress={onSave}
              disabled={busy}
              primary
              testID={`${testID}-save`}
            />
            <SmallButton
              label="Cancel"
              onPress={() => {
                setEditing(false);
                setDraft('');
                setError(null);
              }}
              disabled={busy}
              testID={`${testID}-cancel`}
            />
          </View>
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
