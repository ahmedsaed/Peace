import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, SectionList, Text, View } from 'react-native';

import { BankActions, BankRow } from '@/components/bank-row';
import { ProposalActions, ProposalRow } from '@/components/proposal-row';
import {
  catchUp,
  postProposals,
  skipProposals,
  upcomingProposals,
  type Proposal,
} from '@/db/repo/recurring';
import { RecordActions, type ReversalContext } from '@/components/record-actions';
import { RecordRow } from '@/components/record-row';
import { Snackbar } from '@/components/snackbar';
import { EmptyState, Fab, MonthHeader, Screen, SummaryTrio } from '@/components/screen';
import { db } from '@/db/client';
import { listAccountsWithBalance } from '@/db/repo/accounts';
import {
  groupByDay,
  listRecordsForPeriod,
  periodSummary,
  type PeriodSummary,
  type RecordRow as Row,
} from '@/db/repo/records';
import {
  broughtForward,
  movementByAccount,
  positionByAccount,
  type AccountPosition,
  type BroughtForward,
} from '@/db/repo/carry';
import { PositionSheet } from '@/components/position-sheet';
import { recordSections } from '@/lib/record-sections';
import { linkById, reversedBy } from '@/db/repo/reversal';
import { dismissCapture, markSaved } from '@/db/repo/bank-captures';
import type { BankCapture } from '@/db/schema';
import { createRecord, deleteRecord, restoreRecords } from '@/db/repo/transactions';
import { currentPeriod } from '@/lib/period';
import { useSetting } from '@/state/settings';
import { useBankInbox } from '@/state/bank';
import { useUndoStore } from '@/state/undo';
import { useMoney } from '@/state/money';

const EMPTY_SUMMARY: PeriodSummary = {
  expenseMinor: 0,
  incomeMinor: 0,
  adjustmentMinor: 0,
  balanceMinor: 0,
  unvaluedCount: 0,
};

const NO_CARRY: BroughtForward = {
  amountMinor: 0,
  openingMinor: 0,
  ledgerMinor: 0,
  unvaluedCount: 0,
};

/**
 * Records — the default tab, because logging a spend is why the app gets
 * opened.
 */
/** Due rows carry a rule and a date; records carry an id. */
const isProposal = (row: Row | Proposal | BankCapture): row is Proposal =>
  (row as Proposal).ruleId !== undefined;

/** A captured bank message. Only these carry the message body. */
const isCapture = (row: Row | Proposal | BankCapture): row is BankCapture =>
  (row as BankCapture).captureKey !== undefined;

export default function RecordsScreen() {
  const money = useMoney();
  const router = useRouter();
  const [period, setPeriod] = useState(currentPeriod());
  const homeCurrency = useSetting('homeCurrency');
  const carryOver = useSetting('carryOver');
  const showTotal = useSetting('showTotal');
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<PeriodSummary>(EMPTY_SUMMARY);
  const [carried, setCarried] = useState<BroughtForward>(NO_CARRY);
  /**
   * The breakdown behind the third summary cell, or null while it is shut.
   *
   * Read WHEN THE SHEET OPENS rather than on every refresh. It is a scan of
   * every account crossed with every record up to the end of the month, which
   * is the same shape of query as the carry above it — and unlike that one,
   * nothing on the screen behind the sheet needs the answer. Paying for it on
   * every focus, every month change and every save would be paying for a
   * question almost nobody asks.
   */
  const [breakdown, setBreakdown] = useState<AccountPosition[] | null>(null);
  // Long-pressed row, if any. The menu is the only place Delete lives now: at
  // the bottom of the edit form it meant opening a record to change it in order
  // to remove it, with a destructive action next to Save.
  const [acting, setActing] = useState<Row | null>(null);
  /**
   * How the long-pressed row relates to others — what it undoes, and what
   * undoes it.
   *
   * Resolved HERE rather than carried on every row of the list: two indexed
   * lookups on one id, paid once when the sheet opens. Folding them into the
   * list query would pay for them on every row of every month to answer a
   * question almost nobody asks of almost any row.
   */
  const actingLinks: ReversalContext | undefined = useMemo(() => {
    if (!acting) return undefined;
    // `reversesId` is a bare column by design, so it can name a record that has
    // been deleted — and delete is undoable, so this resolves again if the
    // original comes back. Looked up ONCE: the two fields are two readings of
    // the same answer.
    const source = acting.reversesId ? linkById(db, acting.reversesId) : null;
    return {
      reverses: source,
      danglingSource: !!acting.reversesId && !source,
      reversedBy: reversedBy(db, acting.id),
    };
  }, [acting]);
  /**
   * Records that rules say are owed but which do not exist yet.
   *
   * Derived on every refresh, never stored — see `proposal-row.tsx` for why a
   * pending row in `transactions` would be the expensive answer.
   */
  const [due, setDue] = useState<Proposal[]>([]);
  /** Already spoken for, in the month being viewed. Display only. */
  const [upcoming, setUpcoming] = useState<Proposal[]>([]);
  const [actingDue, setActingDue] = useState<Proposal | null>(null);
  /**
   * Bank messages that have been read and not yet acted on.
   *
   * Merged into this list rather than given a screen, because a captured
   * message is the same kind of thing as a due occurrence: something the app
   * believes happened, waiting to be agreed to. A second inbox is a second
   * place to remember to visit.
   */
  const captures = useBankInbox((state) => state.captures);
  const reloadInbox = useBankInbox((state) => state.reload);
  const [actingCapture, setActingCapture] = useState<BankCapture | null>(null);
  const defaultAccountId = useSetting('defaultAccountId');
  const pendingUndo = useUndoStore((state) => state.pending);
  const clearUndo = useUndoStore((state) => state.clear);
  const offerUndo = useUndoStore((state) => state.offer);

  const refresh = useCallback(() => {
    setRows(listRecordsForPeriod(db, period, homeCurrency));
    setSummary(periodSummary(db, period, homeCurrency));
    // Only asked for when it is going to be shown. It is a scan of every record
    // before this month, which is the one query here that grows with the age of
    // the ledger.
    setCarried(carryOver ? broughtForward(db, period, homeCurrency) : NO_CARRY);
    // Everything outstanding, whatever month it fell in. An occurrence missed
    // in August must not hide in a month nobody scrolls back to.
    setDue(catchUp(db).proposals);
    // Belongs to the month being LOOKED AT, unlike the due list, which is
    // everything outstanding whenever it fell.
    setUpcoming(upcomingProposals(db, period));
    // Everything outstanding whatever month it fell in, like the due list — a
    // message from last week must not hide in a month nobody scrolls back to.
    // Into the STORE, not into local state: the catch-up finishes a network
    // round trip after this runs, and only a store can tell the screen so.
    reloadInbox();
    // homeCurrency belongs here: changing it changes what the totals MEAN, and
    // without it the screen would keep showing figures computed against the
    // previous one until something else happened to trigger a refresh.
  }, [period, homeCurrency, carryOver, reloadInbox]);

  // Re-read on focus rather than on mount: returning from the add-record screen
  // has to show the record that was just saved.
  useFocusEffect(refresh);

  function onUndo() {
    if (!pendingUndo) return;
    try {
      restoreRecords(db, pendingUndo.rows);
    } catch {
      // The rows could no longer be insertable — an account deleted in the
      // meantime, say. Nothing to do but drop the offer; the list refresh below
      // shows the true state either way.
    } finally {
      // Whether or not the restore succeeded, the offer is spent — leaving it up
      // would invite a second tap that inserts a duplicate.
      clearUndo();
      refresh();
    }
  }

  // The position at the end of the month being viewed.
  const running = carried.amountMinor + summary.balanceMinor;
  // WHAT THE THIRD CELL IS, in one place. The header and the sheet behind it
  // both need the label and the figure, and two copies of the same ternary is
  // two chances for a sheet to explain a number the cell above it is not
  // showing.
  const headline = carryOver
    ? { label: 'Now', minor: running, testID: 'summary-running' }
    : { label: 'Balance', minor: summary.balanceMinor, testID: 'summary-balance' };
  // One line, not two. The carry scan and the month query can each turn up
  // records they cannot value, and telling the user about them separately would
  // report the same underlying problem twice with two different numbers.
  const unvaluedTotal = summary.unvaluedCount + carried.unvaluedCount;

  const dayGroups = groupByDay(rows).map((group) => ({
    key: group.key,
    title: group.heading,
    // What the day did to your position, shown beside its heading when the
    // setting is on. Computed for every group either way — it is a sum over
    // rows already in memory, and branching on a preference to avoid it would
    // save nothing while giving the two paths room to disagree.
    total: group.totalMinor as number | null,
    unvalued: group.unvaluedCount,
    data: group.rows as (Row | Proposal)[],
  }));

  // Due rows sit at the TOP, above today, because they are the only thing on
  // this screen that is waiting on a decision.
  /**
   * Run a due-row action.
   *
   * There is nothing to refuse any more: every occurrence is independent, so
   * approving September while August is still waiting simply leaves August
   * waiting. The try/catch is for a genuine write failure — a deleted account,
   * say — not for a rule about ordering.
   */
  /**
   * Which account a message goes to.
   *
   * The default if one is set and still exists, otherwise the first — the same
   * fallback the record screen uses, because a deleted default must not leave
   * this unable to write anything.
   */
  function accountFor(): string | null {
    const accounts = listAccountsWithBalance(db);
    return accounts.find((a) => a.id === defaultAccountId)?.id ?? accounts[0]?.id ?? null;
  }

  function handleDue(work: () => void) {
    try {
      work();
    } catch (error) {
      Alert.alert('Could not do that', error instanceof Error ? error.message : 'Something went wrong.');
    }
    setActingDue(null);
    refresh();
  }

  // The ORDER lives in `lib/record-sections.ts`, with a test. It was wrong
  // here precisely because it was the shape of an array literal in the middle
  // of a screen: nothing could contradict it and nothing recorded the decision.
  const sections = recordSections<Row | Proposal | BankCapture>({
    due,
    captures,
    upcoming,
    days: dayGroups,
  });

  return (
    <Screen testID="home-screen">
      <MonthHeader period={period} onChange={setPeriod}>
        {/* The third cell carries EITHER the month's net or the running
            position, never both and never an extra row. "Balance" is
            income minus expense for this month; "Now" is what you are actually
            holding, which is the more useful of the two once there is a
            position to hold — and it is the number the Accounts screen shows,
            so the two agree by construction.

            What is lost is the month's own net, which is no longer printed
            anywhere. It is the difference of the two cells beside it, so both
            operands stay on screen. */}
        <SummaryTrio
          expense={money(summary.expenseMinor, homeCurrency)}
          income={money(summary.incomeMinor, homeCurrency)}
          balance={money(headline.minor, homeCurrency)}
          balanceMinor={headline.minor}
          balanceLabel={headline.label}
          balanceTestID={headline.testID}
          // The one number on this screen whose working is nowhere else on it.
          onBalancePress={() =>
            setBreakdown(
              carryOver
                ? positionByAccount(db, period, homeCurrency)
                : movementByAccount(db, period, homeCurrency)
            )
          }
        />
        {/* Under-reporting in silence is the thing to avoid. This happens when
            the home currency is changed after records exist: their value in the
            new one is unknown, so they are excluded and counted rather than
            summed in as if their numbers meant something they do not. */}
        {unvaluedTotal > 0 ? (
          <Text className="mt-2 text-center text-[11px] text-muted" testID="summary-unvalued">
            {unvaluedTotal === 1 ? '1 record is' : `${unvaluedTotal} records are`} not counted — no{' '}
            {homeCurrency} value
          </Text>
        ) : null}
      </MonthHeader>

      {/* `sections`, not `rows`. A month with no records but something DUE is
          not empty — gating on records alone hid the due rows behind the empty
          state, which is precisely the case the feature exists for: a fresh
          month where the standing orders have not been added yet. */}
      {sections.length === 0 ? (
        <EmptyState
          icon="records"
          title="No records this month"
          hint="Tap + to log your first expense."
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(row) =>
            isProposal(row) ? `due-${row.ruleId}-${row.occurredOn}` : row.id
          }
          renderItem={({ item }) =>
            isCapture(item) ? (
              <BankRow
                capture={item}
                currency={homeCurrency}
                // A tap opens the ordinary record screen with whatever could be
                // read already filled in — the same gesture a due row uses.
                onPress={() =>
                  router.push({ pathname: '/record', params: { fromCapture: item.id } })
                }
                onLongPress={() => setActingCapture(item)}
              />
            ) : isProposal(item) ? (
              <ProposalRow
                proposal={item}
                currency={homeCurrency}
                // A tap edits it: the rent went up, so change the amount and
                // save. The record screen writes it and tells the rule.
                onPress={() =>
                  router.push({
                    pathname: '/record',
                    params: {
                      fromRule: item.ruleId,
                      dueOn: item.occurredOn,
                    },
                  })
                }
                // Every proposed row is actionable, whenever it falls. Paying
                // next month's rent early is a real thing, and occurrences are
                // independent — approving one leaves the others exactly as they
                // were.
                onLongPress={() => setActingDue(item)}
                upcoming={upcoming.includes(item)}
              />
            ) : (
              <RecordRow
                row={item}
                onPress={() => router.push({ pathname: '/record', params: { id: item.id } })}
                onLongPress={() => setActing(item)}
              />
            )
          }
          renderSectionHeader={({ section }) => (
            <View className="flex-row items-baseline justify-between gap-3 bg-ground px-4 pb-1.5 pt-4">
              {/* `flex-1` and one line: without it the heading was shrunk by the
                  total beside it and "Aug 13, Thursday" rendered as "Aug 13,"
                  — clipped mid-string with no ellipsis to say so. */}
              <Text className="flex-1 text-xs font-semibold text-muted" numberOfLines={1}>
                {section.title}
              </Text>
              {/* The due-rows section has no total — it is a list of things that
                  have not happened yet, and giving it one would invite reading
                  it as money already spent. */}
              {showTotal && section.total !== null ? (
                <Text className="shrink-0 text-xs text-muted" testID={`day-total-${section.key}`}>
                  {money(section.total, homeCurrency, { showSign: true })}
                  {section.unvalued ? ' +' : ''}
                </Text>
              ) : null}
            </View>
          )}
          stickySectionHeadersEnabled={false}
          contentContainerClassName="pb-24"
          testID="records-list"
        />
      )}

      {/* Hold to photograph a receipt.
          It pushes the ORDINARY record screen with a flag rather than opening a
          camera here — the capture, the attach and the read all belong to the
          screen that owns those fields, and doing any of it on this screen
          would be a second implementation of all three. */}
      <Fab
        onPress={() => router.push('/record')}
        onLongPress={() => router.push({ pathname: '/record', params: { capture: '1' } })}
        longPressLabel="photograph a receipt"
        raised={!!pendingUndo}
      />

      <BankActions
        capture={actingCapture}
        currency={homeCurrency}
        onClose={() => setActingCapture(null)}
        onAdd={(capture) => {
          /**
           * Written straight out when there is enough to write.
           *
           * The account is the default one and there is no category: a bank
           * message names neither, and inventing them would be worse than a
           * record the user can re-file in two taps. Anything less than a full
           * amount and direction goes to the record screen instead, because a
           * zero record is worse than typing one.
           */
          if (capture.amountMinor === null || capture.direction === null) {
            setActingCapture(null);
            router.push({ pathname: '/record', params: { fromCapture: capture.id } });
            return;
          }
          handleDue(() => {
            // The card the MESSAGE named, when it named one this ledger has.
            // Its currency and its fees come with it — which is the whole
            // reason a purchase on a foreign card stopped reading as EGP.
            const account = capture.matchedAccountId ?? accountFor();
            if (!account) throw new Error('No account to record this against.');
            const record = createRecord(db, {
              type: capture.direction === 'in' ? 'income' : 'expense',
              accountId: account,
              amountMinor: capture.amountMinor!,
              currency: capture.currency ?? homeCurrency,
              note: capture.merchant ?? capture.sender,
              // DATED BY THE NOTIFICATION, to the second. The bank posts when
              // the money moves, so this is the exact answer — and it is the
              // one thing the model is never asked for.
              occurredAt: capture.postedAt,
            });
            // After the write, never before: the same rule a recurring rule
            // follows. Marking first and then failing loses the message.
            markSaved(db, capture.id, record.id);
          });
          setActingCapture(null);
        }}
        onDismiss={(capture) => {
          handleDue(() => dismissCapture(db, capture.id));
          setActingCapture(null);
        }}
      />

      <ProposalActions
        proposal={actingDue}
        currency={homeCurrency}
        onClose={() => setActingDue(null)}
        onAdd={(proposal) => handleDue(() => postProposals(db, [proposal]))}
        onDismiss={(proposal) =>
          // Skips this occurrence only. The rule carries on, because a month
          // you did not pay is an ordinary thing, not a reason to stop.
          handleDue(() => skipProposals(db, [proposal]))
        }
      />

      <RecordActions
        row={acting}
        context={actingLinks}
        onClose={() => setActing(null)}
        onRefund={(row) => {
          // Starts from the record being reversed, so the refund inherits its
          // account and category and cannot be filed against the wrong one.
          router.push({ pathname: '/record', params: { refundOf: row.id } });
          setActing(null);
        }}
        onReverse={(row) => {
          // Same reasoning, one step further: the reversal inherits BOTH
          // accounts and swaps them, so it cannot send the money back to an
          // account it never came from.
          router.push({ pathname: '/record', params: { reverseOf: row.id } });
          setActing(null);
        }}
        onOpen={(id) => {
          router.push({ pathname: '/record', params: { id } });
          setActing(null);
        }}
        onDuplicate={(row) => {
          router.push({ pathname: '/record', params: { copyOf: row.id } });
          setActing(null);
        }}
        onDelete={(row) => {
          const removed = deleteRecord(db, row.id);
          offerUndo(removed, removed.length > 1 ? 'Transfer deleted' : 'Record deleted');
          setActing(null);
          refresh();
        }}
      />

      {/* Rendered from a NON-NULL list handed down, never from `breakdown!`
          inside the sheet: it is closed almost all of the time, and an
          assertion in a closure over state is how a screen typechecks clean and
          crashes on first open. */}
      {breakdown ? (
        <PositionSheet
          visible
          onClose={() => setBreakdown(null)}
          label={headline.label}
          period={period}
          homeCurrency={homeCurrency}
          totalMinor={headline.minor}
          accounts={breakdown}
          // Null, not zero, when carry-over is off: the cell is then the
          // month's own net and nothing was carried into it, so a "Brought
          // forward E£0.00" row would invent a component of a sum that has one
          // fewer.
          broughtForwardMinor={carryOver ? carried.amountMinor : null}
          incomeMinor={summary.incomeMinor}
          expenseMinor={summary.expenseMinor}
          adjustmentMinor={summary.adjustmentMinor}
          // The SAME figure the header prints, not a second count of the same
          // thing — two numbers for one problem is how a user learns to trust
          // neither.
          unvaluedCount={carryOver ? unvaluedTotal : summary.unvaluedCount}
        />
      ) : null}

      {pendingUndo ? (
        <Snackbar
          message={pendingUndo.message}
          actionLabel="Undo"
          onAction={onUndo}
          onDismiss={clearUndo}
          token={pendingUndo.token}
        />
      ) : null}
    </Screen>
  );
}
