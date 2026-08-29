import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Every bottom sheet with a field in it is lifted above the keyboard.
 *
 * A `Modal` IS ITS OWN WINDOW. Android's `adjustResize` shrinks the app's
 * window, which is why an ordinary screen can simply scroll clear of the
 * keyboard — a Modal keeps its full height, so whatever sits near the foot of a
 * sheet stays underneath the keyboard however hard the content scrolls. The
 * sheet has to be lifted by hand with `useKeyboardHeight`.
 *
 * This is a test rather than a comment because the rule was ALREADY written
 * down as a hard rule and still got missed twice. There are nine hand-rolled
 * sheets in this app and exactly one of them remembered — so "Update balance"
 * opened with its field, its difference line and its save button all hidden,
 * and because those sheets `autoFocus`, that was not an edge case reached by
 * tapping something: it was the state the sheet was always in.
 *
 * Same shape as `no-unmasked-money.test.ts`: the check is not "did we remember"
 * but "is it still impossible to forget".
 *
 * It reads the JSX BETWEEN `<Modal` and `</Modal>` rather than the whole file,
 * which is the difference between a rule and a nuisance — `drive-backup.tsx`
 * has a passphrase field on the ordinary screen and a Modal that only lists
 * files. That field resizes with the app's window and needs nothing, so
 * flagging it would be a false positive, and a false positive is how a guard
 * test earns an allowlist and stops meaning anything.
 */
const UI_DIRS = ['src/app', 'src/components'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
      continue;
    }
    if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(path);
  }
  return out;
}

/** The JSX inside each `<Modal>…</Modal>` in a file. */
function modalBodies(source: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const open = source.indexOf('<Modal', from);
    if (open === -1) return bodies;
    const close = source.indexOf('</Modal>', open);
    if (close === -1) return bodies;
    bodies.push(source.slice(open, close));
    from = close;
  }
}

describe('sheets that hold a field', () => {
  const withField = UI_DIRS.flatMap(sourceFiles).filter((file) =>
    modalBodies(readFileSync(file, 'utf8')).some((body) => body.includes('<TextInput'))
  );

  it('finds the sheets it is supposed to be guarding', () => {
    // A matcher that silently found nothing would make the assertion below pass
    // forever, which is the one way this test could rot into decoration.
    expect(withField).toContain(join('src', 'components', 'reconcile-sheet.tsx'));
    expect(withField).toContain(join('src', 'components', 'repeat-sheet.tsx'));
    expect(withField).toContain(join('src', 'app', '(drawer)', '(tabs)', 'budgets.tsx'));
  });

  it('does not count a field that lives outside the Modal', () => {
    // The other half of the matcher. If this ever fails, the slicing above has
    // stopped working and the test has become a blanket ban on Modal+TextInput.
    expect(withField).not.toContain(join('src', 'components', 'drive-backup.tsx'));
  });

  it.each(UI_DIRS)('lifts every sheet with a field above the keyboard in %s', (dir) => {
    const unlifted = withField
      .filter((file) => file.startsWith(dir))
      .filter((file) => !readFileSync(file, 'utf8').includes('useKeyboardHeight'));

    expect(unlifted).toEqual([]);
  });
});
