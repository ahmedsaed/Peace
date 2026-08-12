import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, SectionList, Text } from 'react-native';

import { ProposalActions, ProposalRow } from '@/components/proposal-row';
import {
  catchUp,
  postProposals,
  skipProposals,
  upcomingProposals,
  type Proposal,
} from '@/db/repo/recurring';
import { RecordActions } from '@/components/record-actions';
import { RecordRow } from '@/components/record-row';
import { Snackbar } from '@/components/snackbar';
import { EmptyState, Fab, MonthHeader, Screen, SummaryTrio } from '@/components/screen';
import { db } from '@/db/client';
import {
  groupByDay,
  listRecordsForPeriod,
  periodSummary,
  type PeriodSummary,
  type RecordRow as Row,
} from '@/db/repo/records';
import { broughtForward, type BroughtForward } from '@/db/repo/carry';
import { deleteRecord, restoreRecords } from '@/db/repo/transactions';
import { formatMinor } from '@/lib/money';
import { currentPeriod } from '@/lib/period';
import { useSetting } from '@/state/settings';
import { useUndoStore } from '@/state/undo';

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
const isProposal = (row: Row | Proposal): row is Proposal =>
  (row as Proposal).ruleId !== undefined;

export default function RecordsScreen() {
  const router = useRouter();
  const [period, setPeriod] = useState(currentPeriod());
  const homeCurrency = useSetting('homeCurrency');
  const carryOver = useSetting('carryOver');
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<PeriodSummary>(EMPTY_SUMMARY);
  const [carried, setCarried] = useState<BroughtForward>(NO_CARRY);
  // Long-pressed row, if any. The menu is the only place Delete lives now: at
  // the bottom of the edit form it meant opening a record to change it in order
  // to remove it, with a destructive action next to Save.
  const [acting, setActing] = useState<Row | null>(null);
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
  const pendingUndo = useUndoStore((state) => state.pending);
  const clearUndo = useUndoStore((state) => state.clear);
  const offerUndo = useUndoStore((state) => state.offer);

  const refresh = useCallback(() => {
    setRows(listRecordsForPeriod(db, period));
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
    // homeCurrency belongs here: changing it changes what the totals MEAN, and
    // without it the screen would keep showing figures computed against the
    // previous one until something else happened to trigger a refresh.
  }, [period, homeCurrency, carryOver]);

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
  // One line, not two. The carry scan and the month query can each turn up
  // records they cannot value, and telling the user about them separately would
  // report the same underlying problem twice with two different numbers.
  const unvaluedTotal = summary.unvaluedCount + carried.unvaluedCount;

  const dayGroups = groupByDay(rows).map((group) => ({
    key: group.key,
    title: group.heading,
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
  function handleDue(work: () => void) {
    try {
      work();
    } catch (error) {
      Alert.alert('Could not do that', error instanceof Error ? error.message : 'Something went wrong.');
    }
    setActingDue(null);
    refresh();
  }

  const sections = [
    ...(due.length > 0
      ? [
          {
            key: 'due',
            title: due.length === 1 ? 'Due' : `Due · ${due.length}`,
            data: due as (Row | Proposal)[],
          },
        ]
      : []),
    ...dayGroups,
    // LAST, and after the real records: these have not happened. Above them
    // they would read as the newest thing in the month.
    ...(upcoming.length > 0
      ? [{ key: 'upcoming', title: 'Upcoming', data: upcoming as (Row | Proposal)[] }]
      : []),
  ];

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
          expense={formatMinor(summary.expenseMinor, homeCurrency)}
          income={formatMinor(summary.incomeMinor, homeCurrency)}
          balance={formatMinor(carryOver ? running : summary.balanceMinor, homeCurrency)}
          balanceMinor={carryOver ? running : summary.balanceMinor}
          balanceLabel={carryOver ? 'Now' : 'Balance'}
          balanceTestID={carryOver ? 'summary-running' : 'summary-balance'}
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
            isProposal(item) ? (
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
            <Text className="bg-ground px-4 pb-1.5 pt-4 text-xs font-semibold text-muted">
              {section.title}
            </Text>
          )}
          stickySectionHeadersEnabled={false}
          contentContainerClassName="pb-24"
          testID="records-list"
        />
      )}

      <Fab onPress={() => router.push('/record')} raised={!!pendingUndo} />

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
        onClose={() => setActing(null)}
        onRefund={() => {
          // Starts from the record being reversed, so the refund inherits its
          // account and category and cannot be filed against the wrong one.
          router.push({ pathname: '/record', params: { refundOf: acting!.id } });
          setActing(null);
        }}
        onDuplicate={() => {
          router.push({ pathname: '/record', params: { copyOf: acting!.id } });
          setActing(null);
        }}
        onDelete={() => {
          const removed = deleteRecord(db, acting!.id);
          offerUndo(removed, removed.length > 1 ? 'Transfer deleted' : 'Record deleted');
          setActing(null);
          refresh();
        }}
      />

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
