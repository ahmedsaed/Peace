import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import type { AccountPosition } from '@/db/repo/carry';
import { isLiability, owedDisplay } from '@/lib/liability';
import { currentPeriod, formatPeriod, shortMonth, type Period } from '@/lib/period';
import { useMoney, type Money } from '@/state/money';

/**
 * The arithmetic behind the third cell of the summary trio.
 *
 * That cell is one number standing in for the whole ledger, and nothing on any
 * screen said where it came from — you were asked to trust a figure whose only
 * explanation was a ten-pixel label. This is that explanation, and it is a
 * sheet rather than a screen because it is something you read and dismiss, not
 * somewhere you go.
 *
 * A TABLE, NOT TWO LISTS. The question is not "where is my money" — the
 * Accounts screen answers that — and it is not "what did this month do" either,
 * which is the two cells to the left. It is BOTH AT ONCE: is this figure high
 * because the month went well, or because an account has been sitting on money
 * since March? So each account is split across time, and the table reconciles
 * along both edges — every column sums to a figure the app already shows
 * elsewhere, and every row sums to that account's balance.
 *
 * The obvious alternative, a single column adding brought-forward to the
 * account balances, is simply wrong: the accounts ALREADY contain everything
 * brought forward, so the total comes out at roughly double itself under a
 * heading claiming to explain it.
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
   * case the cell is the month's own net, the table collapses to its middle
   * column, and there is nothing to carry.
   */
  broughtForwardMinor,
  incomeMinor,
  expenseMinor,
  adjustmentMinor,
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
}) {
  const money = useMoney();
  const running = broughtForwardMinor !== null;
  const month = shortMonth(period);

  // An archived account that is empty is finished business and only lengthens
  // the table. An ACTIVE one at zero stays: "Cash — E£0.00" is an answer, and a
  // list whose rows appear and disappear with the data is one you cannot scan.
  const rows = accounts.filter(
    (account) =>
      !account.archived ||
      account.amountMinor !== 0 ||
      account.unvaluedBefore + account.unvaluedMonth > 0
  );

  // The count the records header prints, arrived at the same way — the header
  // adds the carry scan's and the month's, and so does this. Two numbers for
  // one problem is how a user learns to trust neither.
  const unvaluedCount = rows.reduce(
    (total, account) =>
      total + account.unvaluedMonth + (running ? account.unvaluedBefore : 0),
    0
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
        className="max-h-[85%] rounded-t-2xl border-t border-line bg-ground pb-6"
        style={{
          elevation: 16,
          shadowColor: '#000',
          shadowOpacity: 0.5,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
        }}
        testID="position-sheet">
        <View className="flex-row items-start justify-between border-b border-line px-4 py-4">
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
          {/* THE COLUMN HEADINGS ARE THE EXPLANATION. Without them the middle
              column is just a second set of amounts, and the whole point is
              that one of them is history and the other is this month. */}
          {running ? (
            <View className="flex-row items-end gap-2 px-4 pb-1 pt-4">
              {/* "Account", not a sentence. The label column is what is left
                  after three fixed money columns, and "Where it is" wrapped
                  onto two lines there and dragged the headings out of line with
                  the figures under them. */}
              <Text className="flex-1 text-[10px] uppercase tracking-widest text-muted">
                Account
              </Text>
              <Text className="w-[26%] text-right text-[10px] uppercase tracking-widest text-muted">
                Before
              </Text>
              <Text className="w-[26%] text-right text-[10px] uppercase tracking-widest text-muted">
                {month}
              </Text>
              <Text className="w-[26%] text-right text-[10px] uppercase tracking-widest text-muted">
                {label}
              </Text>
            </View>
          ) : (
            <View className="flex-row items-end gap-2 px-4 pb-1 pt-4">
              <Text className="flex-1 text-[10px] uppercase tracking-widest text-muted">
                Account
              </Text>
              <Text className="w-[34%] text-right text-[10px] uppercase tracking-widest text-muted">
                {month}
              </Text>
            </View>
          )}

          {rows.length === 0 ? (
            <Text className="px-4 py-3 text-sm text-muted">No accounts yet.</Text>
          ) : (
            rows.map((account) => (
              <AccountLine
                key={account.id}
                account={account}
                running={running}
                money={money}
                home={homeCurrency}
              />
            ))
          )}

          {/* The column totals, which are the SAME three numbers the sheet
              would otherwise list separately: brought forward, the month's net,
              and the position. Printed here they are the foot of the table
              rather than a second opinion about it. */}
          <View className="mx-4 mt-1 flex-row items-center gap-2 border-t border-line pt-2.5">
            <Text className="flex-1 text-sm font-semibold text-ink">{label}</Text>
            {running ? (
              <>
                <Figure
                  minor={broughtForwardMinor}
                  width="w-[26%]"
                  bold
                  money={money}
                  home={homeCurrency}
                  testID="position-carry"
                />
                <Figure
                  minor={totalMinor - broughtForwardMinor}
                  width="w-[26%]"
                  bold
                  money={money}
                  home={homeCurrency}
                  testID="position-month"
                />
                <Figure
                  minor={totalMinor}
                  width="w-[26%]"
                  bold
                  tone={totalMinor < 0 ? 'text-expense' : 'text-income'}
                  money={money}
                  home={homeCurrency}
                  testID="position-accounts-total"
                />
              </>
            ) : (
              <Figure
                minor={totalMinor}
                width="w-[34%]"
                bold
                tone={totalMinor < 0 ? 'text-expense' : 'text-income'}
                money={money}
                home={homeCurrency}
                testID="position-accounts-total"
              />
            )}
          </View>

          {/* What the MONTH column is made of. The table says how much of the
              figure this month is responsible for; this says what it did. */}
          <View className="mt-4 border-t border-line pt-1">
            <Text className="px-4 pb-1 pt-3 text-[10px] uppercase tracking-widest text-muted">
              What {formatPeriod(period)} did
            </Text>
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
                is on every ledger where nobody has ever made one. */}
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
            <View className="mx-4 mt-1 flex-row items-center gap-3 border-t border-line pt-2.5">
              <Text className="flex-1 text-sm font-semibold text-ink">
                {formatPeriod(period)}
              </Text>
              <Figure
                minor={incomeMinor + expenseMinor + adjustmentMinor}
                bold
                tone={
                  incomeMinor + expenseMinor + adjustmentMinor < 0
                    ? 'text-expense'
                    : 'text-income'
                }
                money={money}
                home={homeCurrency}
                testID="position-month-total"
              />
            </View>
          </View>

          {/* The same sentence the records header carries, for the same reason:
              a figure that quietly leaves records out is worse than one that
              says how many. */}
          {unvaluedCount > 0 ? (
            <Text className="px-4 pb-2 pt-4 text-[11px] text-muted" testID="position-unvalued">
              {unvaluedCount === 1 ? '1 record is' : `${unvaluedCount} records are`} left out — no{' '}
              {homeCurrency} value for {unvaluedCount === 1 ? 'it' : 'them'}.
            </Text>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function AccountLine({
  account,
  running,
  money,
  home,
}: {
  account: AccountPosition;
  running: boolean;
  money: Money;
  home: string;
}) {
  // "owed" / "in credit" on a card or a loan, so the row says what a negative
  // number means without asking anyone to read a minus sign as debt. The
  // AMOUNTS stay signed regardless: these columns are being added up in front
  // of the user, and arithmetic with unsigned magnitudes in it does not work.
  const owed = isLiability(account.type) ? owedDisplay(account.amountMinor) : null;
  const unvalued = account.unvaluedMonth + (running ? account.unvaluedBefore : 0);

  const hints = [
    owed && owed.label !== 'clear' ? owed.label : null,
    account.archived ? 'archived' : null,
    unvalued > 0 ? `${unvalued} not counted — held in ${account.currency.toUpperCase()}` : null,
  ].filter(Boolean);

  return (
    <View
      className="flex-row items-center gap-2 px-4 py-2.5"
      testID={`position-account-${account.id}`}>
      <View className="flex-1 flex-row items-center gap-2">
        <View
          className="h-6 w-6 items-center justify-center rounded-full"
          style={{ backgroundColor: account.color ?? '#6B5B4A' }}>
          <Icon name={account.icon ?? 'dots'} size={12} color="#FFFFFF" />
        </View>
        <View className="flex-1">
          <Text className="text-xs text-ink" numberOfLines={1}>
            {account.name}
          </Text>
          {hints.length > 0 ? (
            <Text className="text-[10px] text-muted" numberOfLines={1}>
              {hints.join(' · ')}
            </Text>
          ) : null}
        </View>
      </View>

      {running ? (
        <>
          {/* Muted, both of them: the two history columns are working, and the
              position is the answer. Colouring all three the same makes the row
              a wall of numbers with nothing to land on. */}
          <Figure minor={account.beforeMinor} width="w-[26%]" tone="text-muted" money={money} home={home} />
          <Figure minor={account.monthMinor} width="w-[26%]" tone="text-muted" money={money} home={home} />
          <Figure
            minor={account.amountMinor}
            width="w-[26%]"
            tone={account.amountMinor < 0 ? 'text-expense' : 'text-ink'}
            money={money}
            home={home}
          />
        </>
      ) : (
        <Figure
          minor={account.monthMinor}
          width="w-[34%]"
          tone={account.monthMinor < 0 ? 'text-expense' : 'text-ink'}
          money={money}
          home={home}
        />
      )}
    </View>
  );
}

/**
 * One cell of the table.
 *
 * `numberOfLines={1}` with `adjustsFontSizeToFit` because a column has a fixed
 * share of a phone's width and a ledger does not have a fixed number of digits:
 * three columns of "E£1,234,567.00" is more than fits, and a wrapped amount
 * breaks the row alignment that makes a table readable at all.
 */
function Figure({
  minor,
  width = 'w-[34%]',
  tone = 'text-ink',
  bold = false,
  money,
  home,
  testID,
}: {
  minor: number;
  width?: string;
  tone?: string;
  bold?: boolean;
  money: Money;
  home: string;
  testID?: string;
}) {
  return (
    <Text
      className={`${width} text-right text-[11px] tabular-nums ${bold ? 'font-semibold' : ''} ${tone}`}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.7}
      testID={testID}>
      {money(minor, home)}
    </Text>
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
    <View className="flex-row items-center gap-3 px-4 py-2.5">
      <View className="flex-1">
        <Text className="text-sm text-ink">{label}</Text>
        {hint ? <Text className="text-[11px] text-muted">{hint}</Text> : null}
      </View>
      <Figure minor={minor} tone={tone} money={money} home={home} testID={testID} />
    </View>
  );
}
