/**
 * Reading receipts and invoices — photos, PDFs and text files — everything
 * except the key, which is shared.
 *
 * Shaped like Penny's card on purpose: the switch sits beside the sentence
 * saying what the feature does, and nothing else is shown while it is off. A
 * page of options for a feature that is not running is a page of controls that
 * do nothing.
 */

import { Switch, Text, View } from 'react-native';

import { ModelRow } from '@/components/model-picker';
import { PromptEditor } from '@/components/prompt-editor';
import { useSwitchColors } from '@/state/theme';
import { useAi } from '@/state/ai';
import { useSettingsStore } from '@/state/settings';

export function ReceiptsCard() {
  const switchColors = useSwitchColors();
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  // What the switch SHOWS is whether reading is wanted AND could be — Use AI,
  // some key, and this switch. With no key it is off and muted, and the setting
  // itself is kept. The model is chosen below it, so "on with no model yet" is
  // a state the switch has to be able to show.
  const ai = useAi();
  const enabled = ai.ready && settings.receiptsEnabled;

  return (
    <View className="rounded-xl bg-surface p-4" testID="receipts-card">
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <Text className="text-[15px] leading-6 text-ink">
            Attach a receipt or invoice to a record — a photo, a PDF or a text file — and tap the
            sparkle to fill in the amount, date and shop.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={(next) => update('receiptsEnabled', next)}
          disabled={!ai.ready}
          testID="receipts-enabled"
          accessibilityLabel="Read receipts and invoices"
          {...switchColors}
        />
      </View>

      {enabled ? (
        <View className="mt-4 gap-4 border-t border-line pt-4">
          <ModelRow
            label="Model"
            value={settings.receiptsModel}
            onChange={(stored) => update('receiptsModel', stored)}
            sheetTitle="Model for receipts"
            testIDPrefix="receipts-model"
          />
          <PromptEditor
            label="Your rules"
            hint="Anything about your own receipts and invoices the model could not work out — a shop it keeps misreading, a charge that should not count. Most people need none."
            example={'Leave out the service charge on restaurant bills.\nReceipts from "AMZN Mktp" are Amazon.'}
            value={settings.receiptGuidance}
            onChange={(next) => update('receiptGuidance', next)}
            testID="receipt-guidance"
          />
        </View>
      ) : ai.ready ? (
        <Text className="mt-3 text-xs leading-5 text-muted" testID="receipts-off">
          Off: files still attach to records, with no reading button on them.
        </Text>
      ) : null}
    </View>
  );
}
