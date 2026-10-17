import { useEffect } from 'react';
import { AppState } from 'react-native';

import { setWidgetSnapshot } from '../../modules/home-widget/src/HomeWidgetModule';
import { db } from '@/db/client';
import { listAccountsWithBalance } from '@/db/repo/accounts';
import { listBudgets } from '@/db/repo/budgets';
import { broughtForward } from '@/db/repo/carry';
import { periodSummary } from '@/db/repo/records';
import { periodOf } from '@/lib/period';
import { widgetSnapshot } from '@/lib/widget';
import { moneyFor } from '@/state/money';
import { useSettingsStore } from '@/state/settings';
import { trackSync } from '@/state/stalls';

/**
 * Write the home-screen widgets' snapshot from the ledger as it is now.
 *
 * WHEN: on launch, whenever a setting it depends on changes, and every time
 * the app leaves the foreground. The last one is the one that matters — the
 * widget can only be looked at once Peace is no longer on screen, and every
 * change to the ledger happens inside the app, so leaving it is exactly the
 * moment there is something new to show. Nothing has to remember to call this
 * after a save, a restore or an import.
 *
 * Never throws: a widget that could not be updated keeps its last snapshot,
 * and that is never worth interrupting somebody leaving the app.
 */
export function syncWidget(): void {
  trackSync('widget', writeWidget);
}

function writeWidget(): void {
  try {
    const settings = useSettingsStore.getState().settings;
    const currency = settings.homeCurrency;
    const period = periodOf(new Date());
    const summary = periodSummary(db, period, currency);
    const budgets = listBudgets(db, period, currency);
    const headline = settings.carryOver
      ? { label: 'Now' as const, minor: broughtForward(db, period, currency).amountMinor + summary.balanceMinor }
      : { label: 'Balance' as const, minor: summary.balanceMinor };

    const snapshot = widgetSnapshot(
      {
        period,
        currency,
        budgetMinor: budgets.totalBudgetMinor,
        budgetSpentMinor: budgets.totalSpentMinor,
        monthSpentMinor: summary.expenseMinor,
        monthEarnedMinor: summary.incomeMinor,
        headline,
        // The Accounts tab's own list and order; the widget shows as many as fit.
        accounts: listAccountsWithBalance(db),
        // The SETTING, not whether this phone can honour it: a widget is the
        // wrong place to discover the lock quietly failed open.
        locked: settings.lockEnabled,
        theme: settings.theme,
      },
      moneyFor(settings.hideAmounts)
    );
    setWidgetSnapshot(JSON.stringify(snapshot));
  } catch (e) {
    console.warn('[widget] could not build the snapshot', e);
  }
}

/** Mounted once in the root layout. Renders nothing. */
export function WidgetSync(): null {
  const theme = useSettingsStore((s) => s.settings.theme);
  const hidden = useSettingsStore((s) => s.settings.hideAmounts);
  const locked = useSettingsStore((s) => s.settings.lockEnabled);
  const currency = useSettingsStore((s) => s.settings.homeCurrency);
  const carry = useSettingsStore((s) => s.settings.carryOver);
  const monthStart = useSettingsStore((s) => s.settings.monthStartDay);

  useEffect(syncWidget, [theme, hidden, locked, currency, carry, monthStart]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') syncWidget();
    });
    return () => subscription.remove();
  }, []);

  return null;
}
