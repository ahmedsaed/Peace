import type { Op } from './calculator';

/**
 * Which way up the digits go.
 *
 * `calculator` puts 7-8-9 on top, like a desk calculator and the reference app;
 * `phone` puts 1-2-3 on top, like a dialler. Neither is "right" — people type
 * amounts with whichever their hands already know, and a keypad laid out the
 * other way round costs a mis-typed figure, which is the expensive kind of
 * mistake here.
 */
export type DigitOrder = 'calculator' | 'phone';

/** Which edge the operator column sits on. */
export type OperatorSide = 'left' | 'right';

export type KeypadCell =
  | { kind: 'op'; op: Op }
  | { kind: 'digit'; value: string }
  | { kind: 'dot' }
  | { kind: 'equals' };

const OPS: Op[] = ['+', '-', '*', '/'];

const DIGIT_ROWS: Record<DigitOrder, string[][]> = {
  calculator: [
    ['7', '8', '9'],
    ['4', '5', '6'],
    ['1', '2', '3'],
  ],
  phone: [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
  ],
};

const digit = (value: string): KeypadCell => ({ kind: 'digit', value });

/**
 * The keypad as rows of cells.
 *
 * Only the 3x3 digit block flips: `0 . =` stays the bottom row in both orders,
 * because that is where `0` sits on a calculator AND on a dialler, and `=` is
 * the record screen's next/save key — moving it would move the one key the
 * thumb is trained to finish on. The operators keep their top-to-bottom order
 * on either side, so changing sides is a mirror and not a relearn.
 *
 * Settings are stored as plain strings and an unknown value decodes as itself,
 * so anything that is not exactly `phone` or `right` falls back to the default
 * rather than rendering an empty keypad.
 */
export function keypadRows(order: DigitOrder, side: OperatorSide): KeypadCell[][] {
  const digits = DIGIT_ROWS[order === 'phone' ? 'phone' : 'calculator'];
  const blocks: KeypadCell[][] = [
    ...digits.map((row) => row.map(digit)),
    [digit('0'), { kind: 'dot' }, { kind: 'equals' }],
  ];
  return blocks.map((block, i) => {
    const op: KeypadCell = { kind: 'op', op: OPS[i] };
    return side === 'right' ? [...block, op] : [op, ...block];
  });
}
