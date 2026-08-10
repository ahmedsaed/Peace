import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { SectionList, Text } from 'react-native';

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
import { restoreRecords } from '@/db/repo/transactions';
import { formatMinor } from '@/lib/money';
import { currentPeriod } from '@/lib/period';
import { useSetting } from '@/state/settings';
import { useUndoStore } from '@/state/undo';

const EMPTY_SUMMARY: PeriodSummary = { expenseMinor: 0, incomeMinor: 0, balanceMinor: 0 };

/**
 * Records — the default tab, because logging a spend is why the app gets
 * opened.
 */
export default function RecordsScreen() {
  const router = useRouter();
  const [period, setPeriod] = useState(currentPeriod());
  const homeCurrency = useSetting('homeCurrency');
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<PeriodSummary>(EMPTY_SUMMARY);
  const pendingUndo = useUndoStore((state) => state.pending);
  const clearUndo = useUndoStore((state) => state.clear);

  const refresh = useCallback(() => {
    setRows(listRecordsForPeriod(db, period));
    setSummary(periodSummary(db, period));
  }, [period]);

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
