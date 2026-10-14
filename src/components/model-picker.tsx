import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';

import { PickerSheet, type PickerOption } from '@/components/picker-sheet';
import { GeminiError, listModels, type GeminiModel } from '@/lib/gemini';
import { getGeminiKey } from '@/lib/secrets';
import { useTheme } from '@/state/theme';

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
  const palette = useTheme();
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
          accessibilityLabel={`${label}: ${value}. Choose another`}
          className={`flex-1 flex-row items-center gap-2 rounded-lg border border-line px-3 py-2 active:bg-raised ${
            listing ? 'opacity-60' : ''
          }`}>
          <Text
            className="flex-1 text-right text-sm text-ink"
            numberOfLines={1}
            testID={`${testIDPrefix}-state`}>
            {listing ? 'Loading models…' : value}
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
