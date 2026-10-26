import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';

import { PickerSheet, type PickerOption } from '@/components/picker-sheet';
import { listModels } from '@/ai';
import { CHECKS, type CheckName } from '@/ai/checks';
import { AiError } from '@/ai/error';
import { formatModelRef, parseModelRef } from '@/ai/model-ref';
import { PROVIDER_IDS, PROVIDERS, type ModelInfo, type ProviderId } from '@/ai/providers';
import { getApiKey } from '@/lib/secrets';
import { useModelChecks } from '@/state/model-checks';
import { useSetting } from '@/state/settings';
import { useTheme } from '@/state/theme';

type Listed = { provider: ProviderId; model: ModelInfo };

/** What the row shows for a stored choice. */
export function describeModel(stored: string): string {
  const ref = parseModelRef(stored);
  return ref ? `${PROVIDERS[ref.provider].name} · ${ref.model}` : 'Choose a model';
}

/**
 * Choosing a model for one job, from every provider that has a key.
 *
 * Shared by every feature, each of which picks its own — one copy of the
 * listing, the error handling and the "keep what is in use visible" rule,
 * rather than one per page that drift. A provider whose listing fails is left
 * out with its reason; the others still list, so one provider having a bad
 * minute does not stop anybody choosing another.
 *
 * A dropdown rather than a free-text field, because a typed model name is a
 * 404 waiting to happen and there is no way to discover the right spelling
 * from inside the app. Fetched on demand rather than at launch: it costs a
 * request, it is only needed on the rare occasion somebody changes it, and a
 * Settings screen that makes a network call just by opening is a Settings
 * screen that fails to open on a plane.
 */
export function ModelRow({
  label,
  value,
  onChange,
  sheetTitle,
  testIDPrefix,
  listen = false,
}: {
  label: string;
  /** The stored choice, `provider:model`, or empty. */
  value: string;
  onChange: (stored: string) => void;
  sheetTitle: string;
  testIDPrefix: string;
  /** Voice's listener: speech-to-text models are offered too. Nowhere else can use one. */
  listen?: boolean;
}) {
  const remember = useModelChecks((s) => s.remember);
  const check = useModelChecks((s) => s.check);
  const abilities = useSetting('modelAbilities');
  const palette = useTheme();
  const [models, setModels] = useState<Listed[] | null>(null);
  const [listing, setListing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async () => {
    setListing(true);
    setError(null);
    try {
      const keyed: { provider: ProviderId; key: string }[] = [];
      for (const provider of PROVIDER_IDS) {
        const key = await getApiKey(provider);
        if (key !== null) keyed.push({ provider, key });
      }
      if (keyed.length === 0) {
        setError('Add a key in Providers & keys first.');
        return;
      }
      const results = await Promise.allSettled(keyed.map(({ provider, key }) => listModels(provider, key)));
      const listed: Listed[] = [];
      const failures: string[] = [];
      results.forEach((result, i) => {
        const { provider } = keyed[i];
        if (result.status === 'fulfilled') {
          for (const model of result.value) listed.push({ provider, model });
        } else {
          // Listing failing must not strand anyone on a broken model — whatever
          // is already set keeps working, and the message says what went wrong.
          const reason = result.reason;
          if (!(reason instanceof AiError)) console.warn('[models] listing failed', provider, reason);
          failures.push(reason instanceof AiError ? reason.message : `Could not list ${PROVIDERS[provider].name}'s models.`);
        }
      });
      if (failures.length > 0) setError(failures.join('\n'));
      if (listed.length > 0) setModels(listed);
    } finally {
      setListing(false);
    }
  }, []);

  /**
   * The model currently in use is ALWAYS present, even when the fetched list
   * does not contain it — otherwise opening the picker on a retired model would
   * show no selection at all and leave the user unsure what they are running.
   */
  const options: PickerOption[] = useMemo(() => {
    const rows: PickerOption[] = (models ?? [])
      .filter(({ model }) => listen || !model.transcription)
      .map(({ provider, model }) => ({
        id: formatModelRef({ provider, model: model.id }),
        label: model.label,
        icon: 'sparkle',
        detail: `${PROVIDERS[provider].name} · ${model.transcription ? 'speech to text' : model.id}`,
      }));
    if (value !== '' && !rows.some((r) => r.id === value)) {
      rows.unshift({ id: value, label: describeModel(value), icon: 'sparkle', detail: 'In use' });
    }
    return rows;
  }, [listen, models, value]);

  /**
   * ONE ROW: the label, and a field that shows the model and opens the list.
   *
   * It used to be the name on one line and a "Change model" button on the next
   * — two controls for one value, and the button said nothing about what it
   * would change. A field that holds its own value is the shape everybody
   * already knows from every dropdown they have used. The id is shown rather
   * than the display name because the id is what gets called, and two similar
   * names would leave you unsure which one you are running.
   */
  return (
    <View>
      <View className="flex-row items-center gap-3">
        <Text className="text-[15px] text-ink">{label}</Text>
        <Pressable
          onPress={open}
          disabled={listing}
          testID={`${testIDPrefix}-edit`}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${describeModel(value)}. Choose another`}
          className={`flex-1 flex-row items-center gap-2 rounded-lg border border-line px-3 py-2 active:bg-raised ${
            listing ? 'opacity-60' : ''
          }`}>
          <Text
            className="flex-1 text-right text-sm text-ink"
            numberOfLines={1}
            testID={`${testIDPrefix}-state`}>
            {listing ? 'Loading models…' : describeModel(value)}
          </Text>
          {listing ? (
            <ActivityIndicator size="small" color={palette.muted} />
          ) : (
            // A chevron turned down: the "this opens a list" mark of a dropdown.
            <View style={{ transform: [{ rotate: '90deg' }] }}>
              <Icon name="chevron" size={12} color={palette.muted} />
            </View>
          )}
        </Pressable>
      </View>
      {value !== '' ? <ModelAbilities stored={value} testIDPrefix={testIDPrefix} /> : null}
      {error ? (
        <Text className="mt-2 text-xs text-expense" testID={`${testIDPrefix}-error`}>
          {error}
        </Text>
      ) : null}

      <PickerSheet
        visible={models !== null}
        title={sheetTitle}
        options={options}
        selectedId={value}
        onSelect={(id) => {
          const info = models?.find(({ provider, model }) => formatModelRef({ provider, model: model.id }) === id)?.model;
          remember(id, info);
          onChange(id);
          setModels(null);
          // Asked once per model, the first time anybody chooses it. A
          // transcription model is not a chat model and has nothing to check.
          if (!info?.transcription && !abilities[id]?.checked && !abilities[id]?.transcription) void check(id);
        }}
        onClose={() => setModels(null)}
        testID={`sheet-${testIDPrefix}`}
      />
    </View>
  );
}

const CHECK_LABELS: Record<CheckName, string> = {
  json: 'Replies',
  tools: 'Tools',
  images: 'Images',
  audio: 'Audio',
};

/**
 * What the chosen model can do, under its field: the four checks, or the
 * offer to run them. "?" is a check that could not be asked — never a no.
 */
function ModelAbilities({ stored, testIDPrefix }: { stored: string; testIDPrefix: string }) {
  const palette = useTheme();
  const known = useSetting('modelAbilities')[stored];
  const running = useModelChecks((s) => !!s.running[stored]);
  const check = useModelChecks((s) => s.check);

  if (known?.transcription) {
    return (
      <Text className="mt-2 text-xs leading-4 text-muted" testID={`${testIDPrefix}-abilities`}>
        Speech to text: it writes down what was said, and a second model reads it.
      </Text>
    );
  }
  if (running) {
    return (
      <View className="mt-2 flex-row items-center gap-2" testID={`${testIDPrefix}-checking`}>
        <ActivityIndicator size="small" color={palette.muted} />
        <Text className="text-xs text-muted">Checking what it can do…</Text>
      </View>
    );
  }
  const checked = known?.checked;
  const why = checked ? CHECKS.map((name) => checked[name]).find((o) => o.result === 'unknown')?.message : undefined;
  return (
    <View className="mt-2" testID={`${testIDPrefix}-abilities`}>
      {checked ? (
        <Text className="text-xs leading-4 text-muted">
          {CHECKS.map((name) => {
            const result = checked[name].result;
            return `${result === 'yes' ? '✓' : result === 'no' ? '✗' : '?'} ${CHECK_LABELS[name]}`;
          }).join('   ')}
        </Text>
      ) : null}
      {why ? <Text className="mt-1 text-xs leading-4 text-muted">{why}</Text> : null}
      <Pressable
        onPress={() => void check(stored)}
        testID={`${testIDPrefix}-check`}
        accessibilityRole="button"
        className="mt-1 self-start py-1 active:opacity-60">
        <Text className="text-xs text-accent">
          {checked ? 'Check again' : 'Check what it can do'} · a few tiny requests, a fraction of a cent
        </Text>
      </Pressable>
    </View>
  );
}
