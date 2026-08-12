import { feeMinor, foreignPurchase } from './fees';

describe('feeMinor', () => {
  it('takes the documented 3% of a real converted amount', () => {
    // $25 at 49.873 is E£1,246.83; 3% of that is E£37.40.
    expect(feeMinor(124_683, 300)).toBe(3_740);
  });

  it('is zero when the card charges no fee', () => {
    // So a card with no profile needs no special-casing at the call site.
    expect(feeMinor(124_683, null)).toBe(0);
    expect(feeMinor(124_683, undefined)).toBe(0);
    expect(feeMinor(124_683, 0)).toBe(0);
  });

  it('ignores a negative rate rather than crediting money back', () => {
    expect(feeMinor(124_683, -300)).toBe(0);
  });

  it('is unsigned — a fee on a refund is still a charge', () => {
    expect(feeMinor(-124_683, 300)).toBe(3_740);
  });

  /**
   * The reason the rate is basis points and the multiply comes before the
   * divide: an integer result, identical every time, for a percentage of money.
   */
  it('is an exact integer', () => {
    for (const amount of [1, 7, 99, 12_345, 999_999]) {
      const fee = feeMinor(amount, 300);
      expect(Number.isInteger(fee)).toBe(true);
    }
  });

  it('rounds a half up rather than truncating it away', () => {
    // 5% of 50 is 2.5. Truncating would quietly under-charge every time.
    expect(feeMinor(50, 500)).toBe(3);
  });

  it('handles a fractional rate', () => {
    // 3.5% is 350 basis points.
    expect(feeMinor(100_000, 350)).toBe(3_500);
  });

  it('is zero on a zero amount', () => {
    expect(feeMinor(0, 300)).toBe(0);
  });
});

describe('foreignPurchase', () => {
  it('adds the fee to what the card is charged', () => {
    expect(foreignPurchase(124_683, 300)).toEqual({
      settledMinor: 124_683,
      feeMinor: 3_740,
      totalMinor: 128_423,
    });
  });

  it('leaves the amount alone when the card charges nothing', () => {
    expect(foreignPurchase(124_683, null)).toEqual({
      settledMinor: 124_683,
      feeMinor: 0,
      totalMinor: 124_683,
    });
  });

  /**
   * The parts have to add up, or the two records written from this would move
   * the card by a different amount than the screen promised.
   */
  it('always totals its parts', () => {
    for (const amount of [1, 999, 124_683, 5_000_000]) {
      for (const bp of [null, 0, 100, 300, 350, 500]) {
        const out = foreignPurchase(amount, bp);
        expect(out.settledMinor + out.feeMinor).toBe(out.totalMinor);
      }
    }
  });
});
