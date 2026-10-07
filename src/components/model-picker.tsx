import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { PickerSheet, type PickerOption } from '@/components/picker-sheet';
import { GeminiError, listModels, type GeminiModel } from '@/lib/gemini';
import { getGeminiKey } from '@/lib/secrets';

/**
 * Choosing a Gemini model from the list Google returns for this key.
 *
 * Shared by the reading features and the assistant, which pick separately —
 * one copy of the listing, the error handling and the "keep what is in use
 * visible" rule, rather than two that drift.
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
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  sheetTitle: string;
  testIDPrefix: string;
}) {
  const [models, setModels] = useState<GeminiModel[] | null>(null);
  const [listing, setListing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async () => {
    setListing(true);
    setError(null);
    try {
      const key = await getGeminiKey();
      if (key === null) {
        setError('Add a key first.');
        return;
      }
      setModels(await listModels(key));
    } catch (e) {
      // Listing failing must not strand anyone on a broken model — whatever is
      // already set keeps working, and the message says what went wrong.
      setError(e instanceof GeminiError ? e.message : 'Could not list the models.');
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
    const rows = (models ?? []).map((m) => ({ id: m.id, label: m.label, icon: 'sparkle', detail: m.id }));
    if (!rows.some((r) => r.id === value)) {
      rows.unshift({ id: value, label: value, icon: 'sparkle', detail: 'In use' });
    }
    return rows;
  }, [models, value]);

  return (
    <View>
      <View className="mb-2 flex-row items-center justify-between">
        <Text className="text-sm text-muted">{label}</Text>
        <Text className="text-sm text-ink" testID={`${testIDPrefix}-state`}>
          {value}
        </Text>
      </View>

      <Pressable
        onPress={open}
        disabled={listing}
        testID={`${testIDPrefix}-edit`}
        accessibilityRole="button"
        className={`rounded-lg border border-line px-4 py-2.5 active:opacity-80 ${listing ? 'opacity-40' : ''}`}>
        <Text className="text-sm font-semibold text-muted">{listing ? 'Loading models…' : 'Change model'}</Text>
      </Pressable>
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
          onChange(id);
          setModels(null);
        }}
        onClose={() => setModels(null)}
        testID={`sheet-${testIDPrefix}`}
      />
    </View>
  );
}
