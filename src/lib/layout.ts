import { useEffect, useState } from 'react';
import { Keyboard, useWindowDimensions } from 'react-native';

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
 * Pure so it can be tested at the boundaries — the breakpoints are the whole
 * design, and getting one off by a pixel is invisible until you are standing in
 * a shop trying to log a purchase.
 *
 * The numbers come from what the record screen actually needs: its pinned block
 * (amount + keypad + date/time) is about 250dp at `tight`, which leaves usable
 * room for the scrollable part below ~520dp. Above ~680dp nothing needs to give.
 */
export function densityForHeight(height: number): Density {
  if (height >= 680) return 'regular';
  if (height >= 520) return 'compact';
  return 'tight';
}

/** React Native reports window (not screen) size, which is what split-screen changes. */
export function useDensity(): Density {
  const { height } = useWindowDimensions();
  return densityForHeight(height);
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
