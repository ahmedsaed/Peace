import { formatMinor, parseAmountToMinor, sumMinor } from './money';

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
