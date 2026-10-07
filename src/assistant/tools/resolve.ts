import { eq } from 'drizzle-orm';

import { accounts, categories, recurringRules, tags } from '../../db/schema';
import type { Account, Category, RecurringRule, Tag } from '../../db/schema';
import { parseAmountToMinor } from '../../lib/money';
import { ToolInputError } from '../dates';
import type { Args, Db } from './types';

/**
 * Turning what the model wrote into rows, and refusing to guess.
 *
 * The model is shown every id in the system prompt and usually passes one. It
 * may pass a NAME instead, and that is accepted when it names exactly one
 * thing. Two matches is an error that lists both: picking one would file a
 * record under whichever "Fuel" happened to sort first, and the user approving
 * the card would have no way to see that the other was meant.
 *
 * Every error here goes back to the MODEL, which reads it and tries again —
 * so it says what would have worked, not just what did not.
 */

const fold = (value: string) => value.trim().toLowerCase();

function pick<T extends { id: string; name: string; archived?: boolean }>(
  rows: T[],
  ref: string,
  noun: string,
  describe: (row: T) => string = (row) => row.name
): T {
  const exact = rows.find((row) => row.id === ref);
  if (exact) return exact;

  const wanted = fold(ref);
  const named = rows.filter((row) => fold(describe(row)) === wanted || fold(row.name) === wanted);
  // A live match beats an archived one with the same name — the archived one
  // is the thing the user put away.
  const live = named.filter((row) => !row.archived);
  const matches = live.length > 0 ? live : named;

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new ToolInputError(
      `More than one ${noun} is called "${ref}": ${matches
        .map((row) => `${describe(row)} (id ${row.id})`)
        .join(', ')}. Pass the id.`
    );
  }
  const known = rows
    .filter((row) => !row.archived)
    .slice(0, 40)
    .map((row) => describe(row))
    .join(', ');
  throw new ToolInputError(`There is no ${noun} called "${ref}". Known: ${known || 'none'}.`);
}

export function resolveCategory(db: Db, ref: string, kind?: 'expense' | 'income'): Category {
  const all = db.select().from(categories).all();
  const byId = new Map(all.map((c) => [c.id, c]));
  // "Food › Groceries" and "Food/Groceries" both name the child unambiguously.
  const path = (c: Category) => (c.parentId ? `${byId.get(c.parentId)?.name ?? ''} › ${c.name}` : c.name);
  const normalised = ref.replace(/\s*(?:›|>|\/)\s*/g, ' › ');
  const pool = kind ? all.filter((c) => c.kind === kind) : all;
  return pick(pool.length > 0 ? pool : all, normalised, kind ? `${kind} category` : 'category', path);
}

export function resolveAccount(db: Db, ref: string): Account {
  return pick(db.select().from(accounts).all(), ref, 'account');
}

export function resolveTag(db: Db, ref: string): Tag {
  return pick(db.select().from(tags).all(), ref, 'tag');
}

export function resolveRule(db: Db, ref: string): RecurringRule {
  const rules = db.select().from(recurringRules).all();
  const named = rules.map((rule) => ({ ...rule, name: rule.name ?? rule.note ?? rule.id }));
  const found = pick(named, ref, 'recurring rule');
  return db.select().from(recurringRules).where(eq(recurringRules.id, found.id)).get()!;
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

export function optString(args: Args, name: string): string | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ToolInputError(`"${name}" must be text.`);
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function reqString(args: Args, name: string): string {
  const value = optString(args, name);
  if (value === undefined) throw new ToolInputError(`"${name}" is required.`);
  return value;
}

export function optBool(args: Args, name: string): boolean | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  // Only a real boolean. A model answering "yes" has not said true — the same
  // rule the bank reader keeps for withdrawals.
  if (typeof value !== 'boolean') throw new ToolInputError(`"${name}" must be true or false.`);
  return value;
}

export function optEnum<T extends string>(args: Args, name: string, allowed: readonly T[]): T | undefined {
  const value = optString(args, name);
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T)) {
    throw new ToolInputError(`"${name}" must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export function reqEnum<T extends string>(args: Args, name: string, allowed: readonly T[]): T {
  const value = optEnum(args, name, allowed);
  if (value === undefined) throw new ToolInputError(`"${name}" is required (${allowed.join(', ')}).`);
  return value;
}

export function optStringList(args: Args, name: string): string[] | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new ToolInputError(`"${name}" must be a list of text.`);
  }
  return (value as string[]).map((v) => v.trim()).filter((v) => v !== '');
}

export function optInt(args: Args, name: string, min: number, max: number): number | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw new ToolInputError(`"${name}" must be a whole number from ${min} to ${max}.`);
  }
  return n;
}

/**
 * An amount, in the major units of `currency`, to integer minor units.
 *
 * Through `parseAmountToMinor` and never `Math.round(x * 100)`: the model
 * sends 12.345 for a dinar and 1200 for a yen, and only the parser knows how
 * many decimals each one has. Unsigned — the SIDE is a separate argument, so a
 * stray minus sign cannot turn an expense into income.
 */
export function amountMinor(args: Args, name: string, currency: string, required: boolean): number | undefined {
  const value = args[name];
  if (value === undefined || value === null || value === '') {
    if (required) throw new ToolInputError(`"${name}" is required.`);
    return undefined;
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new ToolInputError(`"${name}" must be a number.`);
  }
  const minor = parseAmountToMinor(String(value), currency);
  if (minor === null) throw new ToolInputError(`"${value}" is not an amount.`);
  if (minor <= 0) throw new ToolInputError(`"${name}" must be more than zero.`);
  return minor;
}
