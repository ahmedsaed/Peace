/**
 * Reading receipts — everything except the key, which is shared.
 *
 * A card of its own so the Gemini credential above it is visibly ONE thing used
 * by two features, rather than something that appears to belong to receipts and
 * is mysteriously also required by bank messages.
 */

import { Text, View } from 'react-native';

import { PromptEditor } from '@/components/prompt-editor';
import { DEFAULT_RECEIPT_GUIDANCE } from '@/lib/receipt';
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
        label="What to read"
        hint="Tell the model what your receipts look like — which total counts, shops it keeps misreading, anything it should ignore."
        value={settings.receiptGuidance}
        fallback={DEFAULT_RECEIPT_GUIDANCE}
        onChange={(next) => update('receiptGuidance', next)}
        testID="receipt-guidance"
      />
    </View>
  );
}
