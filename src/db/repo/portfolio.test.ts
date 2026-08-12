/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/db';
import { UNIT_SCALE } from '../../lib/portfolio';
import {
  createAssetClass,
  createHolding,
  deleteAssetClass,
  deleteHolding,
  listAssetClasses,
  listHoldings,
  portfolioSnapshot,
  PortfolioError,
  rebalancePlan,
  updateAssetClass,
  updateHolding,
} from './portfolio';

const units = (n: number) => Math.round(n * UNIT_SCALE);

function seed() {
  const { db } = createTestDb();
  createAssetClass(db, { id: 'stocks', name: 'Stocks', targetBp: 6_000 });
  createAssetClass(db, { id: 'bonds', name: 'Bonds', targetBp: 4_000 });
  return db;
}

describe('asset classes', () => {
  it('stores and lists them', () => {
    const db = seed();
    expect(listAssetClasses(db).map((c) => c.name)).toEqual(['Stocks', 'Bonds']);
  });

  it('refuses a nameless class', () => {
    const { db } = createTestDb();
    expect(() => createAssetClass(db, { name: '   ', targetBp: 5_000 })).toThrow(PortfolioError);
  });

  it('refuses a fractional or negative target', () => {
    // Basis points are integers by definition; a fraction here means someone
    // has passed a percentage by mistake.
    const { db } = createTestDb();
    expect(() => createAssetClass(db, { name: 'X', targetBp: 12.5 })).toThrow(PortfolioError);
    expect(() => createAssetClass(db, { name: 'X', targetBp: -100 })).toThrow(PortfolioError);
  });

  it('updates a target', () => {
    const db = seed();
    updateAssetClass(db, 'stocks', { targetBp: 7_000 });
    expect(listAssetClasses(db).find((c) => c.id === 'stocks')?.targetBp).toBe(7_000);
  });

  /**
   * Orphaned holdings would belong to no class, drop out of every total, and
   * still be listed as owned — worse than being removed with the class.
   */
  it('takes its holdings with it when deleted', () => {
    const db = seed();
    createHolding(db, { name: 'Fund A', assetClassId: 'stocks', unitsMicro: units(10), priceMinor: 10_000 });
    createHolding(db, { name: 'Bond A', assetClassId: 'bonds', unitsMicro: units(5), priceMinor: 10_000 });

    deleteAssetClass(db, 'stocks');

    expect(listHoldings(db).map((h) => h.name)).toEqual(['Bond A']);
  });
});

describe('holdings', () => {
  it('stores fractional units without losing them', () => {
    const db = seed();
    createHolding(db, {
      name: 'Fund A',
      assetClassId: 'stocks',
      unitsMicro: units(12.347),
      priceMinor: 4_183,
    });
    expect(listHoldings(db)[0].unitsMicro).toBe(12_347_000);
  });

  it('refuses zero or negative units and prices', () => {
    const db = seed();
    const base = { name: 'X', assetClassId: 'stocks', unitsMicro: units(1), priceMinor: 100 };
    expect(() => createHolding(db, { ...base, unitsMicro: 0 })).toThrow(/Units/);
    expect(() => createHolding(db, { ...base, priceMinor: 0 })).toThrow(/price/i);
    expect(() => createHolding(db, { ...base, unitsMicro: -1 })).toThrow(/Units/);
  });

  it('updates a price, which is how a portfolio is revalued', () => {
    const db = seed();
    const h = createHolding(db, {
      name: 'Fund A',
      assetClassId: 'stocks',
      unitsMicro: units(10),
      priceMinor: 10_000,
    });
    expect(portfolioSnapshot(db).totalValueMinor).toBe(100_000);

    updateHolding(db, h.id, { priceMinor: 12_000 });

    // The portfolio is worth more with no transaction anywhere — which is
    // exactly why this feature stays out of the ledger.
    expect(portfolioSnapshot(db).totalValueMinor).toBe(120_000);
  });

  it('deletes one without touching the others', () => {
    const db = seed();
    const a = createHolding(db, { name: 'A', assetClassId: 'stocks', unitsMicro: units(1), priceMinor: 100 });
    createHolding(db, { name: 'B', assetClassId: 'stocks', unitsMicro: units(1), priceMinor: 100 });

    deleteHolding(db, a.id);
    expect(listHoldings(db).map((h) => h.name)).toEqual(['B']);
  });
});

describe('the snapshot a screen reads', () => {
  it('reports the running target total before it is complete', () => {
    const { db } = createTestDb();
    createAssetClass(db, { name: 'Stocks', targetBp: 6_000 });

    const snapshot = portfolioSnapshot(db);
    expect(snapshot.targetsTotalBp).toBe(6_000);
    expect(snapshot.targetsComplete).toBe(false);
  });

  it('is complete at exactly 100%', () => {
    expect(portfolioSnapshot(seed()).targetsComplete).toBe(true);
  });

  it('carries the drift for each class', () => {
    const db = seed();
    createHolding(db, { name: 'A', assetClassId: 'stocks', unitsMicro: units(7), priceMinor: 10_000 });
    createHolding(db, { name: 'B', assetClassId: 'bonds', unitsMicro: units(3), priceMinor: 10_000 });

    // 7 units at 100.00 = 700.00, 3 at 100.00 = 300.00, so 1,000.00 in total.
    const snapshot = portfolioSnapshot(db);
    expect(snapshot.totalValueMinor).toBe(100_000);
    expect(snapshot.drift.map((d) => d.driftBp)).toEqual([1_000, -1_000]);
  });
});

describe('the rebalancing plan', () => {
  it('refuses while the targets do not add up', () => {
    // Confident-looking amounts derived from a target the user has not
    // finished stating are worse than no amounts at all.
    const { db } = createTestDb();
    createAssetClass(db, { name: 'Stocks', targetBp: 6_000 });

    expect(() => rebalancePlan(db, 100_000)).toThrow(/add up to 100%/);
  });

  it('sends a modest contribution entirely to whatever is behind', () => {
    const db = seed();
    createHolding(db, { name: 'A', assetClassId: 'stocks', unitsMicro: units(7), priceMinor: 10_000 });
    createHolding(db, { name: 'B', assetClassId: 'bonds', unitsMicro: units(3), priceMinor: 10_000 });

    // 700/300 against 60/40, adding 100.00: stocks are still ahead afterwards,
    // so the whole contribution goes to bonds.
    const plan = rebalancePlan(db, 10_000);
    expect(plan.find((p) => p.assetClassId === 'stocks')?.investMinor).toBe(0);
    expect(plan.find((p) => p.assetClassId === 'bonds')?.investMinor).toBe(10_000);
  });

  /**
   * Not an edge case — it is what happens whenever the contribution is large
   * relative to the portfolio. A big enough deposit leaves EVERY class short of
   * the target it will have afterwards, so all of them are underweight and all
   * of them get a share.
   */
  it('spreads a large contribution across every class, not just the laggard', () => {
    const db = seed();
    createHolding(db, { name: 'A', assetClassId: 'stocks', unitsMicro: units(7), priceMinor: 10_000 });
    createHolding(db, { name: 'B', assetClassId: 'bonds', unitsMicro: units(3), priceMinor: 10_000 });

    // Doubling the portfolio: stocks need 1,200 total and hold 700; bonds need
    // 800 and hold 300. Both short by 500.
    const plan = rebalancePlan(db, 100_000);
    expect(plan.map((p) => p.investMinor)).toEqual([50_000, 50_000]);
    expect(plan.every((p) => !p.overweight)).toBe(true);
  });

  it('spends exactly what was offered', () => {
    const db = seed();
    createHolding(db, { name: 'A', assetClassId: 'stocks', unitsMicro: units(7), priceMinor: 10_000 });
    createHolding(db, { name: 'B', assetClassId: 'bonds', unitsMicro: units(3), priceMinor: 10_000 });

    expect(rebalancePlan(db, 33_333).reduce((a, p) => a + p.investMinor, 0)).toBe(33_333);
  });
});
