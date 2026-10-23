import {
  byDensity,
  centerScrollOffset,
  densityForHeight,
  fittedNoteBlock,
  keyboardOverlap,
  ringSize,
} from './layout';

describe('densityForHeight', () => {
  it('treats a whole phone as regular', () => {
    expect(densityForHeight(800)).toBe('regular');
    expect(densityForHeight(2000)).toBe('regular');
  });

  // Large text needs the room a shorter window would lack. 800dp at the
  // phone's largest common sizes is not a "whole phone" for the keypad.
  it('gives large text the density of a shorter window', () => {
    expect(densityForHeight(800, 1)).toBe('regular');
    expect(densityForHeight(800, 1.3)).toBe('compact');
    expect(densityForHeight(800, 2)).toBe('compact');
  });

  // Only a short window is tight; large text alone stops at compact.
  it('leaves tight to split-screen', () => {
    expect(densityForHeight(800, 3)).toBe('compact');
    expect(densityForHeight(340, 2)).toBe('tight');
  });

  it('never makes a layout roomier for small text', () => {
    expect(densityForHeight(600, 0.85)).toBe('compact');
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

describe('keyboardOverlap', () => {
  it('measures from the keyboard top, so the nav bar beneath it counts', () => {
    // 2400px screen at 1x for simplicity: a 300 keyboard over a 63 nav bar.
    expect(keyboardOverlap(2400, 2037, 300)).toBe(363);
  });

  it('falls back to the reported height when there is no position', () => {
    expect(keyboardOverlap(2400, 0, 300)).toBe(300);
    expect(keyboardOverlap(2400, Number.NaN, 300)).toBe(300);
  });

  it('is never negative', () => {
    expect(keyboardOverlap(800, 900, 0)).toBe(0);
  });
});

describe('ringSize', () => {
  it('fills most of a phone\'s width', () => {
    expect(ringSize(411, 914)).toBe(360);
    expect(ringSize(360, 780)).toBe(312);
  });

  it('stops growing on a tablet', () => {
    expect(ringSize(1280, 800)).toBe(360);
  });

  /** A split-screen half must still show the first rows of the list. */
  it('stays small in a short window, but never below the old ring', () => {
    expect(ringSize(411, 340)).toBe(200);
    expect(ringSize(411, 600)).toBe(270);
  });
});

describe('fittedNoteBlock', () => {
  /** A whole phone: the note gets the room the pickers leave, and no more. */
  it('pins the block to its window when everything fits', () => {
    // 600 tall, of which the note is 400: the rest of the block is 200.
    expect(fittedNoteBlock({ viewport: 600, content: 600, note: 400, noteMin: 120 })).toBe(600);
  });

  /** A long note made the content 1400 tall; it must not stretch the block. */
  it('does not grow with the text of a long note', () => {
    expect(fittedNoteBlock({ viewport: 600, content: 1400, note: 1200, noteMin: 120 })).toBe(600);
  });

  /** Split-screen: the floors add up to more than the window, so it scrolls. */
  it('never squeezes the note below its floor', () => {
    expect(fittedNoteBlock({ viewport: 250, content: 300, note: 76, noteMin: 76 })).toBe(300);
  });

  it('makes room when tags or receipts make the rest taller', () => {
    // The attachment bar grew by 80: still the window, the note just gets less.
    expect(fittedNoteBlock({ viewport: 600, content: 600, note: 320, noteMin: 120 })).toBe(600);
    // …until the rest alone no longer leaves the note its floor.
    expect(fittedNoteBlock({ viewport: 600, content: 600, note: 120, noteMin: 120 })).toBe(600);
    expect(fittedNoteBlock({ viewport: 600, content: 650, note: 120, noteMin: 120 })).toBe(650);
  });

  it('waits until everything has been laid out', () => {
    expect(fittedNoteBlock({ viewport: 0, content: 600, note: 400, noteMin: 120 })).toBeNull();
    expect(fittedNoteBlock({ viewport: 600, content: 600, note: 0, noteMin: 120 })).toBeNull();
  });
});
