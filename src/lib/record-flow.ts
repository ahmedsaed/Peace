/**
 * What the `=` key should do next.
 *
 * The record screen can be driven entirely from the keypad: `=` advances
 * through the choices a record needs — account, then category — and saves once
 * everything is in place. That matters because the pickers live at the TOP of
 * the screen and the keypad at the bottom, so logging a spend one-handed
 * otherwise means reaching across the whole phone twice.
 *
 * `=` KEEPS ITS ARITHMETIC MEANING. A pending operation always wins: typing
 * `120 + 35 =` must still show 155, not save a record. Only once there is
 * nothing to evaluate does the key act as "next", which is safe because the
 * calculator is immediate-execution — an operator already commits the previous
 * step, so a pending operation exists exactly when the user is mid-sum.
 *
 * Pure, and tested at every branch, because the failure mode is a keypress
 * doing something the user did not intend — and one of the things it can do is
 * save a record.
 */

export type RecordType = 'income' | 'expense' | 'transfer';
export type Sheet = 'account' | 'toAccount' | 'category';

export type FlowAction =
  /** Finish the sum first. */
  | { kind: 'evaluate' }
  /** Open a picker. */
  | { kind: 'open'; sheet: Sheet }
  /** Everything is present; write the record. */
  | { kind: 'save' }
  /** Nothing to open and nothing to save — say why rather than doing nothing. */
  | { kind: 'incomplete'; message: string };

export type FlowState = {
  /** True while an operator is waiting for its right-hand side or its result. */
  hasPendingOp: boolean;
  type: RecordType;
  accountId: string | null;
  toAccountId: string | null;
  categoryId: string | null;
  /** Committed amount, or null when the entry is not a usable number. */
  amountMinor: number | null;
  /**
   * Pickers the flow has already put in front of the user for this record.
   *
   * The flow offers each step ONCE. Without this, dismissing the category sheet
   * would reopen it on the next `=` forever — and a category is not actually
   * required to save, so that would be an inescapable loop around an optional
   * field.
   */
  offered: readonly Sheet[];
};

/** The pickers this record type needs, in the order they are asked for. */
function sheetsFor(type: RecordType): Sheet[] {
  return type === 'transfer' ? ['account', 'toAccount'] : ['account', 'category'];
}

function canSave(state: FlowState): boolean {
  if (state.amountMinor === null || state.amountMinor <= 0) return false;
  if (!state.accountId) return false;
  if (state.type === 'transfer') {
    return !!state.toAccountId && state.toAccountId !== state.accountId;
  }
  return true;
}

export function nextAction(state: FlowState): FlowAction {
  // 1. Arithmetic always wins. `=` is a calculator key first.
  if (state.hasPendingOp) return { kind: 'evaluate' };

  // 2. Walk the record's own steps, offering each exactly once. The account is
  //    offered even though it has a default: the default is a guess, and the
  //    whole point of this flow is that choosing it costs one thumb press
  //    rather than a reach to the top of the screen.
  for (const sheet of sheetsFor(state.type)) {
    if (!state.offered.includes(sheet)) return { kind: 'open', sheet };
  }

  // 3. Everything asked, everything present.
  if (canSave(state)) return { kind: 'save' };

  // 4. Asked but still not satisfiable. Reopen what is actually missing rather
  //    than leaving the key dead — dismissing the account sheet must not strand
  //    the record with no way forward.
  if (!state.accountId) return { kind: 'open', sheet: 'account' };
  if (state.type === 'transfer' && (!state.toAccountId || state.toAccountId === state.accountId)) {
    return { kind: 'open', sheet: 'toAccount' };
  }

  // 5. Only the amount can be missing at this point, and it cannot be "opened".
  return { kind: 'incomplete', message: 'Enter an amount to save' };
}

/**
 * The same key, SPOKEN. TalkBack reads the glyphs literally — "check mark",
 * "rightwards arrow" — which names a shape, not what the press will do, and a
 * press that can save a record has to say so before it is made.
 */
const SHEET_SPOKEN: Record<Sheet, string> = {
  account: 'choose the account',
  toAccount: 'choose where it goes',
  category: 'choose the category',
};

export function flowKeySpoken(action: FlowAction): string {
  switch (action.kind) {
    case 'evaluate':
      return 'Equals';
    case 'save':
      return 'Save';
    case 'open':
      return `Next, ${SHEET_SPOKEN[action.sheet]}`;
    case 'incomplete':
      return `Next. ${action.message}`;
  }
}

/**
 * What the key should SHOW it will do.
 *
 * A key labelled `=` that silently saves a record is a trap, so the face
 * changes with the action. A bare `→` said only "something comes next"; the
 * key now wears the icon of the thing the press opens — the Accounts tab's
 * card, the Categories tab's tag — and a check for save, so the next press is
 * never a surprise. `=` stays text: it finishes a sum, and every calculator
 * spells it that way. The arrow is left only for the one case with nothing to
 * open: an amount still to type.
 */
export type FlowKeyFace =
  | { kind: 'text'; text: string }
  | { kind: 'icon'; icon: 'accounts' | 'categories' | 'check' };

const SHEET_ICON: Record<Sheet, 'accounts' | 'categories'> = {
  account: 'accounts',
  toAccount: 'accounts',
  category: 'categories',
};

export function flowKeyFace(action: FlowAction): FlowKeyFace {
  switch (action.kind) {
    case 'evaluate':
      return { kind: 'text', text: '=' };
    case 'save':
      return { kind: 'icon', icon: 'check' };
    case 'open':
      return { kind: 'icon', icon: SHEET_ICON[action.sheet] };
    case 'incomplete':
      return { kind: 'text', text: '→' };
  }
}
