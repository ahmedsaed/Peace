import { budgetFraction, budgetState, remainingMinor } from './budget';
import { isLiability, owedDisplay, type AccountKind } from './liability';
import { MONTHS, parsePeriod, periodBounds, type Period } from './period';
import { resolveTheme, themeColors, type ThemeColors, type ThemeId } from './theme';

/**
 * What the home-screen widgets show, decided here and nowhere else.
 *
 * THE WIDGETS NEVER READ THE LEDGER. Android draws them in the launcher's
 * process with none of our JavaScript running, so everything they say is a
 * SNAPSHOT the app writes whenever it leaves the foreground — ready-made text,
 * already formatted and already masked. The native side (modules/home-widget)
 * only arranges it and answers the two questions that change while the app is
 * closed: is this month over yet, and how many days are left in it.
 *
 * One snapshot serves all three widgets — Budget, Balance and Quick add — so
 * they can never disagree with each other about the same month.
 *
 * The rules that make it safe to show on a home screen anybody can see:
 * - Figures go through the same `Money` the screens use, so Hide amounts masks
 *   them exactly as it masks the app. The budget bar is a proportion and stays.
 * - With the app lock on there are NO figures and no account names — a locked
 *   ledger is not readable from the home screen — only the buttons, which open
 *   the app and meet the lock there.
 * - A snapshot records when its month ENDS, so after that it cannot pass itself
 *   off as the new month: the native side shows "Open Peace to update" instead.
 */

/** What a screen's formatter looks like; the caller passes the masked one. */
export type Money = (minor: number, currency?: string) => string;

export type WidgetTone = 'ink' | 'income' | 'expense';

/** The colours the widgets need from a theme — `accentInk` sits on `accent`. */
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

export type WidgetAccount = {
  name: string;
  /** Formatted. A card's debt reads as the amount owed, never a negative. */
  amount: string;
  tone: WidgetTone;
  /** The account's own colour, for its dot. Data, not theme. */
  color: string;
};

export type WidgetSnapshot = {
  v: 2;
  /** "October": a custom month is named after the calendar month holding most of it. */
  month: string;
  /** When this month ends (exclusive), epoch ms. Past it, the snapshot is stale. */
  endsAt: number;
  locked: boolean;
  /**
   * Spent against the month's budget. Null when nothing is budgeted (or the
   * lock is on): the Budget widget then says so rather than becoming a
   * different widget.
   */
  budget: null | {
    amount: string;
    /** "of $1,200.00 budget" */
    beside: string;
    bar: { fraction: number; over: boolean };
    /** "$510.00 left" or "$140.00 over"; the device appends the days left. */
    foot: string;
  };
  /** The Records header's third cell, and the month's two sides under it. Null when locked. */
  balance: null | {
    amount: string;
    tone: WidgetTone;
    /** "now" with carry-over on, "balance" without, as on Records. */
    beside: string;
    /** "Spent $690.00 · earned $4,800.00" */
    foot: string;
  };
  /** In Accounts-tab order. Empty when locked. The widget shows as many as fit. */
  accounts: WidgetAccount[];
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
  /** The month's two sides, as on the Records header. */
  monthSpentMinor: number;
  monthEarnedMinor: number;
  /** The Records header's third cell: the running position, or the month's balance. */
  headline: { label: 'Now' | 'Balance'; minor: number };
  /** Live accounts, in the order the Accounts tab lists them. */
  accounts: { name: string; type: AccountKind; currency: string; balanceMinor: number; color: string | null }[];
  locked: boolean;
  /** The Appearance setting: a theme id, or `system` for Match phone. */
  theme: string;
};

/** A dot for an account with no colour of its own — the Accounts tab's default. */
const NO_COLOUR = '#6B5B4A';

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
  const { period, currency, locked } = input;
  return {
    v: 2,
    month: MONTHS[parsePeriod(period).month - 1],
    endsAt: periodBounds(period).end.getTime(),
    locked,
    budget: locked ? null : budget(input, money, currency),
    balance: locked ? null : balance(input, money, currency),
    accounts: locked ? [] : input.accounts.map((a) => account(a, money)),
    // The same resolution the app uses, so an unknown setting is Ledger here too.
    theme: {
      system: input.theme === 'system',
      light: widgetPalette(resolveTheme(input.theme, 'light')),
      dark: widgetPalette(resolveTheme(input.theme, 'dark')),
    },
  };
}

function budget(input: WidgetInputs, money: Money, currency: string): WidgetSnapshot['budget'] {
  const { budgetMinor, budgetSpentMinor } = input;
  if (budgetMinor <= 0) return null;
  const left = remainingMinor(budgetSpentMinor, budgetMinor);
  return {
    amount: money(Math.abs(budgetSpentMinor), currency),
    beside: `of ${money(budgetMinor, currency)} budget`,
    bar: {
      fraction: budgetFraction(budgetSpentMinor, budgetMinor),
      over: budgetState(budgetSpentMinor, budgetMinor) === 'over',
    },
    foot: left < 0 ? `${money(-left, currency)} over` : `${money(left, currency)} left`,
  };
}

// The figure the Records header leads with, so the widget and the app never
// disagree about what "now" is.
function balance(input: WidgetInputs, money: Money, currency: string): WidgetSnapshot['balance'] {
  const { headline } = input;
  return {
    amount: money(headline.minor, currency),
    tone: headline.minor < 0 ? 'expense' : 'income',
    beside: headline.label === 'Now' ? 'now' : 'balance',
    foot: `Spent ${money(Math.abs(input.monthSpentMinor), currency)} · earned ${money(
      Math.abs(input.monthEarnedMinor),
      currency
    )}`,
  };
}

// Read the way the Accounts tab reads it: a card's −5,000 is 5,000 OWED.
function account(a: WidgetInputs['accounts'][number], money: Money): WidgetAccount {
  const color = a.color ?? NO_COLOUR;
  if (!isLiability(a.type)) {
    return {
      name: a.name,
      amount: money(a.balanceMinor, a.currency),
      tone: a.balanceMinor < 0 ? 'expense' : 'income',
      color,
    };
  }
  const owed = owedDisplay(a.balanceMinor);
  return {
    name: a.name,
    amount: `${money(owed.magnitudeMinor, a.currency)} ${owed.label}`,
    tone: owed.isDebt ? 'expense' : 'income',
    color,
  };
}
