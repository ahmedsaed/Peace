import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Colours reach the UI through the theme, never straight from the table.
 *
 * There used to be one palette, imported as a plain object in fifty files.
 * Imported like that today, a colour would be Ledger's forever: right on the
 * screen it was written against, and a dark smudge on a Paper one — and only on
 * the screens nobody happened to check in a light theme. Same shape as the
 * `formatMinor` rule beside this file: the check is not "did we remember" but
 * "is it still impossible to forget".
 *
 * `useTheme()` is the way in for a colour as a value; class names need nothing
 * at all. The settings page that PREVIEWS every theme asks `lib/theme` for each
 * one by id, which is a deliberate act rather than an accident of an import.
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
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

describe('colours reaching the screen', () => {
  const files = UI_DIRS.flatMap(sourceFiles);

  it('finds the UI files it is supposed to be guarding', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain(join('src', 'components', 'record-row.tsx'));
  });

  it('never imports the theme table directly', () => {
    const offenders = files.filter((file) => /constants\/(themes|palette)['"]/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('reads colours as values only through useTheme', () => {
    // A file that names `palette.` must have got it from the hook — anything
    // else is a module-level copy the theme cannot reach.
    const offenders = files.filter((file) => {
      const src = readFileSync(file, 'utf8');
      return /\bpalette(\.|\[)/.test(src) && !src.includes('useTheme()');
    });
    expect(offenders).toEqual([]);
  });
});
