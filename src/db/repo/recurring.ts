/**
 * Recurring rules, and the records they propose.
 *
 * EVERY OCCURRENCE IS INDEPENDENT. A rule proposes records; each one is
 * approved or dismissed on its own, and September does not care about August.
 *
 * This replaced a single `next_run_on` cursor, which could express "handled up
 * to here" and nothing finer — so occurrences had to be dealt with in order,
 * and acting out of order had to be forbidden. That constraint came from the
 * storage, not from anything true about standing orders.
 *
 * Progress is therefore read from two places, neither of them a pointer:
 *
 *   Approved  the transaction itself, which carries `recurring_rule_id` and its
 *             date. Having been added IS the record of having been added.
 *   Dismissed a row in `recurring_skips`, because declining leaves nothing else
 *             behind.
 *
 * A proposal is any occurrence in range that appears in neither.
 *
 * The one rule this feature has to obey is unchanged: A WRONG RULE MUST NOT
 * CORRUPT HISTORY. Nothing is written until the user says so, and closing the
 * app mid-review changes nothing at all.
 *
 * Catch-up runs on app open rather than on a schedule, for the same reason the
 * Drive backup does: Android will not honour a sideloaded app's alarms.
 */

import { asc, eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { newId } from '../../lib/id';
import { periodBounds, type Period } from '../../lib/period';
import {
  firstOccurrenceOnOrAfter,
  isAfterEnd,
  nextOccurrenceAfter,
  occurrencesDue,
  toYmd,
  type Recurrence,
} from '../../lib/recurrence';
import * as schema from '../schema';
import { recurringRules, recurringSkips, transactions } from '../schema';
import { createRecord, createTransfer } from './transactions';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;
type Rule = typeof recurringRules.$inferSelect;

export class RecurringError extends Error {}

/** How many occurrences one rule may generate in a single catch-up. */
export const CATCH_UP_CAP = 60;

const asRecurrence = (rule: Rule): Recurrence => ({
  frequency: rule.frequency,
  interval: rule.interval,
  anchorDay: rule.anchorDay,
  startsOn: rule.startsOn,
  endsOn: rule.endsOn,
});

export function listRules(db: Db): Rule[] {
  return db
    .select()
    .from(recurringRules)
    .orderBy(asc(recurringRules.active), asc(recurringRules.nextRunOn))
    .all();
}

export function getRule(db: Db, id: string): Rule | undefined {
  return db.select().from(recurringRules).where(eq(recurringRules.id, id)).get();
}

export type RuleInput = {
  id?: string;
  name?: string | null;
  type?: 'expense' | 'income' | 'transfer';
  accountId: string;
  counterAccountId?: string | null;
  categoryId?: string | null;
  /** UNSIGNED. The sign comes from `type` when a record is written. */
  amountMinor: number;
  currency?: string;
  note?: string | null;
  frequency: Recurrence['frequency'];
  interval?: number;
  anchorDay?: number | null;
  startsOn: string;
  endsOn?: string | null;
  autoPost?: boolean;
};

export function createRule(db: Db, input: RuleInput): Rule {
  if (input.amountMinor <= 0) {
    throw new RecurringError('A recurring amount must be more than zero.');
  }
  if (input.type === 'transfer' && !input.counterAccountId) {
    throw new RecurringError('A recurring transfer needs an account to move money into.');
  }
  if (input.endsOn && input.endsOn < input.startsOn) {
    throw new RecurringError('The end date cannot be before the start date.');
  }

  const rule = {
    id: input.id ?? newId(),
    name: input.name ?? null,
    type: input.type ?? ('expense' as const),
    accountId: input.accountId,
    counterAccountId: input.counterAccountId ?? null,
    categoryId: input.categoryId ?? null,
    amountMinor: input.amountMinor,
    currency: input.currency ?? 'EGP',
    note: input.note ?? null,
    frequency: input.frequency,
    interval: Math.max(1, Math.trunc(input.interval ?? 1)),
    anchorDay: input.anchorDay ?? null,
    startsOn: input.startsOn,
    endsOn: input.endsOn ?? null,
    autoPost: input.autoPost ?? false,
    active: true,
  };

  // The first occurrence is computed once, at creation, so a rule created
  // today for a date in the past is immediately owed — which is what someone
  // entering an existing standing order expects.
  const nextRunOn = firstOccurrenceOnOrAfter(asRecurrence(rule as Rule), rule.startsOn);

  db.insert(recurringRules)
    .values({ ...rule, nextRunOn, lastRunOn: null })
    .run();

  return getRule(db, rule.id)!;
}

export function setRuleActive(db: Db, id: string, active: boolean): void {
  db.update(recurringRules)
    .set({ active, updatedAt: new Date() })
    .where(eq(recurringRules.id, id))
    .run();
}

export function deleteRule(db: Db, id: string): void {
  // Records already written keep their `recurring_rule_id` pointing at nothing,
  // which is deliberate: deleting a rule must never delete history. The column
  // is `set null` on delete for exactly this reason.
  db.delete(recurringRules).where(eq(recurringRules.id, id)).run();
}

export type Proposal = {
  ruleId: string;
  ruleName: string;
  type: 'expense' | 'income' | 'transfer';
  accountId: string;
  counterAccountId: string | null;
  categoryId: string | null;
  amountMinor: number;
  currency: string;
  note: string | null;
  /** `YYYY-MM-DD`. */
  occurredOn: string;
};

export type DueSummary = {
  proposals: Proposal[];
  /** Rules that had more owing than one pass may generate. */
  truncatedRuleIds: string[];
};

/**
 * What every active rule owes as of `today`.
 *
 * Derived, never stored. Calling this twice returns the same answer and changes
 * nothing — which is what makes it safe to run on every app open.
 */
/**
 * Occurrences of a rule that have been dealt with, either way.
 *
 * Approved ones are read from the LEDGER — a transaction carries its rule and
 * its date, so its existence is the record of approval. Dismissed ones come
 * from `recurring_skips`. Nothing here is a cursor, so nothing here cares what
 * order they were handled in.
 */
function handledDates(db: Db, ruleId: string): Set<string> {
  const posted = db
    .select({ occurredAt: transactions.occurredAt })
    .from(transactions)
    .where(eq(transactions.recurringRuleId, ruleId))
    .all();

  const skipped = db
    .select({ occurredOn: recurringSkips.occurredOn })
    .from(recurringSkips)
    .where(eq(recurringSkips.ruleId, ruleId))
    .all();

  return new Set([
    // A transfer writes TWO rows for one occurrence; a Set folds them together.
    ...posted.map((row) => toYmd(row.occurredAt)),
    ...skipped.map((row) => row.occurredOn),
  ]);
}

const proposalFrom = (rule: Rule, occurredOn: string): Proposal => ({
  ruleId: rule.id,
  ruleName: rule.name ?? 'Recurring',
  type: rule.type,
  accountId: rule.accountId,
  counterAccountId: rule.counterAccountId,
  categoryId: rule.categoryId,
  amountMinor: rule.amountMinor,
  currency: rule.currency,
  note: rule.note,
  occurredOn,
});

const activeRules = (db: Db): Rule[] =>
  db
    .select()
    .from(recurringRules)
    .where(eq(recurringRules.active, true))
    .orderBy(asc(recurringRules.startsOn))
    .all();

/**
 * Everything a rule has proposed up to today and that has not been dealt with.
 *
 * Generated from the schedule every time rather than tracked, so the answer
 * cannot drift from the rule. Reading it changes nothing, which is what makes
 * it safe to call on every app open.
 */
export function dueProposals(db: Db, today = toYmd(new Date())): DueSummary {
  const proposals: Proposal[] = [];
  const truncatedRuleIds: string[] = [];

  for (const rule of activeRules(db)) {
    const { dates, truncated } = occurrencesDue(
      asRecurrence(rule),
      rule.startsOn,
      today,
      CATCH_UP_CAP
    );
    if (truncated) truncatedRuleIds.push(rule.id);

    const handled = handledDates(db, rule.id);
    for (const occurredOn of dates) {
      if (!handled.has(occurredOn)) proposals.push(proposalFrom(rule, occurredOn));
    }
  }

  proposals.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
  return { proposals, truncatedRuleIds };
}

export function upcomingProposals(
  db: Db,
  period: Period,
  today = toYmd(new Date()),
  cap = 30
): Proposal[] {
  const { start, end } = periodBounds(period);
  const firstOfMonth = toYmd(start);
  // `end` is midnight on the 1st of the NEXT month, so this bound is exclusive.
  const firstOfNextMonth = toYmd(end);

  // Strictly after today: an occurrence falling today is proposed by
  // `dueProposals`, and listing it here as well would put one payment on screen
  // in two sections.
  const from = firstOfMonth > today ? firstOfMonth : nextDay(today);

  const proposals: Proposal[] = [];

  for (const rule of activeRules(db)) {
    const recurrence = asRecurrence(rule);
    const handled = handledDates(db, rule.id);
    let cursor = firstOccurrenceOnOrAfter(recurrence, from);

    while (cursor !== null && cursor < firstOfNextMonth && proposals.length < cap) {
      if (isAfterEnd(recurrence, cursor)) break;
      if (!handled.has(cursor)) proposals.push(proposalFrom(rule, cursor));
      cursor = nextOccurrenceAfter(recurrence, cursor);
    }
  }

  return proposals.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
}

function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d + 1);
  return toYmd(date);
}


/** Write one proposal into the ledger. */
function write(db: Db, proposal: Proposal): void {
  // Midday, not midnight: a record dated 00:00 sits ambiguously on a day
  // boundary, and every period query in this app groups by local calendar day.
  const occurredAt = new Date(`${proposal.occurredOn}T12:00:00`);

  if (proposal.type === 'transfer') {
    createTransfer(db, {
      fromAccountId: proposal.accountId,
      toAccountId: proposal.counterAccountId!,
      amountMinor: proposal.amountMinor,
      currency: proposal.currency,
      note: proposal.note,
      occurredAt,
      recurringRuleId: proposal.ruleId,
    });
    return;
  }

  createRecord(db, {
    type: proposal.type,
    accountId: proposal.accountId,
    categoryId: proposal.categoryId,
    amountMinor: proposal.amountMinor,
    currency: proposal.currency,
    note: proposal.note,
    occurredAt,
    recurringRuleId: proposal.ruleId,
  });
}

/**
 * Approve them: the records are written, and that is the whole of it.
 *
 * Nothing else is updated. The transaction carries its rule and its date, so
 * the ledger itself is the record of approval — there is no second place to
 * keep in step, and no order to respect.
 */
export function postProposals(db: Db, proposals: Proposal[]): number {
  let written = 0;
  for (const proposal of proposals) {
    // Approving the same occurrence twice would write it twice, and the second
    // one would look exactly like a real payment.
    if (handledDates(db, proposal.ruleId).has(proposal.occurredOn)) continue;
    write(db, proposal);
    written++;
  }
  return written;
}

/**
 * Decline them: nothing is written to the ledger, and the occurrence is
 * remembered as dismissed so it stops being proposed.
 *
 * A month you did not pay is a real thing — a paused subscription, a salary
 * that came late — so this has to be as easy as approving.
 */
export function skipProposals(db: Db, proposals: Proposal[]): void {
  for (const proposal of proposals) {
    db.insert(recurringSkips)
      .values({
        id: newId(),
        ruleId: proposal.ruleId,
        occurredOn: proposal.occurredOn,
      })
      // Dismissing twice is the same as dismissing once.
      .onConflictDoNothing()
      .run();
  }
}

/**
 * Mark an occurrence handled without writing anything to the ledger.
 *
 * Needed for one case: tapping a proposed row opens the ordinary record screen,
 * and the user is free to CHANGE THE DATE before saving. The saved record then
 * carries the rule but a different date, so it no longer answers for the
 * occurrence it came from — which would go on being proposed forever.
 *
 * Recorded as a dismissal, which is exactly what it is from the schedule's
 * point of view: that date produced no record of its own.
 */
export function markHandled(db: Db, ruleId: string, occurredOn: string): void {
  skipProposals(db, [{ ruleId, occurredOn } as Proposal]);
}

export function catchUp(db: Db, today = toYmd(new Date())): DueSummary {
  const { proposals, truncatedRuleIds } = dueProposals(db, today);

  const automatic: Proposal[] = [];
  const forReview: Proposal[] = [];
  for (const proposal of proposals) {
    (getRule(db, proposal.ruleId)?.autoPost ? automatic : forReview).push(proposal);
  }

  postProposals(db, automatic);
  return { proposals: forReview, truncatedRuleIds };
}

/**
 * The next occurrence a rule will propose, for the rules list.
 *
 * Derived rather than stored. A `next_run_on` column would be a second copy of
 * something the schedule already knows, and the two would eventually disagree —
 * which is the whole reason the cursor was removed.
 */
export function nextProposalDate(db: Db, rule: Rule, today = toYmd(new Date())): string | null {
  if (!rule.active) return null;

  const recurrence = asRecurrence(rule);
  const handled = handledDates(db, rule.id);

  // Look forward from today only: anything earlier that is still unhandled is
  // already on the records list, where it can be acted on.
  let cursor = firstOccurrenceOnOrAfter(recurrence, today);
  for (let guard = 0; cursor !== null && guard < 400; guard++) {
    if (isAfterEnd(recurrence, cursor)) return null;
    if (!handled.has(cursor)) return cursor;
    cursor = nextOccurrenceAfter(recurrence, cursor);
  }
  return null;
}
