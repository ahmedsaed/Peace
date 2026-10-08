import { roundHalfAwayFromZero } from '../lib/money';
import { ToolInputError } from './dates';
import type { Figure } from './figures';

/**
 * Arithmetic over cited figures, for the model.
 *
 * WHY THIS EXISTS. Penny may only show an amount a tool returned — that is
 * what keeps hidden amounts hidden and the model out of the sums. But a good
 * answer often needs a number no query returns: an average, "everything except
 * the installments", "six months of that". With no way to make one, the model
 * kept calling tools hoping one would hand it the figure, and an emergency-fund
 * question ran out of steps. This lets it ask for the number instead of typing
 * it: `({{t3f1}} + {{t3f2}}) * 6` comes back as a NEW cited figure, worked out
 * here in minor units.
 *
 * DIMENSIONS ARE CHECKED, so the arithmetic cannot be nonsense: money plus
 * money in the same currency is money; money times or divided by a plain number
 * is money; money divided by money is a plain ratio ("months of cover"); money
 * times money, money plus a bare number, and pounds plus dollars are refused —
 * each of those is a model mixing things up, and an answer built on it would
 * look exact.
 */

export type CalcResult =
  | { kind: 'money'; figure: Figure }
  | { kind: 'number'; value: number };

type Value = { kind: 'money'; minor: number; currency: string } | { kind: 'number'; value: number };

type Token =
  | { t: 'num'; value: number }
  | { t: 'fig'; ref: string; abs: boolean }
  | { t: 'op'; op: '+' | '-' | '*' | '/' | '(' | ')' };

export const MAX_EXPRESSION = 500;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (source.startsWith('{{', i)) {
      const end = source.indexOf('}}', i);
      if (end < 0) throw new ToolInputError('An unclosed {{ in the expression.');
      const inner = source.slice(i + 2, end).trim();
      const match = /^([A-Za-z0-9_.]+)\s*(\|\s*abs)?$/.exec(inner);
      if (!match) throw new ToolInputError(`"{{${inner}}}" is not a cite token.`);
      tokens.push({ t: 'fig', ref: match[1], abs: match[2] !== undefined });
      i = end + 2;
      continue;
    }
    const number = /^\d+(?:\.\d+)?/.exec(source.slice(i));
    if (number) {
      tokens.push({ t: 'num', value: Number(number[0]) });
      i += number[0].length;
      continue;
    }
    if ('+-*/()'.includes(c)) {
      tokens.push({ t: 'op', op: c as '+' });
      i++;
      continue;
    }
    // "×" and "÷" are what a model writes when it is thinking in prose.
    if (c === '×' || c === '÷') {
      tokens.push({ t: 'op', op: c === '×' ? '*' : '/' });
      i++;
      continue;
    }
    throw new ToolInputError(
      `"${c}" cannot appear in an expression. Use cite tokens, plain numbers, + - * / and brackets — no currency signs.`
    );
  }
  return tokens;
}

export function calculate(expression: string, lookup: (ref: string) => Figure | undefined): CalcResult {
  if (expression.length > MAX_EXPRESSION) throw new ToolInputError('That expression is too long.');
  const tokens = tokenize(expression);
  if (tokens.length === 0) throw new ToolInputError('The expression is empty.');
  let at = 0;

  const peek = () => tokens[at];
  const isOp = (op: string) => {
    const token = peek();
    return token?.t === 'op' && token.op === op;
  };

  const add = (a: Value, b: Value, sign: 1 | -1): Value => {
    if (a.kind === 'number' && b.kind === 'number') return { kind: 'number', value: a.value + sign * b.value };
    if (a.kind === 'money' && b.kind === 'money') {
      if (a.currency !== b.currency) {
        throw new ToolInputError(`Cannot add ${a.currency} to ${b.currency} — they need converting first.`);
      }
      return { kind: 'money', minor: a.minor + sign * b.minor, currency: a.currency };
    }
    throw new ToolInputError('Cannot add a plain number to an amount. Every amount in a sum must be a cite token.');
  };

  const multiply = (a: Value, b: Value): Value => {
    if (a.kind === 'money' && b.kind === 'money') throw new ToolInputError('Cannot multiply an amount by an amount.');
    if (a.kind === 'money' && b.kind === 'number') return { ...a, minor: a.minor * b.value };
    if (a.kind === 'number' && b.kind === 'money') return { ...b, minor: b.minor * a.value };
    return { kind: 'number', value: (a as { value: number }).value * (b as { value: number }).value };
  };

  const divide = (a: Value, b: Value): Value => {
    const divisor = b.kind === 'money' ? b.minor : b.value;
    if (divisor === 0) throw new ToolInputError('Division by zero.');
    if (a.kind === 'money' && b.kind === 'number') return { ...a, minor: a.minor / b.value };
    if (a.kind === 'money' && b.kind === 'money') {
      if (a.currency !== b.currency) throw new ToolInputError(`Cannot divide ${a.currency} by ${b.currency}.`);
      return { kind: 'number', value: a.minor / b.minor };
    }
    if (a.kind === 'number' && b.kind === 'number') return { kind: 'number', value: a.value / b.value };
    throw new ToolInputError('Cannot divide a plain number by an amount.');
  };

  function primary(): Value {
    const token = tokens[at++];
    if (!token) throw new ToolInputError('The expression ends too early.');
    if (token.t === 'num') return { kind: 'number', value: token.value };
    if (token.t === 'fig') {
      const figure = lookup(token.ref);
      if (!figure) throw new ToolInputError(`{{${token.ref}}} is not a figure from this conversation.`);
      return { kind: 'money', minor: token.abs ? Math.abs(figure.minor) : figure.minor, currency: figure.currency };
    }
    if (token.op === '(') {
      const value = expr();
      if (!isOp(')')) throw new ToolInputError('A bracket is not closed.');
      at++;
      return value;
    }
    if (token.op === '-') {
      const value = primary();
      return value.kind === 'money' ? { ...value, minor: -value.minor } : { kind: 'number', value: -value.value };
    }
    throw new ToolInputError(`Unexpected "${token.op}" in the expression.`);
  }

  function term(): Value {
    let value = primary();
    while (isOp('*') || isOp('/')) {
      const op = (tokens[at++] as { op: string }).op;
      value = op === '*' ? multiply(value, primary()) : divide(value, primary());
    }
    return value;
  }

  function expr(): Value {
    let value = term();
    while (isOp('+') || isOp('-')) {
      const op = (tokens[at++] as { op: string }).op;
      value = add(value, term(), op === '+' ? 1 : -1);
    }
    return value;
  }

  const result = expr();
  if (at < tokens.length) throw new ToolInputError('Something is left over at the end of the expression.');

  if (result.kind === 'money') {
    // Float noise trimmed BEFORE rounding — 15150.000000000002 is 15150, and
    // rounding first would occasionally lose half a unit. Then rounded away
    // from zero, so a negative result is not a unit off its positive twin,
    // and `+ 0` so it is never negative zero.
    const trimmed = Number(result.minor.toFixed(6));
    return { kind: 'money', figure: { minor: roundHalfAwayFromZero(trimmed) + 0, currency: result.currency } };
  }
  return { kind: 'number', value: Number(result.value.toFixed(4)) + 0 };
}
