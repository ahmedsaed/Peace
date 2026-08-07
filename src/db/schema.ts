import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Money is ALWAYS stored as an integer number of minor units (cents, piastres...).
 * Never store money as a float — 0.1 + 0.2 !== 0.3 and rounding drift in a ledger
 * is unrecoverable. Convert at the display boundary only.
 */

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** cash | bank | card | savings */
  type: text('type').notNull().default('cash'),
  /** ISO 4217, e.g. "EGP", "USD" */
  currency: text('currency').notNull().default('USD'),
  /** Opening balance in minor units. Current balance is derived from transactions. */
  openingBalance: integer('opening_balance').notNull().default(0),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** 'expense' | 'income' */
  kind: text('kind').notNull().default('expense'),
  /** Emoji or icon name */
  icon: text('icon'),
  color: text('color'),
  /** Optional monthly budget cap in minor units */
  budgetMinor: integer('budget_minor'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    categoryId: text('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    /**
     * Signed minor units: negative = money out, positive = money in.
     * A single signed column keeps SUM() queries trivial.
     */
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull().default('USD'),
    /** Rate to the account currency at time of entry; 1 for same-currency. */
    fxRate: real('fx_rate').notNull().default(1),
    note: text('note'),
    /** For transfers: the paired transaction on the other account. */
    transferPairId: text('transfer_pair_id'),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    // The two queries this app makes constantly: "recent transactions" and
    // "spend per category this month".
    index('idx_tx_occurred_at').on(table.occurredAt),
    index('idx_tx_account_occurred').on(table.accountId, table.occurredAt),
    index('idx_tx_category').on(table.categoryId),
  ]
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
