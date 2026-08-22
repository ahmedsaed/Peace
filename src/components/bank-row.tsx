import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import type { BankCapture } from '@/db/schema';
import { formatMinor } from '@/lib/money';

/**
 * A bank message, shown in the records list before it is a record.
 *
 * THE SAME TREATMENT AS A DUE ROW, deliberately. Grey, in no total, and merged
 * in at render time — a captured message is exactly the same kind of thing as a
 * recurring occurrence: something the app believes happened, waiting for a
 * person to agree. Giving it a screen of its own made it a second inbox to
 * remember to visit.
 *
 * DATED BY THE NOTIFICATION, never by the model. Android stamps the moment the
 * message arrived, to the second, and a bank alert arrives when the money moves.
 * Asking a model to read "13/08/2026" instead invites the one mistake nobody can
 * spot afterwards, because that string is a valid date under two conventions and
 * both look right.
 */
export function BankRow({
  capture,
  currency,
  onPress,
  onLongPress,
}: {
  capture: BankCapture;
  currency: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const reading = capture.status === 'pending';
  const sign = capture.direction === 'in' ? '' : '-';

  /**
   * THE MESSAGE'S OWN WORDS, unless there is something better to show.
   *
   * Once a reading has succeeded the merchant is the useful line and the raw SMS
   * is noise. Before that — still reading, or could not be read — the text IS
   * the information: it is what tells the user which purchase this is, and
   * without it the row is an anonymous grey bar they have to open to identify.
   */
  const subtitle = capture.status === 'parsed' ? `from ${capture.sender}` : capture.body;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      testID={`bank-${capture.id}`}
      accessibilityRole="button"
      className="flex-row items-center gap-3 px-4 py-3 active:bg-surface">
      {/* Dashed, like a due row: the outline says "not yet real" before any
          colour or wording does. */}
      <View className="h-7 w-7 items-center justify-center rounded-full border border-dashed border-line">
        <Icon name="bank" size={14} color={palette.muted} />
      </View>

      <View className="flex-1">
        <Text className="text-[15px] text-muted" numberOfLines={1}>
          {capture.merchant ?? capture.sender}
        </Text>
        {/* Two lines for the raw message: one truncates a bank's wording right
            where the amount usually is. */}
        <Text
          className="text-xs text-muted opacity-70"
          numberOfLines={capture.status === 'parsed' ? 1 : 2}>
          {subtitle}
        </Text>
      </View>

      {reading ? (
        /* Being read right now. A spinner rather than a dash, because the row
           appears the instant the message lands and the reading takes a network
           round trip — without this it looks like a message with no amount. */
        <ActivityIndicator size="small" color={palette.accent} testID="bank-reading" />
      ) : capture.amountMinor === null ? (
        // No amount means the model found nothing usable. A dash rather than a
        // zero: zero is a number, and this is the absence of one.
        <Text className="text-[15px] text-muted opacity-70">—</Text>
      ) : (
        <Text className="text-[15px] text-muted">
          {sign}
          {formatMinor(capture.amountMinor, capture.currency || currency)}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * What a long press offers.
 *
 * THE MESSAGE'S OWN WORDS ARE HERE, and this is the only place they appear.
 * The question being answered is "did it read this right", which cannot be
 * answered from a summary — but it does not need a page either, because a sheet
 * has room for a few lines of text and appears exactly when the question is
 * being asked.
 *
 * Add and Dismiss, and nothing else. Editing is a TAP, which opens the ordinary
 * record screen with the fields filled in.
 */
export function BankActions({
  capture,
  currency,
  onClose,
  onAdd,
  onDismiss,
}: {
  capture: BankCapture | null;
  currency: string;
  onClose: () => void;
  onAdd: (capture: BankCapture) => void;
  onDismiss: (capture: BankCapture) => void;
}) {
  const usable = capture !== null && capture.amountMinor !== null && capture.direction !== null;

  return (
    <Modal visible={capture !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Dismiss" />

      <View
        className="rounded-t-2xl border-t border-line bg-ground pb-8"
        style={{ elevation: 16 }}
        testID="bank-actions">
        {capture ? (
          <>
            <View className="border-b border-line px-5 py-4">
              <Text className="text-base font-semibold text-ink" numberOfLines={1}>
                {capture.merchant ?? capture.sender}
              </Text>
              <Text className="mb-2 text-xs text-muted">
                {capture.sender} ·{' '}
                {capture.status === 'pending'
                  ? 'still being read…'
                  : capture.amountMinor === null
                    ? 'no amount found'
                    : formatMinor(capture.amountMinor, capture.currency || currency)}
              </Text>

              {/* Scrolls rather than truncates. A bank message runs to three or
                  four lines and the amount is as often at the end as the start. */}
              <ScrollView className="max-h-32" testID="bank-actions-body">
                <Text className="text-xs leading-5 text-muted">{capture.body}</Text>
              </ScrollView>

              {capture.status === 'unreadable' && capture.error ? (
                <Text className="mt-2 text-xs leading-4 text-expense" testID="bank-actions-error">
                  {capture.error}
                </Text>
              ) : null}
            </View>

            {/* Only offered when there is something to write. "Add it" on a
                message with no amount would create a zero record, which is
                worse than making the user open it and type. */}
            {usable ? (
              <Action
                icon="records"
                label="Add it"
                hint="Writes the record, dated when the message arrived"
                onPress={() => onAdd(capture)}
                testID="bank-add"
              />
            ) : (
              <Action
                icon="records"
                label="Enter it by hand"
                hint="Opens a record with whatever could be read"
                onPress={() => onAdd(capture)}
                testID="bank-add"
              />
            )}
            <Action
              icon="dots"
              label="Not this one"
              hint="Dismisses the message. Nothing is written."
              onPress={() => onDismiss(capture)}
              testID="bank-dismiss"
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
  icon: 'records' | 'dots';
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
      className="flex-row items-center gap-3 px-5 py-4 active:bg-surface">
      <Icon name={icon} size={18} color={danger ? palette.expense : palette.ink} />
      <View className="flex-1">
        <Text className={`text-[15px] ${danger ? 'text-expense' : 'text-ink'}`}>{label}</Text>
        <Text className="text-xs text-muted">{hint}</Text>
      </View>
    </Pressable>
  );
}
