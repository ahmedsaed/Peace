import {
  cleanTagName,
  formatTags,
  isNewTagName,
  MAX_TAG_LENGTH,
  tagKey,
  tagNameProblem,
} from './tag';

describe('cleanTagName', () => {
  it('trims and collapses inner whitespace', () => {
    expect(cleanTagName('  kitchen   reno  ')).toBe('kitchen reno');
  });

  it('keeps the case the user typed', () => {
    // What is SHOWN is what was typed. Only the matching key is folded.
    expect(cleanTagName('Kitchen Reno')).toBe('Kitchen Reno');
  });

  it('normalises to NFC', () => {
    // "é" as one code point and as "e" + combining acute are different strings
    // and would be two tags. The keyboard decides which you get, so a person
    // can type the same name twice and be told it is new.
    const composed = 'Café';
    const decomposed = 'Café';
    expect(decomposed).not.toBe(composed);
    expect(cleanTagName(decomposed)).toBe(composed);
  });
});

describe('tagKey', () => {
  it('folds case, so one project is one tag', () => {
    expect(tagKey('Kitchen')).toBe('kitchen');
    expect(tagKey('KITCHEN')).toBe(tagKey('kitchen'));
  });

  it('folds the whitespace and the accents too', () => {
    expect(tagKey('  Café   Trip ')).toBe(tagKey('café trip'));
  });

  it('keeps genuinely different names apart', () => {
    expect(tagKey('kitchen')).not.toBe(tagKey('kitchens'));
  });
});

describe('tagNameProblem', () => {
  it('accepts an ordinary name', () => {
    expect(tagNameProblem('Kitchen reno')).toBeNull();
  });

  it('refuses nothing, and refuses whitespace', () => {
    expect(tagNameProblem('')).toBe('empty');
    expect(tagNameProblem('   ')).toBe('empty');
  });

  it('refuses a name longer than the limit', () => {
    expect(tagNameProblem('x'.repeat(MAX_TAG_LENGTH))).toBeNull();
    expect(tagNameProblem('x'.repeat(MAX_TAG_LENGTH + 1))).toBe('too-long');
  });

  it('measures the CLEANED name', () => {
    // The spaces are about to be removed, so refusing a name for carrying them
    // would be refusing one that is already short enough.
    expect(tagNameProblem(`  ${'x'.repeat(MAX_TAG_LENGTH)}  `)).toBeNull();
  });
});

describe('isNewTagName', () => {
  const existing = [{ normalised: 'kitchen' }, { normalised: 'holiday 2026' }];

  it('is true for a name nothing matches', () => {
    expect(isNewTagName('Bathroom', existing)).toBe(true);
  });

  it('is false for one that differs only by case or spacing', () => {
    // The picker asks this on every keystroke to decide whether to offer
    // "create". Offering it for a name that then merges into an existing tag
    // is a promise the save breaks.
    expect(isNewTagName('KITCHEN', existing)).toBe(false);
    expect(isNewTagName('  holiday   2026 ', existing)).toBe(false);
  });

  it('is false for a name that could not be created at all', () => {
    expect(isNewTagName('   ', existing)).toBe(false);
    expect(isNewTagName('x'.repeat(MAX_TAG_LENGTH + 1), existing)).toBe(false);
  });
});

describe('formatTags', () => {
  it('marks each one, so it does not read as more note', () => {
    // The subtitle already ends in the note. Without the hash,
    // `Cash · "Winter jacket" · kitchen` reads as one longer note.
    expect(formatTags(['kitchen', 'urgent'])).toBe('#kitchen #urgent');
  });

  it('is empty for no tags', () => {
    expect(formatTags([])).toBe('');
  });
});
