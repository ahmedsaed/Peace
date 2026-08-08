import { useRouter } from 'expo-router';
import { useState } from 'react';

import { EmptyState, Fab, MonthHeader, Screen, SummaryTrio } from '@/components/screen';
import { formatMinor } from '@/lib/money';
import { currentPeriod } from '@/lib/period';

/**
 * Records — the default tab, because logging a spend is why the app gets
 * opened. The list itself is the next piece of Stage 1; the FAB already routes
 * to the working add-record screen.
 */
export default function RecordsScreen() {
  const router = useRouter();
  const [period, setPeriod] = useState(currentPeriod());

  return (
    <Screen testID="home-screen">
      <MonthHeader period={period} onChange={setPeriod}>
        <SummaryTrio
          expense={formatMinor(0, 'EGP')}
          income={formatMinor(0, 'EGP')}
          balance={formatMinor(0, 'EGP')}
        />
      </MonthHeader>

      <EmptyState
        icon="records"
        title="No records this month"
        hint="Tap + to log your first expense."
      />

      <Fab onPress={() => router.push('/record')} />
    </Screen>
  );
}
