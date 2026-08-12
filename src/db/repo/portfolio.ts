/**
 * Reading and writing the portfolio.
 *
 * Storage only — every calculation lives in `src/lib/portfolio.ts`, where it is
 * pure and tested. Nothing here reaches the ledger: no transaction is written,
 * no account balance moves, and none of these figures reach the Accounts total.
 */

import { asc, eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { newId } from '../../lib/id';
import {
  analyse,
  recommend,
  targetsAreComplete,
  targetsTotalBp,
  totalValueMinor,
  type AssetClass,
  type DriftRow,
  type Holding,
  type Recommendation,
} from '../../lib/portfolio';
import * as schema from '../schema';
import { assetClasses, holdings } from '../schema';

type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export class PortfolioError extends Error {}

export function listAssetClasses(db: Db): AssetClass[] {
  return db
    .select({ id: assetClasses.id, name: assetClasses.name, targetBp: assetClasses.targetBp })
    .from(assetClasses)
    .orderBy(asc(assetClasses.sortOrder), asc(assetClasses.name))
    .all();
}

export function listHoldings(db: Db): Holding[] {
  return db
    .select({
      id: holdings.id,
      name: holdings.name,
      assetClassId: holdings.assetClassId,
      unitsMicro: holdings.unitsMicro,
      priceMinor: holdings.priceMinor,
    })
    .from(holdings)
    .orderBy(asc(holdings.name))
    .all();
}

export function createAssetClass(
  db: Db,
  input: { id?: string; name: string; targetBp: number }
): AssetClass {
  const name = input.name.trim();
  if (!name) throw new PortfolioError('An asset class needs a name.');
  if (!Number.isInteger(input.targetBp) || input.targetBp < 0) {
    throw new PortfolioError('A target must be a whole number of basis points, and not negative.');
  }

  const row = { id: input.id ?? newId(), name, targetBp: input.targetBp };
  db.insert(assetClasses).values({ ...row, sortOrder: countAssetClasses(db) }).run();
  return row;
}

export function updateAssetClass(
  db: Db,
  id: string,
  patch: { name?: string; targetBp?: number }
): void {
  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new PortfolioError('An asset class needs a name.');
    values.name = name;
  }
  if (patch.targetBp !== undefined) {
    if (!Number.isInteger(patch.targetBp) || patch.targetBp < 0) {
      throw new PortfolioError('A target must be a whole number of basis points.');
    }
    values.targetBp = patch.targetBp;
  }
  db.update(assetClasses).set(values).where(eq(assetClasses.id, id)).run();
}

/** Takes its holdings with it — see the cascade in the schema. */
export function deleteAssetClass(db: Db, id: string): void {
  db.delete(assetClasses).where(eq(assetClasses.id, id)).run();
}

export function createHolding(
  db: Db,
  input: { id?: string; name: string; assetClassId: string; unitsMicro: number; priceMinor: number }
): Holding {
  const name = input.name.trim();
  if (!name) throw new PortfolioError('A holding needs a name.');
  if (!Number.isInteger(input.unitsMicro) || input.unitsMicro <= 0) {
    throw new PortfolioError('Units must be more than zero.');
  }
  if (!Number.isInteger(input.priceMinor) || input.priceMinor <= 0) {
    throw new PortfolioError('A price must be more than zero.');
  }

  const row = {
    id: input.id ?? newId(),
    name,
    assetClassId: input.assetClassId,
    unitsMicro: input.unitsMicro,
    priceMinor: input.priceMinor,
  };
  db.insert(holdings).values(row).run();
  return row;
}

export function updateHolding(
  db: Db,
  id: string,
  patch: { name?: string; assetClassId?: string; unitsMicro?: number; priceMinor?: number }
): void {
  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new PortfolioError('A holding needs a name.');
    values.name = name;
  }
  if (patch.assetClassId !== undefined) values.assetClassId = patch.assetClassId;
  if (patch.unitsMicro !== undefined) {
    if (!Number.isInteger(patch.unitsMicro) || patch.unitsMicro <= 0) {
      throw new PortfolioError('Units must be more than zero.');
    }
    values.unitsMicro = patch.unitsMicro;
  }
  if (patch.priceMinor !== undefined) {
    if (!Number.isInteger(patch.priceMinor) || patch.priceMinor <= 0) {
      throw new PortfolioError('A price must be more than zero.');
    }
    values.priceMinor = patch.priceMinor;
  }
  db.update(holdings).set(values).where(eq(holdings.id, id)).run();
}

export function deleteHolding(db: Db, id: string): void {
  db.delete(holdings).where(eq(holdings.id, id)).run();
}

function countAssetClasses(db: Db): number {
  return db.select({ id: assetClasses.id }).from(assetClasses).all().length;
}

export type PortfolioSnapshot = {
  classes: AssetClass[];
  holdings: Holding[];
  totalValueMinor: number;
  targetsTotalBp: number;
  targetsComplete: boolean;
  drift: DriftRow[];
};

/** Everything the screen needs, read once. */
export function portfolioSnapshot(db: Db): PortfolioSnapshot {
  const classes = listAssetClasses(db);
  const rows = listHoldings(db);

  return {
    classes,
    holdings: rows,
    totalValueMinor: totalValueMinor(rows),
    targetsTotalBp: targetsTotalBp(classes),
    targetsComplete: targetsAreComplete(classes),
    drift: analyse(classes, rows),
  };
}

/**
 * Where the next contribution should go.
 *
 * Refuses when the targets do not add up. Recommending against an incomplete
 * allocation would produce confident-looking amounts derived from a target the
 * user has not finished stating.
 */
export function rebalancePlan(db: Db, newMoneyMinor: number): Recommendation[] {
  const classes = listAssetClasses(db);
  if (!targetsAreComplete(classes)) {
    throw new PortfolioError('Your target allocation must add up to 100% first.');
  }
  return recommend(classes, listHoldings(db), newMoneyMinor);
}
