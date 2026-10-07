import { InvariantError } from '../../db/repo/categories';
import { RecurringError } from '../../db/repo/recurring';
import { restoreRecords } from '../../db/repo/transactions';
import { attachments, transactionTags } from '../../db/schema';
import { ToolInputError } from '../dates';
import type { FunctionCall, FunctionDeclaration } from '../gemini-chat';
import { READ_TOOLS } from './read';
import type { Db, Display, Preview, Tool, ToolContext, Undo } from './types';
import { WRITE_TOOLS } from './write';

export const TOOLS: Tool[] = [...READ_TOOLS, ...WRITE_TOOLS];

const BY_NAME = new Map(TOOLS.map((tool) => [tool.declaration.name, tool]));

export function findTool(name: string): Tool | undefined {
  return BY_NAME.get(name);
}

export function declarations(): FunctionDeclaration[] {
  return TOOLS.map((tool) => tool.declaration);
}

/** Reads run at once; writes wait for a tap. Unknown names are treated as reads so they fail fast. */
export function isWrite(name: string): boolean {
  return findTool(name)?.kind === 'write';
}

/**
 * A failure the MODEL should read and recover from, as opposed to one the
 * user has to be told about. Bad arguments, a name that matches nothing, an
 * invariant the repository refused — the model can fix every one of these by
 * asking differently, so the message goes back to it verbatim.
 */
function expected(error: unknown): error is Error {
  return error instanceof ToolInputError || error instanceof InvariantError || error instanceof RecurringError;
}

function failure(error: unknown, name: string): { error: string } {
  if (expected(error)) return { error: error.message };
  // Anything else is a bug here, not a mistake there. The model gets enough to
  // tell the user something went wrong; the log gets the real thing.
  console.warn(`[assistant] tool ${name} threw`, error);
  return { error: `The ${name} tool failed unexpectedly. Tell the user it did not work.` };
}

function args(call: FunctionCall): Record<string, unknown> {
  return call.args && typeof call.args === 'object' ? call.args : {};
}

export function runRead(
  call: FunctionCall,
  ctx: ToolContext
): { response: Record<string, unknown>; display?: Display } {
  const tool = findTool(call.name);
  if (!tool) return { response: { error: `There is no tool called ${call.name}.` } };
  if (tool.kind !== 'read') return { response: { error: `${call.name} needs approval.` } };
  try {
    return tool.run(args(call), ctx);
  } catch (error) {
    return { response: failure(error, call.name) };
  }
}

export function prepareWrite(call: FunctionCall, ctx: ToolContext): { preview: Preview } | { error: string } {
  const tool = findTool(call.name);
  if (!tool || tool.kind !== 'write') return { error: `There is no write tool called ${call.name}.` };
  try {
    return { preview: tool.prepare(args(call), ctx) };
  } catch (error) {
    return failure(error, call.name);
  }
}

export function applyWrite(
  call: FunctionCall,
  ctx: ToolContext
): { response: Record<string, unknown>; undo?: Undo } {
  const tool = findTool(call.name);
  if (!tool || tool.kind !== 'write') return { response: { error: `There is no write tool called ${call.name}.` } };
  try {
    return tool.apply(args(call), ctx);
  } catch (error) {
    return { response: failure(error, call.name) };
  }
}

/** Put back what an applied write removed. Only deletions of records offer it. */
export function undoWrite(db: Db, undo: Undo): void {
  if (!undo) return;
  db.transaction((tx) => {
    const inner = tx as unknown as Db;
    restoreRecords(inner, undo.rows);
    if (undo.tags.length > 0) inner.insert(transactionTags).values(undo.tags).onConflictDoNothing().run();
    if (undo.attachments.length > 0) inner.insert(attachments).values(undo.attachments).onConflictDoNothing().run();
  });
}

export type { Display, Preview, ToolContext, Undo };
