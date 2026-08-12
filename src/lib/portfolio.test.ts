import {
  allocateMinor,
  analyse,
  driftBand,
  FULL_ALLOCATION_BP,
  holdingValueMinor,
  recommend,
  targetsAreComplete,
  targetsTotalBp,
  totalValueMinor,
  UNIT_SCALE,
  valueByClass,
  type AssetClass,
  type Holding,
} from './portfolio';

const cls = (id: string, name: string, targetBp: number): AssetClass => ({ id, name, targetBp });

/** `units` and `price` in the natural units a person would type. */
const hold = (id: string, assetClassId: string, units: number, price: number): Holding => ({
  id,
  name: id,
  assetClassId,
  unitsMicro: Math.round(units * UNIT_SCALE),
  priceMinor: Math.round(price * 100),
});

describe('what a holding is worth', () => {
  it('multiplies fractional units by a fractional price', () => {
    // 12.347 units at 41.83 = 516.47501 -> 516.48
    expect(holdingValueMinor(hold('h', 'a', 12.347, 41.83))).toBe(51_648);
  });

  it('rounds half away from zero rather than toward +infinity', () => {
    // 0.5 units at 0.01 = 0.005 -> half a piastre. Math.round would take it to
    // 1 here and to -0 for the mirror case; money must round symmetrically.
    expect(holdingValueMinor(hold('h', 'a', 0.5, 0.01))).toBe(1);
  });

  it('handles a holding worth nothing', () => {
    expect(holdingValueMinor(hold('h', 'a', 0, 41.83))).toBe(0);
  });

  it('sums holdings and groups them by class', () => {
    const holdings = [hold('a1', 'stocks', 10, 100), hold('a2', 'stocks', 5, 100), hold('b1', 'bonds', 2, 50)];
    expect(totalValueMinor(holdings)).toBe(160_000);
    expect(valueByClass(holdings).get('stocks')).toBe(150_000);
    expect(valueByClass(holdings).get('bonds')).toBe(10_000);
  });
});

/**
 * Basis points make "the targets must add up to 100%" an exact integer
 * question. The tool this came from compared floats with a 0.01 tolerance —
 * a tolerance precisely because floats cannot answer it honestly.
 */
describe('target allocation', () => {
  it('is complete only at exactly 100%', () => {
    expect(targetsAreComplete([cls('a', 'A', 6_000), cls('b', 'B', 4_000)])).toBe(true);
    expect(targetsAreComplete([cls('a', 'A', 6_000), cls('b', 'B', 3_999)])).toBe(false);
    expect(targetsAreComplete([cls('a', 'A', 6_000), cls('b', 'B', 4_001)])).toBe(false);
  });

  it('is not complete when there are no classes at all', () => {
    // Zero classes sum to zero, which is not 100% — and an empty allocation
    // must not read as a finished one.
    expect(targetsAreComplete([])).toBe(false);
  });

  it('reports the running total for the progress line', () => {
    expect(targetsTotalBp([cls('a', 'A', 3_333), cls('b', 'B', 3_333)])).toBe(6_666);
  });
});

describe('drift', () => {
  const classes = [cls('stocks', 'Stocks', 6_000), cls('bonds', 'Bonds', 4_000)];

  it('is the gap between where a class is and where it should be', () => {
    // 700 stocks / 1000 total = 70%, target 60% -> +10 points.
    const rows = analyse(classes, [hold('s', 'stocks', 7, 100), hold('b', 'bonds', 3, 100)]);
    expect(rows[0]).toMatchObject({ currentBp: 7_000, driftBp: 1_000 });
    expect(rows[1]).toMatchObject({ currentBp: 3_000, driftBp: -1_000 });
  });

  it('reads an empty portfolio as 0%, not as a division by zero', () => {
    const rows = analyse(classes, []);
    expect(rows.map((r) => r.currentBp)).toEqual([0, 0]);
    expect(rows.map((r) => r.driftBp)).toEqual([-6_000, -4_000]);
  });

  it('counts a class with no holdings as fully underweight', () => {
    const rows = analyse(classes, [hold('s', 'stocks', 10, 100)]);
    expect(rows[1]).toMatchObject({ currentValueMinor: 0, driftBp: -4_000 });
  });

  it.each([
    [0, 'on-target'],
    [200, 'on-target'],
    [201, 'drifting'],
    [500, 'drifting'],
    [501, 'off-target'],
    [-201, 'drifting'],
    [-501, 'off-target'],
  ])('bands %i basis points as %s', (drift, band) => {
    expect(driftBand(drift)).toBe(band);
  });
});

/**
 * The heart of it: money is split across weights so the parts add up to the
 * whole EXACTLY. "Invest these four amounts" that do not sum to the number just
 * typed is how a screen loses someone's trust.
 */
describe('splitting an amount across weights', () => {
  it('sums to the total exactly, even when it does not divide', () => {
    const parts = allocateMinor(10_000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10_000);
    // 3333.33 each: the spare piastre goes somewhere rather than vanishing.
    expect(parts.sort((a, b) => b - a)).toEqual([3_334, 3_333, 3_333]);
  });

  it('gives the remainder to the largest fraction first', () => {
    const parts = allocateMinor(10, [1, 8, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10);
    expect(parts[1]).toBe(8);
  });

  it('breaks ties on the earlier index, so renders do not reorder', () => {
    expect(allocateMinor(4, [1, 1, 1])).toEqual([2, 1, 1]);
  });

  it('ignores negative weights rather than inverting the split', () => {
    const parts = allocateMinor(100, [1, -5, 1]);
    expect(parts[1]).toBe(0);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('allocates nothing when there is nothing to allocate', () => {
    expect(allocateMinor(0, [1, 2])).toEqual([0, 0]);
    expect(allocateMinor(100, [0, 0])).toEqual([0, 0]);
  });
});

describe('recommending where the next contribution goes', () => {
  const classes = [cls('stocks', 'Stocks', 6_000), cls('bonds', 'Bonds', 4_000)];

  it('sends everything to the underweight class', () => {
    // 700/300 against a 60/40 target: stocks are ahead, so bonds get it all.
    const recs = recommend(classes, [hold('s', 'stocks', 7, 100), hold('b', 'bonds', 3, 100)], 10_000);
    expect(recs[0]).toMatchObject({ overweight: true, investMinor: 0 });
    expect(recs[1].investMinor).toBe(10_000);
  });

  /** The whole point of the strategy: an overweight class is never sold. */
  it('never asks for a negative investment', () => {
    const recs = recommend(classes, [hold('s', 'stocks', 100, 100), hold('b', 'bonds', 1, 100)], 5_000);
    expect(recs.every((r) => r.investMinor >= 0)).toBe(true);
    expect(recs.every((r) => r.shortfallMinor >= 0)).toBe(true);
  });

  it('spends exactly the amount offered, never more or less', () => {
    const holdings = [hold('s', 'stocks', 7, 100), hold('b', 'bonds', 3, 100)];
    for (const amount of [1, 7, 333, 10_000, 999_999]) {
      const spent = recommend(classes, holdings, amount).reduce((a, r) => a + r.investMinor, 0);
      expect(spent).toBe(amount);
    }
  });

  /**
   * Falls out of the maths rather than being special-cased: at target, each
   * class needs `newMoney × target`, so the split becomes target-weighted with
   * no separate branch for the already-balanced portfolio.
   */
  it('splits by target weight once the portfolio is already balanced', () => {
    const balanced = [hold('s', 'stocks', 6, 100), hold('b', 'bonds', 4, 100)];
    const recs = recommend(classes, balanced, 10_000);
    expect(recs.map((r) => r.investMinor)).toEqual([6_000, 4_000]);
  });

  it('measures against the portfolio AFTER the money goes in', () => {
    // Empty portfolio, 10,000 in: the whole contribution is split 60/40.
    // Measuring against today's total (zero) would aim at nothing at all.
    const recs = recommend(classes, [], 10_000);
    expect(recs.map((r) => r.investMinor)).toEqual([6_000, 4_000]);
  });

  it('brings a portfolio fully to target when the money is enough', () => {
    // 700/300 needs 100 into bonds to reach 60/40 at a 1,100 total... so a
    // large enough contribution lands both classes exactly on target.
    const holdings = [hold('s', 'stocks', 7, 100), hold('b', 'bonds', 3, 100)];
    const recs = recommend(classes, holdings, 100_000);

    const after = [
      recs[0].currentValueMinor + recs[0].investMinor,
      recs[1].currentValueMinor + recs[1].investMinor,
    ];
    const total = after[0] + after[1];
    expect(Math.round((after[0] / total) * FULL_ALLOCATION_BP)).toBe(6_000);
  });

  it('recommends nothing when there is nothing to invest', () => {
    const recs = recommend(classes, [hold('s', 'stocks', 7, 100)], 0);
    expect(recs.every((r) => r.investMinor === 0)).toBe(true);
  });
});
