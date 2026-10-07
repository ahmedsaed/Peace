import { listAccountsWithBalance, balanceByCurrency } from '../../db/repo/accounts';
import { listBudgets } from '../../db/repo/budgets';
import { totalHeld } from '../../db/repo/carry';
import { ledgerFacts, type LedgerFilter } from '../../db/repo/ledger-query';
import { ledgerSide } from '../../db/repo/predicates';
import { listRules, nextProposalDate } from '../../db/repo/recurring';
import { searchRecords } from '../../db/repo/search';
import { categories } from '../../db/schema';
import { sharePercents } from '../../lib/analysis';
import { formatPeriod } from '../../lib/period';
import { describeRecurrence } from '../../lib/recurrence';
import { EMPTY_QUERY, type SearchQuery } from '../../lib/search-query';
import { aggregate, GROUP_BYS, MEASURES, type Aggregate, type GroupBy, type Measure } from '../aggregate';
import { resolveSpan, spanLabel, ToolInputError, ymd, type Span } from '../dates';
import { citedFigures } from '../figures';
import type { Schema } from '../gemini-chat';
import {
  optBool,
  optEnum,
  optInt,
  optString,
  optStringList,
  reqEnum,
  reqString,
  resolveAccount,
  resolveCategory,
  resolveTag,
} from './resolve';
import type {
  Args,
  ChartPoint,
  ChartSpec,
  ChartType,
  ReadTool,
  ReportSection,
  StoredFilter,
  ToolContext,
} from './types';

// ---------------------------------------------------------------------------
// Shared argument shapes
// ---------------------------------------------------------------------------

const SPAN_PROPS: Record<string, Schema> = {
  month: { type: 'string', description: 'A calendar month, YYYY-MM. Use instead of from/to.' },
  from: { type: 'string', description: 'First day included, YYYY-MM-DD (or YYYY-MM / YYYY).' },
  to: { type: 'string', description: 'Last day included, YYYY-MM-DD (or YYYY-MM / YYYY).' },
};

const FILTER_PROPS: Record<string, Schema> = {
  category: {
    type: 'string',
    description: 'Category id or name. A parent category includes its sub-categories.',
  },
  tag: { type: 'string', description: 'Tag id or name.' },
  account: { type: 'string', description: 'Account id or name.' },
  text: {
    type: 'string',
    description:
      'Words to look for in notes, category, account and tag names — e.g. "coffee" or a shop name.',
  },
};

const MEASURE_PROP: Schema = {
  type: 'string',
  enum: MEASURES,
  description: 'expense = money spent (refunds subtract), income = money earned, net = income minus spending.',
};

const GROUP_PROP: Schema = {
  type: 'string',
  enum: GROUP_BYS,
  description:
    'How to split the total. month/week/day keep empty periods as zero. category groups by top-level category, subcategory by the exact one. tag groups overlap.',
};

type Filter = { span: Span; filter: LedgerFilter; stored: StoredFilter; described: string[] };

function readFilter(args: Args, ctx: ToolContext): Filter {
  const span = resolveSpan(args);
  const described: string[] = [];

  const categoryRef = optString(args, 'category');
  const category = categoryRef ? resolveCategory(ctx.db, categoryRef) : null;
  if (category) described.push(`category ${category.name}`);

  const tagRef = optString(args, 'tag');
  const tag = tagRef ? resolveTag(ctx.db, tagRef) : null;
  if (tag) described.push(`tag ${tag.name}`);

  const accountRef = optString(args, 'account');
  const account = accountRef ? resolveAccount(ctx.db, accountRef) : null;
  if (account) described.push(`account ${account.name}`);

  const text = optString(args, 'text') ?? '';
  if (text) described.push(`matching "${text}"`);

  const filter: LedgerFilter = {
    start: span.start,
    end: span.end,
    categoryId: category?.id ?? null,
    tagId: tag?.id ?? null,
    accountId: account?.id ?? null,
    text,
  };
  return {
    span,
    filter,
    described,
    stored: {
      start: span.start?.getTime() ?? null,
      end: span.end?.getTime() ?? null,
      categoryId: filter.categoryId ?? null,
      tagId: filter.tagId ?? null,
      accountId: filter.accountId ?? null,
      text,
    },
  };
}

/** A stored filter back into the shape `ledgerFacts` and search take. */
export function fromStored(stored: StoredFilter): LedgerFilter {
  return {
    start: stored.start === null ? null : new Date(stored.start),
    end: stored.end === null ? null : new Date(stored.end),
    categoryId: stored.categoryId,
    tagId: stored.tagId,
    accountId: stored.accountId,
    text: stored.text,
  };
}

/** The colour each top-level category already wears, so a chart matches the app. */
function categoryColors(ctx: ToolContext): Map<string, string> {
  return new Map(
    ctx.db
      .select({ id: categories.id, color: categories.color })
      .from(categories)
      .all()
      .flatMap((row) => (row.color ? [[row.id, row.color] as [string, string]] : []))
  );
}

function summarise(args: Args, ctx: ToolContext): { filter: Filter; measure: Measure; groupBy: GroupBy; result: Aggregate } {
  const filter = readFilter(args, ctx);
  const measure = reqEnum(args, 'measure', MEASURES);
  const groupBy = optEnum(args, 'group_by', GROUP_BYS) ?? 'none';
  const facts = ledgerFacts(ctx.db, filter.filter, ctx.homeCurrency);
  const result = aggregate(facts, {
    measure,
    groupBy,
    start: filter.span.start,
    end: filter.span.end,
  });
  return { filter, measure, groupBy, result };
}

/** What the model is told about a summary. Every amount is a cite. */
function summaryResponse(
  ctx: ToolContext,
  { filter, measure, groupBy, result }: ReturnType<typeof summarise>
): Record<string, unknown> {
  const cite = (minor: number) => ctx.figures.cite(minor, ctx.homeCurrency);
  const timeSeries = groupBy === 'month' || groupBy === 'week' || groupBy === 'day';
  // Shares only where the groups partition the total. Tags overlap, and net
  // mixes signs, so a percentage of either would be a number that means
  // nothing while looking exact.
  const partition = !result.overlapping && measure !== 'net' && !timeSeries && groupBy !== 'none';
  const percents = partition ? sharePercents(result.buckets.map((b) => Math.max(0, b.valueMinor))) : [];

  return {
    range: filter.span.label,
    filters: filter.described,
    measure,
    total: cite(result.totalMinor),
    records_counted: result.count,
    ...(result.unvaluedCount > 0
      ? {
          not_counted: `${result.unvaluedCount} record(s) have no ${ctx.homeCurrency} value and are left out.`,
        }
      : {}),
    ...(result.overlapping ? { note: 'Tags overlap: a record with two tags is in both groups, so groups do not add up to the total.' } : {}),
    ...(groupBy === 'none'
      ? {}
      : {
          groups: result.buckets.map((bucket, i) => ({
            label: bucket.label,
            value: cite(bucket.valueMinor),
            records: bucket.count,
            ...(partition ? { percent: percents[i] } : {}),
            ...(timeSeries && i > 0
              ? { change_from_previous: cite(bucket.valueMinor - result.buckets[i - 1].valueMinor) }
              : {}),
          })),
        }),
  };
}

const CITE_NOTE =
  'Every amount comes with a "cite" token. Write the token itself, e.g. {{t3f2}}, wherever you mention that amount — never type the number.';

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

const findRecords: ReadTool = {
  kind: 'read',
  activity: 'Searching records',
  declaration: {
    name: 'find_records',
    description:
      'Find individual records (expenses, income, transfers) matching filters. Returns totals over ALL matches and up to `limit` rows, newest first, with their ids. Set show=true to put the list on screen for the user.',
    parameters: {
      type: 'object',
      properties: {
        ...SPAN_PROPS,
        ...FILTER_PROPS,
        kind: { type: 'string', enum: ['expense', 'income', 'transfer'] },
        min_amount: { type: 'number', description: 'Smallest amount, unsigned, in the home currency.' },
        max_amount: { type: 'number', description: 'Largest amount, unsigned, in the home currency.' },
        limit: { type: 'integer', description: 'Rows to return, 1-50. Default 20.' },
        show: { type: 'boolean', description: 'Show the rows to the user as a tappable list.' },
        title: { type: 'string', description: 'Heading for the list when show=true.' },
      },
    },
  },
  run(args, ctx) {
    const { span, filter, described } = readFilter(args, ctx);
    const kind = optEnum(args, 'kind', ['expense', 'income', 'transfer'] as const) ?? null;
    const limit = optInt(args, 'limit', 1, 50) ?? 20;
    const min = args.min_amount;
    const max = args.max_amount;

    const query: SearchQuery = {
      ...EMPTY_QUERY,
      text: filter.text ?? '',
      kind,
      accountId: filter.accountId ?? null,
      categoryId: filter.categoryId ?? null,
      tagIds: filter.tagId ? [filter.tagId] : [],
      minAmount: typeof min === 'number' || typeof min === 'string' ? String(min) : '',
      maxAmount: typeof max === 'number' || typeof max === 'string' ? String(max) : '',
    };
    const outcome = searchRecords(ctx.db, query, {
      homeCurrency: ctx.homeCurrency,
      limit,
      now: ctx.now,
      span: { start: span.start, end: span.end },
    });

    const response: Record<string, unknown> = {
      range: span.label,
      filters: described,
      match_count: outcome.matchCount,
      returned: outcome.rows.length,
      // Over EVERY match, not the rows returned — a total of the first twenty
      // would silently mean "the first twenty of them".
      total_spent: ctx.figures.cite(-outcome.expenseMinor, ctx.homeCurrency),
      total_earned: ctx.figures.cite(outcome.incomeMinor, ctx.homeCurrency),
      ...(outcome.unvaluedCount > 0 ? { not_counted: outcome.unvaluedCount } : {}),
      records: outcome.rows.map((row) => ({
        id: row.id,
        date: ymd(row.occurredAt),
        kind: ledgerSide(row),
        ...(row.isRefund ? { refund: true } : {}),
        // What this row undoes — a refund's purchase, a reversal's transfer —
        // so "was that already refunded?" is answerable from the list.
        ...(row.reversesId ? { reverses: row.reversesId } : {}),
        amount: ctx.figures.cite(row.isTransfer ? Math.abs(row.amountMinor) : row.amountMinor, row.currency),
        category: row.categoryName,
        account: row.accountName,
        ...(row.counterAccountName ? { to_account: row.counterAccountName } : {}),
        ...(row.note ? { note: row.note.slice(0, 200) } : {}),
        ...(row.tags.length > 0 ? { tags: row.tags } : {}),
      })),
    };

    const show = optBool(args, 'show') ?? false;
    if (!show || outcome.rows.length === 0) return { response };
    return {
      response: { ...response, shown_to_user: true },
      display: {
        kind: 'records',
        title: optString(args, 'title') ?? 'Records',
        ids: outcome.rows.map((row) => row.id),
        matchCount: outcome.matchCount,
        rangeLabel: span.label,
      },
    };
  },
};

const summarize: ReadTool = {
  kind: 'read',
  activity: 'Adding up',
  declaration: {
    name: 'summarize',
    description:
      'Total spending, income or net over a span, optionally split by month/week/day/category/tag/account. Transfers between own accounts and balance corrections are excluded, refunds net against spending. This is how to answer "how much".',
    parameters: {
      type: 'object',
      properties: { measure: MEASURE_PROP, group_by: GROUP_PROP, ...SPAN_PROPS, ...FILTER_PROPS },
      required: ['measure'],
    },
  },
  run(args, ctx) {
    return { response: summaryResponse(ctx, summarise(args, ctx)) };
  },
};

/** A chart's spec from the same summary the model was given. */
export function chartFrom(
  args: Args,
  ctx: ToolContext,
  summary: ReturnType<typeof summarise>,
  title: string
): ChartSpec {
  const { filter, measure, groupBy, result } = summary;
  const timeSeries = groupBy === 'month' || groupBy === 'week' || groupBy === 'day';
  const asked = optEnum(args, 'chart', ['bar', 'line', 'donut'] as const) ?? (timeSeries ? 'bar' : 'donut');

  // The chart type has to suit the data, whatever was asked for. A donut of
  // months says nothing a bar does not, a donut cannot draw a negative net or
  // honest slices of overlapping tags, and a line across categories invents a
  // trend between things that have no order.
  let type: ChartType = asked;
  if (type === 'donut' && (timeSeries || measure === 'net' || result.overlapping || groupBy === 'none')) type = 'bar';
  if (type === 'line' && !timeSeries) type = 'bar';

  const colors = groupBy === 'category' || groupBy === 'subcategory' ? categoryColors(ctx) : new Map<string, string>();
  const points: ChartPoint[] = result.buckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    valueMinor: bucket.valueMinor,
    count: bucket.count,
    ...(bucket.start ? { start: bucket.start.getTime() } : {}),
    ...(bucket.end ? { end: bucket.end.getTime() } : {}),
    ...(bucket.categoryId !== undefined ? { categoryId: bucket.categoryId } : {}),
    ...(bucket.tagId ? { tagId: bucket.tagId } : {}),
    ...(bucket.accountId ? { accountId: bucket.accountId } : {}),
    ...(bucket.categoryId && colors.get(bucket.categoryId) ? { color: colors.get(bucket.categoryId) } : {}),
  }));

  return {
    title,
    type,
    measure,
    groupBy,
    rangeLabel: filter.span.label,
    currency: ctx.homeCurrency,
    points,
    totalMinor: result.totalMinor,
    unvaluedCount: result.unvaluedCount,
    overlapping: result.overlapping,
    filter: filter.stored,
  };
}

const showChart: ReadTool = {
  kind: 'read',
  activity: 'Drawing a chart',
  declaration: {
    name: 'show_chart',
    description:
      'Draw a chart for the user from the ledger — the app computes it, you only choose what to plot. bar suits comparisons and months, line suits trends over time, donut suits shares of a whole (categories). Returns the same figures as summarize. Use for "breakdown", "compare", "trend", "show me".',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short chart title, e.g. "Coffee by month".' },
        chart: { type: 'string', enum: ['bar', 'line', 'donut'] },
        measure: MEASURE_PROP,
        group_by: GROUP_PROP,
        ...SPAN_PROPS,
        ...FILTER_PROPS,
      },
      required: ['title', 'measure', 'group_by'],
    },
  },
  run(args, ctx) {
    const summary = summarise(args, ctx);
    if (summary.groupBy === 'none') {
      throw new ToolInputError('A chart needs group_by — month, category, tag, account, week or day.');
    }
    const chart = chartFrom(args, ctx, summary, reqString(args, 'title'));
    return {
      response: {
        ...summaryResponse(ctx, summary),
        chart: chart.type,
        shown_to_user: true,
        guidance: 'The chart is on screen. Point out what matters rather than listing every group.',
      },
      display: { kind: 'chart', chart },
    };
  },
};

const getBalances: ReadTool = {
  kind: 'read',
  activity: 'Reading balances',
  declaration: {
    name: 'get_balances',
    description:
      'Every account with its current balance in its own currency, plus totals per currency and the total held in the home currency. Archived accounts are included and marked — their money has not been spent.',
    parameters: { type: 'object', properties: {} },
  },
  run(_args, ctx) {
    const accounts = listAccountsWithBalance(ctx.db, true);
    return {
      response: {
        accounts: accounts.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          balance: ctx.figures.cite(a.balanceMinor, a.currency),
          ...(a.archived ? { archived: true } : {}),
          ...(a.type === 'card' && a.creditLimit
            ? { credit_limit: ctx.figures.cite(a.creditLimit, a.currency) }
            : {}),
        })),
        totals_by_currency: balanceByCurrency(ctx.db).map((t) => ctx.figures.cite(t.balanceMinor, t.currency)),
        total_held_in_home_currency: ctx.figures.cite(totalHeld(ctx.db, ctx.homeCurrency), ctx.homeCurrency),
      },
    };
  },
};

const listRecurring: ReadTool = {
  kind: 'read',
  activity: 'Reading recurring payments',
  declaration: {
    name: 'list_recurring',
    description: 'Every recurring rule (standing orders, subscriptions, salary): amount, schedule, next date due, and whether it is paused.',
    parameters: { type: 'object', properties: {} },
  },
  run(_args, ctx) {
    const today = ymd(ctx.now);
    return {
      response: {
        rules: listRules(ctx.db).map((rule) => ({
          id: rule.id,
          name: rule.name ?? rule.note ?? null,
          type: rule.type,
          amount: ctx.figures.cite(rule.amountMinor, rule.currency),
          schedule: describeRecurrence(rule),
          starts_on: rule.startsOn,
          ...(rule.endsOn ? { ends_on: rule.endsOn } : {}),
          next_due: rule.active ? nextProposalDate(ctx.db, rule, today) : null,
          active: rule.active,
          account_id: rule.accountId,
          ...(rule.counterAccountId ? { to_account_id: rule.counterAccountId } : {}),
          ...(rule.categoryId ? { category_id: rule.categoryId } : {}),
        })),
      },
    };
  },
};

const getBudgets: ReadTool = {
  kind: 'read',
  activity: 'Reading budgets',
  declaration: {
    name: 'get_budgets',
    description: "A month's budgets: each budgeted category's limit, spent and remaining, plus spending in categories with no budget.",
    parameters: {
      type: 'object',
      properties: { month: { type: 'string', description: 'YYYY-MM. Defaults to the current month.' } },
    },
  },
  run(args, ctx) {
    const month = optString(args, 'month') ?? ymd(ctx.now).slice(0, 7);
    resolveSpan({ month }); // validates
    const summary = listBudgets(ctx.db, month, ctx.homeCurrency);
    const cite = (minor: number) => ctx.figures.cite(minor, ctx.homeCurrency);
    return {
      response: {
        month: formatPeriod(month),
        budgeted: summary.budgeted.map((row) => ({
          category: row.categoryName,
          category_id: row.categoryId,
          limit: cite(row.budgetMinor),
          spent: cite(row.spentMinor),
          remaining: cite(row.budgetMinor - row.spentMinor),
          ...(row.stale ? { stale: 'set in a different currency; not comparable' } : {}),
        })),
        total_limit: cite(summary.totalBudgetMinor),
        total_spent_in_budgeted: cite(summary.totalSpentMinor),
        unbudgeted_spending: summary.unbudgeted
          .filter((row) => row.spentMinor > 0)
          .map((row) => ({ category: row.categoryName, spent: cite(row.spentMinor) })),
      },
    };
  },
};

/**
 * The span just before `span`, the same length, for "compared with last
 * month". Whole months step back in months — February is not 31 days — and
 * anything else steps back by its length in days. An open span has nothing
 * before it to compare with.
 */
export function previousSpan(span: Span): Span | null {
  if (!span.start || !span.end) return null;
  const s = span.start;
  const e = span.end;
  if (s.getDate() === 1 && e.getDate() === 1) {
    const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
    if (months > 0) {
      const start = new Date(s.getFullYear(), s.getMonth() - months, 1);
      return { start, end: s, label: spanLabel(start, s) };
    }
  }
  const days = Math.round((e.getTime() - s.getTime()) / 86_400_000);
  const start = new Date(s.getFullYear(), s.getMonth(), s.getDate() - days);
  return { start, end: s, label: spanLabel(start, s) };
}

/**
 * How to write a report, handed to the model in the tool's own description so
 * it is in view at the moment it decides what to write.
 *
 * The first version said only "you write the sections", and the reports read
 * like a database dump in paragraphs: "Clothing: X. Food: Y." A report is worth
 * opening when it says what HAPPENED and what to DO, so that is what this asks
 * for, with an outline to fall back on and the comparisons gathered first —
 * an insight needs something to be compared with.
 */
const REPORT_GUIDE = `Produce a PDF report the user can save. The app draws the cover (title, period, income/spending/net with the change from the previous period, top categories); you write the overview, takeaways and sections.

BEFORE CALLING: gather the figures with summarize (this period AND the previous one, by category and by month), find_records for the largest or unusual items, and get_budgets if budgets exist. Cite every amount with its {{token}}.

WRITE IT LIKE A SHARP, FRIENDLY ACCOUNTANT'S BRIEFING:
- overview: 2-3 sentences that answer "how did this period go, and why" — the verdict first.
- takeaways: 3 short lines, each a conclusion with its figure ("Dining out rose to {{t}} — the biggest change").
- sections: 3-6. A good default outline:
  1. Where the money went — category donut, and what dominates.
  2. What changed — compare with the previous period; a 6-month bar chart for the trend.
  3. Notable spending — the largest or unusual records, named.
  4. Budgets — over/under, only if budgets exist.
  5. What to do next — 2-4 concrete, specific suggestions tied to the numbers.
- Headings state the insight ("Dining out doubled"), not the topic ("Restaurants").
- highlights: 2-4 key figures per section where they help (label + cited value + short detail).
- Short paragraphs and "- " bullets. No filler, no repeating the cover's numbers without saying what they mean.
- Spending figures are negative in record lists and changes; write {{token|abs}} where the sentence already says the direction ("cut by", "over by", "spent").`;

const makeReport: ReadTool = {
  kind: 'read',
  activity: 'Writing a report',
  declaration: {
    name: 'make_report',
    description: REPORT_GUIDE,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Specific: "September 2026 — a costly month for the car", not "Report".' },
        ...SPAN_PROPS,
        overview: { type: 'string', description: 'The 2-3 sentence verdict, with cited amounts.' },
        takeaways: { type: 'array', items: { type: 'string' }, description: 'Three one-line conclusions with cited amounts.' },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string', description: 'The insight, not the topic.' },
              body: {
                type: 'string',
                description: 'Paragraphs and "- " bullet lines. **bold** is allowed. Cite amounts with tokens.',
              },
              highlights: {
                type: 'array',
                description: 'Up to 4 key figures shown as tiles.',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', description: 'What the figure is, 1-4 words.' },
                    value: { type: 'string', description: 'A cite token, e.g. {{t3f2}}, or a short percentage like "+42%".' },
                    detail: { type: 'string', description: 'Optional context, a few words.' },
                  },
                  required: ['label', 'value'],
                },
              },
              chart: {
                type: 'object',
                description:
                  'Optional chart, same fields as show_chart. Its span defaults to the report span; give it its own (e.g. six months) for a trend.',
                properties: {
                  title: { type: 'string' },
                  ...SPAN_PROPS,
                  chart: { type: 'string', enum: ['bar', 'line', 'donut'] },
                  measure: MEASURE_PROP,
                  group_by: GROUP_PROP,
                  ...FILTER_PROPS,
                },
              },
            },
            required: ['heading', 'body'],
          },
        },
      },
      required: ['title', 'overview', 'sections'],
    },
  },
  run(args, ctx) {
    const title = reqString(args, 'title');
    const span = resolveSpan(args);
    const raw = args.sections;
    if (!Array.isArray(raw) || raw.length === 0) throw new ToolInputError('"sections" needs at least one section.');
    if (raw.length > 12) throw new ToolInputError('A report has at most 12 sections.');

    const spanArgs = { month: args.month, from: args.from, to: args.to };
    const totalsFor = (s: Span) => {
      const facts = ledgerFacts(ctx.db, { start: s.start, end: s.end }, ctx.homeCurrency);
      const income = aggregate(facts, { measure: 'income', groupBy: 'none' });
      const expense = aggregate(facts, { measure: 'expense', groupBy: 'category' });
      return { income, expense };
    };
    const now = totalsFor(span);
    const before = previousSpan(span);
    const then = before ? totalsFor(before) : null;
    const top = now.expense.buckets.slice(0, 8);
    const percents = sharePercents(now.expense.buckets.map((b) => Math.max(0, b.valueMinor)));
    const previousByKey = new Map(then?.expense.buckets.map((b) => [b.key, b.valueMinor]) ?? []);

    const sections: ReportSection[] = raw.map((entry, i) => {
      const section = (entry ?? {}) as Args;
      const heading = reqString(section, 'heading');
      const body = optString(section, 'body') ?? '';
      const highlights = (Array.isArray(section.highlights) ? section.highlights : [])
        .slice(0, 4)
        .flatMap((h) => {
          const item = (h ?? {}) as Args;
          const label = optString(item, 'label');
          const value = optString(item, 'value');
          if (!label || !value) return [];
          const detail = optString(item, 'detail');
          return [{ label, value, ...(detail ? { detail } : {}) }];
        });
      const base = { heading, body, ...(highlights.length > 0 ? { highlights } : {}) };
      const chartArgs = section.chart as Args | undefined;
      if (!chartArgs || typeof chartArgs !== 'object') return base;
      try {
        // The section's own span wins: "how spending has moved" in a report on
        // one month needs the months before it, and overwriting that with the
        // report's span drew a trend chart with a single bar in it.
        const ownSpan = ['month', 'from', 'to'].some((k) => chartArgs[k] !== undefined && chartArgs[k] !== '');
        const merged = ownSpan ? { ...chartArgs } : { ...chartArgs, ...spanArgs };
        const summary = summarise(merged, ctx);
        if (summary.groupBy === 'none') return base;
        return { ...base, chart: chartFrom(merged, ctx, summary, optString(chartArgs, 'title') ?? heading) };
      } catch (error) {
        throw new ToolInputError(`Section ${i + 1} chart: ${(error as Error).message}`);
      }
    });

    const overview = optString(args, 'overview');
    const takeaways = (optStringList(args, 'takeaways') ?? []).slice(0, 5);
    // Every piece of prose the PDF will render, so every cite in it resolves.
    const prose = [
      title,
      overview ?? '',
      ...sections.map((s) => s.heading),
      ...takeaways,
      ...sections.flatMap((s) => [s.body, ...(s.highlights ?? []).map((h) => `${h.value} ${h.detail ?? ''}`)]),
    ];
    const lookup = (ref: string) => ctx.figures.get(ref);
    const figures = Object.assign({}, ...prose.map((text) => citedFigures(text, lookup)));

    return {
      response: {
        created: true,
        title,
        range: span.label,
        sections: sections.length,
        guidance: 'The report is on screen with a button to save it as a PDF. Tell the user in a sentence; do not repeat its contents.',
      },
      display: {
        kind: 'report',
        report: {
          title,
          rangeLabel: span.label,
          currency: ctx.homeCurrency,
          generatedAt: ctx.now.getTime(),
          ...(overview ? { overview } : {}),
          ...(takeaways.length > 0 ? { takeaways } : {}),
          summary: {
            incomeMinor: now.income.totalMinor,
            expenseMinor: now.expense.totalMinor,
            netMinor: now.income.totalMinor - now.expense.totalMinor,
            unvaluedCount: now.income.unvaluedCount + now.expense.unvaluedCount,
          },
          ...(then && before
            ? {
                previous: {
                  label: before.label,
                  incomeMinor: then.income.totalMinor,
                  expenseMinor: then.expense.totalMinor,
                  netMinor: then.income.totalMinor - then.expense.totalMinor,
                },
              }
            : {}),
          topCategories: top.map((bucket, i) => ({
            label: bucket.label,
            valueMinor: bucket.valueMinor,
            percent: percents[i],
            ...(then ? { previousMinor: previousByKey.get(bucket.key) ?? 0 } : {}),
          })),
          sections,
          figures,
        },
      },
    };
  },
};

export const READ_TOOLS: ReadTool[] = [
  summarize,
  findRecords,
  showChart,
  getBalances,
  getBudgets,
  listRecurring,
  makeReport,
];

export { CITE_NOTE };
