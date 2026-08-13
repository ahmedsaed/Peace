/**
 * @jest-environment node
 */
import { createTestDb, type TestDb } from '../../test/db';
import { createAccount } from './accounts';
import { createCategory } from './categories';
import { periodSummary } from './records';
import {
  catchUp,
  createRule,
  dueProposals,
  getRule,
  listRules,
  postProposals,
  RecurringError,
  setRuleActive,
  nextProposalDate,
  skipProposals,
  upcomingProposals,
} from './recurring';

function seed() {
  const { db } = createTestDb();
  createAccount(db, { id: 'bank', name: 'Bank', currency: 'EGP' });
  createAccount(db, { id: 'cash', name: 'Cash', currency: 'EGP' });
  createCategory(db, { id: 'installments', name: 'Installments', kind: 'expense', sortOrder: 0 });
  createCategory(db, { id: 'salary', name: 'Salary', kind: 'income', sortOrder: 0 });
  return db;
}

const rent = (db: TestDb, over: Partial<Parameters<typeof createRule>[1]> = {}) =>
  createRule(db, {
    id: 'rule-rent',
    name: 'Rent',
    type: 'expense',
    accountId: 'bank',
    categoryId: 'installments',
    amountMinor: 500_000,
    frequency: 'monthly',
    startsOn: '2026-01-01',
    ...over,
  });

describe('creating a rule', () => {
  it('schedules its first run on the start date', () => {
    const db = seed();
    expect(rent(db).nextRunOn).toBe('2026-01-01');
  });

  it('refuses an amount of zero', () => {
    const db = seed();
    expect(() => rent(db, { amountMinor: 0 })).toThrow(RecurringError);
  });

  it('refuses a transfer with nowhere to transfer to', () => {
    const db = seed();
    expect(() => rent(db, { type: 'transfer', counterAccountId: null })).toThrow(/move money into/);
  });

  it('refuses an end date before the start', () => {
    const db = seed();
    expect(() => rent(db, { endsOn: '2025-12-01' })).toThrow(/cannot be before/);
  });
});

/**
 * Nothing is stored: a proposal exists exactly as long as the rule is still
 * owed it. Reading them twice must therefore be identical and must change
 * nothing — that is what makes it safe on every app open.
 */
describe('what is owed', () => {
  it('lists one occurrence per period missed', () => {
    const db = seed();
    rent(db);

    const { proposals } = dueProposals(db, '2026-03-15');
    expect(proposals.map((p) => p.occurredOn)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
  });

  it('is idempotent — reading does not advance anything', () => {
    const db = seed();
    rent(db);

    const first = dueProposals(db, '2026-03-15');
    const second = dueProposals(db, '2026-03-15');
    expect(second.proposals).toEqual(first.proposals);
    expect(getRule(db, 'rule-rent')!.nextRunOn).toBe('2026-01-01');
  });

  it('ignores a paused rule', () => {
    const db = seed();
    rent(db);
    setRuleActive(db, 'rule-rent', false);
    expect(dueProposals(db, '2026-03-15').proposals).toEqual([]);
  });

  it('says when a rule owes more than one pass can generate', () => {
    const db = seed();
    rent(db, { frequency: 'daily', startsOn: '2024-01-01' });
    const { proposals, truncatedRuleIds } = dueProposals(db, '2026-01-01');
    expect(proposals).toHaveLength(60);
    expect(truncatedRuleIds).toEqual(['rule-rent']);
  });
});

describe('accepting proposals', () => {
  it('writes the records and moves the rule on', () => {
    const db = seed();
    rent(db);

    const { proposals } = dueProposals(db, '2026-02-15');
    expect(postProposals(db, proposals)).toBe(2);

    expect(periodSummary(db, '2026-01').expenseMinor).toBe(-500_000);
    expect(periodSummary(db, '2026-02').expenseMinor).toBe(-500_000);
    // Nothing else to check: the transactions ARE the record of approval, so
    // those two occurrences simply stop being proposed.
    expect(dueProposals(db, '2026-02-15').proposals).toEqual([]);
  });

  /** Posting twice is the failure that quietly doubles someone's rent. */
  it('does not post the same occurrence twice', () => {
    const db = seed();
    rent(db);

    postProposals(db, dueProposals(db, '2026-02-15').proposals);
    const second = dueProposals(db, '2026-02-15');

    expect(second.proposals).toEqual([]);
    expect(postProposals(db, second.proposals)).toBe(0);
    expect(periodSummary(db, '2026-01').expenseMinor).toBe(-500_000);
  });

  it('dates the record on the day it was due, not today', () => {
    const db = seed();
    rent(db);
    postProposals(db, dueProposals(db, '2026-03-15').proposals);

    // Three months materialised at once still land in their own months.
    expect(periodSummary(db, '2026-01').expenseMinor).toBe(-500_000);
    expect(periodSummary(db, '2026-03').expenseMinor).toBe(-500_000);
  });

  it('writes income on the income side', () => {
    const db = seed();
    createRule(db, {
      id: 'rule-salary',
      name: 'Salary',
      type: 'income',
      accountId: 'bank',
      categoryId: 'salary',
      amountMinor: 900_000,
      frequency: 'monthly',
      startsOn: '2026-01-25',
    });

    postProposals(db, dueProposals(db, '2026-01-31').proposals);
    expect(periodSummary(db, '2026-01').incomeMinor).toBe(900_000);
  });

  it('writes a transfer as a transfer, counting as neither side', () => {
    const db = seed();
    createRule(db, {
      id: 'rule-savings',
      name: 'To savings',
      type: 'transfer',
      accountId: 'bank',
      counterAccountId: 'cash',
      amountMinor: 100_000,
      frequency: 'monthly',
      startsOn: '2026-01-05',
    });

    postProposals(db, dueProposals(db, '2026-01-31').proposals);

    const summary = periodSummary(db, '2026-01');
    expect(summary.expenseMinor).toBe(0);
    expect(summary.incomeMinor).toBe(0);
  });

  /**
   * Accepting an older occurrence while a newer one is still owed must not
   * swallow the newer one — the rule advances past the LATEST date handled, and
   * the rest stays owing.
   */
  it('leaves the occurrences that were not accepted still owing', () => {
    const db = seed();
    rent(db);

    const { proposals } = dueProposals(db, '2026-03-15');
    postProposals(db, proposals.slice(0, 1));

    expect(dueProposals(db, '2026-03-15').proposals.map((p) => p.occurredOn)).toEqual([
      '2026-02-01',
      '2026-03-01',
    ]);
  });
});

/**
 * A month you did not actually pay is a real thing — a paused subscription, a
 * salary that came late. Skipping has to be as easy as accepting.
 */
describe('skipping proposals', () => {
  it('writes nothing and still moves the rule on', () => {
    const db = seed();
    rent(db);

    skipProposals(db, dueProposals(db, '2026-02-15').proposals);

    expect(periodSummary(db, '2026-01').expenseMinor).toBe(0);
    expect(dueProposals(db, '2026-02-15').proposals).toEqual([]);
  });
});

describe('catch-up on app open', () => {
  it('posts what the user trusts and holds back the rest', () => {
    const db = seed();
    rent(db, { id: 'rule-rent', autoPost: true });
    createRule(db, {
      id: 'rule-gym',
      name: 'Gym',
      type: 'expense',
      accountId: 'bank',
      categoryId: 'installments',
      amountMinor: 30_000,
      frequency: 'monthly',
      startsOn: '2026-01-10',
      autoPost: false,
    });

    const { proposals } = catchUp(db, '2026-01-31');

    // Rent landed by itself; the gym is waiting to be looked at.
    expect(periodSummary(db, '2026-01').expenseMinor).toBe(-500_000);
    expect(proposals.map((p) => p.ruleId)).toEqual(['rule-gym']);
    // The un-posted rule still proposes January, because nothing has dealt
    // with it.
    expect(dueProposals(db, '2026-01-31').proposals.map((p) => p.ruleId)).toContain('rule-gym');
  });

  it('is safe to run repeatedly', () => {
    const db = seed();
    rent(db, { autoPost: true });

    catchUp(db, '2026-02-15');
    catchUp(db, '2026-02-15');
    catchUp(db, '2026-02-15');

    expect(periodSummary(db, '2026-01').expenseMinor).toBe(-500_000);
    expect(periodSummary(db, '2026-02').expenseMinor).toBe(-500_000);
  });

  it('stops for good once the rule has ended', () => {
    const db = seed();
    rent(db, { autoPost: true, endsOn: '2026-02-01' });

    catchUp(db, '2026-06-01');

    expect(periodSummary(db, '2026-03').expenseMinor).toBe(0);
    expect(dueProposals(db, '2027-01-01').proposals).toEqual([]);
    expect(nextProposalDate(db, getRule(db, 'rule-rent')!, '2026-06-01')).toBeNull();
  });
});

describe('listing', () => {
  it('returns the rules', () => {
    const db = seed();
    rent(db);
    expect(listRules(db).map((r) => r.name)).toEqual(['Rent']);
  });
});

/**
 * What is already spoken for, in whatever month is being looked at. Most of why
 * anyone writes a rule down is to see next month's rent in next month's list.
 */
describe('upcoming occurrences', () => {
  it('shows a monthly rule in a future month', () => {
    const db = seed();
    rent(db);
    expect(upcomingProposals(db, '2026-04', '2026-01-15').map((p) => p.occurredOn)).toEqual([
      '2026-04-01',
    ]);
  });

  it('shows the rest of the current month, but not what has already passed', () => {
    const db = seed();
    rent(db, { frequency: 'weekly', startsOn: '2026-01-05' });

    // Standing on the 15th: the 5th and 12th are behind and belong to `due`.
    const dates = upcomingProposals(db, '2026-01', '2026-01-15').map((p) => p.occurredOn);
    expect(dates).toEqual(['2026-01-19', '2026-01-26']);
  });

  /**
   * The overlap that would show one payment twice. An occurrence falling TODAY
   * is owed, so it belongs to `dueProposals` — listing it here as well would
   * put the same row on screen in two sections.
   */
  it('excludes an occurrence falling exactly today', () => {
    const db = seed();
    rent(db);

    expect(dueProposals(db, '2026-02-01').proposals.map((p) => p.occurredOn)).toContain(
      '2026-02-01'
    );
    expect(upcomingProposals(db, '2026-02', '2026-02-01').map((p) => p.occurredOn)).not.toContain(
      '2026-02-01'
    );
  });

  it('stays inside the month it was asked about', () => {
    const db = seed();
    rent(db);
    const dates = upcomingProposals(db, '2026-03', '2026-01-15').map((p) => p.occurredOn);
    expect(dates).toEqual(['2026-03-01']);
  });

  it('ignores a paused rule', () => {
    const db = seed();
    rent(db);
    setRuleActive(db, 'rule-rent', false);
    expect(upcomingProposals(db, '2026-04', '2026-01-15')).toEqual([]);
  });

  it('stops at the rule end date', () => {
    const db = seed();
    rent(db, { endsOn: '2026-02-28' });
    expect(upcomingProposals(db, '2026-04', '2026-01-15')).toEqual([]);
  });

  it('lists several occurrences of a frequent rule in date order', () => {
    const db = seed();
    rent(db, { frequency: 'weekly', startsOn: '2026-01-01' });
    const dates = upcomingProposals(db, '2026-03', '2026-01-15').map((p) => p.occurredOn);
    expect(dates).toEqual([...dates].sort());
    expect(dates.length).toBeGreaterThan(3);
  });
});

/**
 * EVERY OCCURRENCE IS INDEPENDENT. This replaced a `next_run_on` cursor, which
 * could only say "handled up to here" — so occurrences had to be dealt with in
 * order, and acting out of order had to be forbidden. That constraint came from
 * the storage, not from anything true about standing orders.
 */
describe('occurrences are independent', () => {
  it('accepts a later one while an earlier one is still waiting', () => {
    const db = seed();
    rent(db);

    const all = dueProposals(db, '2026-03-15').proposals;
    const march = all.find((p) => p.occurredOn === '2026-03-01')!;
    postProposals(db, [march]);

    expect(periodSummary(db, '2026-03').expenseMinor).toBe(-500_000);
    // January and February are untouched and still proposed.
    expect(dueProposals(db, '2026-03-15').proposals.map((p) => p.occurredOn)).toEqual([
      '2026-01-01',
      '2026-02-01',
    ]);
  });

  it('skips one in the middle without disturbing the others', () => {
    const db = seed();
    rent(db);

    const february = dueProposals(db, '2026-03-15').proposals.find(
      (p) => p.occurredOn === '2026-02-01'
    )!;
    skipProposals(db, [february]);

    expect(dueProposals(db, '2026-03-15').proposals.map((p) => p.occurredOn)).toEqual([
      '2026-01-01',
      '2026-03-01',
    ]);
  });

  it('never proposes the same occurrence twice, whatever the order', () => {
    const db = seed();
    rent(db);

    const all = dueProposals(db, '2026-03-15').proposals;
    postProposals(db, [all[2]]);
    postProposals(db, [all[0]]);
    skipProposals(db, [all[1]]);

    expect(dueProposals(db, '2026-03-15').proposals).toEqual([]);
    // Two records, not three: the skipped month wrote nothing.
    expect(periodSummary(db, '2026-02').expenseMinor).toBe(0);
  });

  it('refuses to approve the same occurrence twice', () => {
    // The second write would look exactly like a real second payment.
    const db = seed();
    rent(db);
    const january = dueProposals(db, '2026-01-15').proposals[0];

    expect(postProposals(db, [january])).toBe(1);
    expect(postProposals(db, [january])).toBe(0);
    expect(periodSummary(db, '2026-01').expenseMinor).toBe(-500_000);
  });
});
