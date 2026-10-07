import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type * as schema from '../../db/schema';
import type { GroupBy, Measure } from '../aggregate';
import type { Figure, FigureBook } from '../figures';
import type { FunctionDeclaration } from '../gemini-chat';

export type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export type ToolContext = {
  db: Db;
  homeCurrency: string;
  now: Date;
  figures: FigureBook;
};

export type Args = Record<string, unknown>;

/**
 * A filter, stored. Dates as epoch ms because this lands in JSON — in the
 * conversation history — and a `Date` would come back as a string.
 */
export type StoredFilter = {
  start: number | null;
  end: number | null;
  categoryId: string | null;
  tagId: string | null;
  accountId: string | null;
  text: string;
};

export type ChartType = 'bar' | 'line' | 'donut';

export type ChartPoint = {
  key: string;
  label: string;
  valueMinor: number;
  count: number;
  /** Time buckets only: the bucket's own span, for drilling in. */
  start?: number;
  end?: number;
  categoryId?: string | null;
  tagId?: string;
  accountId?: string;
  color?: string;
};

export type ChartSpec = {
  title: string;
  type: ChartType;
  measure: Measure;
  groupBy: GroupBy;
  rangeLabel: string;
  currency: string;
  points: ChartPoint[];
  totalMinor: number;
  unvaluedCount: number;
  overlapping: boolean;
  filter: StoredFilter;
};

export type ReportSection = {
  heading: string;
  /** Markdown-ish prose with cite tokens. */
  body: string;
  chart?: ChartSpec;
};

export type ReportSpec = {
  title: string;
  rangeLabel: string;
  currency: string;
  generatedAt: number;
  summary: { incomeMinor: number; expenseMinor: number; netMinor: number; unvaluedCount: number };
  topCategories: { label: string; valueMinor: number; percent: number }[];
  sections: ReportSection[];
  /** Every figure the prose cites, resolved when the report was written. */
  figures: Record<string, Figure>;
};

/** What a tool puts on screen, beside what it tells the model. */
export type Display =
  | { kind: 'chart'; chart: ChartSpec }
  | { kind: 'records'; title: string; ids: string[]; matchCount: number; rangeLabel: string }
  | { kind: 'report'; report: ReportSpec };

export type ReadOutcome = { response: Record<string, unknown>; display?: Display };

export type PreviewLine = {
  label: string;
  value?: string;
  /** An amount, rendered through `useMoney` like every other. */
  figure?: Figure;
  /** What it was, for an update. */
  before?: string;
};

export type Preview = {
  title: string;
  lines: PreviewLine[];
  /** Deletes. The card asks twice and paints the button in the expense colour. */
  danger: boolean;
  confirmLabel: string;
};

/** What an applied write leaves behind so it can be taken back. */
export type Undo =
  | {
      kind: 'records';
      rows: schema.Transaction[];
      tags: { transactionId: string; tagId: string }[];
      /** The rows only — the files stay on disk until the next launch's sweep. */
      attachments: schema.Attachment[];
    }
  | null;

export type WriteOutcome = { response: Record<string, unknown>; undo?: Undo };

export type ReadTool = {
  kind: 'read';
  declaration: FunctionDeclaration;
  /** A few words for the activity line: "Searching records". */
  activity: string;
  run: (args: Args, ctx: ToolContext) => ReadOutcome;
};

/**
 * A write is two halves, and the gap between them is the user's approval.
 *
 * `prepare` validates and describes; it must not change anything. `apply`
 * runs only after a tap, and validates AGAIN — the proposal may have sat
 * there while the ledger changed underneath it, or across a restart.
 */
export type WriteTool = {
  kind: 'write';
  declaration: FunctionDeclaration;
  activity: string;
  prepare: (args: Args, ctx: ToolContext) => Preview;
  apply: (args: Args, ctx: ToolContext) => WriteOutcome;
};

export type Tool = ReadTool | WriteTool;
