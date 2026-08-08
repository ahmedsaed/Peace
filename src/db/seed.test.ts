/**
 * @jest-environment node
 */
import { eq, isNotNull, isNull } from 'drizzle-orm';

import { createTestDb, type TestDb } from '../test/db';
import { accounts, categories } from './schema';
import { catId, defaultCategories, seedDefaults } from './seed';

describe('seedDefaults', () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb().db;
  });

  it('creates the starter accounts and categories', () => {
    seedDefaults(db);

    expect(db.select().from(accounts).all()).toHaveLength(2);
    expect(db.select().from(categories).all().length).toBeGreaterThan(20);
  });

  it('is idempotent — a second run adds nothing', () => {
    seedDefaults(db);
    const afterFirst = db.select().from(categories).all().length;

    seedDefaults(db);
    seedDefaults(db);

    expect(db.select().from(categories).all()).toHaveLength(afterFirst);
    expect(db.select().from(accounts).all()).toHaveLength(2);
  });

  it('never overwrites a category the user has edited', () => {
    seedDefaults(db);
    db.update(categories)
      .set({ name: 'Groceries & Food', color: '#123456' })
      .where(eq(categories.id, catId('food')))
      .run();

    // A later release re-seeding to add new defaults must not undo this.
    seedDefaults(db);

    const food = db.select().from(categories).where(eq(categories.id, catId('food'))).get();
    expect(food?.name).toBe('Groceries & Food');
    expect(food?.color).toBe('#123456');
  });

  it('gives every child a parent that exists', () => {
    seedDefaults(db);

    const children = db.select().from(categories).where(isNotNull(categories.parentId)).all();
    expect(children.length).toBeGreaterThan(0);

    const ids = new Set(db.select().from(categories).all().map((c) => c.id));
    for (const child of children) {
      expect(ids.has(child.parentId!)).toBe(true);
    }
  });

  it('keeps the hierarchy exactly two levels deep', () => {
    seedDefaults(db);

    const all = db.select().from(categories).all();
    const parentIds = new Set(all.filter((c) => c.parentId).map((c) => c.parentId));

    // Nothing that is itself a child may also be a parent.
    for (const c of all) {
      if (c.parentId) expect(parentIds.has(c.id)).toBe(false);
    }
  });

  it('gives children the same kind as their parent', () => {
    seedDefaults(db);

    const all = db.select().from(categories).all();
    const byId = new Map(all.map((c) => [c.id, c]));

    for (const child of all) {
      if (!child.parentId) continue;
      expect(child.kind).toBe(byId.get(child.parentId)!.kind);
    }
  });

  it('produces both income and expense top-level categories', () => {
    seedDefaults(db);

    const tops = db.select().from(categories).where(isNull(categories.parentId)).all();
    expect(tops.some((c) => c.kind === 'income')).toBe(true);
    expect(tops.some((c) => c.kind === 'expense')).toBe(true);
  });

  it('uses the home currency for seeded accounts', () => {
    seedDefaults(db, 'USD');
    expect(db.select().from(accounts).all().every((a) => a.currency === 'USD')).toBe(true);
  });

  it('has no duplicate ids in the seed data itself', () => {
    const cats = defaultCategories();
    expect(new Set(cats.map((c) => c.id)).size).toBe(cats.length);
  });
});
