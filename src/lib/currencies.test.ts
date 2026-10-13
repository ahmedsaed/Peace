import { CURRENCIES, currencyName } from './currencies';

describe('currencies', () => {
  // No country goes first: the home currency is detected, and the sheet opens
  // on it. What a person scans for in a list this long is the name.
  it('is sorted by name', () => {
    const names = CURRENCIES.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('has no duplicate codes', () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('uses ISO 4217 codes', () => {
    for (const { code } of CURRENCIES) expect(code).toMatch(/^[A-Z]{3}$/);
  });

  // The picker list is curated, but the database columns are free text. A
  // currency stored before it was listed still needs a label rather than a
  // blank row.
  it('falls back to the code for a currency it does not know', () => {
    expect(currencyName('ZMW')).toBe('ZMW');
    expect(currencyName('EGP')).toBe('Egyptian pound');
  });
});
