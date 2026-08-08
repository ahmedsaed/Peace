import { decimalsFor, parseAmountToMinor } from './money';

/**
 * The amount keypad's arithmetic — an IMMEDIATE-EXECUTION calculator, the kind
 * in a pocket calculator rather than a spreadsheet.
 *
 *   - There is no expression to read back. Only the current number is shown.
 *   - Pressing an operator computes whatever is pending and replaces the
 *     display with the result. `120 +` then `35 +` shows 155.
 *   - Only one operation is ever pending.
 *   - `=` is optional. Saving evaluates anything still pending.
 *
 * OPERAND SEMANTICS (the part that is easy to get wrong):
 *
 *   For + and −, both operands are money: 12.50 + 3.75 is two prices, and the
 *   arithmetic happens in integer minor units so it is exact.
 *
 *   For × and ÷, the second operand is a plain COUNT, not money: "25 × 3" is
 *   three items at 25, and "100 ÷ 4" is a bill split four ways. Parsing that
 *   count as minor units would turn 25 × 3 into 25 × 300.
 *
 * Results are rounded to the currency's precision after every step, so float
 * dust from a division can never accumulate across operations.
 */

export type Op = '+' | '-' | '*' | '/';

export type CalcState = {
  /** The digits currently being typed, as shown. Never empty. */
  entry: string;
  /** Left-hand side in minor units, or null when nothing is pending. */
  accumulatorMinor: number | null;
  pendingOp: Op | null;
  /**
   * True right after an operator or `=` produced the displayed value. The next
   * digit starts a fresh entry instead of appending to the result.
   */
  replaceOnNextDigit: boolean;
  /** Set when the last action was rejected, e.g. divide by zero. */
  error: string | null;
};

export const initialCalc = (): CalcState => ({
  entry: '0',
  accumulatorMinor: null,
  pendingOp: null,
  replaceOnNextDigit: true,
  error: null,
});

const clampToPrecision = (minor: number) => Math.round(minor);

/** Render minor units back into the entry string, trimming pointless zeros. */
function minorToEntry(minor: number, currency: string): string {
  const decimals = decimalsFor(currency);
  if (decimals === 0) return String(minor);

  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(decimals + 1, '0');
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function applyOp(
  accMinor: number,
  op: Op,
  entry: string,
  currency: string
): { minor: number } | { error: string } {
  switch (op) {
    case '+':
    case '-': {
      // Both sides are money — exact integer arithmetic, no rounding.
      const rhs = parseAmountToMinor(entry, currency);
      if (rhs === null) return { error: 'Invalid amount' };
      return { minor: op === '+' ? accMinor + rhs : accMinor - rhs };
    }
    case '*': {
      const factor = Number(entry);
      if (!Number.isFinite(factor)) return { error: 'Invalid amount' };
      return { minor: clampToPrecision(accMinor * factor) };
    }
    case '/': {
      const divisor = Number(entry);
      if (!Number.isFinite(divisor)) return { error: 'Invalid amount' };
      if (divisor === 0) return { error: 'Cannot divide by zero' };
      return { minor: clampToPrecision(accMinor / divisor) };
    }
  }
}

export function inputDigit(state: CalcState, digit: string, currency = 'EGP'): CalcState {
  void currency;
  if (state.replaceOnNextDigit) {
    return { ...state, entry: digit, replaceOnNextDigit: false, error: null };
  }
  // A lone leading zero is replaced rather than appended to, so "0" + "5" = "5".
  const entry = state.entry === '0' ? digit : state.entry + digit;
  return { ...state, entry, error: null };
}

export function inputDot(state: CalcState, currency = 'EGP'): CalcState {
  // Zero-decimal currencies have no fractional part to type.
  if (decimalsFor(currency) === 0) return state;

  if (state.replaceOnNextDigit) {
    return { ...state, entry: '0.', replaceOnNextDigit: false, error: null };
  }
  if (state.entry.includes('.')) return state;
  return { ...state, entry: `${state.entry}.`, error: null };
}

export function backspace(state: CalcState): CalcState {
  // After a computed result, backspace clears it rather than editing digits of
  // a number the user never typed.
  if (state.replaceOnNextDigit) {
    return { ...state, entry: '0', replaceOnNextDigit: true, error: null };
  }
  const entry = state.entry.slice(0, -1);
  return { ...state, entry: entry === '' || entry === '-' ? '0' : entry, error: null };
}

export function clear(): CalcState {
  return initialCalc();
}

/**
 * Pressing an operator commits whatever was pending. Pressing two operators in
 * a row just swaps the pending one — the user corrected themselves, they did
 * not ask for a calculation.
 */
export function inputOp(state: CalcState, op: Op, currency = 'EGP'): CalcState {
  if (state.pendingOp && state.replaceOnNextDigit) {
    return { ...state, pendingOp: op, error: null };
  }

  const entryMinor = parseAmountToMinor(state.entry, currency);
  if (entryMinor === null) return { ...state, error: 'Invalid amount' };

  if (state.accumulatorMinor === null || state.pendingOp === null) {
    return {
      ...state,
      accumulatorMinor: entryMinor,
      pendingOp: op,
      replaceOnNextDigit: true,
      error: null,
    };
  }

  const result = applyOp(state.accumulatorMinor, state.pendingOp, state.entry, currency);
  if ('error' in result) return { ...state, error: result.error };

  return {
    entry: minorToEntry(result.minor, currency),
    accumulatorMinor: result.minor,
    pendingOp: op,
    replaceOnNextDigit: true,
    error: null,
  };
}

/** Optional — Save does this implicitly. */
export function equals(state: CalcState, currency = 'EGP'): CalcState {
  if (state.pendingOp === null || state.accumulatorMinor === null) {
    return { ...state, replaceOnNextDigit: true, error: null };
  }

  // A pending operator with no right-hand operand yet: `entry` currently holds
  // the RESULT of the previous step, not something the user typed. Applying the
  // operator here would use that result as both operands — "120 + 35 +" would
  // settle as 310 instead of 155. Drop the dangling operator instead.
  //
  // A pocket calculator would repeat the last operand here. For a ledger,
  // "what you see is what gets saved" is worth more than that convention.
  if (state.replaceOnNextDigit) {
    return { ...state, accumulatorMinor: null, pendingOp: null, error: null };
  }

  const result = applyOp(state.accumulatorMinor, state.pendingOp, state.entry, currency);
  if ('error' in result) return { ...state, error: result.error };

  return {
    entry: minorToEntry(result.minor, currency),
    accumulatorMinor: null,
    pendingOp: null,
    replaceOnNextDigit: true,
    error: null,
  };
}

/**
 * The value Save commits, in minor units. Evaluates a pending operation, so
 * typing `120 + 35` and hitting Save stores 155 — pressing `=` is never
 * required.
 *
 * Returns null when the amount is not usable, so the caller can keep Save
 * disabled rather than writing a zero or a NaN into the ledger.
 */
export function committedMinor(state: CalcState, currency = 'EGP'): number | null {
  const settled = state.pendingOp ? equals(state, currency) : state;
  if (settled.error) return null;
  return parseAmountToMinor(settled.entry, currency);
}
