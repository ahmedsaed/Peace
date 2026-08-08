import { and, eq, isNull } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import * as schema from '../schema';
import { categories, type Category, type NewCategory } from '../schema';

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
export function buildCategoryTree(all: Category[], kind: Category['kind']): CategoryNode[] {
  const ofKind = all.filter((c) => c.kind === kind && !c.archived);
  const ids = new Set(ofKind.map((c) => c.id));
  const tops = ofKind.filter((c) => !c.parentId || !ids.has(c.parentId)).sort(byOrder);

  return tops.map((top) => ({
    ...top,
    children: ofKind.filter((c) => c.parentId === top.id).sort(byOrder),
  }));
}

/** Top-level categories of one kind, each with its children attached. */
export function listCategoryTree(db: Db, kind: Category['kind']): CategoryNode[] {
  return buildCategoryTree(db.select().from(categories).all(), kind);
}

export function listTopLevel(db: Db, kind: Category['kind']): Category[] {
  return db
    .select()
    .from(categories)
    .where(and(eq(categories.kind, kind), isNull(categories.parentId)))
    .all();
}
