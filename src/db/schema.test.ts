/**
 * @jest-environment node
 */
import { eq, sql } from 'drizzle-orm';

import { createTestDb, type TestDb } from '../test/db';
import { budgets, categories, transactions } from './schema';
import { accountId, catId, seedDefaults } from './seed';

/**
 * These exercise the invariants documented on the schema. They are the reason
 * the schema shape was chosen, so if one breaks the design has drifted — not
 * just the code.
 */
describe('schema invariants', () => {
  let db: TestDb;
  const CASH = accountId('cash');

  beforeEach(() => {
    db = createTestDb().db;
    seedDefaults(db);
  });

  // Transfers as paired rows are proven through the code that writes and reads
  // them, not through SQL written in this file: two legs sharing a pair id and
  // a net of zero in repo.test.ts ('transfers'), kept out of income and expense
  // by `periodSummary` and listed once, as the outgoing leg naming both
  // accounts, by `listRecordsForPeriod` in records.test.ts.

  describe('referential integrity', () => {
    beforeEach(() => {
      db.insert(transactions)
        .values({
          id: 'tx-1',
          accountId: CASH,
          categoryId: catId('food'),
          amountMinor: -8000,
          occurredAt: new Date('2026-08-05'),
        })
        .run();
    });

    it('deletes an account together with its transactions', () => {
      db.run(sql`delete from accounts where id = ${CASH}`);

      expect(db.select().from(transactions).all()).toHaveLength(0);
    });

    it('keeps the transaction when its category is deleted', () => {
      // Losing a category must never lose the money — the row survives
      // uncategorised, which is why this is SET NULL rather than CASCADE.
      db.run(sql`delete from categories where id = ${catId('food')}`);

      const rows = db.select().from(transactions).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].categoryId).toBeNull();
    });

    it('orphans a subcategory rather than deleting it', () => {
      db.run(sql`delete from categories where id = ${catId('food')}`);

      const groceries = db
        .select()
        .from(categories)
        .where(eq(categories.id, catId('groceries')))
        .get();

      expect(groceries).toBeDefined();
      expect(groceries!.parentId).toBeNull();
    });

    it('rejects a transaction pointing at a missing account', () => {
      expect(() =>
        db
          .insert(transactions)
          .values({
            id: 'tx-bad',
            accountId: 'does-not-exist',
            amountMinor: -100,
            occurredAt: new Date(),
          })
          .run()
      ).toThrow(/FOREIGN KEY/i);
    });
  });

  describe('budgets', () => {
    it('allows one budget per category per month', () => {
      db.insert(budgets)
        .values({
          id: 'b1',
          categoryId: catId('food'),
          period: '2026-08',
          amountMinor: 250_000,
        })
        .run();

      expect(() =>
        db
          .insert(budgets)
          .values({
            id: 'b2',
            categoryId: catId('food'),
            period: '2026-08',
            amountMinor: 300_000,
          })
          .run()
      ).toThrow(/UNIQUE/i);
    });

    it('allows the same category in a different month', () => {
      db.insert(budgets)
        .values([
          { id: 'b1', categoryId: catId('food'), period: '2026-08', amountMinor: 250_000 },
          { id: 'b2', categoryId: catId('food'), period: '2026-09', amountMinor: 300_000 },
        ])
        .run();

      expect(db.select().from(budgets).all()).toHaveLength(2);
    });

    it('sorts periods correctly as text', () => {
      // "YYYY-MM" is stored as text specifically so ordering and range queries
      // work without any date parsing or timezone involvement.
      const periods = ['2026-09', '2025-12', '2026-01', '2026-10'];
      db.insert(budgets)
        .values(
          periods.map((p, i) => ({
            id: `b${i}`,
            categoryId: catId('food'),
            period: p,
            amountMinor: 1000,
          }))
        )
        .run();

      const sorted = db.select().from(budgets).orderBy(budgets.period).all().map((b) => b.period);
      expect(sorted).toEqual(['2025-12', '2026-01', '2026-09', '2026-10']);
    });
  });
});
