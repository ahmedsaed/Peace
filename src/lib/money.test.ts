import { convertMinor, formatMinor, groupDigits, parseAmountToMinor, sumMinor } from './money';

describe('parseAmountToMinor', () => {
  it('parses plain decimals into minor units', () => {
    expect(parseAmountToMinor('12.34')).toBe(1234);
    expect(parseAmountToMinor('0.05')).toBe(5);
    expect(parseAmountToMinor('100')).toBe(10000);
  });

  it('handles negatives and thousands separators', () => {
    expect(parseAmountToMinor('-8')).toBe(-800);
    expect(parseAmountToMinor('1,234.50')).toBe(123450);
  });

  it('pads and truncates to the currency precision', () => {
    expect(parseAmountToMinor('12.3')).toBe(1230);
    expect(parseAmountToMinor('12.349')).toBe(1234);
    // JPY has no minor unit at all.
    expect(parseAmountToMinor('1200', 'JPY')).toBe(1200);
    expect(parseAmountToMinor('12.34', 'JPY')).toBe(12);
    // KWD uses three decimals.
    expect(parseAmountToMinor('1.234', 'KWD')).toBe(1234);
  });

  it('rejects junk instead of producing NaN', () => {
    expect(parseAmountToMinor('')).toBeNull();
    expect(parseAmountToMinor('abc')).toBeNull();
    expect(parseAmountToMinor('1.2.3')).toBeNull();
    expect(parseAmountToMinor('-')).toBeNull();
  });

  it('avoids float drift that would corrupt a ledger', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; in minor units it is exact.
    const a = parseAmountToMinor('0.1')!;
    const b = parseAmountToMinor('0.2')!;
    expect(sumMinor([a, b])).toBe(30);
    expect(sumMinor([a, b])).toBe(parseAmountToMinor('0.30'));
  });
});

describe('formatMinor', () => {
  it('renders minor units as currency', () => {
    expect(formatMinor(1234, 'USD')).toBe('$12.34');
    expect(formatMinor(-1234, 'USD')).toBe('-$12.34');
  });

  it('can force a sign for income rows', () => {
    expect(formatMinor(1234, 'USD', { showSign: true })).toBe('+$12.34');
  });

  it('overrides the symbol so EGP is "E£", not "EGP "', () => {
    // Intl renders "EGP 12,500.00" for the app's primary currency on Hermes,
    // which is both uglier and wider in a right-aligned amount column. The
    // override must also swallow the space that follows the ISO code.
    expect(formatMinor(1250000, 'EGP')).toBe('E£12,500.00');
    expect(formatMinor(-8000, 'EGP')).toBe('-E£80.00');
    expect(formatMinor(1250000, 'EGP', { showSign: true })).toBe('+E£12,500.00');
  });

  it('respects zero-decimal currencies when formatting', () => {
    expect(formatMinor(1200, 'JPY')).toBe('¥1,200');
  });
});

describe('groupDigits', () => {
  it('groups the integer part', () => {
    expect(groupDigits('1234')).toBe('1,234');
    expect(groupDigits('1234567')).toBe('1,234,567');
    expect(groupDigits('999')).toBe('999');
    expect(groupDigits('0')).toBe('0');
  });

  // The whole reason this is not Intl.NumberFormat. Every one of these is a
  // state the display passes through while a single amount is being typed.
  it('leaves a half-typed fraction exactly as typed', () => {
    expect(groupDigits('1234.')).toBe('1,234.');
    expect(groupDigits('1234.5')).toBe('1,234.5');
    expect(groupDigits('1234.50')).toBe('1,234.50');
    expect(groupDigits('0.0')).toBe('0.0');
    expect(groupDigits('.')).toBe('.');
  });

  it('never groups the fraction', () => {
    expect(groupDigits('1.23456')).toBe('1.23456');
  });

  it('passes anything unexpected through untouched', () => {
    expect(groupDigits('Cannot divide by zero')).toBe('Cannot divide by zero');
    expect(groupDigits('-12')).toBe('-12');
    expect(groupDigits('')).toBe('');
  });
});

describe('convertMinor', () => {
  it('is an identity for the same currency at rate 1', () => {
    expect(convertMinor(15500, 'EGP', 'EGP', 1)).toBe(15500);
    expect(convertMinor(-15500, 'EGP', 'EGP', 1)).toBe(-15500);
  });

  it('converts between two 2-decimal currencies', () => {
    // $1.00 at fifty pounds to the dollar is E£50.00.
    expect(convertMinor(100, 'USD', 'EGP', 50)).toBe(5000);
    expect(convertMinor(-2599, 'USD', 'EGP', 50)).toBe(-129950);
  });

  /**
   * The case that is invisible in an EGP-only app. Minor units are NOT
   * comparable across currencies: yen has no decimal places, so multiplying by
   * the rate alone is wrong by a factor of a hundred.
   */
  it('handles a zero-decimal currency', () => {
    // ¥1000 at 0.33 pounds to the yen is E£330.00 — 33000 piastres, not 330.
    expect(convertMinor(1000, 'JPY', 'EGP', 0.33)).toBe(33000);
    // And back the other way: E£50.00 at 3.03 yen to the pound is ¥152.
    //
    // This one is also the float-dust guard: 5000 * 3.03 * 0.01 evaluates to
    // 151.49999999999997 in binary floating point, so a naive round gives 151
    // and quietly loses half a unit on every conversion.
    expect(convertMinor(5000, 'EGP', 'JPY', 3.03)).toBe(152);
  });

  it('handles a three-decimal currency', () => {
    // 1.000 KWD at 160 pounds to the dinar is E£160.00.
    expect(convertMinor(1000, 'KWD', 'EGP', 160)).toBe(16000);
  });

  /**
   * Math.round rounds toward +infinity, so -0.5 becomes -0. Applied to money
   * that makes a converted expense and a converted income of the same size come
   * out a unit apart — a spend and its refund would stop cancelling.
   */
  it('rounds symmetrically around zero', () => {
    const rate = 1.005; // chosen so the result lands exactly on .5
    const income = convertMinor(100, 'USD', 'EGP', rate);
    const expense = convertMinor(-100, 'USD', 'EGP', rate);
    expect(income).toBe(-expense);
    expect(income + expense).toBe(0);
  });

  it('always returns an integer', () => {
    for (const rate of [0.333333, 1.7, 49.99, 3.14159]) {
      expect(Number.isInteger(convertMinor(12345, 'USD', 'EGP', rate))).toBe(true);
      expect(Number.isInteger(convertMinor(12345, 'JPY', 'KWD', rate))).toBe(true);
    }
  });
});
