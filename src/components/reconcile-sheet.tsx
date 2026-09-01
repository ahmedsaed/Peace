import { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';

import palette from '@/constants/palette';
import { useKeyboardHeight } from '@/lib/layout';
import {
  isLiability,
  targetBalanceFromAvailable,
  targetBalanceFromOwed,
  type AccountKind,
} from '@/lib/liability';
import { parseAmountToMinor } from '@/lib/money';
import { useMoney } from '@/state/money';

type Mode = 'owed' | 'available';

/**
 * "What does your bank show?"
 *
 * A derived balance cannot be edited, so drift is corrected by stating the
 * truth and letting Peace work out the difference. The difference is shown
 * BEFORE anything is written: a correction you cannot check first is one you
 * cannot refuse, and this writes a permanent row into the ledger.
 *
 * Both numbers are accepted because banking apps disagree about which one they
 * put in front of you. Making someone do the subtraction at the exact moment
 * they are trying to fix an error is how a correction becomes a second error.
 */
export function ReconcileSheet({
  visible,
  accountName,
  accountType,
  currency,
  currentMinor,
  creditLimitMinor,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  accountName: string;
  accountType: AccountKind;
  currency: string;
  /** Signed, as stored. */
  currentMinor: number;
  creditLimitMinor: number | null;
  onClose: () => void;
  onConfirm: (targetMinor: number) => void;
}) {
  const money = useMoney();
  const keyboardHeight = useKeyboardHeight();
  const liability = isLiability(accountType);
  const [mode, setMode] = useState<Mode>('owed');
  const [draft, setDraft] = useState('');

  const typedMinor = parseAmountToMinor(draft, currency);
  const target =
    typedMinor === null
      ? null
      : !liability
        ? typedMinor
        : mode === 'available' && creditLimitMinor
          ? targetBalanceFromAvailable(typedMinor, creditLimitMinor)
          : targetBalanceFromOwed(typedMinor);

  const difference = target === null ? null : target - currentMinor;

  // "Available" only means anything against a limit. Offering it without one
  // would be a control that silently does nothing.
  const canChooseMode = liability && !!creditLimitMinor;

  function close() {
    setDraft('');
    setMode('owed');
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable className="flex-1" onPress={close} accessibilityLabel="Dismiss" />

      {/* LIFTED ABOVE THE KEYBOARD BY HAND. A Modal is its own window and does
          not resize with the keyboard the way the app's window does, so the
          difference line and the save button below the input sit underneath it.
          The input `autoFocus`es, so the keyboard is up before the sheet has
          been looked at — the number you are being asked to check, and the
          button that commits it, were both hidden the whole time. */}
      <View
        className="rounded-t-2xl border-t border-line bg-ground px-5 pb-8 pt-5"
        style={{ elevation: 16, marginBottom: keyboardHeight }}
        testID="reconcile-sheet">
        <Text className="text-base font-semibold text-ink">Update balance</Text>
        <Text className="mt-1 text-xs leading-4 text-muted">
          What does your bank show for {accountName}? Peace records the difference as a correction —
          it never counts as spending.
        </Text>

        {canChooseMode ? (
          <View className="mt-4 flex-row rounded-lg bg-surface p-1">
            {(['owed', 'available'] as const).map((value) => (
              <Pressable
                key={value}
                onPress={() => setMode(value)}
                testID={`reconcile-mode-${value}`}
                accessibilityRole="button"
                accessibilityState={{ selected: mode === value }}
                className={`flex-1 items-center rounded-md py-2 ${
                  mode === value ? 'bg-raised' : ''
                }`}>
                <Text
                  className={`text-sm ${
                    mode === value ? 'font-semibold text-accent' : 'text-muted'
                  }`}>
                  {value === 'owed' ? 'Owed' : 'Available'}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View className="mt-4 flex-row items-center gap-3 rounded-lg bg-raised px-4">
          <Text className="text-sm text-muted">{currency}</Text>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="0"
            placeholderTextColor={palette.muted}
            keyboardType="numeric"
            autoFocus
            testID="reconcile-input"
            className="flex-1 py-3 text-right text-xl text-ink"
          />
        </View>

        {/* Shown before anything is written, and worded as an instruction
            rather than a bare number: "-E£200" tells you nothing about which
            way the correction goes. */}
        <Text className="mt-3 text-center text-xs text-muted" testID="reconcile-difference">
          {difference === null
            ? `Peace currently believes ${money(Math.abs(currentMinor), currency)}${
                liability ? (currentMinor <= 0 ? ' owed' : ' in credit') : ''
              }`
            : difference === 0
              ? 'Already matches — nothing to correct'
              : `Adds a ${money(Math.abs(difference), currency)} correction ${
                  difference < 0 ? 'against' : 'in favour of'
                } this account`}
        </Text>

        <Pressable
          onPress={() => {
            if (target === null) return;
            onConfirm(target);
            setDraft('');
          }}
          disabled={target === null}
          testID="reconcile-save"
          className={`mt-4 items-center rounded-lg py-3 ${
            target === null ? 'bg-surface' : 'bg-accent active:opacity-80'
          }`}>
          <Text
            className={`text-sm font-semibold ${
              target === null ? 'text-line' : 'text-accent-ink'
            }`}>
            Save correction
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}
