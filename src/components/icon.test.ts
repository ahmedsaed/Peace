import { defaultAccounts, defaultCategories } from '../db/seed';
import { hasIcon, ICON_GROUPS, ICON_NAMES } from './icon';

const { chrome, category, alias } = ICON_GROUPS;

describe('the glyph groups are disjoint', () => {
  /**
   * A slug written into two maps would have one definition silently win, and
   * the losing one would be dead code that still reads as if it were in force.
   */
  it('defines every slug exactly once', () => {
    const all = [...Object.keys(chrome), ...Object.keys(category), ...Object.keys(alias)];
    const seen = new Set<string>();
    const duplicated = all.filter((name) => (seen.has(name) ? true : (seen.add(name), false)));
    expect(duplicated).toEqual([]);
  });
});

describe('the picker', () => {
  /**
   * The bug this file exists for. Chrome names a section or an action, so a
   * category called "Groceries" wearing the hamburger glyph is wrong — and it
   * is wrong in a way that only ever shows up in a screenshot.
   *
   * This can no longer fail by omission, because `ICON_NAMES` is now the
   * category map rather than a hand-kept list filtered out of it. It stays as
   * the assertion that the construction is still the construction.
   */
  it('offers no chrome glyph', () => {
    for (const name of Object.keys(chrome)) {
      expect(ICON_NAMES).not.toContain(name);
    }
  });

  it('offers no alias', () => {
    for (const name of Object.keys(alias)) {
      expect(ICON_NAMES).not.toContain(name);
    }
  });

  /**
   * Two entries drawing the identical path give the user two identical circles
   * and no way to tell which one they chose. `fork` did exactly that against
   * `food` until it was moved to the aliases.
   *
   * Chrome is excluded from this on purpose: `receipt` and `tag` do duplicate
   * `records` and `categories`, but chrome is never offered, so each shape
   * still appears exactly once in the picker.
   */
  it('draws each shape only once', () => {
    const byPath = new Map<string, string[]>();
    for (const name of ICON_NAMES) {
      const d = (category as Record<string, string>)[name];
      byPath.set(d, [...(byPath.get(d) ?? []), name]);
    }
    const collisions = [...byPath.values()].filter((names) => names.length > 1);
    expect(collisions).toEqual([]);
  });

  it('is not empty', () => {
    // A construction change that produced an empty picker would otherwise pass
    // every assertion above.
    expect(ICON_NAMES.length).toBeGreaterThan(20);
  });
});

describe('the seed data', () => {
  /**
   * A category seeded with a slug that resolves to nothing renders as `dots`,
   * which looks like a deliberate "no icon" rather than a typo — so it survives
   * review and ships. Every slug the app writes on first launch has to exist.
   */
  it('names only glyphs that exist', () => {
    const missing = [
      ...defaultCategories().map((c) => c.icon),
      ...defaultAccounts().map((a) => a.icon),
    ].filter((icon): icon is string => typeof icon === 'string' && !hasIcon(icon));

    expect(missing).toEqual([]);
  });
});

describe('an unknown slug', () => {
  it('does not resolve', () => {
    // hasIcon has to be honest, because it is what tells a caller to fall back.
    expect(hasIcon('no-such-glyph')).toBe(false);
    expect(hasIcon('dots')).toBe(true);
    // Aliases still resolve even though the picker will not offer them —
    // dropping `fork` would render every seeded Restaurants row as `dots`.
    expect(hasIcon('fork')).toBe(true);
  });
});
