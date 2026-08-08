import {
  backspace,
  committedMinor,
  equals,
  initialCalc,
  inputDigit,
  inputDot,
  inputOp,
  type CalcState,
} from './calculator';

/** Type a sequence like "120+35" against the keypad. */
function type(sequence: string, currency = 'EGP'): CalcState {
  let state = initialCalc();
  for (const ch of sequence) {
    if (ch >= '0' && ch <= '9') state = inputDigit(state, ch, currency);
    else if (ch === '.') state = inputDot(state, currency);
    else if (ch === '=') state = equals(state, currency);
    else if (ch === '<') state = backspace(state);
    else state = inputOp(state, ch as '+' | '-' | '*' | '/', currency);
  }
  return state;
}

describe('typing', () => {
  it('replaces the leading zero instead of appending', () => {
    expect(type('5').entry).toBe('5');
    expect(type('120').entry).toBe('120');
  });

  it('allows only one decimal point', () => {
    expect(type('12.3.4').entry).toBe('12.34');
  });

  it('starts a decimal with a leading zero', () => {
    expect(type('.5').entry).toBe('0.5');
  });

  it('has no decimal point for zero-decimal currencies', () => {
    // JPY has no minor unit, so the key does nothing.
    expect(type('12.5', 'JPY').entry).toBe('125');
  });

  it('backspaces to zero rather than to empty', () => {
    expect(type('12<<').entry).toBe('0');
    expect(type('12<<<').entry).toBe('0');
  });
});

describe('immediate execution', () => {
  it('shows the running result when an operator is pressed', () => {
    // The whole point: no expression is displayed, the operator computes.
    expect(type('120+35+').entry).toBe('155');
  });

  it('chains operations, each committing the previous', () => {
    expect(type('10+5+3+2+').entry).toBe('20');
  });

  it('does not require equals', () => {
    expect(committedMinor(type('120+35'))).toBe(15500);
  });

  it('still works with equals', () => {
    expect(type('120+35=').entry).toBe('155');
    expect(committedMinor(type('120+35='))).toBe(15500);
  });

  it('swaps the operator when two are pressed in a row', () => {
    // The user corrected themselves; nothing should be computed.
    const state = type('120+-');
    expect(state.pendingOp).toBe('-');
    expect(state.entry).toBe('120');
    expect(committedMinor(type('120+-20'))).toBe(10000);
  });

  it('starts a fresh entry after a result', () => {
    expect(type('120+35+7').entry).toBe('7');
  });
});

describe('money semantics', () => {
  it('adds and subtracts exactly, with no float drift', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004.
    expect(committedMinor(type('0.1+0.2'))).toBe(30);
    expect(committedMinor(type('12.50+3.75'))).toBe(1625);
    expect(committedMinor(type('100-0.01'))).toBe(9999);
  });

  it('treats the multiplier as a count, not as money', () => {
    // Three items at 25 is 75, not 7,500. Parsing "3" as minor units would
    // multiply by 300.
    expect(committedMinor(type('25*3'))).toBe(7500);
    expect(committedMinor(type('12.50*4'))).toBe(5000);
  });

  it('treats the divisor as a count too', () => {
    // A 100 bill split four ways.
    expect(committedMinor(type('100/4'))).toBe(2500);
    expect(committedMinor(type('10/3'))).toBe(333); // rounds to the piastre
  });

  it('rounds after every step so dust cannot accumulate', () => {
    const state = type('10/3*3');
    expect(committedMinor(state)).toBe(999); // 3.33 x 3, not 10.000000001
  });

  it('refuses to divide by zero', () => {
    const state = type('100/0=');
    expect(state.error).toMatch(/divide by zero/i);
    expect(committedMinor(state)).toBeNull();
  });
});

describe('committedMinor', () => {
  it('returns 0 for an untouched keypad', () => {
    // Not null — zero is a well-formed amount, it is just not a valid record.
    // Rejecting it is the screen's job (Save stays disabled), and createRecord
    // enforces it again at the boundary.
    expect(committedMinor(initialCalc())).toBe(0);
  });

  it('returns null when the amount cannot be computed', () => {
    expect(committedMinor(type('100/0='))).toBeNull();
  });

  it('does not mutate the state it evaluates', () => {
    const state = type('120+35');
    const before = { ...state };
    committedMinor(state);
    expect(state).toEqual(before);
  });

  it('handles a three-decimal currency', () => {
    expect(committedMinor(type('1.234+0.001', 'KWD'), 'KWD')).toBe(1235);
  });
});

describe('clearing', () => {
  it('backspace after a result clears it rather than editing digits', () => {
    // Those digits were computed, not typed; editing them would be nonsense.
    expect(type('120+35+<').entry).toBe('0');
  });
});
