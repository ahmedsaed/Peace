/**
 * The setup steps, and how far along a ledger is.
 *
 * Pure: the Records card and the setup screen both ask this, from facts the
 * caller has read, so the two can never disagree about what is left.
 */

export const SETUP_STEPS = [
  'currency',
  'accounts',
  'keypad',
  'theme',
  'reminder',
  'ai',
  'bank',
  'backup',
] as const;

export type SetupStep = (typeof SETUP_STEPS)[number];

export function isSetupStep(value: unknown): value is SetupStep {
  return typeof value === 'string' && (SETUP_STEPS as readonly string[]).includes(value);
}

/** What the card calls each step — short, because they sit in a row of chips. */
export const STEP_LABELS: Record<SetupStep, string> = {
  currency: 'Currency',
  accounts: 'Accounts',
  keypad: 'Keypad',
  theme: 'Theme',
  reminder: 'Reminder',
  ai: 'AI key',
  bank: 'Bank messages',
  backup: 'Backups',
};

export type SetupFacts = {
  /** `setupDone`: steps finished on purpose. */
  done: readonly string[];
  remindersOn: boolean;
  hasKey: boolean;
  /** Notification access granted AND capturing AND at least one sender. */
  bankReady: boolean;
  driveConnected: boolean;
};

/**
 * A step is done when it was finished on purpose OR when the thing it sets up
 * is already true.
 *
 * The second half is what keeps the card honest about work done elsewhere: a
 * reminder switched on in Settings is a reminder set up, and listing it as
 * unfinished because it was not switched on HERE would be the app disagreeing
 * with itself.
 */
export function stepDone(step: SetupStep, facts: SetupFacts): boolean {
  if (facts.done.includes(step)) return true;
  switch (step) {
    // Never left undone: the app always HAS a theme — Match phone, unless one
    // was chosen — so there is nothing for the Records card to keep offering.
    // Setup shows the step so a new install can choose by looking; skipping it
    // is a choice too.
    case 'theme':
      return true;
    case 'reminder':
      return facts.remindersOn;
    case 'ai':
      return facts.hasKey;
    case 'bank':
      return facts.bankReady;
    case 'backup':
      return facts.driveConnected;
    default:
      return false;
  }
}

export function setupProgress(facts: SetupFacts): {
  done: number;
  total: number;
  remaining: SetupStep[];
} {
  const remaining = SETUP_STEPS.filter((step) => !stepDone(step, facts));
  return { done: SETUP_STEPS.length - remaining.length, total: SETUP_STEPS.length, remaining };
}

/** `setupDone` with one more step, kept in step order and without repeats. */
export function markDone(done: readonly string[], step: SetupStep): string[] {
  const set = new Set([...done, step]);
  return SETUP_STEPS.filter((s) => set.has(s));
}
