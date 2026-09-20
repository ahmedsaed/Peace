import { and, eq, isNull } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import * as schema from '../schema';
import { categories, transactions, type Category, type NewCategory } from '../schema';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/** Thrown when a write would break a documented invariant. */
export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantError';
  }
}

/**
 * The category rules that SQLite cannot express as constraints:
 *
 *   1. The tree is at most TWO levels deep. A parent must be top-level.
 *   2. A child shares its parent's `kind`. A category is income XOR expense,
 *      and a sub-category of Food cannot be income.
 *   3. Nothing is its own parent.
 *
 * Seeded data satisfies these by construction; user input does not, which is
 * why every write goes through here rather than touching the table directly.
 */
function assertParentIsValid(
  db: Db,
  parentId: string,
  kind: Category['kind'],
  selfId?: string
): void {
  if (selfId && parentId === selfId) {
    throw new InvariantError('A category cannot be its own parent.');
  }

  const parent = db.select().from(categories).where(eq(categories.id, parentId)).get();
  if (!parent) {
    throw new InvariantError(`Parent category "${parentId}" does not exist.`);
  }
  if (parent.parentId) {
    throw new InvariantError(
      `Categories are only two levels deep — "${parent.name}" is already a sub-category.`
    );
  }
  if (parent.kind !== kind) {
    throw new InvariantError(
      `A ${kind} category cannot sit under "${parent.name}", which is ${parent.kind}.`
    );
  }
}

function hasChildren(db: Db, id: string): boolean {
  return db.select().from(categories).where(eq(categories.parentId, id)).all().length > 0;
}

export function createCategory(db: Db, input: NewCategory): Category {
  const name = input.name?.trim();
  if (!name) throw new InvariantError('A category needs a name.');

  const kind = input.kind ?? 'expense';
  if (input.parentId) assertParentIsValid(db, input.parentId, kind);

  const row: NewCategory = { ...input, name, kind };
  db.insert(categories).values(row).run();
  return db.select().from(categories).where(eq(categories.id, input.id)).get()!;
}

export function updateCategory(
  db: Db,
  id: string,
  patch: Partial<Omit<NewCategory, 'id'>>
): Category {
  const existing = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!existing) throw new InvariantError(`Category "${id}" does not exist.`);

  const kind = patch.kind ?? existing.kind;
  const parentId = patch.parentId === undefined ? existing.parentId : patch.parentId;

  if (parentId) {
    // Self-parenting is checked first: it is the more fundamental mistake, and
    // reporting "it has sub-categories" for `parent = self` would be confusing.
    if (parentId === id) {
      throw new InvariantError('A category cannot be its own parent.');
    }
    // A category with children cannot itself become a child — that is depth 3.
    if (hasChildren(db, id)) {
      throw new InvariantError(
        `"${existing.name}" has sub-categories, so it cannot become a sub-category itself.`
      );
    }
    assertParentIsValid(db, parentId, kind, id);
  }

  // Changing a parent's kind has to take its children with it, or they end up
  // as income sub-categories of an expense parent.
  if (patch.kind && patch.kind !== existing.kind && hasChildren(db, id)) {
    db.update(categories).set({ kind: patch.kind }).where(eq(categories.parentId, id)).run();
  }

  // ARCHIVING TRAVELS ALONG THE TREE, for the same reason, and it is here
  // rather than in a helper so that no caller can set the flag and miss it.
  //
  // The invariant is that a LIVE category has a live parent. Archive a parent
  // and leave its children, and `buildCategoryTree` promotes them to top level
  // — "Groceries" silently becomes a heading beside "Food", which reads as a
  // bug in the picker rather than as something the user did. Restore a child
  // whose parent is still away and the same promotion happens in reverse. So
  // archiving goes DOWN to the children and restoring goes UP to the parent;
  // restoring a parent deliberately leaves its children where they are, since
  // bringing back a sub-category somebody retired on its own would be the one
  // direction that undoes a decision nobody made twice.
  if (patch.archived !== undefined && patch.archived !== existing.archived) {
    if (patch.archived) {
      db.update(categories)
        .set({ archived: true, updatedAt: new Date() })
        .where(eq(categories.parentId, id))
        .run();
    } else if (existing.parentId) {
      db.update(categories)
        .set({ archived: false, updatedAt: new Date() })
        .where(eq(categories.id, existing.parentId))
        .run();
    }
  }

  db.update(categories)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(categories.id, id))
    .run();

  return db.select().from(categories).where(eq(categories.id, id)).get()!;
}

export type CategoryNode = Category & { children: Category[] };

const byOrder = (a: Category, b: Category) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

/**
 * Pure: turns a flat list into the two-level tree the UI renders. Separate from
 * the query so screens can feed it rows from a live query, and so the shaping
 * can be tested without a database.
 *
 * A row whose parent is missing from `all` (archived, or deleted mid-render) is
 * promoted to top level rather than silently disappearing — losing a category
 * from the picker is worse than showing it in the wrong place.
 */
export function buildCategoryTree(
  all: Category[],
  kind: Category['kind'],
  { includeArchived = false } = {}
): CategoryNode[] {
  const ofKind = all.filter((c) => c.kind === kind && (includeArchived || !c.archived));
  const ids = new Set(ofKind.map((c) => c.id));
  const tops = ofKind.filter((c) => !c.parentId || !ids.has(c.parentId)).sort(byOrder);

  return tops.map((top) => ({
    ...top,
    children: ofKind.filter((c) => c.parentId === top.id).sort(byOrder),
  }));
}

/**
 * Every live category, both kinds, flat.
 *
 * What a MODEL needs, as opposed to a picker: sub-categories included, because
 * "Restaurants" is the name a receipt or a bank message actually contains and
 * a tree cannot be offered as a list of choices. Archived ones are left out —
 * they are not offered to a person either, and a model filing into one would
 * resurrect a category the user retired.
 */
export function listCategoriesFlat(db: Db): Category[] {
  return db
    .select()
    .from(categories)
    .all()
    .filter((c) => !c.archived);
}

/**
 * The categories that have been put away.
 *
 * Both kinds in one list, parents before their own children, because the sheet
 * offering them back is one list — and a sub-category on its own says almost
 * nothing without the parent it belonged to above it.
 */
export function listArchivedCategories(db: Db): Category[] {
  const all = db.select().from(categories).all();
  const archived = all.filter((c) => c.archived);
  const tops = archived.filter((c) => !c.parentId).sort(byOrder);
  const orphans = archived.filter((c) => c.parentId && !archived.some((p) => p.id === c.parentId));

  return [
    ...tops.flatMap((top) => [top, ...archived.filter((c) => c.parentId === top.id).sort(byOrder)]),
    // A child whose parent is still live: it was retired on its own, and it
    // belongs in the list rather than being unreachable because the loop above
    // only walks archived parents.
    ...orphans.sort(byOrder),
  ];
}

/**
 * Bring an archived category back into the pickers and the tree.
 *
 * Records never lost it — an archived category stays on every record already
 * filed under it, which is the whole difference between archiving one and
 * deleting one, where the records survive but come back UNCATEGORISED.
 */
export function restoreCategory(db: Db, id: string): Category {
  return updateCategory(db, id, { archived: false });
}

/**
 * Top-level categories of one kind, each with its children attached.
 *
 * `includeArchived` exists for SEARCH, and for nothing else so far: a retired
 * category is exactly the thing somebody goes looking for afterwards, and a
 * filter naming one it cannot list would show the records while the chip above
 * them read "Any category". Every picker that OFFERS a category for new data
 * leaves the default alone.
 */
export function listCategoryTree(
  db: Db,
  kind: Category['kind'],
  options?: { includeArchived?: boolean }
): CategoryNode[] {
  return buildCategoryTree(db.select().from(categories).all(), kind, options);
}

export function listTopLevel(db: Db, kind: Category['kind']): Category[] {
  return db
    .select()
    .from(categories)
    .where(and(eq(categories.kind, kind), isNull(categories.parentId)))
    .all();
}

export function getCategory(db: Db, id: string): Category | undefined {
  return db.select().from(categories).where(eq(categories.id, id)).get();
}

export function categoryRecordCount(db: Db, id: string): number {
  return db.select().from(transactions).where(eq(transactions.categoryId, id)).all().length;
}

/**
 * Delete a category.
 *
 * Unlike accounts, this is SAFE by construction: `transactions.category_id` is
 * SET NULL, so records survive uncategorised, and `categories.parent_id` is also
 * SET NULL, so children are promoted to top level rather than deleted. Losing a
 * label should never lose the money or the sub-categories underneath it.
 *
 * Returns how many records were left uncategorised, so the caller can say so.
 */
export function deleteCategory(db: Db, id: string): { orphanedRecords: number } {
  const existing = getCategory(db, id);
  if (!existing) throw new InvariantError(`Category "${id}" does not exist.`);

  const orphanedRecords = categoryRecordCount(db, id);
  db.delete(categories).where(eq(categories.id, id)).run();
  return { orphanedRecords };
}
