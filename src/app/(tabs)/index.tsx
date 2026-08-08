import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { SectionList, Text } from 'react-native';

import { RecordRow } from '@/components/record-row';
import { EmptyState, Fab, MonthHeader, Screen, SummaryTrio } from '@/components/screen';
import { db } from '@/db/client';
import {
  groupByDay,
  listRecordsForPeriod,
  periodSummary,
  type PeriodSummary,
  type RecordRow as Row,
} from '@/db/repo/records';
import { formatMinor } from '@/lib/money';
import { currentPeriod } from '@/lib/period';

const EMPTY_SUMMARY: PeriodSummary = { expenseMinor: 0, incomeMinor: 0, balanceMinor: 0 };

/**
 * Records — the default tab, because logging a spend is why the app gets
 * opened.
 */
export default function RecordsScreen() {
  const router = useRouter();
  const [period, setPeriod] = useState(currentPeriod());
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<PeriodSummary>(EMPTY_SUMMARY);

  // Re-read on focus rather than on mount: returning from the add-record screen
  // has to show the record that was just saved.
  useFocusEffect(
    useCallback(() => {
      setRows(listRecordsForPeriod(db, period));
      setSummary(periodSummary(db, period));
    }, [period])
  );

  const sections = groupByDay(rows).map((group) => ({
    key: group.key,
    title: group.heading,
    data: group.rows,
  }));

  return (
    <Screen testID="home-screen">
      <MonthHeader period={period} onChange={setPeriod}>
        <SummaryTrio
          expense={formatMinor(summary.expenseMinor, 'EGP')}
          income={formatMinor(summary.incomeMinor, 'EGP')}
          balance={formatMinor(summary.balanceMinor, 'EGP')}
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
          renderItem={({ item }) => <RecordRow row={item} />}
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

      <Fab onPress={() => router.push('/record')} />
    </Screen>
  );
}
