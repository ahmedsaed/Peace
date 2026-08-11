import {
  activeFilterCount,
  amountBoundsMinor,
  EMPTY_QUERY,
  isRunnable,
  likePattern,
  rangeBounds,
  type SearchQuery,
} from './search-query';

const q = (over: Partial<SearchQuery> = {}): SearchQuery => ({ ...EMPTY_QUERY, ...over });

describe('isRunnable', () => {
  it('refuses an empty query', () => {
    // Returning every record ever entered is not a search result — it is the
    // records list with the month navigator taken off.
    expect(isRunnable(EMPTY_QUERY)).toBe(false);
  });

  it('refuses whitespace', () => {
    expect(isRunnable(q({ text: '   ' }))).toBe(false);
  });

  it('runs on text alone', () => {
    expect(isRunnable(q({ text: 'a' }))).toBe(true);
  });

  it('runs on a filter alone, with no text', () => {
    // "Every transfer this year" is a legitimate search with nothing typed.
    expect(isRunnable(q({ kind: 'transfer' }))).toBe(true);
    expect(isRunnable(q({ range: 'year' }))).toBe(true);
    expect(isRunnable(q({ minAmount: '100' }))).toBe(true);
  });
});

describe('activeFilterCount', () => {
  it('is zero for a fresh query', () => {
    expect(activeFilterCount(EMPTY_QUERY)).toBe(0);
  });

  it('does not count the text field', () => {
    // The text is visible on screen. Badging it would claim a hidden filter.
    expect(activeFilterCount(q({ text: 'coffee' }))).toBe(0);
  });

  it('counts a min and a max as one filter between them', () => {
    expect(activeFilterCount(q({ minAmount: '100' }))).toBe(1);
    expect(activeFilterCount(q({ minAmount: '100', maxAmount: '200' }))).toBe(1);
  });

  it('adds up the independent filters', () => {
    expect(
      activeFilterCount(
        q({ kind: 'expense', accountId: 'a1', categoryId: 'c1', range: 'month', minAmount: '5' })
      )
    ).toBe(5);
  });
});

describe('likePattern', () => {
  it('wraps the text in wildcards', () => {
    expect(likePattern('coffee')).toBe('%coffee%');
  });

  it('trims, so a trailing space does not stop matching', () => {
    expect(likePattern('  coffee ')).toBe('%coffee%');
  });

  /**
   * The whole reason this function exists. Unescaped, `%` matches every record
   * in the database and `_` matches any single character — both while looking
   * exactly like an ordinary search that happened to find odd results.
   */
  it('escapes SQL wildcards', () => {
    expect(likePattern('50%')).toBe('%50\\%%');
    expect(likePattern('50_off')).toBe('%50\\_off%');
  });

  it('escapes the escape character first', () => {
    // Otherwise a backslash in a note leaves a dangling escape and the pattern
    // stops meaning what it says.
    expect(likePattern('a\\b')).toBe('%a\\\\b%');
    expect(likePattern('\\%')).toBe('%\\\\\\%%');
  });
});

describe('amountBoundsMinor', () => {
  it('parses both bounds into minor units', () => {
    expect(amountBoundsMinor(q({ minAmount: '100', maxAmount: '250.50' }), 'EGP')).toEqual({
      min: 10_000,
      max: 25_050,
    });
  });

  it('leaves an empty bound absent', () => {
    expect(amountBoundsMinor(q({ minAmount: '100' }), 'EGP')).toEqual({ min: 10_000, max: null });
    expect(amountBoundsMinor(EMPTY_QUERY, 'EGP')).toEqual({ min: null, max: null });
  });

  /**
   * The user reads "E£250" off the list. Nobody hunting a 250-pound lunch
   * thinks of it as -250, so the bounds are magnitudes and the repository
   * compares against abs().
   */
  it('is unsigned, so a typed minus still matches expenses', () => {
    expect(amountBoundsMinor(q({ minAmount: '-100' }), 'EGP').min).toBe(10_000);
  });

  it('swaps reversed bounds instead of matching nothing', () => {
    // "More than 500 and less than 100" is never what anyone meant, and an
    // empty screen would read as missing data rather than as a typo.
    expect(amountBoundsMinor(q({ minAmount: '500', maxAmount: '100' }), 'EGP')).toEqual({
      min: 10_000,
      max: 50_000,
    });
  });

  it('treats unparseable input as absent, not as zero', () => {
    // Zero as a max would empty the screen mid-keystroke.
    expect(amountBoundsMinor(q({ minAmount: 'abc', maxAmount: '..' }), 'EGP')).toEqual({
      min: null,
      max: null,
    });
  });

  it('honours the precision of the currency', () => {
    // Yen has no minor unit; 100 JPY is 100, not 10,000.
    expect(amountBoundsMinor(q({ minAmount: '100' }), 'JPY').min).toBe(100);
    expect(amountBoundsMinor(q({ minAmount: '100' }), 'KWD').min).toBe(100_000);
  });
});

describe('rangeBounds', () => {
  const june = new Date(2026, 5, 17, 14, 30);

  it('is absent for "any time"', () => {
    expect(rangeBounds('any', june)).toBeNull();
  });

  it('brackets the current calendar month', () => {
    expect(rangeBounds('month', june)).toEqual({
      start: new Date(2026, 5, 1),
      end: new Date(2026, 6, 1),
    });
  });

  it('counts the current month as one of the three', () => {
    expect(rangeBounds('quarter', june)?.start).toEqual(new Date(2026, 3, 1));
  });

  it('rolls a quarter back over the year boundary', () => {
    // February reaches into December of the previous year.
    expect(rangeBounds('quarter', new Date(2026, 1, 3))?.start).toEqual(new Date(2025, 11, 1));
  });

  it('brackets the calendar year', () => {
    expect(rangeBounds('year', june)).toEqual({
      start: new Date(2026, 0, 1),
      end: new Date(2027, 0, 1),
    });
  });

  it('starts at local midnight, not UTC', () => {
    // A record logged at 11pm on the 1st belongs to the month the user lived.
    const start = rangeBounds('month', june)!.start;
    expect(start.getHours()).toBe(0);
    expect(start.getDate()).toBe(1);
  });
});
