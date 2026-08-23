import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * The masking rule, enforced structurally rather than remembered.
 *
 * Amounts are hidden by going through `useMoney`, and there are sixty-odd
 * places that render one. A rule that lives in sixty places is a rule that gets
 * missed at one of them — and this is the worst possible thing to miss, because
 * the failure is silent and inverted: the header says amounts are hidden, the
 * user believes it and turns the screen towards someone, and one figure is
 * still sitting there. Nothing about the screen looks wrong.
 *
 * So the check is not "did we remember" but "is it still impossible to forget".
 * Same shape as `ICON_NAMES` being the category map itself rather than a
 * parallel list beside it: a new screen that reaches for `formatMinor` fails
 * here on its first run, long before anyone has to notice it in review.
 *
 * `formatMinor` itself stays exported and unrestricted — `src/lib` and
 * `src/db` use it for CSV headers, tests and anything that is not a screen.
 * The rule is about the UI layer only.
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

describe('money reaching the screen', () => {
  const files = UI_DIRS.flatMap(sourceFiles);

  it('finds the UI files it is supposed to be guarding', () => {
    // A walker that silently returns nothing would make every assertion below
    // pass forever, which is the one way this test could rot into decoration.
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain(join('src', 'components', 'record-row.tsx'));
  });

  it.each(UI_DIRS)('never calls formatMinor directly in %s', (dir) => {
    const offenders = sourceFiles(dir).filter((file) =>
      readFileSync(file, 'utf8').includes('formatMinor')
    );

    expect(offenders).toEqual([]);
  });

  it('routes every screen that shows an amount through useMoney', () => {
    // The other half of the rule. Banning formatMinor alone would be satisfied
    // by a screen that renders no amounts at all — this checks that the files
    // which DO format money took the masked path rather than inventing one.
    const formatting = files.filter((file) => {
      const src = readFileSync(file, 'utf8');
      return src.includes('money(') || src.includes('useMoney');
    });

    for (const file of formatting) {
      expect(readFileSync(file, 'utf8')).toContain("from '@/state/money'");
    }
    expect(formatting.length).toBeGreaterThan(10);
  });
});
