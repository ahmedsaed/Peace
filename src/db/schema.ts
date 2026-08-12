import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * Money is ALWAYS stored as an integer number of minor units (cents, piastres...).
 * Never store money as a float — 0.1 + 0.2 !== 0.3 and rounding drift in a ledger
 * is unrecoverable. Convert at the display boundary only, via src/lib/money.ts.
 *
 * Timestamps are epoch milliseconds. Dates that mean "a calendar day" with no
 * time component (a budget period, a recurrence anchor) are stored as text
 * instead, because a timestamp silently drags a timezone along with it.
 */

const now = sql`(unixepoch() * 1000)`;

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type', {
      enum: ['cash', 'bank', 'card', 'savings', 'loan'],
    })
      .notNull()
      .default('cash'),
    /** ISO 4217, e.g. "EGP", "USD" */
    currency: text('currency').notNull().default('EGP'),
    /**
     * Opening balance in minor units. Current balance is derived from
     * transactions.
     *
     * Asset accounts only, in practice. A CARD is set up with its credit limit
     * instead, and whatever is already owed arrives as a dated adjustment — an
     * undated number you cannot see in the list is a bad place to keep a debt,
     * and it would be the one figure on the card that no record explains.
     */
    openingBalance: integer('opening_balance').notNull().default(0),
    /** Annual rate as a decimal (0.185 = 18.5%). Only meaningful for `loan` accounts. */
    interestRate: real('interest_rate'),

    // --- card profile -------------------------------------------------------
    // All nullable, all per-account. There is deliberately no "Kenana mode":
    // one bank's rules hardcoded into the app is a rule every other card would
    // then have to be excused from. A card with none of these set behaves
    // exactly like any other account.

    /** Ceiling on what may be owed, in minor units. A limit, never a balance. */
    creditLimit: integer('credit_limit'),
    /**
     * Fees as BASIS POINTS — 3% is 300 — because a percentage stored as a float
     * and multiplied by money reintroduces exactly the drift `amount_minor`
     * exists to prevent. 3% of E£1,246.83 must be one exact integer, every time.
     */
    foreignFeeBp: integer('foreign_fee_bp'),
    cashFeeBp: integer('cash_fee_bp'),
    /** Day of month the statement closes, and the day payment is due. 1–28. */
    statementDay: integer('statement_day'),
    dueDay: integer('due_day'),
    icon: text('icon'),
    color: text('color'),
    sortOrder: integer('sort_order').notNull().default(0),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (table) => [index('idx_accounts_sort').on(table.archived, table.sortOrder)]
);

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /**
     * A category is income XOR expense — never both. This mirrors the two
     * separate lists in the reference app, and it is what lets the picker show
     * only relevant options once the user has chosen a record type.
     */
    kind: text('kind', { enum: ['expense', 'income'] })
      .notNull()
      .default('expense'),
    /**
     * Two-tier only. A child's parent must itself have no parent — enforced in
     * application code, since SQLite cannot express "depth <= 2" as a constraint.
     * A child must also share its parent's `kind`.
     */
    parentId: text('parent_id').references((): AnySQLiteColumn => categories.id, {
      onDelete: 'set null',
    }),
    icon: text('icon'),
    color: text('color'),
    sortOrder: integer('sort_order').notNull().default(0),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (table) => [
    index('idx_categories_kind').on(table.kind, table.archived, table.sortOrder),
    index('idx_categories_parent').on(table.parentId),
  ]
);

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /** NULL for transfers — a transfer has no category by definition. */
    categoryId: text('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    /**
     * Signed minor units: negative = money out, positive = money in.
     * A single signed column keeps SUM() over an account trivial.
     */
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull().default('EGP'),
    /**
     * How many HOME-currency major units one major unit of `currency` was worth
     * when this was entered. 1 when the record is already in home currency.
     *
     * Captured per record rather than looked up: a purchase made when the
     * dollar was fifty pounds stays at fifty forever. Re-converting history at
     * today's rate would silently rewrite what last month cost.
     */
    fxRate: real('fx_rate').notNull().default(1),
    /**
     * `amountMinor` converted to the home currency, in ITS minor units.
     *
     * Stored rather than computed, because every report sums it and
     * `amount * rate` is float arithmetic — doing it per row at read time is
     * how drift gets into totals. Money stays integer minor units here as
     * everywhere else.
     *
     * NULL means "no conversion applies", i.e. the record is already in the
     * home currency. That is what makes this column addable without touching a
     * single existing row: every record written before multi-currency existed
     * was in the home currency by definition, so NULL is already the right
     * answer for all of them. Read it as
     * `COALESCE(home_amount_minor, amount_minor)`.
     */
    homeAmountMinor: integer('home_amount_minor'),
    /**
     * WHICH home currency `homeAmountMinor` is expressed in.
     *
     * Without this, changing the home currency silently relabels history: a
     * record converted to pounds would be summed into a dollar total and shown
     * with a dollar sign. The conversion is only meaningful against the
     * currency it was made for, so that currency has to travel with it.
     *
     * NULL alongside a NULL amount means "written before this existed, in
     * whatever the home currency was then" — those records are valued only when
     * their own currency still matches today's home currency.
     */
    homeCurrency: text('home_currency'),
    /**
     * WHAT YOU ACTUALLY HANDED OVER ABROAD. Metadata, never summed.
     *
     * A card denominated in EGP and used in Rome is charged in EGP at the
     * bank's rate, so `amount_minor` — the number that moves the account — must
     * be the settled EGP. Store the euros there instead and the card balance
     * can never agree with the statement, which is a permanent, guaranteed
     * drift.
     *
     * That leaves nowhere to answer "what did this cost in euros", hence these.
     * They exist to be read back, never to be added up.
     *
     * Three pairs of currency fields now hang off a row, so to be explicit:
     *   currency + amountMinor          what moved the ACCOUNT
     *   homeCurrency + homeAmountMinor  what it is worth for REPORTING
     *   originalCurrency + originalAmountMinor   what was HANDED OVER
     */
    originalAmountMinor: integer('original_amount_minor'),
    originalCurrency: text('original_currency'),

    /**
     * Set on a card fee, pointing at the purchase that incurred it.
     *
     * A foreign-transaction commission is a real, permanent cost and gets its
     * own row so "what did FX cost me this year" stays answerable — folded into
     * the purchase it would be invisible for ever and would overstate whatever
     * category the purchase was filed under.
     *
     * Cascade so a deleted purchase cannot leave its fee behind. `deleteRecord`
     * also collects the fee explicitly, because the undo buffer has to be able
     * to put BOTH back — a cascade the undo does not know about is silent data
     * loss the moment someone taps Undo.
     */
    feeForId: text('fee_for_id'),

    note: text('note'),

    /**
     * TRANSFERS ARE TWO ROWS.
     *
     * A transfer writes one negative row on the source account and one positive
     * row on the destination, sharing a `transfer_pair_id`. Per-account balance
     * therefore stays a plain `SUM(amount_minor) WHERE account_id = ?` with no
     * special cases — which is why this shape was chosen over a single row.
     *
     * Two consequences every query must respect:
     *   1. The records list renders only the NEGATIVE leg, or every transfer
     *      appears twice.
     *   2. Income/expense totals must exclude rows where this is non-NULL.
     *      A transfer is neither, and summing it inflates both sides.
     */
    transferPairId: text('transfer_pair_id'),

    /**
     * A BALANCE CORRECTION, not spending.
     *
     * Cards drift: the bank's rate differs from the one estimated, a fee posts
     * that was not anticipated, a record gets forgotten. An adjustment moves the
     * account to the figure the bank actually shows.
     *
     * It moves the BALANCE and the running position — it is real money, and
     * pretending otherwise would put the Accounts screen and the Records header
     * permanently at odds. It must never touch income or expense: a correction
     * is not a purchase, and counting it would put a category's worth of
     * phantom spending into whichever month you happened to reconcile in.
     *
     * That makes two different "not ordinary spending" conditions in one table,
     * which is precisely the shape that gets forgotten in one query out of six.
     * Neither is ever written by hand — see `src/db/repo/predicates.ts`.
     */
    isAdjustment: integer('is_adjustment', { mode: 'boolean' }).notNull().default(false),

    /**
     * MONEY COMING BACK ON THE EXPENSE SIDE.
     *
     * Return E£800 of shoes and log it as Income, and that month reports E£800
     * more income than you earned AND E£800 more expense than you spent. The
     * net comes out right, which is why it survives — but every category
     * breakdown is a lie, and Clothing keeps a purchase that was undone.
     *
     * A refund is a POSITIVE amount on an EXPENSE-kind row. That breaks the
     * rule the ledger has relied on since the first commit — that the sign of
     * `amount_minor` tells you which side a row belongs to — so the side is now
     * decided by `onExpenseSide` / `onIncomeSide` in predicates.ts, and never by
     * a bare sign test again.
     *
     * Not to be confused with lending someone money: that was never spending,
     * and belongs in an account of its own so the balance shows what you are
     * owed.
     */
    isRefund: integer('is_refund', { mode: 'boolean' }).notNull().default(false),
    /**
     * The other account in a transfer, denormalised onto BOTH legs.
     * Redundant with the sibling row, but it lets the records list render
     * "Bank → Credit Card" without a self-join on its hottest query.
     */
    counterAccountId: text('counter_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),

    /** Set when this row was materialised from a recurring rule. */
    recurringRuleId: text('recurring_rule_id').references(() => recurringRules.id, {
      onDelete: 'set null',
    }),

    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (table) => [
    // The queries this app makes constantly: "recent records", "this account's
    // history", and "spend per category this month".
    index('idx_tx_occurred_at').on(table.occurredAt),
    index('idx_tx_account_occurred').on(table.accountId, table.occurredAt),
    index('idx_tx_category_occurred').on(table.categoryId, table.occurredAt),
    index('idx_tx_transfer_pair').on(table.transferPairId),
    index('idx_tx_recurring').on(table.recurringRuleId),
  ]
);

// ---------------------------------------------------------------------------
// Budgets — one limit per (category, month)
// ---------------------------------------------------------------------------

export const budgets = sqliteTable(
  'budgets',
  {
    id: text('id').primaryKey(),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    /**
     * Calendar month as "YYYY-MM". Text rather than a timestamp because a budget
     * belongs to a month, not an instant — and this sorts and ranges correctly
     * as a string without any timezone involvement.
     */
    period: text('period').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull().default('EGP'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (table) => [
    // One budget per category per month. This is what makes "copy last month's
    // budgets" an upsert rather than a de-duplication problem.
    uniqueIndex('idx_budgets_category_period').on(table.categoryId, table.period),
    index('idx_budgets_period').on(table.period),
  ]
);

// ---------------------------------------------------------------------------
// Recurring rules
// ---------------------------------------------------------------------------

export const recurringRules = sqliteTable(
  'recurring_rules',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    type: text('type', { enum: ['expense', 'income', 'transfer'] })
      .notNull()
      .default('expense'),

    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /** Destination account when `type` is 'transfer'. */
    counterAccountId: text('counter_account_id').references(() => accounts.id, {
      onDelete: 'cascade',
    }),
    categoryId: text('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),

    /** Unsigned; the sign is derived from `type` when the row is materialised. */
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull().default('EGP'),
    fxRate: real('fx_rate').notNull().default(1),
    note: text('note'),

    frequency: text('frequency', {
      enum: ['daily', 'weekly', 'monthly', 'yearly'],
    })
      .notNull()
      .default('monthly'),
    /** Every N periods — 1 = every month, 3 = quarterly. */
    interval: integer('interval').notNull().default(1),
    /**
     * Weekly: day of week, 0 = Sunday. Monthly/yearly: day of month.
     * A monthly rule anchored to 31 fires on the last day of shorter months —
     * clamping is the materialiser's job, not the schema's.
     */
    anchorDay: integer('anchor_day'),

    /** Calendar days as "YYYY-MM-DD" — these are dates, not instants. */
    startsOn: text('starts_on').notNull(),
    endsOn: text('ends_on'),
    /** Next occurrence not yet materialised. NULL once the rule is exhausted. */
    nextRunOn: text('next_run_on'),
    lastRunOn: text('last_run_on'),

    /**
     * When false (the default) generated records land in a review queue instead
     * of being written straight to the ledger. A wrong rule that posts silently
     * corrupts history in a way that is tedious to unpick.
     */
    autoPost: integer('auto_post', { mode: 'boolean' }).notNull().default(false),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),

    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (table) => [
    // Drives the catch-up pass on app open: "rules due on or before today".
    index('idx_recurring_due').on(table.active, table.nextRunOn),
  ]
);

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    transactionId: text('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    /**
     * File name RELATIVE to the app's document directory — never an absolute
     * path. The sandbox path changes between installs and OS updates, so a
     * stored absolute path turns every old receipt into a broken image.
     */
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    /** Content hash, so re-attaching the same receipt does not store it twice. */
    sha256: text('sha256'),
    width: integer('width'),
    height: integer('height'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (table) => [index('idx_attachments_tx').on(table.transactionId)]
);

// ---------------------------------------------------------------------------
// Settings — key/value
// ---------------------------------------------------------------------------

/**
 * Key/value so adding a preference never needs a migration.
 *
 * NOTHING SECRET GOES HERE. This table is included in backup and export files.
 * The Gemini API key belongs in expo-secure-store (Android Keystore), not in
 * SQLite. See src/db/settings.ts for the typed accessors and known keys.
 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
});

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

/**
 * The investment side, and DELIBERATELY SEPARATE FROM THE LEDGER.
 *
 * A holding is not an account and buying units is not a transaction: nothing
 * here moves an account balance, appears in income or expense, or reaches the
 * Accounts total. It is a rebalancing tool that happens to live in this app,
 * with its own tables and its own arithmetic.
 *
 * Stated here because the temptation to wire the two together will come back —
 * portfolio value looks a lot like net worth — and the moment it does, every
 * total on every other screen starts moving with the market.
 */
export const assetClasses = sqliteTable(
  'asset_classes',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /**
     * BASIS POINTS, so "the targets must add up to 100%" is an exact integer
     * comparison against 10000 rather than a float tolerance. Same reasoning as
     * `foreign_fee_bp` on an account.
     */
    targetBp: integer('target_bp').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (table) => [index('idx_asset_classes_sort').on(table.sortOrder)]
);

export const holdings = sqliteTable(
  'holdings',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    assetClassId: text('asset_class_id')
      .notNull()
      // Deleting a class takes its holdings with it. The alternative — orphans
      // belonging to no class — would silently drop out of every total while
      // still being listed as owned.
      .references(() => assetClasses.id, { onDelete: 'cascade' }),
    /**
     * Units scaled by 1e6. You can hold 12.347 of a fund, and a float would be
     * the same mistake as a float amount of money — see `src/lib/portfolio.ts`.
     */
    unitsMicro: integer('units_micro').notNull().default(0),
    /** Minor units of the home currency, per ONE whole unit. */
    priceMinor: integer('price_minor').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (table) => [index('idx_holdings_class').on(table.assetClassId)]
);

// ---------------------------------------------------------------------------

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
export type RecurringRule = typeof recurringRules.$inferSelect;
export type NewRecurringRule = typeof recurringRules.$inferInsert;
export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type AssetClassRow = typeof assetClasses.$inferSelect;
export type NewAssetClassRow = typeof assetClasses.$inferInsert;
export type HoldingRow = typeof holdings.$inferSelect;
export type NewHoldingRow = typeof holdings.$inferInsert;
