/**
 * @jest-environment node
 *
 * THE PART OF A MAESTRO FLOW THAT CAN BE CHECKED WITHOUT A DEVICE.
 *
 * Maestro does not run in CI — it needs a booted emulator — so a flow that
 * names an id no screen renders is not caught by anything until somebody runs
 * the suite by hand, and it fails there looking exactly like a broken app.
 * Every `id:` a flow taps or asserts has to exist in `src/`, and this checks
 * it against the source rather than against a list somebody maintains.
 *
 * Two kinds of testID live in the tree and both are handled: the literal
 * (`testID="form-save"`) and the one built from data
 * (`testID={`tab-${name}`}`), which becomes a pattern here because its value
 * is only known at run time.
 *
 * What this canNOT do is know whether `archive-delete-seed-cat-baby` names a
 * category that exists — `archive-delete-.+` matches any spelling. The keys
 * the flows hardcode are pinned separately at the foot of this file, against
 * the seed and the same `idSlug` the screen uses.
 */
import fs from 'node:fs';
import path from 'node:path';

import { accountId, catId } from '../db/seed';
import { tagKey } from './tag';
import { idSlug } from './slug';

const ROOT = path.resolve(__dirname, '../..');
const FLOWS = path.join(ROOT, '.maestro');
const SOURCE = path.join(ROOT, 'src');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [full] : [];
  });
}

const source = sourceFiles(SOURCE).map((file) => fs.readFileSync(file, 'utf8'));

/** `testID="form-save"`, `testID={'form-save'}`, and `testID = 'fab'` — the
 *  default a component gives itself, which is how the home FAB is named. */
const literalIds = new Set<string>();
/** `testID={`tab-${name}`}` → /^tab-.+$/, because the value is data. */
const patterns: RegExp[] = [];
/** `testID={`${testID}-save`}` — a component naming its parts after its own prop. */
const suffixes = new Set<string>();

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const text of source) {
  for (const [, id] of text.matchAll(/testID\s*=\s*["']([^"'{}]+)["']/g)) literalIds.add(id);
  // `testID={isReversal ? 'reversal-badge' : 'refund-badge'}` — both are real.
  for (const [, a, b] of text.matchAll(/testID=\{[^}]*?'([^']+)'\s*:\s*'([^']+)'\}/g)) {
    literalIds.add(a);
    literalIds.add(b);
  }
  // The tab bar names its buttons through the navigator, not through a prop.
  for (const [, template] of text.matchAll(/tabBarButtonTestID:\s*`([^`]+)`/g)) {
    const head = template.slice(0, template.indexOf('${'));
    if (head.length > 1) patterns.push(new RegExp(`^${escape(head)}.+$`));
  }
  for (const [, id] of text.matchAll(/testID=\{'([^']+)'\}/g)) literalIds.add(id);
  // `testID: 'drawer-settings'` — the drawer builds its rows from a list.
  for (const [, id] of text.matchAll(/testID:\s*'([^']+)'/g)) literalIds.add(id);
  // `testIDPrefix="cat-kind"` — a segmented control names its options.
  for (const [, prefix] of text.matchAll(/testIDPrefix\s*=\s*["']([^"']+)["']/g)) {
    patterns.push(new RegExp(`^${escape(prefix)}-.+$`));
  }

  for (const [, template] of text.matchAll(/testID=\{`([^`]+)`\}/g)) {
    const head = template.slice(0, template.indexOf('${'));
    if (head.length > 1) {
      // A LITERAL HEAD IS WHAT MAKES THIS WORTH ANYTHING. Generalising the
      // whole template instead turns `${testIDPrefix}-${option.value}` into
      // `^.+-.+$`, which matches every hyphenated id there is — and a check
      // that matches everything passes everything, which is worse than no
      // check at all because it looks like one.
      patterns.push(new RegExp(`^${escape(head)}.+$`));
      continue;
    }

    // No literal head: the prefix is the caller's own testID, so the real ids
    // are every literal id plus this suffix. Collected now, paired below once
    // every file has been read.
    const tail = template.slice(template.indexOf('}') + 1);
    if (tail && !tail.includes('${')) suffixes.add(tail);
  }
}

for (const suffix of suffixes) {
  for (const id of [...literalIds]) literalIds.add(`${id}${suffix}`);
}

const flowFiles = fs
  .readdirSync(FLOWS)
  .filter((f) => f.endsWith('.yaml'))
  .sort();

/** Every `id:` a flow refers to, with the file it came from. */
const referenced = flowFiles.flatMap((file) => {
  const text = fs.readFileSync(path.join(FLOWS, file), 'utf8');
  return [...text.matchAll(/^\s*id:\s*"([^"]+)"/gm)].map(([, id]) => ({ file, id }));
});

/**
 * Every id-shaped string literal in the tree, however it is used.
 *
 * The last mile the strong rules above cannot reach: an id handed to a local
 * helper (`cell('Expense', expense, 'text-expense', 'summary-expense')`) is a
 * string in a call, indistinguishable from any other string without types.
 * Deliberately loose, and still worth having — the failure this file exists to
 * catch is a flow naming an id that was renamed or mistyped, and such an id
 * appears NOWHERE in the source. What it costs is the ability to tell a real
 * testID from a coincidence, which is why the strong rules run first.
 */
const quoted = new Set<string>();
for (const text of source) {
  for (const [, value] of text.matchAll(/['"]([a-z][a-z0-9]*(?:-[a-z0-9]+)+)['"]/g)) {
    quoted.add(value);
  }
}

const known = (id: string) =>
  literalIds.has(id) || patterns.some((p) => p.test(id)) || quoted.has(id);

describe('every id a flow taps exists in the app', () => {
  it('found flows and testIDs to compare at all', () => {
    // Guards the rest: a broken glob would let every case below pass by
    // comparing nothing to nothing.
    expect(flowFiles.length).toBeGreaterThan(5);
    expect(referenced.length).toBeGreaterThan(50);
    expect(literalIds.size).toBeGreaterThan(50);
    expect(patterns.length).toBeGreaterThan(3);
  });

  it('does not accept an id the app has never heard of', () => {
    // THE FAILURE THIS FILE NEARLY SHIPPED WITH. Generalising every template
    // turned `${testIDPrefix}-${option.value}` into `^.+-.+$`, which matches
    // every hyphenated id there is — so all 24 flows passed while nothing was
    // being checked. A validator that accepts everything is worse than none,
    // because it looks like one.
    expect(known('zzz-no-such-id')).toBe(false);
    expect(known('archived-accounts-panel')).toBe(false);
    // Not `tab-index-2`: `tab-${name}` is genuinely open-ended, and a
    // pattern cannot know which routes exist. Under a dynamic prefix this
    // file stops short by design, which is what the hardcoded keys below
    // are for.
    expect(known('tabs-index')).toBe(false);
  });

  it.each(flowFiles)('%s', (file) => {
    const missing = referenced
      .filter((ref) => ref.file === file && !known(ref.id))
      .map((ref) => ref.id);

    expect(missing).toEqual([]);
  });
});

describe('testIDs are regex-safe, because Maestro matches them as regexes', () => {
  it('has no literal id carrying a regex character', () => {
    // `key-op-+` read as "`key-op` then one or more hyphens" and tapped the
    // MINUS key, under a green test claiming to add.
    const unsafe = [...literalIds].filter((id) => !/^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/.test(id));
    expect(unsafe).toEqual([]);
  });
});

/**
 * The keys a flow spells out by hand.
 *
 * `tag-kitchen` is matched by the `tag-${slug}` pattern above whatever it says
 * after the prefix, so the half that matters — that this is the key the screen
 * will actually render for that row — is pinned here, through the same
 * `idSlug` the screen uses.
 *
 * ACCOUNTS AND CATEGORIES NO LONGER APPEAR HERE, and that is the point of the
 * redesign rather than a gap: their actions are reached by HOLDING the row,
 * which Maestro finds by the visible name, so no flow has to know a seeded id.
 * Tags keep a key because a tag row carries no amount or subtitle to hold onto
 * and its name is the only thing on it.
 */
describe('the keys the flows hardcode', () => {
  it('are what the screen builds for a tag called Kitchen', () => {
    // The tag rows are keyed by the NORMALISED name, which is what survives
    // a rename to "kitchen" and back.
    expect(idSlug(tagKey('Kitchen'))).toBe('kitchen');
    expect(idSlug(tagKey('Kitchen redo'))).toBe('kitchen-redo');
  });

  it('are spelled the same way in the flows', () => {
    const ids = new Set(referenced.map((ref) => ref.id));
    for (const id of [
      `tag-${idSlug(tagKey('Kitchen'))}`,
      `tag-count-${idSlug(tagKey('Kitchen'))}`,
      `tag-${idSlug(tagKey('Kitchen redo'))}`,
      `tag-count-${idSlug(tagKey('Kitchen redo'))}`,
      `tag-row-${idSlug(tagKey('Kitchen redo'))}`,
    ]) {
      expect([...ids]).toContain(id);
    }
  });
});
