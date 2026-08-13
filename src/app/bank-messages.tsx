/**
 * Bank messages waiting on a decision.
 *
 * A SCREEN OF ITS OWN, unlike recurring proposals, and the difference is the
 * message. A due row needs no explanation — the rule says what it is — but a
 * bank alert has to show its own words, because the whole question the user is
 * answering is "did the model read this right". Squeezing the raw SMS into the
 * records list would either truncate the one thing worth reading or push the
 * ledger off the screen.
 *
 * NOTHING HERE WRITES TO THE LEDGER. Tapping a message opens the ordinary record
 * screen with the fields filled in; saving is what creates the record, and the
 * message is marked only after that write succeeds.
 */

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { EmptyState, StackHeader } from '@/components/screen';
import palette from '@/constants/palette';
import { db } from '@/db/client';
import { dismissCapture, reviewableCaptures } from '@/db/repo/bank-captures';
import type { BankCapture } from '@/db/schema';
import { formatMinor } from '@/lib/money';
import { useSetting } from '@/state/settings';

export default function BankMessagesScreen() {
  const router = useRouter();
  const homeCurrency = useSetting('homeCurrency');
  const [rows, setRows] = useState<BankCapture[]>([]);

  const refresh = useCallback(() => setRows(reviewableCaptures(db)), []);
  // On focus, not on mount: returning from the record screen must drop the
  // message that was just saved.
  useFocusEffect(refresh);

  return (
    <View className="flex-1 bg-ground" testID="bank-messages-screen">
      <StackHeader title="Bank messages" />

      {rows.length === 0 ? (
        <EmptyState
          icon="records"
          title="Nothing waiting"
          hint="Messages from the senders you named appear here once they arrive, ready to check and save."
        />
      ) : (
        <ScrollView contentContainerClassName="px-4 pb-10 pt-2">
          {rows.map((row) => (
            <MessageCard
              key={row.id}
              capture={row}
              homeCurrency={homeCurrency}
              onOpen={() =>
                router.push({ pathname: '/record', params: { fromCapture: row.id } })
              }
              onDismiss={() => {
                dismissCapture(db, row.id);
                refresh();
              }}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function MessageCard({
  capture,
  homeCurrency,
  onOpen,
  onDismiss,
}: {
  capture: BankCapture;
  homeCurrency: string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const unreadable = capture.status === 'unreadable';
  /**
   * The amount is shown in the currency the MESSAGE named, not the home one.
   *
   * A bank writes what it charged. Converting it here would need today's rate
   * for a transaction that already happened, and would print a number the user
   * cannot find on their statement.
   */
  const currency = capture.currency ?? homeCurrency;
  const amount =
    capture.amountMinor === null ? null : formatMinor(capture.amountMinor, currency);

  return (
    <View className="mb-3 rounded-xl bg-surface p-4" testID={`bank-message-${capture.id}`}>
      <View className="mb-2 flex-row items-baseline justify-between gap-3">
        <Text className="flex-1 text-sm font-semibold text-ink" numberOfLines={1}>
          {capture.sender}
        </Text>
        {amount ? (
          <Text
            className={`text-base font-semibold ${
              capture.direction === 'in' ? 'text-income' : 'text-expense'
            }`}>
            {capture.direction === 'in' ? '+' : '−'}
            {amount}
          </Text>
        ) : null}
      </View>

      {/* THE MESSAGE'S OWN WORDS. This is what the user is checking the reading
          against, so it is never truncated to one line. */}
      <Text className="mb-3 text-xs leading-5 text-muted">{capture.body}</Text>

      {unreadable ? (
        <View className="mb-3 flex-row items-start gap-2 rounded-lg bg-raised p-2.5">
          <Icon name="info" size={14} color={palette.muted} />
          <Text className="flex-1 text-xs leading-4 text-muted" testID="bank-message-error">
            {capture.error ?? 'This one could not be read. You can still enter it by hand.'}
          </Text>
        </View>
      ) : capture.merchant ? (
        <Text className="mb-3 text-sm text-ink">{capture.merchant}</Text>
      ) : null}

      <View className="flex-row gap-2">
        <Pressable
          onPress={onOpen}
          testID={`bank-open-${capture.id}`}
          accessibilityRole="button"
          className="flex-1 items-center rounded-lg bg-accent py-2.5 active:opacity-80">
          <Text className="text-sm font-semibold text-accent-ink">
            {unreadable ? 'Enter by hand' : 'Check and save'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onDismiss}
          testID={`bank-dismiss-${capture.id}`}
          accessibilityRole="button"
          className="items-center rounded-lg border border-line px-4 py-2.5 active:opacity-70">
          <Text className="text-sm text-muted">Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}
