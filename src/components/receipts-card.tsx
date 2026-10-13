/**
 * Reading receipts — everything except the key, which is shared.
 *
 * Shaped like Penny's card on purpose: the switch sits beside the sentence
 * saying what the feature does, and nothing else is shown while it is off. A
 * page of options for a feature that is not running is a page of controls that
 * do nothing.
 */

import { Switch, Text, View } from 'react-native';

import { PromptEditor } from '@/components/prompt-editor';
import palette from '@/constants/palette';
import { useSettingsStore } from '@/state/settings';

export function ReceiptsCard() {
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  const enabled = settings.receiptsEnabled;

  return (
    <View className="rounded-xl bg-surface p-4" testID="receipts-card">
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <Text className="text-[15px] leading-6 text-ink">
            Photograph a receipt on the record screen and tap the sparkle to fill in the amount, date
            and shop.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={(next) => update('receiptsEnabled', next)}
          testID="receipts-enabled"
          accessibilityLabel="Read receipts"
          trackColor={{ false: palette.line, true: palette.accent }}
          thumbColor={palette.ink}
        />
      </View>

      {enabled ? (
        <View className="mt-4 border-t border-line pt-4">
          <PromptEditor
            label="Your rules"
            hint="Anything about your own receipts the model could not work out — a shop it keeps misreading, a charge that should not count. Most people need none."
            example={'Leave out the service charge on restaurant bills.\nReceipts from "AMZN Mktp" are Amazon.'}
            value={settings.receiptGuidance}
            onChange={(next) => update('receiptGuidance', next)}
            testID="receipt-guidance"
          />
        </View>
      ) : (
        <Text className="mt-3 text-xs leading-5 text-muted" testID="receipts-off">
          Off: photos still attach to records, with no reading button on them.
        </Text>
      )}
    </View>
  );
}
