import { useState } from 'react';

import { currentPeriod, type Period } from '@/lib/period';
import { useSetting } from '@/state/settings';

/**
 * The month a screen is showing — which goes back to the CURRENT one when the
 * month start day changes.
 *
 * Moving the start from the 1st to the 25th can move today into the next
 * period, and a screen left on the old one would open, after the change, on a
 * month that is no longer "this month" while its arrows say otherwise. Done
 * while rendering rather than in an effect — React's pattern for state that
 * follows a prop — so there is no frame showing the stale month.
 */
export function usePeriodState(): [Period, (next: Period) => void] {
  const startDay = useSetting('monthStartDay');
  const [period, setPeriod] = useState(currentPeriod);
  const [seenStart, setSeenStart] = useState(startDay);
  if (seenStart !== startDay) {
    setSeenStart(startDay);
    setPeriod(currentPeriod());
  }
  return [period, setPeriod];
}
