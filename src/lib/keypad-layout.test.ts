import { keypadRows, type KeypadCell } from './keypad-layout';

/** One cell as the label a person would read off the key. */
const label = (cell: KeypadCell) =>
  cell.kind === 'op'
    ? cell.op
    : cell.kind === 'digit'
      ? cell.value
      : cell.kind === 'dot'
        ? '.'
        : '=';

const grid = (rows: KeypadCell[][]) => rows.map((row) => row.map(label).join(' '));

describe('keypadRows', () => {
  it('defaults to the calculator layout with operators on the left', () => {
    expect(grid(keypadRows('calculator', 'left'))).toEqual([
      '+ 7 8 9',
      '- 4 5 6',
      '* 1 2 3',
      '/ 0 . =',
    ]);
  });

  it('puts 1 2 3 on top for the phone layout and keeps 0 . = at the bottom', () => {
    expect(grid(keypadRows('phone', 'left'))).toEqual([
      '+ 1 2 3',
      '- 4 5 6',
      '* 7 8 9',
      '/ 0 . =',
    ]);
  });

  it('mirrors the operator column without reordering it', () => {
    expect(grid(keypadRows('phone', 'right'))).toEqual([
      '1 2 3 +',
      '4 5 6 -',
      '7 8 9 *',
      '0 . = /',
    ]);
  });

  it.each([
    ['calculator', 'left'],
    ['calculator', 'right'],
    ['phone', 'left'],
    ['phone', 'right'],
  ] as const)('%s/%s has every key exactly once', (order, side) => {
    const keys = keypadRows(order, side).flat().map(label).sort();
    expect(keys).toEqual(
      ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '=', '+', '-', '*', '/'].sort()
    );
  });

  // Settings are stored as text and a corrupt or future value decodes as
  // itself. It must land on a usable keypad, never an empty one.
  it('falls back to the default for a value it does not know', () => {
    expect(keypadRows('sideways' as never, 'up' as never)).toEqual(
      keypadRows('calculator', 'left')
    );
  });
});
