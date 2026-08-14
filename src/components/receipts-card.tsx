/**
 * Reading receipts — everything except the key, which is shared.
 *
 * A card of its own so the Gemini credential above it is visibly ONE thing used
 * by two features, rather than something that appears to belong to receipts and
 * is mysteriously also required by bank messages.
 */

import { Text, View } from 'react-native';

import { PromptEditor } from '@/components/prompt-editor';
import { useSettingsStore } from '@/state/settings';

export function ReceiptsCard() {
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);

  return (
    <View className="rounded-xl bg-surface p-4" testID="receipts-card">
      <Text className="mb-1 text-base font-semibold text-ink">Receipts</Text>
      <Text className="mb-3 text-sm leading-5 text-muted">
        Photograph a receipt on the record screen and tap the sparkle to fill in the amount, date
        and shop.
      </Text>

      <PromptEditor
        label="Your rules"
        hint="Anything about your own receipts the model could not work out — a shop it keeps misreading, a charge that should not count. Most people need none."
        example={'Ignore the 12% service charge at Zooba.\nReceipts from "AMZN Mktp" are Amazon.'}
        value={settings.receiptGuidance}
        onChange={(next) => update('receiptGuidance', next)}
        testID="receipt-guidance"
      />
    </View>
  );
}
