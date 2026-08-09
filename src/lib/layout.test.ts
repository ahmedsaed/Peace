import { byDensity, densityForHeight } from './layout';

describe('densityForHeight', () => {
  it('treats a whole phone as regular', () => {
    expect(densityForHeight(800)).toBe('regular');
    expect(densityForHeight(2000)).toBe('regular');
  });

  it('treats a half-height split-screen window as tight', () => {
    // A 6.1" phone in split-screen portrait, minus the system bars.
    expect(densityForHeight(340)).toBe('tight');
  });

  // The boundaries are the design. An off-by-one here is invisible in review
  // and shows up as a keypad hanging off the bottom of the screen.
  it.each([
    [679, 'compact'],
    [680, 'regular'],
    [519, 'tight'],
    [520, 'compact'],
  ])('height %i is %s', (height, expected) => {
    expect(densityForHeight(height)).toBe(expected);
  });

  it('never returns undefined for absurd input', () => {
    expect(densityForHeight(0)).toBe('tight');
    expect(densityForHeight(-1)).toBe('tight');
  });
});

describe('byDensity', () => {
  it('requires a value for every density, so a new one cannot be forgotten', () => {
    const table = { regular: 'a', compact: 'b', tight: 'c' };
    expect(byDensity('regular', table)).toBe('a');
    expect(byDensity('compact', table)).toBe('b');
    expect(byDensity('tight', table)).toBe('c');
  });
});
