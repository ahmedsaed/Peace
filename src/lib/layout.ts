import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, useWindowDimensions } from 'react-native';

/**
 * How much vertical room a screen has to work with.
 *
 * This exists because of Android split-screen, which is a real way this app
 * gets used: half the screen shows a bank notification or an SMS, the other
 * half logs the record. In that mode the window is roughly 340dp tall instead
 * of 800, and a layout tuned for a whole phone does not merely look cramped —
 * the keypad slides off the bottom edge and the note field collapses to
 * nothing, which is exactly what happened before this.
 *
 * Height, not width: the record screen is a vertical stack and the squeeze is
 * always vertical. Width barely changes in split-screen portrait.
 */
export type Density = 'regular' | 'compact' | 'tight';

/**
 * How wide the app's content may grow, in dp. A large phone is ~430; a tablet
 * or an unfolded foldable is 700–1300, and Android 16 lets the app rotate and
 * fill one whatever the manifest says. Beyond this the content is centred and
 * the sides are ground — see the root layout.
 */
export const CONTENT_MAX_WIDTH = 640;

/**
 * How big the Analysis ring is drawn, in dp.
 *
 * As wide as the column allows less a margin, because the ring is the screen's
 * headline and a fixed 200 left a third of a phone's width empty either side of
 * it. Capped at 360 so a tablet does not get a dinner plate, and at under half
 * the window's HEIGHT so a split-screen half (~340dp tall) still shows the
 * first rows of the list under it — never below the old 200, which every
 * screen already held.
 */
export function ringSize(width: number, height: number): number {
  const across = Math.min(width, CONTENT_MAX_WIDTH) - 48;
  return Math.round(Math.max(200, Math.min(across, height * 0.45, 360)));
}

/**
 * Pure so it can be tested at the boundaries — the breakpoints are the whole
 * design, and getting one off by a pixel is invisible until you are standing in
 * a shop trying to log a purchase.
 *
 * The numbers come from what the record screen actually needs: its pinned block
 * (amount + keypad + date/time) is about 250dp at `tight`, which leaves usable
 * room for the scrollable part below ~520dp. Above ~680dp nothing needs to give.
 */
export function densityForHeight(height: number, fontScale = 1): Density {
  // LARGE TEXT IS LESS ROOM. The pinned block is mostly text — the amount, the
  // keys, the date — so at 1.3x font it needs about 1.3x the height, and a
  // full phone at that size has what a much shorter one has at 1x. Only ever
  // scaled DOWN: a font set smaller than default must not buy a roomier layout
  // than the window can actually hold. And never past compact on its own:
  // `tight` is for a window that is SHORT — it folds the note to one line and
  // the pickers to bare icons — and at 2x text on a whole phone that left half
  // the screen empty while hiding the labels large text is for.
  height = height / Math.min(Math.max(1, fontScale), 1.5);
  if (height >= 680) return 'regular';
  if (height >= 520) return 'compact';
  return 'tight';
}

/** React Native reports window (not screen) size, which is what split-screen changes. */
export function useDensity(): Density {
  const { height, fontScale } = useWindowDimensions();
  return densityForHeight(height, fontScale);
}

/** Picks the value for the current density from a full table. */
export function byDensity<T>(density: Density, table: Record<Density, T>): T {
  return table[density];
}

/**
 * How much of the screen the keyboard is currently covering.
 *
 * NEEDED BECAUSE A `Modal` DOES NOT RESIZE WITH THE KEYBOARD. Android's
 * `adjustResize` shrinks the app's own window, which is why an ordinary screen
 * can simply scroll — but a Modal is a SEPARATE window and keeps its full
 * height, so anything near the bottom of a bottom-sheet stays underneath the
 * keyboard however hard the content tries to scroll. The sheet has to be lifted
 * by hand.
 *
 * Reported in dp, and 0 when the keyboard is down.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // `Did` rather than `Will`: Android only ever fires the `Did` events, and
    // using `Will` would leave this at 0 on the one platform that needs it.
    const shown = Keyboard.addListener('keyboardDidShow', (event) =>
      setHeight(event.endCoordinates.height)
    );
    const hidden = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return height;
}

/**
 * How much of the SCREEN the keyboard covers, measured from its top edge.
 *
 * `endCoordinates.height` is the keyboard's own height, and on an edge-to-edge
 * Android that is not how much it covers: the navigation bar sits below it,
 * and content drawn behind that bar is covered too. A composer padded by the
 * reported height came to rest a nav bar's height UNDER the keyboard — half an
 * input field, visible only in a screenshot. The distance from the keyboard's
 * top to the bottom of the screen is the overlap itself; the reported height
 * is kept as a floor for a device that reports no position.
 */
export function keyboardOverlap(screenHeight: number, screenY: number, reported: number): number {
  const fromTop = Number.isFinite(screenY) && screenY > 0 ? screenHeight - screenY : 0;
  return Math.max(0, reported, fromTop);
}

/** `useKeyboardHeight`, for a SCREEN that draws to the bottom edge. */
export function useKeyboardOverlap(): number {
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) =>
      setOverlap(
        keyboardOverlap(Dimensions.get('screen').height, event.endCoordinates.screenY, event.endCoordinates.height)
      )
    );
    const hidden = Keyboard.addListener('keyboardDidHide', () => setOverlap(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return overlap;
}

/**
 * Where to scroll a list so a given row sits in the middle of the viewport.
 *
 * Used when a picker sheet opens on an existing selection: the account or
 * category you already chose should be the thing you are looking at, not
 * something you have to hunt for below the fold. Centring rather than merely
 * revealing it also shows the neighbours on both sides, which is what makes a
 * long category list navigable.
 *
 * Pure, and clamped at BOTH ends, because the two edge cases are the common
 * ones and both look like a bug. A row near the top cannot be centred without
 * scrolling to a negative offset, and a row near the bottom cannot be centred
 * without scrolling past the end into blank space — so the first item leaves
 * the list at rest and the last leaves it against its end. Clamping here rather
 * than trusting the platform keeps the whole rule in one testable place;
 * `scrollTo` does not clamp identically everywhere.
 */
export function centerScrollOffset(
  item: { y: number; height: number },
  viewportHeight: number,
  contentHeight: number
): number {
  // Not measured yet, or everything already fits — either way there is nothing
  // to scroll and no offset that would help.
  if (!(viewportHeight > 0) || !(contentHeight > viewportHeight)) return 0;

  const ideal = item.y + item.height / 2 - viewportHeight / 2;
  return Math.max(0, Math.min(ideal, contentHeight - viewportHeight));
}

/**
 * How tall the record screen's scrolling block should be, so a long note
 * scrolls INSIDE its field instead of dragging the pickers up with it.
 *
 * A multiline input in a scroll view has no ceiling: it grows with its text,
 * the block grows with it, and the account and category pickers scroll out of
 * sight above a note that is still being typed. Pinning the block to the
 * height of its window gives the note exactly the room left over, and the text
 * scrolls within that.
 *
 * Never shorter than everything at its floor, though. In split-screen that is
 * taller than the window, and the block scrolls as it always has — the rule
 * that keeps the keypad on screen (see `record.tsx`).
 *
 * Measured, not computed: `content - note` is everything that is not the note
 * — the type row and the pickers — and `noteMin` is the note's floor plus the
 * bar of tags and receipts floating over its foot, which grows as they are
 * added. Null until all three have been laid out, which leaves the block to
 * size itself for that first frame.
 */
export function fittedNoteBlock(m: {
  viewport: number;
  content: number;
  note: number;
  noteMin: number;
}): number | null {
  if (m.viewport <= 0 || m.content <= 0 || m.note <= 0) return null;
  return Math.round(Math.max(m.viewport, m.content - m.note + m.noteMin));
}
