import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { newId } from '../../lib/id';
import type { ImportPlan, LedgerSnapshot, Ref } from '../../lib/import-csv';
import { tagKey } from '../../lib/tag';
import * as schema from '../schema';
import {
  accounts,
  budgets,
  categories,
  imports,
  recurringRules,
  tags,
  transactionTags,
  transactions,
  type ImportRow,
} from '../schema';
import { createAccount } from './accounts';
import { createCategory } from './categories';
import { ensureTag, setRecordTags } from './tags';
import { createRecord, createTransfer } from './transactions';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/**
 * Writing a planned CSV import, and taking it back out again.
 *
 * Everything goes through the same writers the record screen uses —
 * `createRecord`, `createTransfer` — so a refund lands on the expense side, a
 * transfer gets both legs and its pair id, and no rule about the ledger gets a
 * second, import-only copy. The planning and every check on the file's
 * contents live in `lib/import-csv.ts`.
 */

/** The ledger as the planner needs to see it. */
export function ledgerSnapshot(db: Db, homeCurrency: string, fileIds: string[]): LedgerSnapshot {
  const existing = new Set<string>();
  // Chunked: SQLite caps the number of bound parameters in one statement.
  for (let i = 0; i < fileIds.length; i += 500) {
    const chunk = fileIds.slice(i, i + 500);
    for (const row of db
      .select({ id: transactions.id })
      .from(transactions)
      .where(inArray(transactions.id, chunk))
      .all()) {
      existing.add(row.id);
    }
  }
  return {
    homeCurrency,
    accounts: db
      .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
      .from(accounts)
      .all(),
    categories: db
      .select({
        id: categories.id,
        name: categories.name,
        kind: categories.kind,
        parentId: categories.parentId,
      })
      .from(categories)
      .all(),
    tagKeys: new Set(db.select({ key: tags.normalised }).from(tags).all().map((t) => t.key)),
    existingIds: existing,
  };
}

/**
 * Write a plan, all of it or none of it.
 *
 * One SQL transaction: a file that fails on row 900 must not leave 899 records
 * behind with no import row to undo them by. Returns the import's id.
 */
export function applyImport(
  db: Db,
  plan: ImportPlan,
  { fileName, homeCurrency }: { fileName: string | null; homeCurrency: string }
): string {
  const importId = newId();

  db.transaction((tx) => {
    const accountIds = new Map<string, string>();
    for (const account of plan.newAccounts) {
      accountIds.set(account.key, createAccount(tx, { name: account.name, currency: account.currency }).id);
    }

    // Parents first: a sub-category's parent may be new as well.
    const categoryIds = new Map<string, string>();
    const resolveCategory = (ref: Ref | null): string | null =>
      ref === null ? null : 'id' in ref ? ref.id : (categoryIds.get(ref.create) ?? null);
    for (const pass of [false, true]) {
      for (const category of plan.newCategories) {
        if ((category.parent !== null) !== pass) continue;
        const id = newId();
        createCategory(tx, {
          id,
          name: category.name,
          kind: category.kind,
          parentId: resolveCategory(category.parent),
          icon: 'tag',
          color: '#6B5B4A',
        });
        categoryIds.set(category.key, id);
      }
    }

    const account = (ref: Ref): string => ('id' in ref ? ref.id : accountIds.get(ref.create)!);
    // Which tags this import brought into being, so Undo can take them back.
    const createdTags = new Set<string>();
    const tagIds = (names: string[]): string[] =>
      names.map((name) => {
        const existed = tx.select({ id: tags.id }).from(tags).where(eq(tags.normalised, tagKey(name))).get();
        const tag = ensureTag(tx, name);
        if (!existed) createdTags.add(tag.id);
        return tag.id;
      });

    for (const row of plan.rows) {
      const shared = {
        amountMinor: row.amountMinor,
        currency: row.currency,
        fxRate: row.fxRate,
        homeCurrency,
        note: row.note,
        occurredAt: row.occurredAt,
        importId,
      };
      let tagged: string;
      if (row.kind === 'record') {
        tagged = createRecord(tx, {
          ...shared,
          type: row.type,
          isRefund: row.isRefund,
          accountId: account(row.account),
          categoryId: resolveCategory(row.category),
          id: row.id ?? undefined,
        }).id;
      } else if (row.kind === 'transfer') {
        tagged = createTransfer(tx, {
          ...shared,
          fromAccountId: account(row.from),
          toAccountId: account(row.to),
          ids: {
            out: row.id,
            in: row.inId,
            // Kept only while nothing in the ledger uses it: a pair id shared
            // with an existing transfer would make two movements read as one.
            pair:
              row.pairId &&
              !tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.transferPairId, row.pairId)).get()
                ? row.pairId
                : null,
          },
        }).out.id;
      } else {
        // A correction keeps its sign — it is the one row where the sign IS
        // the information — and goes in exactly as `reconcileAccount` writes
        // one: no category, flagged, in the account's own currency.
        tagged = row.id ?? newId();
        tx.insert(transactions)
          .values({
            id: tagged,
            accountId: account(row.account),
            categoryId: null,
            amountMinor: row.amountMinor,
            currency: row.currency,
            isAdjustment: true,
            note: row.note,
            occurredAt: row.occurredAt,
            importId,
          })
          .run();
      }
      if (row.tags.length > 0) setRecordTags(tx, tagged, tagIds(row.tags));
    }

    tx.insert(imports)
      .values({
        id: importId,
        fileName,
        recordCount: plan.rows.length,
        createdAccountIds: JSON.stringify([...accountIds.values()]),
        createdCategoryIds: JSON.stringify([...categoryIds.values()]),
        createdTagIds: JSON.stringify([...createdTags]),
      })
      .run();
  });

  return importId;
}

/** The newest import still in the ledger, for "Undo import". */
export function lastImport(db: Db): ImportRow | undefined {
  return db.select().from(imports).orderBy(desc(imports.createdAt)).limit(1).get();
}

function ids(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Take an import back out: every record it wrote, and whatever it created to
 * hold them that nothing else has come to use since.
 *
 * "Since" is the careful part. An account the import created may have had a
 * record typed into it by hand afterwards, a category a budget, a tag a
 * record of its own — removing any of those would delete something the person
 * made, under a button that promised only to undo the file. Those stay.
 * Returns how many records were removed.
 */
export function undoImport(db: Db, importId: string): number {
  const row = db.select().from(imports).where(eq(imports.id, importId)).get();
  if (!row) return 0;

  let removed = 0;
  db.transaction((tx) => {
    removed = tx
      .select({ n: sql<number>`count(*)` })
      .from(transactions)
      .where(eq(transactions.importId, importId))
      .get()!.n;
    // Tags go with their rows (cascade); so do both legs of every transfer,
    // since each leg carries the import's id.
    tx.delete(transactions).where(eq(transactions.importId, importId)).run();

    const count = (query: { get: () => { n: number } | undefined }) => (query.get()?.n ?? 0) > 0;
    const n = sql<number>`count(*)`;

    for (const id of ids(row.createdTagIds)) {
      if (!count(tx.select({ n }).from(transactionTags).where(eq(transactionTags.tagId, id)))) {
        tx.delete(tags).where(eq(tags.id, id)).run();
      }
    }

    // Children before parents, so a parent emptied by the undo can go too.
    const created = ids(row.createdCategoryIds).map((id) => ({
      id,
      parentId: tx.select().from(categories).where(eq(categories.id, id)).get()?.parentId ?? null,
    }));
    for (const { id } of [...created.filter((c) => c.parentId), ...created.filter((c) => !c.parentId)]) {
      const busy =
        count(tx.select({ n }).from(transactions).where(eq(transactions.categoryId, id))) ||
        count(tx.select({ n }).from(budgets).where(eq(budgets.categoryId, id))) ||
        count(tx.select({ n }).from(recurringRules).where(eq(recurringRules.categoryId, id))) ||
        count(tx.select({ n }).from(categories).where(eq(categories.parentId, id)));
      if (!busy) tx.delete(categories).where(eq(categories.id, id)).run();
    }

    for (const id of ids(row.createdAccountIds)) {
      const account = tx.select().from(accounts).where(eq(accounts.id, id)).get();
      if (!account) continue;
      const busy =
        // An opening balance typed in since is the person's own figure.
        account.openingBalance !== 0 ||
        count(tx.select({ n }).from(transactions).where(eq(transactions.accountId, id))) ||
        count(tx.select({ n }).from(transactions).where(eq(transactions.counterAccountId, id))) ||
        count(tx.select({ n }).from(recurringRules).where(eq(recurringRules.accountId, id)));
      if (!busy) tx.delete(accounts).where(eq(accounts.id, id)).run();
    }

    tx.delete(imports).where(eq(imports.id, importId)).run();
  });
  return removed;
}
