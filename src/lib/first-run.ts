import { isThemeId, type ThemeSetting } from './theme';

/**
 * What a ledger opened for the very first time starts with.
 *
 * Pure, so the decision is testable without a phone: the provider gathers the
 * device's locales and the launch extras and writes whatever this returns,
 * once, before seeding — the seeded Cash and Bank accounts take their currency
 * from it, so it has to be settled before they exist.
 */

/** Launch extras a test harness can pass (Maestro `launchApp: arguments`). */
export const LAUNCH_ONBOARDING = 'peace.onboarding';
export const LAUNCH_CURRENCY = 'peace.currency';
/**
 * Pins the theme. The screenshot flow needs it: a fresh install follows the
 * phone, and the test AVD is in light mode, so every image would come out Paper.
 */
export const LAUNCH_THEME = 'peace.theme';

type Locale = { currencyCode: string | null };

const ISO_4217 = /^[A-Z]{3}$/;

/**
 * The currency of the phone's region, or US dollars when it has none.
 *
 * The REGION, not the language: `en` alone carries no currency, and English is
 * spoken in a lot of places that do not use the pound. A language-only locale
 * falls through to the next one the user listed, and dollars are the last
 * resort only because they are the likeliest second currency anywhere —
 * onboarding shows the guess and asks, so a wrong one costs a tap.
 */
export function detectCurrency(locales: readonly Locale[]): string {
  for (const locale of locales) {
    const code = locale.currencyCode?.toUpperCase();
    if (code && ISO_4217.test(code)) return code;
  }
  return 'USD';
}

/** A theme a harness named, if it is one this build has. */
function askedTheme(value: string | undefined): ThemeSetting {
  return value && (value === 'system' || isThemeId(value)) ? value : 'system';
}

export type FirstRun = {
  homeCurrency: string;
  /** False unless a harness asked to skip; a person always sees the welcome. */
  onboardingDone: boolean;
  /** The Records card that lists what was skipped. */
  setupCard: boolean;
  /** A new install follows the phone; an existing one keeps Ledger. */
  theme: ThemeSetting;
};

export function firstRunSettings(
  extras: Record<string, string>,
  locales: readonly Locale[]
): FirstRun {
  const asked = extras[LAUNCH_CURRENCY]?.toUpperCase();
  const skip = extras[LAUNCH_ONBOARDING] === 'done';
  return {
    homeCurrency: asked && ISO_4217.test(asked) ? asked : detectCurrency(locales),
    onboardingDone: skip,
    // A flow that skipped onboarding is testing something else, and a card
    // above the first record would move every row it taps.
    setupCard: !skip,
    theme: askedTheme(extras[LAUNCH_THEME]),
  };
}
