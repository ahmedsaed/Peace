/**
 * Recurring rules, and the records they owe you.
 *
 * THE REVIEW QUEUE STORES NOTHING. A rule that is due produces *proposals*
 * computed on the spot from its schedule — there is no half-written row in the
 * ledger, no pending flag for every total to remember to exclude, and no
 * cleanup if the user never looks. A proposal exists exactly as long as the
 * rule is still owed it.
 *
 * That falls out of the one rule this feature has to obey: A WRONG RULE MUST
 * NOT CORRUPT HISTORY. Records appear when the user says so; `nextRunOn` only
 * moves once something has actually been written or explicitly skipped, so
 * closing the app mid-review changes nothing at all.
 *
 * Catch-up runs on app open rather than on a schedule, for the same reason the
 * Drive backup does: Android will not honour a sideloaded app's alarms.
 */

import { and, asc, eq, isNotNull, lte } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { newId } from '../../lib/id';
import {
  firstOccurrenceOnOrAfter,
  nextOccurrenceAfter,
  occurrencesDue,
  toYmd,
  type Recurrence,
} from '../../lib/recurrence';
import * as schema from '../schema';
import { recurringRules } from '../schema';
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
export function dueProposals(db: Db, today = toYmd(new Date())): DueSummary {
  const rules = db
    .select()
    .from(recurringRules)
    .where(
      and(
        eq(recurringRules.active, true),
        isNotNull(recurringRules.nextRunOn),
        lte(recurringRules.nextRunOn, today)
      )
    )
    .orderBy(asc(recurringRules.nextRunOn))
    .all();

  const proposals: Proposal[] = [];
  const truncatedRuleIds: string[] = [];

  for (const rule of rules) {
    const { dates, truncated } = occurrencesDue(
      asRecurrence(rule),
      rule.nextRunOn!,
      today,
      CATCH_UP_CAP
    );
    if (truncated) truncatedRuleIds.push(rule.id);

    for (const occurredOn of dates) {
      proposals.push({
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
    }
  }

  return { proposals, truncatedRuleIds };
}

/**
 * Move a rule past the occurrences just dealt with.
 *
 * Takes the LAST date handled rather than a count, so posting and skipping
 * share one definition of "done up to here" — and so a partially handled batch
 * leaves the rule owing exactly the rest.
 */
function advancePast(db: Db, rule: Rule, handledThrough: string): void {
  db.update(recurringRules)
    .set({
      lastRunOn: handledThrough,
      nextRunOn: nextOccurrenceAfter(asRecurrence(rule), handledThrough),
      updatedAt: new Date(),
    })
    .where(eq(recurringRules.id, rule.id))
    .run();
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
 * Accept some proposals, writing them into the ledger.
 *
 * All of one rule's accepted dates are written and the rule advances past the
 * LATEST of them, so accepting an older occurrence while leaving a newer one
 * cannot quietly swallow the newer one.
 */
export function postProposals(db: Db, proposals: Proposal[]): number {
  if (proposals.length === 0) return 0;

  const byRule = new Map<string, Proposal[]>();
  for (const proposal of proposals) {
    byRule.set(proposal.ruleId, [...(byRule.get(proposal.ruleId) ?? []), proposal]);
  }

  let written = 0;
  for (const [ruleId, group] of byRule) {
    const rule = getRule(db, ruleId);
    if (!rule) continue;

    const sorted = [...group].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
    for (const proposal of sorted) {
      write(db, proposal);
      written++;
    }
    advancePast(db, rule, sorted[sorted.length - 1].occurredOn);
  }
  return written;
}

/**
 * Decline them: the rule moves on and NOTHING is written.
 *
 * A month you did not actually pay is a real thing — a subscription paused, a
 * salary that arrived late. Skipping has to be as easy as accepting, or the
 * only way out is editing the ledger afterwards.
 */
/**
 * Mark a rule handled up to a date without writing anything here.
 *
 * Used when the record was created SOMEWHERE ELSE — tapping a due row opens the
 * ordinary record screen, and saving there writes the record through the normal
 * path. The rule still has to be told, or the same occurrence comes back due
 * tomorrow and gets entered twice.
 */
export function advanceRule(db: Db, ruleId: string, handledThrough: string): void {
  const rule = getRule(db, ruleId);
  if (rule) advancePast(db, rule, handledThrough);
}

export function skipProposals(db: Db, proposals: Proposal[]): void {
  const latest = new Map<string, string>();
  for (const proposal of proposals) {
    const current = latest.get(proposal.ruleId);
    if (!current || proposal.occurredOn > current) latest.set(proposal.ruleId, proposal.occurredOn);
  }

  for (const [ruleId, handledThrough] of latest) {
    const rule = getRule(db, ruleId);
    if (rule) advancePast(db, rule, handledThrough);
  }
}

/**
 * Post everything from rules the user marked `autoPost`, and return what is
 * left for review.
 *
 * The split is the point: a rule you trust (rent, salary) lands without asking,
 * while anything else waits. Both paths go through the same writer, so they
 * cannot disagree about what a generated record looks like.
 */
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
