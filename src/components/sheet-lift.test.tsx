import { act, render, screen } from '@testing-library/react-native';
import { Keyboard } from 'react-native';

import { ReconcileSheet } from './reconcile-sheet';
import { RepeatSheet } from './repeat-sheet';

/**
 * A sheet with a field in it moves up by exactly the keyboard's height.
 *
 * `sheet-keyboard.test.ts` next door proves no sheet can FORGET the lift; this
 * proves the lift does something. The two fail in different ways on purpose: a
 * sheet that imported the hook and dropped the value on the floor would satisfy
 * the structural guard completely, and "Update balance" would still open with
 * its save button underneath the keyboard.
 *
 * Neither of these is a device. What they cannot see is the pixels — the E2E
 * flows assert the button is visible with the keyboard still up, and that needs
 * an emulator.
 */

/**
 * Stands in for the platform, and records what was subscribed to.
 *
 * `Keyboard.emit` does not exist on RN 0.86, so the handler is captured on its
 * way in and called by hand. That is not a workaround for the test's benefit:
 * the event NAME is half the rule, because Android fires only the `Did` events
 * and a `Will` listener reports zero on the one platform this matters on.
 */
function captureKeyboard() {
  const handlers = new Map<string, (event: unknown) => void>();

  jest.spyOn(Keyboard, 'addListener').mockImplementation(((
    event: string,
    handler: (event: unknown) => void
  ) => {
    handlers.set(event, handler);
    return {
      remove: () => {
        handlers.delete(event);
      },
    };
  }) as never);

  return {
    subscribed: () => [...handlers.keys()].sort(),
    show: async (height: number) => {
      await act(async () => {
        handlers.get('keyboardDidShow')?.({ endCoordinates: { height } });
      });
    },
    hide: async () => {
      await act(async () => {
        handlers.get('keyboardDidHide')?.({});
      });
    },
  };
}

/** The gap held below the sheet, however the style prop happens to be shaped. */
function liftOf(testID: string): number | undefined {
  const style = screen.getByTestId(testID).props.style;
  const flat = Array.isArray(style) ? Object.assign({}, ...style.flat()) : style;
  return flat?.marginBottom;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the Update balance sheet', () => {
  async function open() {
    const keyboard = captureKeyboard();
    await render(
      <ReconcileSheet
        visible
        accountName="Visa"
        accountType="card"
        currency="EGP"
        currentMinor={-50000}
        creditLimitMinor={5000000}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );
    return keyboard;
  }

  it('sits on the bottom edge while the keyboard is down', async () => {
    await open();

    expect(liftOf('reconcile-sheet')).toBe(0);
  });

  it('rises by the height of the keyboard', async () => {
    // THE REGRESSION. A Modal is its own window and keeps its full height, so
    // without this the field, the difference line and "Save correction" were
    // all underneath the keyboard — and the field is `autoFocus`, so that was
    // the state the sheet was always in, not one you had to reach.
    const keyboard = await open();

    await keyboard.show(312);

    expect(liftOf('reconcile-sheet')).toBe(312);
  });

  it('comes back down with it', async () => {
    const keyboard = await open();

    await keyboard.show(312);
    await keyboard.hide();

    expect(liftOf('reconcile-sheet')).toBe(0);
  });

  it('listens for the events Android actually fires', async () => {
    // `keyboardWillShow` never fires on Android, so a sheet listening for it
    // reports zero forever and this whole feature is decoration.
    const keyboard = await open();

    expect(keyboard.subscribed()).toEqual(['keyboardDidHide', 'keyboardDidShow']);
  });
});

describe('the Repeat sheet', () => {
  it('rises too', async () => {
    // The one sheet that always had the lift, so a refactor cannot quietly
    // take it away again.
    const keyboard = captureKeyboard();
    await render(
      <RepeatSheet
        visible
        value={null}
        startsOn="2026-08-29"
        onClose={() => {}}
        onChange={() => {}}
      />
    );

    expect(liftOf('repeat-sheet')).toBe(0);
    await keyboard.show(280);
    expect(liftOf('repeat-sheet')).toBe(280);
  });
});
