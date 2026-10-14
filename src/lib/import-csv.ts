/**
 * Reading a CSV into a plan of what an import would write — and nothing more.
 *
 * ONE FORMAT, AND IT IS PEACE'S OWN EXPORT. There is no column mapping and no
 * per-app preset: the columns are the ones Settings › Export writes, so a Peace
 * export comes back in untouched, and a file from anywhere else is adjusted
 * once, in a spreadsheet, against a format documented on peace.merope.dev.
 * Only four columns are required (`date`, `type`, `amount`, `account`); every
 * other one may be left out.
 *
 * PURE. The ledger is handed in as a snapshot, so every rule here is tested
 * without a database, and nothing is written until the person has seen the
 * preview and tapped Import (`repo/imports.ts`).
 *
 * The rules that matter, each one a way an import could silently corrupt a
 * ledger:
 *
 * - THE `type` COLUMN DECIDES THE SIDE, never the amount's sign. A refund is an
 *   expense with a positive amount (`is_refund`), so reading sides off signs
 *   is the bug `ledgerSide` exists to prevent. The amount's MAGNITUDE is used;
 *   people writing a file by hand put "50" for a fifty-pound lunch, and Peace's
 *   own export writes "-50.00", and both mean the same purchase. Only a
 *   `correction` keeps its sign, because there the sign IS the information.
 * - DATES ARE `YYYY-MM-DD` AND NOTHING ELSE. `13/08/2026` reads two ways, and
 *   both are valid dates — the one mistake nobody can see afterwards. A file
 *   in another order is fixed in the spreadsheet, once, with the person
 *   looking at it.
 * - AMOUNTS ARE STRICT. No thousands separators (is `1,234` one thousand or
 *   one point two?) and no more decimals than the currency has — rounding a
 *   figure on the way in is changing it.
 * - A FOREIGN RECORD NEEDS ITS HOME VALUE. A dollar purchase moves a dollar
 *   account, but every report counts it in the home currency at the rate of
 *   the day; without `home_amount` there is nothing honest to put there.
 * - EVERY ROW IS ANSWERED. A row that cannot be imported is listed with its
 *   line number and the reason, and the rest still can be. Rows whose `id` is
 *   already in the ledger are skipped and COUNTED, so importing the same
 *   export twice adds nothing and says so.
 */

import { decimalsFor } from './money';
import { cleanTagName, tagKey, tagNameProblem } from './tag';

export const IMPORT_COLUMNS = [
  'date',
  'time',
  'type',
  'amount',
  'currency',
  'account',
  'counter_account',
  'category',
  'parent_category',
  'note',
  'tags',
  'is_refund',
  'home_amount',
  'home_currency',
  'id',
  'transfer_pair_id',
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export const REQUIRED_COLUMNS: readonly ImportColumn[] = ['date', 'type', 'amount', 'account'];

/** What the planner needs to know about the ledger it is importing into. */
export type LedgerSnapshot = {
  homeCurrency: string;
  accounts: { id: string; name: string; currency: string }[];
  categories: { id: string; name: string; kind: 'expense' | 'income'; parentId: string | null }[];
  /** `tagKey` of every tag that exists, archived ones included. */
  tagKeys: Set<string>;
  /** Which of the ids named in the file are already records. */
  existingIds: Set<string>;
};

/** An account or category: one that exists, or one the import will create. */
export type Ref = { id: string } | { create: string };

export type NewAccount = { key: string; name: string; currency: string };
export type NewCategory = {
  key: string;
  name: string;
  kind: 'expense' | 'income';
  parent: Ref | null;
  /** For the preview: "Food › Snacks" whether Food is new or not. */
  parentName: string | null;
};

type Common = {
  /** 1-based line in the file, for anything said about this row later. */
  line: number;
  occurredAt: Date;
  /** Unsigned minor units, except on a correction. */
  amountMinor: number;
  currency: string;
  /** Home major units per major unit of `currency`; 1 at home. */
  fxRate: number;
  note: string | null;
  tags: string[];
  id: string | null;
};

export type PlannedRow =
  | (Common & {
      kind: 'record';
      type: 'expense' | 'income';
      isRefund: boolean;
      account: Ref;
      category: Ref | null;
    })
  | (Common & {
      kind: 'transfer';
      from: Ref;
      to: Ref;
      inId: string | null;
      /** A Peace export's `transfer_pair_id`, kept so the movement keeps its identity. */
      pairId: string | null;
    })
  | (Common & { kind: 'correction'; account: Ref });

export type Problem = { line: number; message: string };

export type ImportPlan = {
  rows: PlannedRow[];
  newAccounts: NewAccount[];
  newCategories: NewCategory[];
  /** Tags named in the file that do not exist yet, as they will be written. */
  newTags: string[];
  problems: Problem[];
  /** Rows skipped because their id is already in the ledger. */
  alreadyThere: number;
  counts: { expense: number; income: number; transfer: number; correction: number };
  /** First and last date imported, or null when nothing is. */
  span: { from: Date; to: Date } | null;
};

/** The file could not be read as an import at all. */
export type ImportFailure = { error: string };

const lower = (s: string) => s.trim().toLocaleLowerCase();

/** `2026-08-09` and `13:30`, as a LOCAL time — never parsed as UTC. */
export function parseWhen(date: string, time: string): Date | string {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!d) return `the date "${date}" is not YYYY-MM-DD`;
  const [y, m, day] = [Number(d[1]), Number(d[2]), Number(d[3])];

  let hour = 12;
  let minute = 0;
  if (time.trim() !== '') {
    const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
    if (!t || Number(t[1]) > 23 || Number(t[2]) > 59) return `the time "${time}" is not HH:MM`;
    hour = Number(t[1]);
    minute = Number(t[2]);
  }

  // Noon when no time is given: a date with no time is a DAY, and noon is the
  // instant furthest from either midnight, so no timezone or DST shift can
  // carry it into the day before.
  const at = new Date(y, m - 1, day, hour, minute);
  if (at.getFullYear() !== y || at.getMonth() !== m - 1 || at.getDate() !== day) {
    return `${date} is not a real date`;
  }
  return at;
}

/**
 * A decimal amount, to signed minor units — strictly.
 *
 * Not `parseAmountToMinor`, which is built for a keypad: it drops commas and
 * quietly truncates extra decimals, and both of those would CHANGE a figure in
 * a file without anybody seeing it happen.
 */
export function parseStrictAmount(raw: string, currency: string): number | string {
  const text = raw.trim().replace(/^\+/, '');
  if (text === '') return 'the amount is empty';
  if (/[,\s]/.test(text)) {
    return `"${raw}" has a comma or space in it — write ${currency} amounts like 1234.50`;
  }
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return `"${raw}" is not a number`;
  const decimals = decimalsFor(currency);
  const fraction = m[3] ?? '';
  if (fraction.length > decimals) {
    return decimals === 0
      ? `${currency} has no decimals, but the amount is ${raw}`
      : `${currency} has ${decimals} decimals, but the amount is ${raw}`;
  }
  const minor = Number(`${m[2]}${fraction.padEnd(decimals, '0')}`);
  if (!Number.isSafeInteger(minor)) return `"${raw}" is too large`;
  return m[1] === '-' ? -minor : minor;
}

const TRUE = new Set(['1', 'true', 'yes', 'y']);
const FALSE = new Set(['', '0', 'false', 'no', 'n']);

/**
 * Turn a parsed CSV (first row the header) into a plan.
 *
 * Nothing here throws on bad data: a bad FILE is an `ImportFailure`, a bad
 * ROW is a `Problem`, and the rest of the file still plans.
 */
export function planImport(table: string[][], ledger: LedgerSnapshot): ImportPlan | ImportFailure {
  if (table.length === 0) return { error: 'The file is empty.' };

  const header = table[0].map(lower);
  const at = new Map<string, number>();
  header.forEach((name, i) => {
    if (!at.has(name)) at.set(name, i);
  });
  const missing = REQUIRED_COLUMNS.filter((c) => !at.has(c));
  if (missing.length > 0) {
    return {
      error: `The file has no ${missing.join(', ')} column${missing.length > 1 ? 's' : ''}. The first row must name the columns — see the template.`,
    };
  }
  if (table.length === 1) return { error: 'The file has a header and no records.' };

  const home = ledger.homeCurrency.toUpperCase();
  const plan: ImportPlan = {
    rows: [],
    newAccounts: [],
    newCategories: [],
    newTags: [],
    problems: [],
    alreadyThere: 0,
    counts: { expense: 0, income: 0, transfer: 0, correction: 0 },
    span: null,
  };

  // --- accounts --------------------------------------------------------------
  const accountsByName = new Map(ledger.accounts.map((a) => [lower(a.name), a]));
  const newAccountsByName = new Map<string, NewAccount>();

  /** The account named, its currency, and the ref to write against. */
  const resolveAccount = (name: string, currency: string | null): { ref: Ref; currency: string } => {
    const key = lower(name);
    const existing = accountsByName.get(key);
    if (existing) return { ref: { id: existing.id }, currency: existing.currency.toUpperCase() };
    let created = newAccountsByName.get(key);
    if (!created) {
      created = { key, name: name.trim(), currency: currency ?? home };
      newAccountsByName.set(key, created);
      plan.newAccounts.push(created);
    }
    return { ref: { create: key }, currency: created.currency };
  };

  // --- categories ------------------------------------------------------------
  const newCategories = new Map<string, NewCategory>();
  const catKey = (kind: string, parent: string, name: string) => `${kind}/${parent}/${name}`;

  const resolveCategory = (
    kind: 'expense' | 'income',
    rawName: string,
    rawParent: string
  ): Ref | string => {
    const name = lower(rawName);
    const parentName = lower(rawParent);
    const ofKind = ledger.categories.filter((c) => c.kind === kind);
    const topLevel = (n: string) => ofKind.find((c) => c.parentId === null && lower(c.name) === n);

    const ensureTop = (n: string, display: string): Ref => {
      const found = topLevel(n);
      if (found) return { id: found.id };
      const key = catKey(kind, '', n);
      if (!newCategories.has(key)) {
        const created: NewCategory = { key, name: display.trim(), kind, parent: null, parentName: null };
        newCategories.set(key, created);
        plan.newCategories.push(created);
      }
      return { create: key };
    };

    if (parentName === '') {
      const top = topLevel(name);
      if (top) return { id: top.id };
      const children = ofKind.filter((c) => c.parentId !== null && lower(c.name) === name);
      if (children.length === 1) return { id: children[0].id };
      if (children.length > 1) {
        return `more than one ${kind} category is called "${rawName.trim()}" — add its parent_category`;
      }
      return ensureTop(name, rawName);
    }

    const parent = ensureTop(parentName, rawParent);
    if ('id' in parent) {
      const child = ofKind.find((c) => c.parentId === parent.id && lower(c.name) === name);
      if (child) return { id: child.id };
    }
    const key = catKey(kind, parentName, name);
    if (!newCategories.has(key)) {
      const existingParent = 'id' in parent ? ofKind.find((c) => c.id === parent.id)?.name : null;
      const created: NewCategory = {
        key,
        name: rawName.trim(),
        kind,
        parent,
        parentName: existingParent ?? rawParent.trim(),
      };
      newCategories.set(key, created);
      plan.newCategories.push(created);
    }
    return { create: key };
  };

  // --- tags ------------------------------------------------------------------
  const seenNewTags = new Set<string>();
  const readTags = (raw: string): string[] | string => {
    const names = raw
      .split(';')
      .map((t) => t.trim())
      .filter(Boolean);
    for (const name of names) {
      const problem = tagNameProblem(name);
      if (problem) return `the tag "${name}" is ${problem === 'too-long' ? 'too long' : 'not usable'}`;
    }
    for (const name of names) {
      const key = tagKey(name);
      if (!ledger.tagKeys.has(key) && !seenNewTags.has(key)) {
        seenNewTags.add(key);
        plan.newTags.push(cleanTagName(name));
      }
    }
    return names;
  };

  // --- rows ------------------------------------------------------------------
  const seenIds = new Set<string>();
  const pairsDone = new Set<string>();
  // A transfer exported by Peace is TWO rows sharing a pair id. Index them so
  // the outgoing leg can be found from either one.
  const col = (row: string[], name: ImportColumn) => {
    const i = at.get(name);
    return i === undefined ? '' : (row[i] ?? '').trim();
  };
  const legsByPair = new Map<string, number[]>();
  table.slice(1).forEach((row, i) => {
    const pair = col(row, 'transfer_pair_id');
    if (pair) legsByPair.set(pair, [...(legsByPair.get(pair) ?? []), i + 1]);
  });

  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    const line = r + 1;
    const problem = (message: string) => plan.problems.push({ line, message });

    const type = lower(col(row, 'type'));
    if (!['expense', 'income', 'transfer', 'correction'].includes(type)) {
      problem(
        col(row, 'type') === ''
          ? 'the type is empty — use expense, income, transfer or correction'
          : `"${col(row, 'type')}" is not a type — use expense, income, transfer or correction`
      );
      continue;
    }

    // One movement, two rows: plan it from whichever leg comes first and let
    // the other one pass in silence.
    const pair = type === 'transfer' ? col(row, 'transfer_pair_id') : '';
    if (pair && pairsDone.has(pair)) continue;
    if (pair) {
      // Planned from the OUTGOING leg, which carries the note and the tags
      // the list shows; the incoming one waits for it. Only a pair whose
      // outgoing leg is missing is planned from what is left.
      const outLeg = (legsByPair.get(pair) ?? []).find((i) => col(table[i], 'amount').startsWith('-'));
      if (outLeg !== undefined && outLeg !== r) continue;
    }

    const id = col(row, 'id') || null;
    const pairIds = pair
      ? (legsByPair.get(pair) ?? []).map((i) => col(table[i], 'id')).filter(Boolean)
      : id
        ? [id]
        : [];
    if (pairIds.some((x) => ledger.existingIds.has(x))) {
      if (pair) pairsDone.add(pair);
      plan.alreadyThere++;
      continue;
    }
    if (pairIds.some((x) => seenIds.has(x))) {
      problem(`the id ${pairIds.find((x) => seenIds.has(x))} appears twice in the file`);
      continue;
    }

    const when = parseWhen(col(row, 'date'), col(row, 'time'));
    if (typeof when === 'string') {
      problem(when);
      continue;
    }

    const accountName = col(row, 'account');
    if (accountName === '') {
      problem('the account is empty');
      continue;
    }
    const rowCurrency = col(row, 'currency').toUpperCase() || null;
    if (rowCurrency && !/^[A-Z]{3}$/.test(rowCurrency)) {
      problem(`"${col(row, 'currency')}" is not a currency code like EGP or USD`);
      continue;
    }

    const account = resolveAccount(accountName, rowCurrency);
    const currency = rowCurrency ?? account.currency;
    if (currency !== account.currency) {
      problem(`${accountName} is in ${account.currency}, but this row is in ${currency}`);
      continue;
    }

    const amount = parseStrictAmount(col(row, 'amount'), currency);
    if (typeof amount === 'string') {
      problem(amount);
      continue;
    }
    if (amount === 0) {
      problem('the amount is zero');
      continue;
    }

    // What it was worth at home, for anything not already there.
    let fxRate = 1;
    if (currency !== home) {
      const homeCurrency = col(row, 'home_currency').toUpperCase();
      const homeAmountRaw = col(row, 'home_amount');
      if (homeAmountRaw === '') {
        problem(`a ${currency} record needs home_amount — what it cost in ${home}`);
        continue;
      }
      if (homeCurrency !== '' && homeCurrency !== home) {
        problem(`home_amount is in ${homeCurrency}, but your home currency is ${home}`);
        continue;
      }
      const homeMinor = parseStrictAmount(homeAmountRaw, home);
      if (typeof homeMinor === 'string') {
        problem(`home_amount: ${homeMinor}`);
        continue;
      }
      if (homeMinor === 0) {
        problem('home_amount is zero');
        continue;
      }
      // Major units on both sides, as `fxRate` is defined.
      fxRate =
        Math.abs(homeMinor) / 10 ** decimalsFor(home) / (Math.abs(amount) / 10 ** decimalsFor(currency));
    }

    const tags = readTags(col(row, 'tags'));
    if (typeof tags === 'string') {
      problem(tags);
      continue;
    }

    const refundRaw = lower(col(row, 'is_refund'));
    if (!TRUE.has(refundRaw) && !FALSE.has(refundRaw)) {
      problem(`is_refund is "${col(row, 'is_refund')}" — leave it empty, or write 1`);
      continue;
    }
    const isRefund = TRUE.has(refundRaw);
    if (isRefund && type !== 'expense') {
      problem('only an expense can be a refund');
      continue;
    }

    const common: Common = {
      line,
      occurredAt: when,
      amountMinor: Math.abs(amount),
      currency,
      fxRate,
      note: col(row, 'note') === '' ? null : (row[at.get('note')!] ?? null),
      tags,
      id,
    };

    if (type === 'transfer') {
      const otherName = col(row, 'counter_account');
      if (otherName === '') {
        problem('a transfer needs counter_account — where the money went');
        continue;
      }
      if (lower(otherName) === lower(accountName)) {
        problem('a transfer needs two different accounts');
        continue;
      }
      const other = resolveAccount(otherName, currency);
      if (other.currency !== currency) {
        problem(`${accountName} is in ${currency} and ${otherName} in ${other.currency} — import moves money within one currency`);
        continue;
      }

      // A lone row — written by hand — always reads account → counter_account.
      // A Peace export's pair is planned from its outgoing leg (above), so a
      // POSITIVE row here is an incoming leg whose partner is missing: it
      // names the destination first.
      let from = account.ref;
      let to = other.ref;
      let outId = id;
      let inId: string | null = null;
      if (pair) {
        const partner = (legsByPair.get(pair) ?? []).find((i) => i !== r);
        const partnerId = partner === undefined ? null : col(table[partner], 'id') || null;
        if (amount > 0) {
          from = other.ref;
          to = account.ref;
          outId = partnerId;
          inId = id;
        } else {
          inId = partnerId;
        }
        pairsDone.add(pair);
      }
      // Tags and the note travel on the outgoing leg, where the list shows them.
      plan.rows.push({ ...common, kind: 'transfer', from, to, id: outId, inId, pairId: pair || null });
      for (const x of [outId, inId]) if (x) seenIds.add(x);
      plan.counts.transfer++;
    } else if (type === 'correction') {
      plan.rows.push({ ...common, kind: 'correction', account: account.ref, amountMinor: amount });
      if (id) seenIds.add(id);
      plan.counts.correction++;
    } else {
      const kind = type as 'expense' | 'income';
      const categoryName = col(row, 'category');
      let category: Ref | null = null;
      if (categoryName !== '') {
        const found = resolveCategory(kind, categoryName, col(row, 'parent_category'));
        if (typeof found === 'string') {
          problem(found);
          continue;
        }
        category = found;
      }
      plan.rows.push({ ...common, kind: 'record', type: kind, isRefund, account: account.ref, category });
      if (id) seenIds.add(id);
      plan.counts[kind]++;
    }

    const t = when.getTime();
    if (!plan.span) plan.span = { from: when, to: when };
    else {
      if (t < plan.span.from.getTime()) plan.span.from = when;
      if (t > plan.span.to.getTime()) plan.span.to = when;
    }
  }

  // Something created and then used by no row that survived — a new account
  // named only on rows that all failed — must not be created at all.
  const usedAccounts = new Set<string>();
  const usedCategories = new Set<string>();
  const mark = (ref: Ref | null, into: Set<string>) => {
    if (ref && 'create' in ref) into.add(ref.create);
  };
  for (const row of plan.rows) {
    if (row.kind === 'transfer') {
      mark(row.from, usedAccounts);
      mark(row.to, usedAccounts);
    } else {
      mark(row.account, usedAccounts);
      if (row.kind === 'record') mark(row.category, usedCategories);
    }
  }
  for (const c of plan.newCategories) {
    if (usedCategories.has(c.key)) mark(c.parent, usedCategories);
  }
  plan.newAccounts = plan.newAccounts.filter((a) => usedAccounts.has(a.key));
  plan.newCategories = plan.newCategories.filter((c) => usedCategories.has(c.key));
  const usedTags = new Set(plan.rows.flatMap((row) => row.tags.map(tagKey)));
  plan.newTags = plan.newTags.filter((t) => usedTags.has(tagKey(t)));

  return plan;
}

/** The ids a plan names, so the caller can ask the ledger which exist. */
export function idsInFile(table: string[][]): string[] {
  const i = (table[0] ?? []).map(lower).indexOf('id');
  if (i < 0) return [];
  return table
    .slice(1)
    .map((row) => (row[i] ?? '').trim())
    .filter(Boolean);
}

/**
 * A file to start from: the header and one row of each kind, written in the
 * format they describe. Amounts in the home currency so it imports as it is.
 */
export function importTemplate(homeCurrency: string): string[][] {
  const c = homeCurrency.toUpperCase();
  // Written at the currency's own precision: "25000.00" is refused for yen.
  const a = (major: number) => major.toFixed(decimalsFor(c));
  return [
    ['date', 'time', 'type', 'amount', 'currency', 'account', 'counter_account', 'category', 'parent_category', 'note', 'tags', 'is_refund'],
    ['2026-08-01', '09:00', 'income', a(25000), c, 'Bank', '', 'Salary', '', 'August salary', '', ''],
    ['2026-08-03', '13:30', 'expense', a(155.5), c, 'Cash', '', 'Restaurants', 'Food', 'Lunch', 'work', ''],
    ['2026-08-05', '', 'expense', a(800), c, 'Bank', '', 'Clothing', '', 'Returned the shoes', '', '1'],
    ['2026-08-06', '', 'transfer', a(3000), c, 'Bank', 'Cash', '', '', 'ATM', '', ''],
    ['2026-08-31', '', 'correction', a(-12), c, 'Cash', '', '', '', 'Counted the drawer', '', ''],
  ];
}
