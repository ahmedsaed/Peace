import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { SectionList, Text, View } from 'react-native';

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
import { restoreRecords } from '@/db/repo/transactions';
import { formatMinor } from '@/lib/money';
import { currentPeriod } from '@/lib/period';
import { useSetting } from '@/state/settings';
import { useUndoStore } from '@/state/undo';

const EMPTY_SUMMARY: PeriodSummary = {
  expenseMinor: 0,
  incomeMinor: 0,
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
export default function RecordsScreen() {
  const router = useRouter();
  const [period, setPeriod] = useState(currentPeriod());
  const homeCurrency = useSetting('homeCurrency');
  const carryOver = useSetting('carryOver');
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<PeriodSummary>(EMPTY_SUMMARY);
  const [carried, setCarried] = useState<BroughtForward>(NO_CARRY);
  const pendingUndo = useUndoStore((state) => state.pending);
  const clearUndo = useUndoStore((state) => state.clear);

  const refresh = useCallback(() => {
    setRows(listRecordsForPeriod(db, period));
    setSummary(periodSummary(db, period, homeCurrency));
    // Only asked for when it is going to be shown. It is a scan of every record
    // before this month, which is the one query here that grows with the age of
    // the ledger.
    setCarried(carryOver ? broughtForward(db, period, homeCurrency) : NO_CARRY);
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

  const sections = groupByDay(rows).map((group) => ({
    key: group.key,
    title: group.heading,
    data: group.rows,
  }));

  return (
    <Screen testID="home-screen">
      <MonthHeader period={period} onChange={setPeriod}>
        <SummaryTrio
          expense={formatMinor(summary.expenseMinor, homeCurrency)}
          income={formatMinor(summary.incomeMinor, homeCurrency)}
          balance={formatMinor(summary.balanceMinor, homeCurrency)}
          balanceMinor={summary.balanceMinor}
        />
        {/* What you started the month holding, and what it leaves you with.
            Shown only when carry-over is on, because it changes what the
            BALANCE above it means: balance is the month, this is the position.

            Deliberately a separate line rather than a fourth cell in the trio —
            the trio is three facts about this month, and "brought forward" is a
            fact about every month before it.

            Hidden when nothing carried, because on a fresh ledger there really
            is nothing to bring forward and "E£0.00 brought forward → E£0.00 now"
            is a sentence that teaches the reader to ignore the line. It appears
            the first month there is a position to report. */}
        {carryOver && carried.amountMinor !== 0 ? (
          <View className="mt-2 flex-row justify-center gap-2">
            <Text className="text-[11px] text-muted" testID="summary-brought-forward">
              {formatMinor(carried.amountMinor, homeCurrency)} brought forward
            </Text>
            <Text className="text-[11px] text-muted">→</Text>
            <Text
              className={`text-[11px] font-semibold ${
                running < 0 ? 'text-expense' : 'text-ink'
              }`}
              testID="summary-running">
              {formatMinor(running, homeCurrency)} now
            </Text>
          </View>
        ) : null}

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

      {rows.length === 0 ? (
        <EmptyState
          icon="records"
          title="No records this month"
          hint="Tap + to log your first expense."
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(row) => row.id}
          renderItem={({ item }) => (
            <RecordRow
              row={item}
              onPress={() => router.push({ pathname: '/record', params: { id: item.id } })}
            />
          )}
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
