import { eq, inArray } from 'drizzle-orm';

import { createAccount, updateAccount } from '../../db/repo/accounts';
import { addAttachment } from '../../db/repo/attachments';
import { checkDeletion, deleteEntity, type EntityTarget } from '../../db/repo/archive';
import { assertBudgetable, setBudget } from '../../db/repo/budgets';
import { createCategory, updateCategory } from '../../db/repo/categories';
import { ledgerSide } from '../../db/repo/predicates';
import { createRule, deleteRule, setRuleActive } from '../../db/repo/recurring';
import { ensureTag, renameTag, setRecordTags, setTagArchived, tagsForRecord } from '../../db/repo/tags';
import {
  createRecord,
  createTransfer,
  deleteRecord,
  updateRecord,
  updateTransfer,
} from '../../db/repo/transactions';
import { accounts, attachments, categories, tags, transactionTags, transactions } from '../../db/schema';
import type { Account, Category, Transaction } from '../../db/schema';
import { newId } from '../../lib/id';
import { formatPeriod } from '../../lib/period';
import { describeRecurrence } from '../../lib/recurrence';
import { cleanTagName, tagKey } from '../../lib/tag';
import type { ChatAttachment } from '../attachments';
import { resolveSpan, ToolInputError, ymd } from '../dates';
import {
  amountMinor,
  optBool,
  optInt,
  optString,
  optStringList,
  reqEnum,
  reqString,
  resolveAccount,
  resolveCategory,
  resolveRule,
  resolveTag,
} from './resolve';
import type { Args, Db, Preview, PreviewLine, ToolContext, WriteTool } from './types';

/**
 * Everything the assistant can CHANGE, each as a proposal first.
 *
 * Every write goes through the same repository functions the screens use, so
 * the invariants they enforce — two-level categories, a tag name that is not
 * already taken, an account with records cannot be deleted — hold here
 * without being restated. What this file adds is the preview: the card the
 * user reads before tapping Approve has to say exactly what will happen,
 * because that tap is the only thing between a model's guess and the ledger.
 */

const DEFAULT_COLOR = '#6B5B4A';
const DEFAULT_ICON = 'dots';

function dateArg(args: Args, name: string, ctx: ToolContext): Date | undefined {
  const raw = optString(args, name);
  if (raw === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new ToolInputError(`"${name}" must be YYYY-MM-DD.`);
  const span = resolveSpan({ from: raw, to: raw });
  const day = span.start!;
  // Today keeps the current time, so the record sorts where one typed now
  // would. Any other day is noon: far from both midnights, so no timezone
  // reading can move it to a neighbouring day.
  if (ymd(day) === ymd(ctx.now)) return new Date(ctx.now);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0, 0);
}

function colorArg(args: Args): string | undefined {
  const raw = optString(args, 'color');
  if (raw === undefined) return undefined;
  if (!/^#[0-9a-fA-F]{6}$/.test(raw)) throw new ToolInputError('"color" must look like #2F6FA8.');
  return raw.toUpperCase();
}

/**
 * A record in a foreign currency needs an exchange rate the model does not
 * have and must not invent. The record screen fetches one and shows it; this
 * sends the user there instead of guessing.
 */
function assertHomeCurrency(account: Account, ctx: ToolContext): void {
  if (account.currency.toUpperCase() !== ctx.homeCurrency.toUpperCase()) {
    throw new ToolInputError(
      `"${account.name}" is in ${account.currency}, which needs an exchange rate to ${ctx.homeCurrency}. Ask the user to add this one from the record screen.`
    );
  }
}

function dayLabel(date: Date): string {
  return date.toDateString().slice(4); // "Dec 12 2025" — locale-free on purpose
}

const recordLine = (row: Transaction, label?: string): PreviewLine => ({
  label: label ?? `${dayLabel(row.occurredAt)}${row.note ? ` · ${row.note.split('\n')[0].slice(0, 40)}` : ''}`,
  figure: { minor: row.transferPairId ? Math.abs(row.amountMinor) : row.amountMinor, currency: row.currency },
});

/**
 * Files from the conversation, by the ids the model was shown.
 *
 * An unknown id is refused rather than skipped: a record saved without the
 * receipt the user just photographed for it looks complete and is not.
 */
function attachmentsArg(args: Args, name: string, ctx: ToolContext): ChatAttachment[] {
  const ids = optStringList(args, name) ?? [];
  return [...new Set(ids)].map((id) => {
    const found = ctx.attachments.find((a) => a.id === id || a.fileName === id);
    if (!found) {
      const known = ctx.attachments.map((a) => a.id).join(', ');
      throw new ToolInputError(`No file "${id}" was attached in this conversation.${known ? ` Attached: ${known}.` : ''}`);
    }
    return found;
  });
}

const fileLabel = (a: ChatAttachment) => a.originalName ?? (a.mimeType.startsWith('image/') ? 'Photo' : 'Document');

/** Keep files with a record — the same row a receipt added on the record screen gets. */
function keepFiles(db: Db, transactionId: string, files: ChatAttachment[]): void {
  for (const file of files) {
    addAttachment(db, {
      transactionId,
      fileName: file.fileName,
      originalName: file.originalName,
      mimeType: file.mimeType,
      byteSize: file.byteSize,
      sha256: file.sha256,
      width: file.width,
      height: file.height,
    });
  }
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

type NewRecordPlan = {
  type: 'expense' | 'income' | 'transfer';
  account: Account;
  toAccount: Account | null;
  category: Category | null;
  amountMinor: number;
  occurredAt: Date;
  note: string | null;
  tagNames: string[];
  files: ChatAttachment[];
};

function planRecord(args: Args, ctx: ToolContext): NewRecordPlan {
  const type = reqEnum(args, 'type', ['expense', 'income', 'transfer'] as const);
  const account = resolveAccount(ctx.db, reqString(args, 'account'));
  assertHomeCurrency(account, ctx);

  let toAccount: Account | null = null;
  let category: Category | null = null;
  if (type === 'transfer') {
    toAccount = resolveAccount(ctx.db, reqString(args, 'to_account'));
    if (toAccount.id === account.id) throw new ToolInputError('A transfer needs two different accounts.');
    assertHomeCurrency(toAccount, ctx);
  } else {
    const ref = optString(args, 'category');
    if (ref) category = resolveCategory(ctx.db, ref, type);
  }

  return {
    type,
    account,
    toAccount,
    category,
    amountMinor: amountMinor(args, 'amount', account.currency, true)!,
    occurredAt: dateArg(args, 'date', ctx) ?? new Date(ctx.now),
    note: optString(args, 'note') ?? null,
    tagNames: (optStringList(args, 'tags') ?? []).map(cleanTagName).filter((n) => n !== ''),
    files: attachmentsArg(args, 'attachments', ctx),
  };
}

function existingTagKeys(db: Db): Set<string> {
  return new Set(db.select({ key: tags.normalised }).from(tags).all().map((t) => t.key));
}

const createRecordTool: WriteTool = {
  kind: 'write',
  activity: 'Preparing a record',
  declaration: {
    name: 'create_record',
    description:
      'Propose a new expense, income or transfer. The user approves it before it is written. Amount is unsigned, in the account currency.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['expense', 'income', 'transfer'] },
        amount: { type: 'number' },
        account: { type: 'string', description: 'Account id or name. For a transfer, where the money leaves.' },
        to_account: { type: 'string', description: 'Transfers only: where the money arrives.' },
        category: { type: 'string', description: 'Expense/income only. Category id or name.' },
        date: { type: 'string', description: 'YYYY-MM-DD. Defaults to now.' },
        note: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tag names; new ones are created.' },
        attachments: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ids of files the user attached in this conversation (e.g. "file12-1") to keep with the record — the receipt or invoice it came from.',
        },
      },
      required: ['type', 'amount', 'account'],
    },
  },
  prepare(args, ctx) {
    const plan = planRecord(args, ctx);
    const known = existingTagKeys(ctx.db);
    const signed = plan.type === 'expense' ? -plan.amountMinor : plan.amountMinor;
    const lines: PreviewLine[] = [
      { label: 'Amount', figure: { minor: signed, currency: plan.account.currency } },
      plan.toAccount
        ? { label: 'Accounts', value: `${plan.account.name} → ${plan.toAccount.name}` }
        : { label: 'Account', value: plan.account.name },
      ...(plan.type === 'transfer' ? [] : [{ label: 'Category', value: plan.category?.name ?? 'None' }]),
      { label: 'Date', value: dayLabel(plan.occurredAt) },
      ...(plan.note ? [{ label: 'Note', value: plan.note }] : []),
      ...(plan.tagNames.length > 0
        ? [
            {
              label: 'Tags',
              value: plan.tagNames
                .map((name) => (known.has(tagKey(name)) ? name : `${name} (new)`))
                .join(', '),
            },
          ]
        : []),
      ...(plan.files.length > 0 ? [{ label: 'Attached', value: plan.files.map(fileLabel).join(', ') }] : []),
    ];
    const noun = plan.type === 'transfer' ? 'transfer' : plan.type;
    return { title: `Add this ${noun}?`, lines, danger: false, confirmLabel: 'Add' };
  },
  apply(args, ctx) {
    const plan = planRecord(args, ctx);
    let id = '';
    ctx.db.transaction((tx) => {
      const db = tx as unknown as Db;
      if (plan.type === 'transfer') {
        id = createTransfer(db, {
          fromAccountId: plan.account.id,
          toAccountId: plan.toAccount!.id,
          amountMinor: plan.amountMinor,
          currency: plan.account.currency,
          homeCurrency: ctx.homeCurrency,
          note: plan.note,
          occurredAt: plan.occurredAt,
        }).out.id;
      } else {
        id = createRecord(db, {
          type: plan.type,
          accountId: plan.account.id,
          categoryId: plan.category?.id ?? null,
          amountMinor: plan.amountMinor,
          currency: plan.account.currency,
          homeCurrency: ctx.homeCurrency,
          note: plan.note,
          occurredAt: plan.occurredAt,
        }).id;
      }
      if (plan.tagNames.length > 0) {
        setRecordTags(db, id, plan.tagNames.map((name) => ensureTag(db, name).id));
      }
      keepFiles(db, id, plan.files);
    });
    return { response: { created: true, id, ...(plan.files.length > 0 ? { attached: plan.files.length } : {}) } };
  },
};

/** Ids to rows, refusing any that do not exist rather than skipping them. */
function rowsFor(db: Db, args: Args): Transaction[] {
  const ids = optStringList(args, 'ids') ?? [];
  if (ids.length === 0) throw new ToolInputError('"ids" needs at least one record id (from find_records).');
  if (ids.length > 200) throw new ToolInputError('At most 200 records at a time.');
  const unique = [...new Set(ids)];
  const rows = db.select().from(transactions).where(inArray(transactions.id, unique)).all();
  const found = new Set(rows.map((r) => r.id));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new ToolInputError(`No record has the id(s): ${missing.slice(0, 5).join(', ')}. Use ids from find_records.`);
  }
  // Both legs of a transfer may be named; the pair is one record to the user.
  const seenPairs = new Set<string>();
  return rows
    .filter((row) => {
      if (!row.transferPairId) return true;
      if (seenPairs.has(row.transferPairId)) return false;
      seenPairs.add(row.transferPairId);
      return true;
    })
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}

type UpdatePlan = {
  rows: Transaction[];
  category: Category | null | undefined;
  account: Account | undefined;
  note: string | null | undefined;
  occurredAt: Date | undefined;
  amountMinor: number | undefined;
  addTags: string[];
  removeTagIds: string[];
  files: ChatAttachment[];
};

function planUpdate(args: Args, ctx: ToolContext): UpdatePlan {
  const rows = rowsFor(ctx.db, args);
  const categoryRef = optString(args, 'category');
  // "none" un-files a record; anything else must name a real category.
  const category =
    categoryRef === undefined ? undefined : /^(none|uncategori[sz]ed)$/i.test(categoryRef) ? null : resolveCategory(ctx.db, categoryRef);
  const accountRef = optString(args, 'account');
  const account = accountRef ? resolveAccount(ctx.db, accountRef) : undefined;
  const noteRaw = args.note;
  const note = noteRaw === undefined || noteRaw === null ? undefined : typeof noteRaw === 'string' ? noteRaw.trim() || null : undefined;
  const occurredAt = dateArg(args, 'date', ctx);
  const addTags = (optStringList(args, 'add_tags') ?? []).map(cleanTagName).filter((n) => n !== '');
  const removeTagIds = (optStringList(args, 'remove_tags') ?? []).map((ref) => resolveTag(ctx.db, ref).id);
  const files = attachmentsArg(args, 'add_attachments', ctx);

  let amount: number | undefined;
  if (args.amount !== undefined && args.amount !== null) {
    // One amount cannot be right for forty records; a bulk edit that set them
    // all to the same figure is never what anybody meant.
    if (rows.length !== 1) throw new ToolInputError('"amount" can only be changed on one record at a time.');
    amount = amountMinor(args, 'amount', rows[0].currency, true);
  }

  for (const row of rows) {
    const side = ledgerSide(row);
    if (side === 'correction') {
      throw new ToolInputError('Balance corrections cannot be edited here — reconcile the account instead.');
    }
    if (side === 'transfer' && (category !== undefined || account || amount !== undefined)) {
      throw new ToolInputError('A transfer has no category, and its accounts and amount are edited on the record screen. Only note, date and tags here.');
    }
    if (category && side !== category.kind) {
      throw new ToolInputError(`"${category.name}" is an ${category.kind} category, and a record dated ${ymd(row.occurredAt)} is ${side}.`);
    }
    if (account && account.currency.toUpperCase() !== row.currency.toUpperCase()) {
      throw new ToolInputError(`"${account.name}" is in ${account.currency}; that record is in ${row.currency}.`);
    }
  }

  if (
    category === undefined &&
    !account &&
    note === undefined &&
    !occurredAt &&
    amount === undefined &&
    addTags.length === 0 &&
    removeTagIds.length === 0 &&
    files.length === 0
  ) {
    throw new ToolInputError('Nothing to change. Pass at least one of category, account, note, date, amount, add_tags, remove_tags, add_attachments.');
  }

  return { rows, category, account, note, occurredAt, amountMinor: amount, addTags, removeTagIds, files };
}

const SAMPLE = 5;

const updateRecordsTool: WriteTool = {
  kind: 'write',
  activity: 'Preparing changes',
  declaration: {
    name: 'update_records',
    description:
      'Propose changes to one or more records by id (get ids from find_records): re-categorise, move account, change note/date, add or remove tags. amount only for a single record. The user approves first.',
    parameters: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' } },
        category: { type: 'string', description: 'Category id or name, or "none".' },
        account: { type: 'string' },
        note: { type: 'string', description: 'Replaces the note. Empty string clears it.' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        amount: { type: 'number', description: 'Unsigned, single record only.' },
        add_tags: { type: 'array', items: { type: 'string' } },
        remove_tags: { type: 'array', items: { type: 'string' } },
        add_attachments: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ids of files attached in this conversation to keep with these records.',
        },
      },
      required: ['ids'],
    },
  },
  prepare(args, ctx) {
    const plan = planUpdate(args, ctx);
    const lines: PreviewLine[] = [];
    if (plan.category !== undefined) lines.push({ label: 'Category', value: plan.category?.name ?? 'None' });
    if (plan.account) lines.push({ label: 'Account', value: plan.account.name });
    if (plan.note !== undefined) lines.push({ label: 'Note', value: plan.note ?? '(cleared)' });
    if (plan.occurredAt) lines.push({ label: 'Date', value: dayLabel(plan.occurredAt) });
    if (plan.amountMinor !== undefined) {
      const row = plan.rows[0];
      const signed = ledgerSide(row) === 'expense' && !row.isRefund ? -plan.amountMinor : plan.amountMinor;
      lines.push({ label: 'Amount', figure: { minor: signed, currency: row.currency } });
    }
    if (plan.addTags.length > 0) lines.push({ label: 'Add tags', value: plan.addTags.join(', ') });
    if (plan.removeTagIds.length > 0) {
      const names = ctx.db.select().from(tags).where(inArray(tags.id, plan.removeTagIds)).all().map((t) => t.name);
      lines.push({ label: 'Remove tags', value: names.join(', ') });
    }
    if (plan.files.length > 0) lines.push({ label: 'Attach', value: plan.files.map(fileLabel).join(', ') });
    lines.push(...plan.rows.slice(0, SAMPLE).map((row) => recordLine(row)));
    if (plan.rows.length > SAMPLE) lines.push({ label: `…and ${plan.rows.length - SAMPLE} more` });

    const n = plan.rows.length;
    return {
      title: n === 1 ? 'Change this record?' : `Change ${n} records?`,
      lines,
      danger: false,
      confirmLabel: n === 1 ? 'Change' : `Change ${n}`,
    };
  },
  apply(args, ctx) {
    const plan = planUpdate(args, ctx);
    ctx.db.transaction((tx) => {
      const db = tx as unknown as Db;
      const added = plan.addTags.map((name) => ensureTag(db, name).id);
      for (const row of plan.rows) {
        if (row.transferPairId) {
          if (plan.note !== undefined || plan.occurredAt) {
            // Either leg addresses the pair; `updateTransfer` finds both.
            updateTransfer(db, row.id, {
              homeCurrency: ctx.homeCurrency,
              ...(plan.note !== undefined ? { note: plan.note } : {}),
              ...(plan.occurredAt ? { occurredAt: plan.occurredAt } : {}),
            });
          }
        } else if (plan.category !== undefined || plan.account || plan.note !== undefined || plan.occurredAt || plan.amountMinor !== undefined) {
          updateRecord(db, row.id, {
            // Always: without it `updateRecord` would clear the stored home value.
            homeCurrency: ctx.homeCurrency,
            ...(plan.category !== undefined ? { categoryId: plan.category?.id ?? null } : {}),
            ...(plan.account ? { accountId: plan.account.id } : {}),
            ...(plan.note !== undefined ? { note: plan.note } : {}),
            ...(plan.occurredAt ? { occurredAt: plan.occurredAt } : {}),
            ...(plan.amountMinor !== undefined ? { amountMinor: plan.amountMinor } : {}),
          });
        }
        if (added.length > 0 || plan.removeTagIds.length > 0) {
          const current = tagsForRecord(db, row.id).map((t) => t.id);
          const next = [...current, ...added].filter((id) => !plan.removeTagIds.includes(id));
          setRecordTags(db, row.id, next);
        }
        keepFiles(db, row.id, plan.files);
      }
    });
    return { response: { updated: plan.rows.length } };
  },
};

const deleteRecordsTool: WriteTool = {
  kind: 'write',
  activity: 'Preparing a deletion',
  declaration: {
    name: 'delete_records',
    description: 'Propose deleting records by id (from find_records). The user must confirm twice; they can undo for a few seconds after.',
    parameters: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' } } },
      required: ['ids'],
    },
  },
  prepare(args, ctx) {
    const rows = rowsFor(ctx.db, args);
    const lines: PreviewLine[] = rows.slice(0, SAMPLE).map((row) => recordLine(row));
    if (rows.length > SAMPLE) lines.push({ label: `…and ${rows.length - SAMPLE} more` });
    const n = rows.length;
    return {
      title: n === 1 ? 'Delete this record?' : `Delete ${n} records?`,
      lines,
      danger: true,
      confirmLabel: n === 1 ? 'Delete' : `Delete ${n}`,
    };
  },
  apply(args, ctx) {
    const rows = rowsFor(ctx.db, args);
    const removed: Transaction[] = [];
    const tagLinks: { transactionId: string; tagId: string }[] = [];
    const files: (typeof attachments.$inferSelect)[] = [];
    ctx.db.transaction((tx) => {
      const db = tx as unknown as Db;
      for (const row of rows) {
        // Captured BEFORE the delete cascades them away, so Undo puts back the
        // whole record and not a bare row that has lost its tags and receipts.
        const ids = row.transferPairId
          ? db.select().from(transactions).where(eq(transactions.transferPairId, row.transferPairId)).all().map((r) => r.id)
          : [row.id, ...db.select().from(transactions).where(eq(transactions.feeForId, row.id)).all().map((r) => r.id)];
        tagLinks.push(...db.select().from(transactionTags).where(inArray(transactionTags.transactionId, ids)).all());
        files.push(...db.select().from(attachments).where(inArray(attachments.transactionId, ids)).all());
        removed.push(...deleteRecord(db, row.id));
      }
    });
    return {
      response: { deleted: rows.length },
      undo: { kind: 'records', rows: removed, tags: tagLinks, attachments: files },
    };
  },
};

// ---------------------------------------------------------------------------
// Categories, tags, accounts
// ---------------------------------------------------------------------------

/** "Delete" refuses what still has records, and says how to clear the way. */
function deletionPreview(ctx: ToolContext, target: EntityTarget, name: string, noun: string): Preview {
  const check = checkDeletion(ctx.db, target);
  if (check.blocking > 0) {
    throw new ToolInputError(
      `${check.blocking} record(s) still use the ${noun} "${name}", so it cannot be deleted. Move them with update_records first, or archive it instead.`
    );
  }
  return {
    title: `Delete the ${noun} "${name}"?`,
    lines:
      check.records > 0
        ? [{ label: `It is removed from ${check.records} record${check.records === 1 ? '' : 's'}. The records stay.` }]
        : [{ label: 'Nothing uses it.' }],
    danger: true,
    confirmLabel: 'Delete',
  };
}

const createCategoryTool: WriteTool = {
  kind: 'write',
  activity: 'Preparing a category',
  declaration: {
    name: 'create_category',
    description: 'Propose a new category. Categories are at most two levels deep; a sub-category has the same kind as its parent.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        kind: { type: 'string', enum: ['expense', 'income'] },
        parent: { type: 'string', description: 'Parent category id or name, for a sub-category.' },
        color: { type: 'string', description: 'Hex colour like #2F6FA8. Optional.' },
      },
      required: ['name', 'kind'],
    },
  },
  prepare(args, ctx) {
    const name = reqString(args, 'name');
    const kind = reqEnum(args, 'kind', ['expense', 'income'] as const);
    const parentRef = optString(args, 'parent');
    const parent = parentRef ? resolveCategory(ctx.db, parentRef, kind) : null;
    if (parent?.parentId) throw new ToolInputError(`"${parent.name}" is already a sub-category; categories are two levels deep.`);
    colorArg(args);
    const clash = ctx.db.select().from(categories).all().find(
      (c) => c.name.toLowerCase() === name.toLowerCase() && c.kind === kind && (c.parentId ?? null) === (parent?.id ?? null)
    );
    if (clash) throw new ToolInputError(`There is already a category called "${clash.name}" there (id ${clash.id}).`);
    return {
      title: `Add the category "${name}"?`,
      lines: [
        { label: 'Kind', value: kind },
        { label: 'Under', value: parent?.name ?? 'Top level' },
      ],
      danger: false,
      confirmLabel: 'Add',
    };
  },
  apply(args, ctx) {
    createCategoryTool.prepare(args, ctx);
    const kind = reqEnum(args, 'kind', ['expense', 'income'] as const);
    const parentRef = optString(args, 'parent');
    const created = createCategory(ctx.db, {
      id: newId(),
      name: reqString(args, 'name'),
      kind,
      parentId: parentRef ? resolveCategory(ctx.db, parentRef, kind).id : null,
      icon: DEFAULT_ICON,
      color: colorArg(args) ?? DEFAULT_COLOR,
    });
    return { response: { created: true, id: created.id } };
  },
};

function planCategoryUpdate(args: Args, ctx: ToolContext) {
  const category = resolveCategory(ctx.db, reqString(args, 'category'));
  const name = optString(args, 'name');
  const parentRef = optString(args, 'parent');
  const parentId =
    parentRef === undefined ? undefined : /^(none|top|top level)$/i.test(parentRef) ? null : resolveCategory(ctx.db, parentRef, category.kind).id;
  const archived = optBool(args, 'archived');
  const color = colorArg(args);
  if (name === undefined && parentId === undefined && archived === undefined && color === undefined) {
    throw new ToolInputError('Nothing to change. Pass name, parent, color or archived.');
  }
  return { category, name, parentId, archived, color };
}

const updateCategoryTool: WriteTool = {
  kind: 'write',
  activity: 'Preparing a category change',
  declaration: {
    name: 'update_category',
    description: 'Propose renaming, moving (parent, or "none" for top level), recolouring, archiving or restoring a category.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        name: { type: 'string' },
        parent: { type: 'string' },
        color: { type: 'string' },
        archived: { type: 'boolean' },
      },
      required: ['category'],
    },
  },
  prepare(args, ctx) {
    const plan = planCategoryUpdate(args, ctx);
    const lines: PreviewLine[] = [];
    if (plan.name !== undefined) lines.push({ label: 'Name', before: plan.category.name, value: plan.name });
    if (plan.parentId !== undefined) {
      const parent = plan.parentId ? ctx.db.select().from(categories).where(eq(categories.id, plan.parentId)).get() : null;
      lines.push({ label: 'Under', value: parent?.name ?? 'Top level' });
    }
    if (plan.color !== undefined) lines.push({ label: 'Colour', value: plan.color });
    if (plan.archived !== undefined) {
      lines.push({ label: plan.archived ? 'Archive it — hidden from pickers, records keep it' : 'Bring it back from the archive' });
    }
    return { title: `Change the category "${plan.category.name}"?`, lines, danger: false, confirmLabel: 'Change' };
  },
  apply(args, ctx) {
    const plan = planCategoryUpdate(args, ctx);
    updateCategory(ctx.db, plan.category.id, {
      ...(plan.name !== undefined ? { name: plan.name } : {}),
      ...(plan.parentId !== undefined ? { parentId: plan.parentId } : {}),
      ...(plan.color !== undefined ? { color: plan.color } : {}),
      ...(plan.archived !== undefined ? { archived: plan.archived } : {}),
    });
    return { response: { updated: true } };
  },
};

const deleteCategoryTool: WriteTool = {
  kind: 'write',
  activity: 'Preparing a deletion',
  declaration: {
    name: 'delete_category',
    description: 'Propose deleting a category. Refused while any record uses it — move those first, or archive instead.',
    parameters: { type: 'object', properties: { category: { type: 'string' } }, required: ['category'] },
  },
  prepare(args, ctx) {
    const category = resolveCategory(ctx.db, reqString(args, 'category'));
    return deletionPreview(ctx, { kind: 'category', id: category.id }, category.name, 'category');
  },
  apply(args, ctx) {
    const category = resolveCategory(ctx.db, reqString(args, 'category'));
    deleteEntity(ctx.db, { kind: 'category', id: category.id });
    return { response: { deleted: true } };
  },
};

const createTagTool: WriteTool = {
  kind: 'write',
  activity: 'Preparing a tag',
  declaration: {
    name: 'create_tag',
    description: 'Propose a new tag. To label records with it, use update_records add_tags instead — that creates it as well.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  prepare(args, ctx) {
    const name = cleanTagName(reqString(args, 'name'));
    if (existingTagKeys(ctx.db).has(tagKey(name))) throw new ToolInputError(`A tag called "${name}" already exists.`);
    return { title: `Add the tag "${name}"?`, lines: [], danger: false, confirmLabel: 'Add' };
  },
  apply(args, ctx) {
    const tag = ensureTag(ctx.db, reqString(args, 'name'));
    return { response: { created: true, id: tag.id } };
  },
};

const updateTagTool: WriteTool = {
  kind: 'write',
  activity: 'Preparing a tag change',
  declaration: {
    name: 'update_tag',
    description: 'Propose renaming, archiving or restoring a tag.',
    parameters: {
      type: 'object',
      properties: { tag: { type: 'string' }, name: { type: 'string' }, archived: { type: 'boolean' } },
      required: ['tag'],
    },
  },
  prepare(args, ctx) {
    const tag = resolveTag(ctx.db, reqString(args, 'tag'));
    const name = optString(args, 'name');
    const archived = optBool(args, 'archived');
    if (name === undefined && archived === undefined) throw new ToolInputError('Nothing to change. Pass name or archived.');
    const lines: PreviewLine[] = [];
    if (name !== undefined) lines.push({ label: 'Name', before: tag.name, value: cleanTagName(name) });
    if (archived !== undefined) lines.push({ label: archived ? 'Archive it' : 'Bring it back from the archive' });
    return { title: `Change the tag "${tag.name}"?`, lines, danger: false, confirmLabel: 'Change' };
  },
  apply(args, ctx) {
    const tag = resolveTag(ctx.db, reqString(args, 'tag'));
    const name = optString(args, 'name');
    const archived = optBool(args, 'archived');
    if (name !== undefined) renameTag(ctx.db, tag.id, name);
    if (archived !== undefined) setTagArchived(ctx.db, tag.id, archived);
    return { response: { updated: true } };
  },
};

const deleteTagTool: WriteTool = {
  kind: 'write',
  activity: 'Preparing a deletion',
  declaration: {
    name: 'delete_tag',
    description: 'Propose deleting a tag. Records keep everything else; they just lose the label.',
    parameters: { type: 'object', properties: { tag: { type: 'string' } }, required: ['tag'] },
  },
  prepare(args, ctx) {
    const tag = resolveTag(ctx.db, reqString(args, 'tag'));
    return deletionPreview(ctx, { kind: 'tag', id: tag.id }, tag.name, 'tag');
  },
  apply(args, ctx) {
    const tag = resolveTag(ctx.db, reqString(args, 'tag'));
    deleteEntity(ctx.db, { kind: 'tag', id: tag.id });
    return { response: { deleted: true } };
  },
};

const ACCOUNT_TYPES = ['cash', 'bank', 'card', 'savings', 'loan'] as const;

const createAccountTool: WriteTool = {
  kind: 'write',
  activity: 'Preparing an account',
  declaration: {
    name: 'create_account',
    description: 'Propose a new account. Opening balance is what it held before the first record; negative for a card or loan that is owed.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string', enum: [...ACCOUNT_TYPES] },
        currency: { type: 'string', description: 'ISO code. Defaults to the home currency.' },
        opening_balance: { type: 'number' },
      },
      required: ['name', 'type'],
    },
  },
  prepare(args, ctx) {
    const plan = planAccount(args, ctx);
    return {
      title: `Add the account "${plan.name}"?`,
      lines: [
        { label: 'Type', value: plan.type },
        { label: 'Opening balance', figure: { minor: plan.openingMinor, currency: plan.currency } },
      ],
      danger: false,
      confirmLabel: 'Add',
    };
  },
  apply(args, ctx) {
    const plan = planAccount(args, ctx);
    const account = createAccount(ctx.db, {
      name: plan.name,
      type: plan.type,
      currency: plan.currency,
      openingBalance: plan.openingMinor,
    });
    return { response: { created: true, id: account.id } };
  },
};

function planAccount(args: Args, ctx: ToolContext) {
  const name = reqString(args, 'name');
  const type = reqEnum(args, 'type', ACCOUNT_TYPES);
  const currency = (optString(args, 'currency') ?? ctx.homeCurrency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ToolInputError('"currency" must be a three-letter code like EGP.');
  const clash = ctx.db.select().from(accounts).all().find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (clash) throw new ToolInputError(`There is already an account called "${clash.name}".`);
  // Signed, unlike every other amount here: an opening balance on a card is a
  // debt, and that is the one place a negative figure is the right answer.
  const raw = args.opening_balance;
  let openingMinor = 0;
  if (raw !== undefined && raw !== null && raw !== 0) {
    const negative = typeof raw === 'number' ? raw < 0 : String(raw).trim().startsWith('-');
    const magnitude = amountMinor({ v: typeof raw === 'number' ? Math.abs(raw) : String(raw).replace('-', '') }, 'v', currency, true)!;
    openingMinor = negative ? -magnitude : magnitude;
  }
  return { name, type, currency, openingMinor };
}

const updateAccountTool: WriteTool = {
  kind: 'write',
  activity: 'Preparing an account change',
  declaration: {
    name: 'update_account',
    description: 'Propose renaming, archiving or restoring an account. An archived account keeps its money in the totals.',
    parameters: {
      type: 'object',
      properties: { account: { type: 'string' }, name: { type: 'string' }, archived: { type: 'boolean' } },
      required: ['account'],
    },
  },
  prepare(args, ctx) {
    const account = resolveAccount(ctx.db, reqString(args, 'account'));
    const name = optString(args, 'name');
    const archived = optBool(args, 'archived');
    if (name === undefined && archived === undefined) throw new ToolInputError('Nothing to change. Pass name or archived.');
    const lines: PreviewLine[] = [];
    if (name !== undefined) lines.push({ label: 'Name', before: account.name, value: name });
    if (archived !== undefined) lines.push({ label: archived ? 'Archive it — its balance still counts' : 'Bring it back from the archive' });
    return { title: `Change the account "${account.name}"?`, lines, danger: false, confirmLabel: 'Change' };
  },
  apply(args, ctx) {
    const account = resolveAccount(ctx.db, reqString(args, 'account'));
    const name = optString(args, 'name');
    const archived = optBool(args, 'archived');
    updateAccount(ctx.db, account.id, {
      ...(name !== undefined ? { name } : {}),
      ...(archived !== undefined ? { archived } : {}),
    });
    return { response: { updated: true } };
  },
};

const deleteAccountTool: WriteTool = {
  kind: 'write',
  activity: 'Preparing a deletion',
  declaration: {
    name: 'delete_account',
    description: 'Propose deleting an account with no records. One with records must be archived instead.',
    parameters: { type: 'object', properties: { account: { type: 'string' } }, required: ['account'] },
  },
  prepare(args, ctx) {
    const account = resolveAccount(ctx.db, reqString(args, 'account'));
    return deletionPreview(ctx, { kind: 'account', id: account.id }, account.name, 'account');
  },
  apply(args, ctx) {
    const account = resolveAccount(ctx.db, reqString(args, 'account'));
    deleteEntity(ctx.db, { kind: 'account', id: account.id });
    return { response: { deleted: true } };
  },
};

// ---------------------------------------------------------------------------
// Recurring rules and budgets
// ---------------------------------------------------------------------------

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;

function planRule(args: Args, ctx: ToolContext) {
  const type = reqEnum(args, 'type', ['expense', 'income', 'transfer'] as const);
  const account = resolveAccount(ctx.db, reqString(args, 'account'));
  assertHomeCurrency(account, ctx);
  const toAccount = type === 'transfer' ? resolveAccount(ctx.db, reqString(args, 'to_account')) : null;
  if (toAccount) assertHomeCurrency(toAccount, ctx);
  const categoryRef = type === 'transfer' ? undefined : optString(args, 'category');
  const category = categoryRef ? resolveCategory(ctx.db, categoryRef, type as 'expense' | 'income') : null;
  const frequency = reqEnum(args, 'frequency', FREQUENCIES);
  const interval = optInt(args, 'interval', 1, 365) ?? 1;
  const startsOn = reqString(args, 'starts_on');
  const endsOn = optString(args, 'ends_on') ?? null;
  for (const [name, value] of [['starts_on', startsOn], ['ends_on', endsOn]] as const) {
    if (value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ToolInputError(`"${name}" must be YYYY-MM-DD.`);
    if (value !== null) resolveSpan({ from: value, to: value });
  }
  return {
    type,
    account,
    toAccount,
    category,
    frequency,
    interval,
    startsOn,
    endsOn,
    name: optString(args, 'name') ?? null,
    note: optString(args, 'note') ?? null,
    amountMinor: amountMinor(args, 'amount', account.currency, true)!,
  };
}

const createRecurringTool: WriteTool = {
  kind: 'write',
  activity: 'Preparing a recurring payment',
  declaration: {
    name: 'create_recurring',
    description:
      'Propose a recurring rule (rent, salary, subscription). Each occurrence is offered on the records screen to approve, not written automatically. A start date in the past makes past occurrences due.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string', enum: ['expense', 'income', 'transfer'] },
        amount: { type: 'number' },
        account: { type: 'string' },
        to_account: { type: 'string', description: 'Transfers only.' },
        category: { type: 'string' },
        frequency: { type: 'string', enum: [...FREQUENCIES] },
        interval: { type: 'integer', description: 'Every N periods. Default 1.' },
        starts_on: { type: 'string', description: 'YYYY-MM-DD, the first occurrence.' },
        ends_on: { type: 'string', description: 'YYYY-MM-DD, optional last day.' },
        note: { type: 'string' },
      },
      required: ['type', 'amount', 'account', 'frequency', 'starts_on'],
    },
  },
  prepare(args, ctx) {
    const plan = planRule(args, ctx);
    const schedule = describeRecurrence({
      frequency: plan.frequency,
      interval: plan.interval,
      anchorDay: null,
      startsOn: plan.startsOn,
      endsOn: plan.endsOn,
    });
    const signed = plan.type === 'expense' ? -plan.amountMinor : plan.amountMinor;
    return {
      title: `Add the recurring ${plan.type} "${plan.name ?? plan.note ?? plan.category?.name ?? plan.account.name}"?`,
      lines: [
        { label: 'Amount', figure: { minor: signed, currency: plan.account.currency } },
        { label: 'Schedule', value: schedule },
        { label: 'Starts', value: plan.startsOn },
        ...(plan.endsOn ? [{ label: 'Ends', value: plan.endsOn }] : []),
        plan.toAccount
          ? { label: 'Accounts', value: `${plan.account.name} → ${plan.toAccount.name}` }
          : { label: 'Account', value: plan.account.name },
        ...(plan.category ? [{ label: 'Category', value: plan.category.name }] : []),
      ],
      danger: false,
      confirmLabel: 'Add',
    };
  },
  apply(args, ctx) {
    const plan = planRule(args, ctx);
    const rule = createRule(ctx.db, {
      name: plan.name,
      type: plan.type,
      accountId: plan.account.id,
      counterAccountId: plan.toAccount?.id ?? null,
      categoryId: plan.category?.id ?? null,
      amountMinor: plan.amountMinor,
      currency: plan.account.currency,
      note: plan.note,
      frequency: plan.frequency,
      interval: plan.interval,
      startsOn: plan.startsOn,
      endsOn: plan.endsOn,
    });
    return { response: { created: true, id: rule.id } };
  },
};

const updateRecurringTool: WriteTool = {
  kind: 'write',
  activity: 'Preparing a change',
  declaration: {
    name: 'update_recurring',
    description: 'Propose pausing or resuming a recurring rule.',
    parameters: {
      type: 'object',
      properties: { rule: { type: 'string', description: 'Rule id or name.' }, active: { type: 'boolean' } },
      required: ['rule', 'active'],
    },
  },
  prepare(args, ctx) {
    const rule = resolveRule(ctx.db, reqString(args, 'rule'));
    const active = optBool(args, 'active');
    if (active === undefined) throw new ToolInputError('"active" is required.');
    return {
      title: `${active ? 'Resume' : 'Pause'} "${rule.name ?? rule.note ?? 'this rule'}"?`,
      lines: [{ label: 'Amount', figure: { minor: rule.type === 'expense' ? -rule.amountMinor : rule.amountMinor, currency: rule.currency } }],
      danger: false,
      confirmLabel: active ? 'Resume' : 'Pause',
    };
  },
  apply(args, ctx) {
    const rule = resolveRule(ctx.db, reqString(args, 'rule'));
    setRuleActive(ctx.db, rule.id, optBool(args, 'active') ?? rule.active);
    return { response: { updated: true } };
  },
};

const deleteRecurringTool: WriteTool = {
  kind: 'write',
  activity: 'Preparing a deletion',
  declaration: {
    name: 'delete_recurring',
    description: 'Propose deleting a recurring rule. Records it already wrote are kept.',
    parameters: { type: 'object', properties: { rule: { type: 'string' } }, required: ['rule'] },
  },
  prepare(args, ctx) {
    const rule = resolveRule(ctx.db, reqString(args, 'rule'));
    return {
      title: `Delete the recurring "${rule.name ?? rule.note ?? 'rule'}"?`,
      lines: [
        { label: 'Amount', figure: { minor: rule.type === 'expense' ? -rule.amountMinor : rule.amountMinor, currency: rule.currency } },
        { label: 'Records it already wrote stay in the ledger.' },
      ],
      danger: true,
      confirmLabel: 'Delete',
    };
  },
  apply(args, ctx) {
    const rule = resolveRule(ctx.db, reqString(args, 'rule'));
    deleteRule(ctx.db, rule.id);
    return { response: { deleted: true } };
  },
};

function planBudget(args: Args, ctx: ToolContext) {
  const category = resolveCategory(ctx.db, reqString(args, 'category'), 'expense');
  if (category.parentId) {
    throw new ToolInputError(`Budgets are set on top-level categories; "${category.name}" is a sub-category.`);
  }
  assertBudgetable(ctx.db, category.id);
  const month = optString(args, 'month') ?? ymd(ctx.now).slice(0, 7);
  resolveSpan({ month });
  const raw = args.amount;
  const clearing = raw === 0 || raw === '0';
  const minor = clearing ? 0 : amountMinor(args, 'amount', ctx.homeCurrency, true)!;
  return { category, month, minor };
}

const setBudgetTool: WriteTool = {
  kind: 'write',
  activity: 'Preparing a budget',
  declaration: {
    name: 'set_budget',
    description: "Propose a month's spending limit for a top-level expense category, in the home currency. 0 removes it.",
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        month: { type: 'string', description: 'YYYY-MM. Defaults to the current month.' },
        amount: { type: 'number' },
      },
      required: ['category', 'amount'],
    },
  },
  prepare(args, ctx) {
    const plan = planBudget(args, ctx);
    return {
      title:
        plan.minor === 0
          ? `Remove the ${plan.category.name} budget for ${formatPeriod(plan.month)}?`
          : `Budget ${plan.category.name} for ${formatPeriod(plan.month)}?`,
      lines: plan.minor === 0 ? [] : [{ label: 'Limit', figure: { minor: plan.minor, currency: ctx.homeCurrency } }],
      danger: false,
      confirmLabel: plan.minor === 0 ? 'Remove' : 'Set',
    };
  },
  apply(args, ctx) {
    const plan = planBudget(args, ctx);
    setBudget(ctx.db, plan.category.id, plan.month, plan.minor, ctx.homeCurrency);
    return { response: { saved: true } };
  },
};

export const WRITE_TOOLS: WriteTool[] = [
  createRecordTool,
  updateRecordsTool,
  deleteRecordsTool,
  createCategoryTool,
  updateCategoryTool,
  deleteCategoryTool,
  createTagTool,
  updateTagTool,
  deleteTagTool,
  createAccountTool,
  updateAccountTool,
  deleteAccountTool,
  createRecurringTool,
  updateRecurringTool,
  deleteRecurringTool,
  setBudgetTool,
];

