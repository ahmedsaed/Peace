import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import * as schema from './schema';
import { accounts, categories, type NewAccount, type NewCategory } from './schema';

/**
 * First-run defaults.
 *
 * IDs are deterministic (`seed:...`) rather than random, which is what makes
 * seeding idempotent: re-running it is an insert-or-ignore, so adding new
 * defaults in a later release tops up an existing install instead of creating
 * duplicates. Never change an existing seed id — that would orphan any record
 * already pointing at it.
 *
 * `icon` holds a stable slug, not a glyph. The icon set is not chosen yet
 * (see docs/design-system.md); resolving slug -> glyph in code means swapping
 * sets later is a code change rather than a data migration.
 *
 * Colours come from the default category palette in docs/design-system.md,
 * all checked against the `ground` token.
 */

type SeedCategory = Omit<NewCategory, 'id'> & { id: string };

const EXPENSE: [slug: string, name: string, icon: string, color: string][] = [
  ['food', 'Food', 'food', '#B03A3A'],
  ['transport', 'Transportation', 'bus', '#3B4E9E'],
  ['bills', 'Bills', 'receipt', '#6B5B4A'],
  ['installments', 'Installments', 'refresh', '#2E7D46'],
  ['shopping', 'Shopping', 'bag', '#C2622C'],
  ['entertainment', 'Entertainment', 'film', '#2F8A78'],
  ['health', 'Health', 'heart', '#A8475C'],
  ['beauty', 'Beauty', 'flower', '#9C2D6B'],
  ['clothing', 'Clothing', 'shirt', '#C2622C'],
  ['home', 'Home', 'house', '#6B5B4A'],
  ['education', 'Education', 'book', '#2F6FA8'],
  ['car', 'Car', 'car', '#6B4CA8'],
  ['telephone', 'Telephone', 'phone', '#2F6FA8'],
  ['travel', 'Travel', 'plane', '#2F8A78'],
  ['gifts', 'Gifts', 'gift', '#9C2D6B'],
  ['pets', 'Pets', 'paw', '#C99A2E'],
  ['baby', 'Baby', 'bottle', '#A8475C'],
  ['insurance', 'Insurance', 'shield', '#6B5B4A'],
  ['other-expense', 'Other', 'dots', '#6B5B4A'],
];

const INCOME: [slug: string, name: string, icon: string, color: string][] = [
  ['salary', 'Salary', 'wallet', '#2E7D46'],
  ['bonus', 'Bonus', 'star', '#6E8B3D'],
  ['refunds', 'Refunds', 'refresh', '#2F8A78'],
  ['rental', 'Rental', 'key', '#6B4CA8'],
  ['sale', 'Sale', 'tag', '#C99A2E'],
  ['interest', 'Interest', 'percent', '#2F6FA8'],
  ['other-income', 'Other', 'dots', '#6B5B4A'],
];

/**
 * A handful of second-level categories, so the two-tier feature is real from
 * the first launch rather than a column nobody uses. A child MUST share its
 * parent's `kind` and MUST NOT itself be a parent.
 */
const CHILDREN: [slug: string, name: string, parent: string, icon: string][] = [
  ['groceries', 'Groceries', 'food', 'cart'],
  ['restaurants', 'Restaurants', 'food', 'fork'],
  ['coffee', 'Coffee', 'food', 'cup'],
  ['fuel', 'Fuel', 'car', 'fuel'],
  ['taxi', 'Taxi', 'transport', 'taxi'],
  ['electricity', 'Electricity', 'bills', 'bolt'],
  ['internet', 'Internet', 'bills', 'wifi'],
];

export const catId = (slug: string) => `seed:cat:${slug}`;
export const accountId = (slug: string) => `seed:acct:${slug}`;

/** Categories are currency-agnostic — only accounts carry a currency. */
export function defaultCategories(): SeedCategory[] {
  const parents: SeedCategory[] = [
    ...EXPENSE.map(([slug, name, icon, color], i) => ({
      id: catId(slug),
      name,
      kind: 'expense' as const,
      icon,
      color,
      sortOrder: i,
    })),
    ...INCOME.map(([slug, name, icon, color], i) => ({
      id: catId(slug),
      name,
      kind: 'income' as const,
      icon,
      color,
      sortOrder: i,
    })),
  ];

  const byId = new Map(parents.map((c) => [c.id, c]));

  const children: SeedCategory[] = CHILDREN.map(([slug, name, parentSlug, icon], i) => {
    const parent = byId.get(catId(parentSlug));
    if (!parent) throw new Error(`seed: unknown parent category "${parentSlug}"`);
    return {
      id: catId(slug),
      name,
      // Inheriting kind and colour from the parent is what keeps the invariant
      // true by construction rather than by convention.
      kind: parent.kind,
      parentId: parent.id,
      icon,
      color: parent.color,
      sortOrder: i,
    };
  });

  return [...parents, ...children];
}

export function defaultAccounts(homeCurrency = 'EGP'): (Omit<NewAccount, 'id'> & { id: string })[] {
  return [
    {
      id: accountId('cash'),
      name: 'Cash',
      type: 'cash',
      currency: homeCurrency,
      icon: 'cash',
      color: '#6E8B3D',
      sortOrder: 0,
    },
    {
      id: accountId('bank'),
      name: 'Bank',
      type: 'bank',
      currency: homeCurrency,
      icon: 'bank',
      color: '#2F6FA8',
      sortOrder: 1,
    },
  ];
}

/**
 * Accepts any synchronous SQLite drizzle instance, so the app can pass its
 * expo-sqlite database and tests can pass a better-sqlite3 one.
 */
type SeedableDb = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/**
 * Insert any missing defaults. Safe to call on every launch: existing rows are
 * left untouched, including any the user has renamed or recoloured.
 */
export function seedDefaults(db: SeedableDb, homeCurrency = 'EGP'): void {
  const cats = defaultCategories();

  // Parents before children, or the parent_id foreign key has nothing to point at.
  const parents = cats.filter((c) => !c.parentId);
  const children = cats.filter((c) => c.parentId);

  db.insert(accounts).values(defaultAccounts(homeCurrency)).onConflictDoNothing().run();
  db.insert(categories).values(parents).onConflictDoNothing().run();
  db.insert(categories).values(children).onConflictDoNothing().run();
}
