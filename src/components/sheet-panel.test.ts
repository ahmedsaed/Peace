import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Every bottom sheet goes through `SheetPanel`, enforced rather than
 * remembered. Each sheet used to pad its own foot with a fixed `pb-8`, so all
 * fourteen of them sat under the three-button navigation bar at once — and the
 * next sheet written the old way would bring it straight back, invisibly, on
 * every emulator and phone using gesture navigation.
 */
const UI_DIRS = ['src/app', 'src/components'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx$/.test(entry)) out.push(path);
  }
  return out;
}

describe('bottom sheets', () => {
  const files = UI_DIRS.flatMap(sourceFiles);

  it('finds the sheets it is supposed to be guarding', () => {
    const sliding = files.filter((f) => readFileSync(f, 'utf8').includes('animationType="slide"'));
    expect(sliding.length).toBeGreaterThan(10);
  });

  it('renders every sliding Modal through SheetPanel', () => {
    const offenders = files.filter((file) => {
      const text = readFileSync(file, 'utf8');
      return text.includes('animationType="slide"') && !text.includes('<SheetPanel');
    });
    expect(offenders).toEqual([]);
  });

  it('never hand-builds the panel chrome outside SheetPanel', () => {
    const offenders = files.filter(
      (file) =>
        !file.endsWith('sheet-panel.tsx') && readFileSync(file, 'utf8').includes('rounded-t-2xl')
    );
    expect(offenders).toEqual([]);
  });
});
