import { useState } from 'react';

import { EmptyState, MonthHeader, Screen } from '@/components/screen';
import { currentPeriod } from '@/lib/period';

export default function AnalysisScreen() {
  const [period, setPeriod] = useState(currentPeriod());

  return (
    <Screen testID="analysis-screen">
      <MonthHeader period={period} onChange={setPeriod} />
      <EmptyState
        icon="analysis"
        title="Nothing to analyse yet"
        hint="Charts appear once this month has records."
      />
    </Screen>
  );
}
