import { budgetFraction, budgetState, remainingMinor } from './budget';
import { MONTHS, parsePeriod, periodBounds, type Period } from './period';
import { resolveTheme, themeColors, type ThemeColors, type ThemeId } from './theme';

/**
 * What the home-screen widget shows, decided here and nowhere else.
 *
 * THE WIDGET NEVER READS THE LEDGER. Android draws it in the launcher's
 * process with none of our JavaScript running, so everything it says is a
 * SNAPSHOT the app writes whenever it leaves the foreground — ready-made text,
 * already formatted and already masked. The native side (modules/home-widget)
 * only arranges it and answers the two questions that change while the app is
 * closed: is this month over yet, and how many days are left in it.
 *
 * The rules that make it safe to show on a home screen anybody can see:
 * - Figures go through the same `Money` the screens use, so Hide amounts masks
 *   them exactly as it masks the app. The bar is a proportion and stays.
 * - With the app lock on there are NO figures at all — a locked ledger is not
 *   readable from the home screen — only the buttons, which open the app and
 *   meet the lock there.
 * - A snapshot records when its month ENDS, so after that it cannot pass itself
 *   off as the new month: the native side shows "Open Peace to update" instead.
 */

/** What a screen's formatter looks like; the caller passes the masked one. */
export type Money = (minor: number, currency?: string) => string;

export type WidgetTone = 'ink' | 'income' | 'expense';

/** The colours the widget needs from a theme — `accentInk` sits on `accent`. */
export type WidgetPalette = {
  surface: string;
  raised: string;
  ink: string;
  muted: string;
  accent: string;
  accentInk: string;
  income: string;
  expense: string;
};

export type WidgetSnapshot = {
  v: 1;
  /** "October": a custom month is named after the calendar month holding most of it. */
  month: string;
  /** When this month ends (exclusive), epoch ms. Past it, the snapshot is stale. */
  endsAt: number;
  /** Null when there is nothing to show: the lock is on. */
  figures: null | {
    amount: string;
    tone: WidgetTone;
    /** Beside the amount: "of $1,200 budget", "now". */
    beside: string;
    /** 0–1, or null when there is no budget to measure against. */
    bar: null | { fraction: number; over: boolean };
    /** Under it: "$510.00 left", "Spent $690.00 this month". */
    foot: string;
    /** Append " · N days to go" — counted on the device, at the time it draws. */
    daysLeft: boolean;
  };
  locked: boolean;
  /**
   * `system`: follow the phone's dark mode between `light` and `dark` (the
   * app's "Match phone"). Otherwise one theme, and the two are the same.
   */
  theme: { system: boolean; light: WidgetPalette; dark: WidgetPalette };
};

export type WidgetInputs = {
  period: Period;
  currency: string;
  /** Total limit across budgeted categories, home currency. 0 = no budget. */
  budgetMinor: number;
  /** Spent in the BUDGETED categories — what the Budgets screen measures. */
  budgetSpentMinor: number;
  /** Everything spent this month, for the no-budget line. */
  monthSpentMinor: number;
  /** The Records header's third cell: the running position, or the month's balance. */
  headline: { label: 'Now' | 'Balance'; minor: number };
  locked: boolean;
  /** The Appearance setting: a theme id, or `system` for Match phone. */
  theme: string;
};

export function widgetPalette(id: ThemeId): WidgetPalette {
  const c: ThemeColors = themeColors(id);
  return {
    surface: c.surface,
    raised: c.raised,
    ink: c.ink,
    muted: c.muted,
    accent: c.accent,
    accentInk: c['accent-ink'],
    income: c.income,
    expense: c.expense,
  };
}

export function widgetSnapshot(input: WidgetInputs, money: Money): WidgetSnapshot {
  const { period, currency } = input;
  const system = input.theme === 'system';
  // The same resolution the app uses, so an unknown setting is Ledger here too.
  const light = widgetPalette(resolveTheme(input.theme, 'light'));
  const dark = widgetPalette(resolveTheme(input.theme, 'dark'));

  return {
    v: 1,
    month: MONTHS[parsePeriod(period).month - 1],
    endsAt: periodBounds(period).end.getTime(),
    figures: input.locked ? null : figures(input, money, currency),
    locked: input.locked,
    theme: { system, light, dark },
  };
}

function figures(input: WidgetInputs, money: Money, currency: string): NonNullable<WidgetSnapshot['figures']> {
  const { budgetMinor, budgetSpentMinor } = input;

  if (budgetMinor > 0) {
    const left = remainingMinor(budgetSpentMinor, budgetMinor);
    const over = budgetState(budgetSpentMinor, budgetMinor) === 'over';
    return {
      amount: money(Math.abs(budgetSpentMinor), currency),
      tone: 'expense',
      beside: `of ${money(budgetMinor, currency)} budget`,
      bar: { fraction: budgetFraction(budgetSpentMinor, budgetMinor), over },
      foot: left < 0 ? `${money(-left, currency)} over` : `${money(left, currency)} left`,
      daysLeft: true,
    };
  }

  // No budget: the figure the Records header leads with, so the widget and the
  // app never disagree about what "now" is.
  const { headline } = input;
  return {
    amount: money(headline.minor, currency),
    tone: headline.minor < 0 ? 'expense' : 'income',
    beside: headline.label === 'Now' ? 'now' : 'balance',
    bar: null,
    foot: `Spent ${money(Math.abs(input.monthSpentMinor), currency)} this month`,
    daysLeft: false,
  };
}
