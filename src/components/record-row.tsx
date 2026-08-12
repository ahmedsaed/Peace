import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import type { RecordRow as Row } from '@/db/repo/records';
import { formatMinor } from '@/lib/money';

/**
 * One line in the records list.
 *
 * Three shapes of row, one component: expense, income, and transfer. Transfers
 * are visually distinct twice over — the transfer colour AND the "→" in the
 * subtitle — because colour alone is not a signal anyone can rely on.
 */
export function RecordRow({
  row,
  onPress,
  onLongPress,
}: {
  row: Row;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  // A correction is its own kind of row. Rendered like an expense it would read
  // as a mystery purchase in a category you never chose — which is exactly the
  // confusion the feature exists to remove.
  const tone = row.isAdjustment
    ? 'text-muted'
    : row.isTransfer
      ? 'text-transfer'
      : // A refund is money coming back, but it belongs to the expense side and
        // must not wear the income colour — the tint is what a reader checks at
        // a glance, and green would say "earned".
        row.isRefund
        ? 'text-muted'
        : row.amountMinor < 0
          ? 'text-expense'
          : 'text-income';

  // A transfer's stored amount is the negative outgoing leg, but showing it as
  // "-E£10,753" would read as spending. The direction is already carried by the
  // "Bank → Cash" subtitle, so the figure itself goes unsigned.
  const amount =
    row.isTransfer || row.isAdjustment
      ? formatMinor(Math.abs(row.amountMinor), row.currency)
      : formatMinor(row.amountMinor, row.currency, { showSign: true });

  const title = row.isAdjustment
    ? 'Balance correction'
    : row.isTransfer
      ? 'Transfer'
      : (row.categoryName ?? 'Uncategorised');

  const subtitle = row.isTransfer
    ? `${row.accountName} → ${row.counterAccountName ?? '—'}`
    : row.isRefund
      ? `${row.accountName} · refunded${row.note ? ` · “${row.note}”` : ''}`
      : row.isAdjustment
      ? `${row.accountName} · not counted as spending`
      : row.note
        ? `${row.accountName} · “${row.note}”`
        : row.accountName;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      testID={`record-${row.id}`}
      className="flex-row items-center gap-3 border-b border-line px-4 py-3 active:bg-surface">
      <View
        className="h-9 w-9 items-center justify-center rounded-full"
        style={{
          backgroundColor: row.isAdjustment
            ? '#2E271D'
            : row.isTransfer
              ? '#2F6FA8'
              : (row.categoryColor ?? '#6B5B4A'),
        }}>
        <Icon
          name={row.isAdjustment ? 'refresh' : row.isTransfer ? 'transfer' : (row.categoryIcon ?? 'dots')}
          size={17}
          color="#FFFFFF"
        />
      </View>

      <View className="flex-1">
        <Text className="text-base text-ink" numberOfLines={1}>
          {title}
        </Text>
        <Text className="text-xs text-muted" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>

      <Text className={`text-base font-semibold ${tone}`}>{amount}</Text>
    </Pressable>
  );
}
