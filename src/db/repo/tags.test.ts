/**
 * @jest-environment node
 */
import { EMPTY_QUERY, type SearchQuery } from '../../lib/search-query';
import { createTestDb, type TestDb } from '../../test/db';
import { createAccount } from './accounts';
import { categoryBreakdown } from './analysis';
import { createCategory, InvariantError } from './categories';
import { listRecordsForPeriod, periodSummary } from './records';
import { searchRecords } from './search';
import {
  ensureTag,
  listTags,
  renameTag,
  setRecordTags,
  setTagArchived,
  tagBreakdown,
  tagUsage,
  tagsForRecord,
} from './tags';
import { createRecord, createTransfer, deleteRecord } from './transactions';

const on = (day: number) => new Date(2026, 7, day, 12, 0);
const PERIOD = '2026-08';
const q = (over: Partial<SearchQuery> = {}): SearchQuery => ({ ...EMPTY_QUERY, ...over });

function seed() {
  const { db } = createTestDb();
  createAccount(db, { id: 'bank', name: 'Bank', currency: 'EGP' });
  createAccount(db, { id: 'cash', name: 'Cash', currency: 'EGP' });
  createCategory(db, { id: 'home', name: 'Home', kind: 'expense' });
  createCategory(db, { id: 'food', name: 'Food', kind: 'expense' });
  createCategory(db, { id: 'salary', name: 'Salary', kind: 'income' });
  return db;
}

const buy = (db: TestDb, id: string, categoryId: string, minor: number, day: number) =>
  createRecord(db, {
    id,
    accountId: 'bank',
    categoryId,
    type: 'expense',
    amountMinor: minor,
    occurredAt: on(day),
  });

describe('one project is one tag', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
  });

  it('returns the existing tag rather than making a second', () => {
    // "Kitchen" and "kitchen" as two rows splits the project's total in half
    // and neither figure is wrong in any way a person could spot.
    const first = ensureTag(db, 'Kitchen');
    const again = ensureTag(db, '  KITCHEN ');
    expect(again.id).toBe(first.id);
    expect(listTags(db)).toHaveLength(1);
  });

  it('keeps the name as it was first typed', () => {
    ensureTag(db, 'Kitchen Reno');
    expect(ensureTag(db, 'kitchen reno').name).toBe('Kitchen Reno');
  });

  it('refuses a name that is not one', () => {
    expect(() => ensureTag(db, '   ')).toThrow(InvariantError);
    expect(() => ensureTag(db, 'x'.repeat(64))).toThrow(InvariantError);
  });

  it('gives an archived tag back rather than failing on the unique index', () => {
    // Re-using a finished project's name almost always means the same project,
    // and the alternative is an error about a tag the picker never showed.
    const tag = ensureTag(db, 'Wedding');
    setTagArchived(db, tag.id, true);
    expect(ensureTag(db, 'wedding').id).toBe(tag.id);
  });
});

describe('renaming', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
  });

  it('keeps every record that carried it', () => {
    const tag = ensureTag(db, 'Kitchen');
    buy(db, 'tiles', 'home', 50_000, 3);
    setRecordTags(db, 'tiles', [tag.id]);

    renameTag(db, tag.id, 'Kitchen reno');
    expect(tagsForRecord(db, 'tiles').map((t) => t.name)).toEqual(['Kitchen reno']);
  });

  it('refuses to rename one tag onto another', () => {
    // That is a MERGE — every record of one silently becomes a record of the
    // other — and it is a different operation with different consequences.
    const kitchen = ensureTag(db, 'Kitchen');
    ensureTag(db, 'Bathroom');
    expect(() => renameTag(db, kitchen.id, 'bathroom')).toThrow(InvariantError);
  });

  it('allows a rename that only changes the case', () => {
    // The clash is with ITSELF, which is not a clash.
    const tag = ensureTag(db, 'kitchen');
    expect(renameTag(db, tag.id, 'Kitchen').name).toBe('Kitchen');
  });
});

describe('archiving', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
  });

  it('takes it out of the picker and leaves it on its records', () => {
    // The whole reason tags exist rather than sub-categories: a project ends,
    // and its spending was still part of it.
    const tag = ensureTag(db, 'Wedding');
    buy(db, 'cake', 'food', 80_000, 3);
    setRecordTags(db, 'cake', [tag.id]);

    setTagArchived(db, tag.id, true);

    expect(listTags(db)).toEqual([]);
    expect(listTags(db, { includeArchived: true })).toHaveLength(1);
    expect(tagsForRecord(db, 'cake').map((t) => t.name)).toEqual(['Wedding']);
    // ...and still findable, which is the point of keeping it.
    expect(searchRecords(db, q({ tagIds: [tag.id] })).matchCount).toBe(1);
  });
});

describe('assigning', () => {
  let db: TestDb;
  beforeEach(() => {
    db = seed();
  });

  it('replaces rather than adds', () => {
    const a = ensureTag(db, 'kitchen');
    const b = ensureTag(db, 'urgent');
    buy(db, 'tiles', 'home', 50_000, 3);

    setRecordTags(db, 'tiles', [a.id, b.id]);
    expect(tagsForRecord(db, 'tiles')).toHaveLength(2);

    setRecordTags(db, 'tiles', [b.id]);
    expect(tagsForRecord(db, 'tiles').map((t) => t.name)).toEqual(['urgent']);

    setRecordTags(db, 'tiles', []);
    expect(tagsForRecord(db, 'tiles')).toEqual([]);
  });

  it('ignores a repeated id rather than failing on the primary key', () => {
    const tag = ensureTag(db, 'kitchen');
    buy(db, 'tiles', 'home', 50_000, 3);
    setRecordTags(db, 'tiles', [tag.id, tag.id]);
    expect(tagsForRecord(db, 'tiles')).toHaveLength(1);
  });

  it('goes away with the record it was on', () => {
    const tag = ensureTag(db, 'kitchen');
    buy(db, 'tiles', 'home', 50_000, 3);
    setRecordTags(db, 'tiles', [tag.id]);

    deleteRecord(db, 'tiles');

    // The join row cascades; the TAG does not. A label nobody chose is still a
    // label you may choose again.
    expect(tagUsage(db, [tag.id]).get(tag.id)).toBeUndefined();
    expect(listTags(db)).toHaveLength(1);
  });

  it('reports how many records carry each tag', () => {
    const tag = ensureTag(db, 'kitchen');
    buy(db, 'tiles', 'home', 50_000, 3);
    buy(db, 'paint', 'home', 20_000, 4);
    setRecordTags(db, 'tiles', [tag.id]);
    setRecordTags(db, 'paint', [tag.id]);
    expect(tagUsage(db, [tag.id]).get(tag.id)).toBe(2);
  });
});

describe('a tag is a filter, never a total', () => {
  let db: TestDb;
  let kitchen: string;
  beforeEach(() => {
    db = seed();
    kitchen = ensureTag(db, 'kitchen').id;
    buy(db, 'tiles', 'home', 50_000, 3);
    buy(db, 'lunch', 'food', 10_000, 4);
    setRecordTags(db, 'tiles', [kitchen]);
  });

  it('changes no figure on any other screen', () => {
    // Tagging is a label, not money. If any of these moved, tags would have
    // become a second dimension of the ledger that can disagree with the first.
    const before = periodSummary(db, PERIOD);
    setRecordTags(db, 'lunch', [kitchen]);
    expect(periodSummary(db, PERIOD)).toEqual(before);
  });

  it('does not double-count a record carrying two tags', () => {
    // The trap an inner join would spring: one row, counted once per label.
    const urgent = ensureTag(db, 'urgent').id;
    setRecordTags(db, 'tiles', [kitchen, urgent]);

    const filtered = categoryBreakdown(db, PERIOD, 'expense', 'EGP', kitchen);
    expect(filtered.totalMinor).toBe(50_000);
  });
});

describe('the analysis breakdown', () => {
  let db: TestDb;
  let kitchen: string;
  let urgent: string;
  beforeEach(() => {
    db = seed();
    kitchen = ensureTag(db, 'kitchen').id;
    urgent = ensureTag(db, 'urgent').id;
    buy(db, 'tiles', 'home', 50_000, 3);
    buy(db, 'paint', 'home', 20_000, 4);
    buy(db, 'lunch', 'food', 10_000, 5);
    setRecordTags(db, 'tiles', [kitchen, urgent]);
    setRecordTags(db, 'paint', [kitchen]);
  });

  it('adds up each tag and counts its records', () => {
    const totals = tagBreakdown(db, PERIOD, 'expense');
    expect(totals).toEqual([
      { id: kitchen, name: 'kitchen', amountMinor: 70_000, recordCount: 2 },
      { id: urgent, name: 'urgent', amountMinor: 50_000, recordCount: 1 },
    ]);
  });

  it('deliberately does NOT add up to the month', () => {
    // The reason this is a list and not a ring: `tiles` is in both tags, and
    // `lunch` is in neither. Slices of these would overlap each other AND
    // leave a remainder — a legend that cannot sum to 100.
    const totals = tagBreakdown(db, PERIOD, 'expense');
    const summed = totals.reduce((n, t) => n + t.amountMinor, 0);
    const month = Math.abs(periodSummary(db, PERIOD).expenseMinor);
    expect(summed).toBe(120_000);
    expect(month).toBe(80_000);
    expect(summed).not.toBe(month);
  });

  it('lets the RING stay honest by filtering it instead', () => {
    // Within a tag, categories are still exclusive and still cover everything
    // shown — so the slices sum to the total and the percentages can reach 100.
    const filtered = categoryBreakdown(db, PERIOD, 'expense', 'EGP', kitchen);
    expect(filtered.totalMinor).toBe(70_000);
    expect(filtered.slices.reduce((n, s) => n + s.amountMinor, 0)).toBe(filtered.totalMinor);
  });

  it('keeps transfers out, as the ring above it does', () => {
    // A tag on money moved between your own accounts is a real label, and it is
    // not spending. Counting it here would put a figure on this screen that no
    // other screen agrees with.
    const { out } = createTransfer(db, {
      fromAccountId: 'bank',
      toAccountId: 'cash',
      amountMinor: 90_000,
      occurredAt: on(6),
    });
    setRecordTags(db, out.id, [kitchen]);

    const totals = tagBreakdown(db, PERIOD, 'expense');
    expect(totals.find((t) => t.id === kitchen)!.amountMinor).toBe(70_000);
  });

  it('ranks by amount, ties broken by name', () => {
    // The same data must never reorder itself between two renders.
    const a = ensureTag(db, 'zeta').id;
    const b = ensureTag(db, 'alpha').id;
    buy(db, 'x', 'food', 5_000, 6);
    buy(db, 'y', 'food', 5_000, 7);
    setRecordTags(db, 'x', [a]);
    setRecordTags(db, 'y', [b]);

    const names = tagBreakdown(db, PERIOD, 'expense').map((t) => t.name);
    expect(names.indexOf('alpha')).toBeLessThan(names.indexOf('zeta'));
  });
});

describe('searching by tag', () => {
  let db: TestDb;
  let kitchen: string;
  let urgent: string;
  beforeEach(() => {
    db = seed();
    kitchen = ensureTag(db, 'Kitchen').id;
    urgent = ensureTag(db, 'Urgent').id;
    buy(db, 'tiles', 'home', 50_000, 3);
    buy(db, 'paint', 'home', 20_000, 4);
    buy(db, 'lunch', 'food', 10_000, 5);
    setRecordTags(db, 'tiles', [kitchen, urgent]);
    setRecordTags(db, 'paint', [kitchen]);
  });

  it('finds every record carrying it, and totals them', () => {
    // The lifetime figure, which the month-scoped analysis screen cannot give.
    const outcome = searchRecords(db, q({ tagIds: [kitchen] }));
    expect(outcome.matchCount).toBe(2);
    expect(outcome.expenseMinor).toBe(-70_000);
  });

  it('narrows with each tag rather than gathering', () => {
    // AND, like every other control in the panel. `tag_id in (...)` would be OR
    // and the difference is invisible until a record carries only one of them.
    expect(searchRecords(db, q({ tagIds: [kitchen, urgent] })).matchCount).toBe(1);
  });

  it('counts a record once however many of its tags match', () => {
    const rows = searchRecords(db, q({ tagIds: [kitchen] })).rows;
    expect(rows.filter((r) => r.id === 'tiles')).toHaveLength(1);
  });

  it('matches a tag name typed into the box', () => {
    // Without opening the filters, which is how anyone would try it first.
    const outcome = searchRecords(db, q({ text: 'kitchen' }));
    expect(outcome.matchCount).toBe(2);
  });

  it('does not return a record twice when several of its tags match the text', () => {
    const named = ensureTag(db, 'Kitchen extras').id;
    setRecordTags(db, 'tiles', [kitchen, named]);
    const rows = searchRecords(db, q({ text: 'kitchen' })).rows;
    expect(rows.filter((r) => r.id === 'tiles')).toHaveLength(1);
  });

  it('carries the names on the rows themselves', () => {
    const rows = searchRecords(db, q({ tagIds: [kitchen] })).rows;
    expect(rows.find((r) => r.id === 'tiles')!.tags).toEqual(['Kitchen', 'Urgent']);
    expect(rows.find((r) => r.id === 'paint')!.tags).toEqual(['Kitchen']);
  });
});

describe('the records list', () => {
  it('carries the tags too, so the ledger shows them', () => {
    const db = seed();
    const tag = ensureTag(db, 'Kitchen').id;
    buy(db, 'tiles', 'home', 50_000, 3);
    buy(db, 'lunch', 'food', 10_000, 4);
    setRecordTags(db, 'tiles', [tag]);

    const rows = listRecordsForPeriod(db, PERIOD);
    expect(rows.find((r) => r.id === 'tiles')!.tags).toEqual(['Kitchen']);
    expect(rows.find((r) => r.id === 'lunch')!.tags).toEqual([]);
  });
});
