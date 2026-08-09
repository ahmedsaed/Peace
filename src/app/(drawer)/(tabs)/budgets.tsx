import { useState } from 'react';

import { EmptyState, MonthHeader, Screen } from '@/components/screen';
import { currentPeriod } from '@/lib/period';

export default function BudgetsScreen() {
  const [period, setPeriod] = useState(currentPeriod());

  return (
    <Screen testID="budgets-screen">
      <MonthHeader period={period} onChange={setPeriod} />
      <EmptyState
        icon="budgets"
        title="No budget set for this month"
        hint="Set a limit per category, or copy last month's."
      />
    </Screen>
  );
}
