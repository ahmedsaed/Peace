import { Modal, Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import type { RecordRow } from '@/db/repo/records';
import { formatMinor } from '@/lib/money';

/**
 * What a long press on a record offers.
 *
 * Delete used to live at the bottom of the edit form, which meant opening a
 * record to change it in order to remove it — and put a destructive action in
 * the same place as the save button.
 *
 * Refund starts from the record it reverses, which is the whole reason it is
 * here rather than a fourth type on the record screen: the refund inherits the
 * account and the category of the purchase, so it CANNOT be filed against the
 * wrong one. Picking a category by hand is exactly how a return ends up
 * reducing Groceries because that is what was on screen.
 */
export function RecordActions({
  row,
  onClose,
  onRefund,
  onDuplicate,
  onDelete,
}: {
  row: RecordRow | null;
  onClose: () => void;
  onRefund: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const ordinary = !!row && !row.isTransfer && !row.isAdjustment;

  /**
   * Only spending can be refunded.
   *
   * A transfer has no category to net against, a correction is not a purchase,
   * income coming back is simply an expense, and a refund of a refund is not a
   * thing. Each of those would be a menu item that does nothing sensible.
   */
  const refundable = ordinary && !row.isRefund && row.amountMinor < 0;

  /**
   * Duplicate is for ordinary records only.
   *
   * NOT a refund: the case it appears to serve — three people settling a shared
   * dinner separately — is served better by refunding the ORIGINAL purchase
   * three times, so each refund derives from the thing it reverses. Copying a
   * refund detaches it from that for no gain and makes double-refunding a
   * one-tap mistake.
   *
   * NOT a correction: reconciling twice by the same amount is not a thing you
   * ever want; you reconcile again against the real balance instead.
   */
  const duplicable = ordinary && !row.isRefund;

  return (
    <Modal visible={row !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Dismiss" />

      <View
        className="rounded-t-2xl border-t border-line bg-ground pb-8"
        style={{ elevation: 16 }}
        testID="record-actions">
        {row ? (
          <>
            <View className="border-b border-line px-5 py-4">
              <Text className="text-base font-semibold text-ink" numberOfLines={1}>
                {row.isTransfer
                  ? 'Transfer'
                  : row.isAdjustment
                    ? 'Balance correction'
                    : (row.categoryName ?? 'Uncategorised')}
              </Text>
              <Text className="text-xs text-muted" numberOfLines={1}>
                {row.accountName} · {formatMinor(Math.abs(row.amountMinor), row.currency)}
              </Text>
            </View>

            {refundable ? (
              <Action
                icon="refresh"
                label="Refund"
                hint="Money coming back — nets against this category"
                onPress={onRefund}
                testID="action-refund"
              />
            ) : null}

            {duplicable ? (
              <Action
                icon="records"
                label="Duplicate"
                hint="Same again, dated today"
                onPress={onDuplicate}
                testID="action-duplicate"
              />
            ) : null}

            <Action
              icon="dots"
              label="Delete"
              hint="Undo is offered straight after"
              onPress={onDelete}
              testID="action-delete"
              danger
            />
          </>
        ) : null}
      </View>
    </Modal>
  );
}

function Action({
  icon,
  label,
  hint,
  onPress,
  testID,
  danger = false,
}: {
  icon: string;
  label: string;
  hint: string;
  onPress: () => void;
  testID: string;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-row items-center gap-4 px-5 py-3.5 active:bg-surface">
      <Icon name={icon} size={18} color={danger ? palette.expense : palette.ink} />
      <View className="flex-1">
        <Text className={`text-[15px] ${danger ? 'text-expense' : 'text-ink'}`}>{label}</Text>
        <Text className="text-xs text-muted">{hint}</Text>
      </View>
    </Pressable>
  );
}
