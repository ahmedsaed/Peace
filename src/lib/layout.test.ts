import { byDensity, centerScrollOffset, densityForHeight } from './layout';

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

describe('centerScrollOffset', () => {
  // A 400dp viewport over 1000dp of content: 600dp of travel available.
  const viewport = 400;
  const content = 1000;

  it('centres a row in the middle of a long list', () => {
    // Row spans 500-548, so its middle is 524; centring puts that at 200.
    expect(centerScrollOffset({ y: 500, height: 48 }, viewport, content)).toBe(324);
  });

  it('leaves the list at rest when the row is already near the top', () => {
    // Centring the first row would need a negative offset. Scrolling up into
    // nothing looks like the sheet opened broken.
    expect(centerScrollOffset({ y: 0, height: 48 }, viewport, content)).toBe(0);
    expect(centerScrollOffset({ y: 100, height: 48 }, viewport, content)).toBe(0);
  });

  it('stops against the end rather than scrolling past it', () => {
    // The last row cannot be centred without showing blank space below the
    // content, which reads as a list that has lost its footing.
    expect(centerScrollOffset({ y: 952, height: 48 }, viewport, content)).toBe(600);
    expect(centerScrollOffset({ y: 900, height: 48 }, viewport, content)).toBe(600);
  });

  // The offset is only ever as large as the distance the list can actually
  // travel; anything more is the caller's bug showing up as an empty sheet.
  it.each([
    [0, 48],
    [200, 48],
    [500, 48],
    [952, 48],
  ])('row at y=%i stays within the scrollable range', (y, height) => {
    const offset = centerScrollOffset({ y, height }, viewport, content);
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThanOrEqual(content - viewport);
  });

  it('does not scroll a list that already fits', () => {
    expect(centerScrollOffset({ y: 100, height: 48 }, 400, 300)).toBe(0);
    expect(centerScrollOffset({ y: 100, height: 48 }, 400, 400)).toBe(0);
  });

  it('does not scroll before anything has been measured', () => {
    // Every onLayout fires with 0 until it does not, and scrolling on those
    // zeroes would fight the real measurement a frame later.
    expect(centerScrollOffset({ y: 0, height: 0 }, 0, 0)).toBe(0);
    expect(centerScrollOffset({ y: 500, height: 48 }, 0, 1000)).toBe(0);
    expect(centerScrollOffset({ y: 500, height: 48 }, 400, 0)).toBe(0);
  });
});
