import { useState } from 'react';

import { EmptyState, MonthHeader, Screen, SummaryTrio } from '@/components/screen';
import { formatMinor } from '@/lib/money';
import { currentPeriod } from '@/lib/period';

/**
 * Records — the default tab, because logging a spend is why the app gets
 * opened. The list itself lands in Stage 1 alongside the add-record screen.
 */
export default function RecordsScreen() {
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
    </Screen>
  );
}
