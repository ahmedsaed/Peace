import {
  budgetFraction,
  budgetPercent,
  budgetState,
  remainingMinor,
  roundUpSuggestion,
} from './budget';

describe('budgetState', () => {
  it('is "none" without a limit', () => {
    expect(budgetState(-25_000, 0)).toBe('none');
    // A negative limit is not a limit. It should never reach here, but treating
    // it as "spend freely" beats reporting 0% against a nonsense number.
    expect(budgetState(-25_000, -100)).toBe('none');
  });

  it('reads an expense stored as negative', () => {
    // The ledger stores spending as negative and the budget as positive. If
    // the sign leaked in, this would be -83% and the bar would run backwards.
    expect(budgetState(-25_000, 30_000)).toBe('under');
  });

  /** A warning that arrives once the money is gone is a report, not a warning. */
  it('warns at 90%, before the money runs out', () => {
    expect(budgetState(-26_999, 30_000)).toBe('under');
    expect(budgetState(-27_000, 30_000)).toBe('close');
    expect(budgetState(-30_000, 30_000)).toBe('close');
  });

  it('is "over" only past the limit, not at it', () => {
    // Spending exactly the budget is a success, not a failure.
    expect(budgetState(-30_000, 30_000)).toBe('close');
    expect(budgetState(-30_001, 30_000)).toBe('over');
  });

  it('is "under" at zero spend', () => {
    expect(budgetState(0, 30_000)).toBe('under');
  });
});

describe('budgetFraction', () => {
  it('is the share of the limit used', () => {
    expect(budgetFraction(-15_000, 30_000)).toBe(0.5);
  });

  /**
   * A bar cannot be 140% long. Unclamped it would either overflow its row or be
   * scaled so every over-budget category looked identically full.
   */
  it('clamps at 1 so the bar cannot overflow', () => {
    expect(budgetFraction(-45_000, 30_000)).toBe(1);
  });

  it('is 0 without a limit, rather than NaN or Infinity', () => {
    // x / 0 is Infinity, and a style width of Infinity crashes the layout.
    expect(budgetFraction(-25_000, 0)).toBe(0);
  });
});

describe('budgetPercent', () => {
  it('is not clamped — the overspend is the useful part', () => {
    expect(budgetPercent(-42_000, 30_000)).toBe(140);
  });

  it('rounds to a whole percent', () => {
    expect(budgetPercent(-24_999, 30_000)).toBe(83);
  });

  it('is 0 without a limit', () => {
    expect(budgetPercent(-25_000, 0)).toBe(0);
  });
});

describe('remainingMinor', () => {
  it('is positive headroom', () => {
    expect(remainingMinor(-25_000, 30_000)).toBe(5_000);
  });

  /**
   * Signed, not a magnitude plus an "is over" flag. Two things kept in step is
   * how a screen ends up saying "E£300 left" in the over-budget colour.
   */
  it('goes negative when overspent', () => {
    expect(remainingMinor(-33_000, 30_000)).toBe(-3_000);
  });
});

describe('roundUpSuggestion', () => {
  /**
   * UP, never to nearest. These are derived from what you already spend, so a
   * limit rounded down is one you are guaranteed to breach in a month that
   * looks exactly like the last three.
   */
  it('never rounds down', () => {
    expect(roundUpSuggestion(284_700, 2)).toBeGreaterThanOrEqual(284_700);
    expect(roundUpSuggestion(908_300, 2)).toBeGreaterThanOrEqual(908_300);
  });

  it('rounds a large amount to the nearest 50 above it', () => {
    // E£2,847 -> E£2,850. Reads as a decision, not a calculation.
    expect(roundUpSuggestion(284_700, 2)).toBe(285_000);
    expect(roundUpSuggestion(908_300, 2)).toBe(910_000);
  });

  it('rounds a small amount to the nearest 10 above it', () => {
    // E£64 -> E£70. The 50-step would give E£100, which is a shrug, not a
    // suggestion.
    expect(roundUpSuggestion(6_400, 2)).toBe(7_000);
  });

  it('leaves an amount that is already round alone', () => {
    expect(roundUpSuggestion(285_000, 2)).toBe(285_000);
    expect(roundUpSuggestion(7_000, 2)).toBe(7_000);
  });

  it('has nothing to suggest for a category with no spending', () => {
    expect(roundUpSuggestion(0, 2)).toBe(0);
  });

  it('scales the step with the currency, not with the integer', () => {
    // Yen has no minor unit, so "1000 units" is 1000 yen, not 10 yen. Reusing
    // the two-decimal thresholds would switch steps a hundred times too early.
    expect(roundUpSuggestion(2_847, 0)).toBe(2_850);
    expect(roundUpSuggestion(64, 0)).toBe(70);
  });
});
