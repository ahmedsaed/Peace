import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import type { RecordRow as Row } from '@/db/repo/records';
import { useMoney } from '@/state/money';

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
  const money = useMoney();
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
      ? money(Math.abs(row.amountMinor), row.currency)
      : money(row.amountMinor, row.currency, { showSign: true });

  const title = row.isAdjustment
    ? 'Balance correction'
    : row.isTransfer
      ? 'Transfer'
      : (row.categoryName ?? 'Uncategorised');

  /**
   * What was HANDED OVER, when it differs from what moved the account.
   *
   * A purchase abroad settles in the card's currency, so the figure on the
   * right is pounds and this is the euros actually paid — the number on the
   * receipt, and the only one the user recognises. It was stored from the
   * start and displayed nowhere.
   */
  const paid =
    row.originalAmountMinor != null && row.originalCurrency
      ? money(row.originalAmountMinor, row.originalCurrency)
      : null;

  /**
   * A transfer that exists to undo another one.
   *
   * Said TWICE, in the badge and in the subtitle, for the reason the transfer
   * arrow is: a 10px mark is a signal nobody can rely on reading, and this one
   * distinguishes a row from an ordinary transfer between the same two accounts
   * going the same way — which is exactly what it looks like otherwise.
   */
  const isReversal = row.isTransfer && row.reversesId !== null;

  const subtitle = row.isTransfer
    ? `${row.accountName} → ${row.counterAccountName ?? '—'}${isReversal ? ' · reversal' : ''}`
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
        {/**
         * A REFUND, marked on the tile rather than only in words.
         *
         * The tint already says "not income" and the subtitle says "refunded",
         * but both need reading — and the one thing a positive number in an
         * expense list has to answer at a glance is "why is this not red". The
         * badge sits on the category icon because that is what a refund is: the
         * same category, coming back.
         *
         * Inside the tile, not overhanging it. A badge hung off the corner is
         * sliced by the list's own bounds, and this row has no padding to spare.
         */}
        {row.isRefund || isReversal ? (
          <View
            testID={isReversal ? 'reversal-badge' : 'refund-badge'}
            accessibilityLabel={isReversal ? 'Reversal' : 'Refund'}
            className="absolute -bottom-0.5 -right-0.5 h-[15px] w-[15px] items-center justify-center rounded-full border border-ground bg-raised">
            {/* An ARROW, not the circular-arrow glyph the correction rows use.
                Rasterised at this size, `refresh` closes into a blob — a ring
                needs ~14px and this has 10. A solid arrow survives it, and
                "came back" is the more direct reading anyway.

                The SAME mark for a refund and a reversal, deliberately: they
                are one idea — this row undoes that one — and the two can never
                appear on the same row, so a second glyph would be a second
                thing to rasterise and learn for no distinction gained. */}
            <Icon name="back" size={10} color={palette.ink} />
          </View>
        ) : null}
      </View>

      <View className="flex-1">
        <Text className="text-base text-ink" numberOfLines={1}>
          {title}
        </Text>
        {/* The clip sits BESIDE the subtitle rather than inside it, so a long
            note truncates and the indicator does not truncate with it — the
            whole job of this mark is to be visible without reading the row.

            The count only appears past one. "1" next to a single clip is the
            icon repeating itself, and a column of 1s is noise in a list whose
            other numbers are money. */}
        <View className="flex-row items-center gap-1">
          {row.attachmentCount > 0 ? (
            <View
              testID="attachment-indicator"
              accessibilityLabel={`${row.attachmentCount} receipt${row.attachmentCount === 1 ? '' : 's'}`}>
              {/* 14, not 12 to match the text beside it: a paperclip is carried
                  by its hole, and the hole closes below ~13px. See icon.tsx. */}
              <Icon name="paperclip" size={14} color={palette.muted} />
            </View>
          ) : null}
          {row.attachmentCount > 1 ? (
            <Text className="text-[10px] text-muted">{row.attachmentCount}</Text>
          ) : null}
          <Text className="flex-1 text-xs text-muted" numberOfLines={1}>
            {paid ? `${paid} · ${subtitle}` : subtitle}
          </Text>
        </View>
      </View>

      <Text className={`text-base font-semibold ${tone}`}>{amount}</Text>
    </Pressable>
  );
}
