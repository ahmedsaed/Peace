import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import type { AccountPosition } from '@/db/repo/carry';
import { isLiability, owedDisplay } from '@/lib/liability';
import { currentPeriod, formatPeriod, type Period } from '@/lib/period';
import { useMoney, type Money } from '@/state/money';

/**
 * The arithmetic behind the third cell of the summary trio.
 *
 * That cell is one number standing in for the whole ledger, and until now
 * nothing on any screen said where it came from — you were asked to trust a
 * figure whose only explanation was a ten-pixel label. This is that
 * explanation, and it is a sheet rather than a screen because it is something
 * you read and dismiss, not somewhere you go.
 *
 * TWO BREAKDOWNS, NOT ONE LIST. The obvious version puts brought-forward and
 * the account balances in a single column and adds them up — and that column is
 * wrong, because the accounts ALREADY contain everything brought forward. The
 * figure would come out at roughly double itself under a heading claiming to
 * explain it. They are two different questions with the same answer:
 *
 *   - WHERE IT IS — one row per account, summing to the figure. This is the
 *     Accounts screen's view, at the end of the month being looked at.
 *   - HOW IT GOT HERE — what you started the month with and what the month did,
 *     also summing to the figure. This is the Records screen's view.
 *
 * Each is shown with its own total, so the two visibly reconcile rather than
 * being asserted to.
 */
export function PositionSheet({
  visible,
  onClose,
  label,
  period,
  homeCurrency,
  totalMinor,
  accounts,
  /**
   * What was carried into the month, or null when carry-over is off — in which
   * case the figure is the month's own net and nothing was brought into it.
   */
  broughtForwardMinor,
  incomeMinor,
  expenseMinor,
  adjustmentMinor,
  unvaluedCount,
}: {
  visible: boolean;
  onClose: () => void;
  /** "Now" or "Balance" — whichever the cell is currently showing. */
  label: string;
  period: Period;
  homeCurrency: string;
  totalMinor: number;
  accounts: AccountPosition[];
  broughtForwardMinor: number | null;
  incomeMinor: number;
  expenseMinor: number;
  adjustmentMinor: number;
  unvaluedCount: number;
}) {
  const money = useMoney();
  const running = broughtForwardMinor !== null;

  // An archived account that is empty is finished business and only lengthens
  // the list. An ACTIVE one at zero stays: "Cash — E£0.00" is an answer, and a
  // list whose rows appear and disappear with the data is one you cannot scan.
  const rows = accounts.filter(
    (account) => !account.archived || account.amountMinor !== 0 || account.unvaluedCount > 0
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Same as every other sheet here: tap above to dismiss, and no scrim —
          `animationType="slide"` cross-fades nothing, so a dim layer arrives as
          an abrupt slab the instant the sheet starts moving. */}
      <Pressable
        className="flex-1"
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      />

      <View
        className="max-h-[80%] rounded-t-2xl border-t border-line bg-ground pb-6"
        style={{
          elevation: 16,
          shadowColor: '#000',
          shadowOpacity: 0.5,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
        }}
        testID="position-sheet">
        <View className="flex-row items-start justify-between border-b border-line px-5 py-4">
          <View className="flex-1">
            <Text className="mb-1 text-[10px] uppercase tracking-widest text-muted">{label}</Text>
            <Text
              className={`text-2xl font-semibold ${totalMinor < 0 ? 'text-expense' : 'text-income'}`}
              testID="position-total">
              {money(totalMinor, homeCurrency)}
            </Text>
            {/* THE SENTENCE FOLLOWS THE NUMBER. This figure is everything
                recorded up to the end of the month being looked at, which is
                three different things in three different tenses — and "where
                you stood at the end of September" on the second of September
                reads as a forecast of a month that has barely started. */}
            <Text className="mt-1 text-xs text-muted">
              {!running
                ? `Income less expense in ${formatPeriod(period)}`
                : period < currentPeriod()
                  ? `Where you stood at the end of ${formatPeriod(period)}`
                  : period > currentPeriod()
                    ? `Where you would stand by the end of ${formatPeriod(period)}`
                    : 'What you are holding right now'}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={16} testID="position-close">
            <Text className="text-sm text-muted">Close</Text>
          </Pressable>
        </View>

        <ScrollView>
          <Section title={running ? 'Where it is' : 'What moved, by account'}>
            {rows.length === 0 ? (
              <Text className="px-5 py-3 text-sm text-muted">No accounts yet.</Text>
            ) : (
              rows.map((account) => (
                <AccountLine key={account.id} account={account} money={money} home={homeCurrency} />
              ))
            )}
            <Total label={label} minor={totalMinor} money={money} home={homeCurrency} testID="position-accounts-total" />
          </Section>

          <Section title="How it got here">
            {/* Only when carry-over is on. Without it the cell is the month's
                own net, and nothing was brought into it — a "Brought forward
                E£0.00" row would be inventing a component of a sum that has
                none. */}
            {broughtForwardMinor !== null ? (
              <Line
                label="Brought forward"
                hint="Opening balances and every earlier month"
                minor={broughtForwardMinor}
                money={money}
                home={homeCurrency}
                testID="position-carry"
              />
            ) : null}
            <Line
              label="Income"
              minor={incomeMinor}
              tone="text-income"
              money={money}
              home={homeCurrency}
              testID="position-income"
            />
            <Line
              label="Expense"
              minor={expenseMinor}
              tone="text-expense"
              money={money}
              home={homeCurrency}
              testID="position-expense"
            />
            {/* Shown only when there is one. A balance correction is a rare
                thing, and a permanent zero row invites the question of what it
                is on every screen where nobody has ever made one. */}
            {adjustmentMinor !== 0 ? (
              <Line
                label="Corrections"
                hint="Balances you reconciled against the bank"
                minor={adjustmentMinor}
                money={money}
                home={homeCurrency}
                testID="position-adjustment"
              />
            ) : null}
            <Total label={label} minor={totalMinor} money={money} home={homeCurrency} testID="position-ledger-total" />
          </Section>

          {/* The same sentence the records header carries, for the same reason:
              a figure that quietly leaves records out is worse than one that
              says how many. */}
          {unvaluedCount > 0 ? (
            <Text className="px-5 pb-2 pt-4 text-[11px] text-muted" testID="position-unvalued">
              {unvaluedCount === 1 ? '1 record is' : `${unvaluedCount} records are`} left out — no{' '}
              {homeCurrency} value for {unvaluedCount === 1 ? 'it' : 'them'}.
            </Text>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="border-b border-line pb-2">
      <Text className="px-5 pb-1 pt-4 text-[10px] uppercase tracking-widest text-muted">
        {title}
      </Text>
      {children}
    </View>
  );
}

function AccountLine({
  account,
  money,
  home,
}: {
  account: AccountPosition;
  money: Money;
  home: string;
}) {
  // "owed" / "in credit" on a card, so the row says what a negative number
  // means without asking anyone to read a minus sign as debt. The AMOUNT stays
  // signed regardless: this column is being added up in front of the user, and
  // an unsigned magnitude in a sum is arithmetic that does not work.
  const owed = isLiability(account.type) ? owedDisplay(account.amountMinor) : null;

  const hints = [
    owed && owed.label !== 'clear' ? owed.label : null,
    account.archived ? 'archived' : null,
    account.unvaluedCount > 0
      ? `${account.unvaluedCount} not counted — held in ${account.currency.toUpperCase()}`
      : null,
  ].filter(Boolean);

  return (
    <View
      className="flex-row items-center gap-3 px-5 py-2.5"
      testID={`position-account-${account.id}`}>
      <View
        className="h-8 w-8 items-center justify-center rounded-full"
        style={{ backgroundColor: account.color ?? '#6B5B4A' }}>
        <Icon name={account.icon ?? 'dots'} size={15} color="#FFFFFF" />
      </View>

      <View className="flex-1">
        <Text className="text-sm text-ink" numberOfLines={1}>
          {account.name}
        </Text>
        {hints.length > 0 ? (
          <Text className="text-[11px] text-muted" numberOfLines={1}>
            {hints.join(' · ')}
          </Text>
        ) : null}
      </View>

      <Text
        className={`text-sm tabular-nums ${account.amountMinor < 0 ? 'text-expense' : 'text-ink'}`}>
        {money(account.amountMinor, home)}
      </Text>
    </View>
  );
}

function Line({
  label,
  hint,
  minor,
  tone = 'text-ink',
  money,
  home,
  testID,
}: {
  label: string;
  hint?: string;
  minor: number;
  tone?: string;
  money: Money;
  home: string;
  testID: string;
}) {
  return (
    <View className="flex-row items-center gap-3 px-5 py-2.5">
      <View className="flex-1">
        <Text className="text-sm text-ink">{label}</Text>
        {hint ? <Text className="text-[11px] text-muted">{hint}</Text> : null}
      </View>
      <Text className={`text-sm tabular-nums ${tone}`} testID={testID}>
        {money(minor, home)}
      </Text>
    </View>
  );
}

/**
 * The figure again, under the rows that make it.
 *
 * Repeated at the foot of BOTH sections on purpose. Two lists of numbers each
 * arriving at the same total is the whole claim this sheet is making, and
 * printing it once at the top asks the reader to hold it in their head while
 * they add.
 */
function Total({
  label,
  minor,
  money,
  home,
  testID,
}: {
  label: string;
  minor: number;
  money: Money;
  home: string;
  testID: string;
}) {
  return (
    <View className="mx-5 mt-1 flex-row items-center gap-3 border-t border-line pt-2.5">
      <Text className="flex-1 text-sm font-semibold text-ink">{label}</Text>
      <Text
        className={`text-sm font-semibold tabular-nums ${minor < 0 ? 'text-expense' : 'text-income'}`}
        testID={testID}>
        {money(minor, home)}
      </Text>
    </View>
  );
}
