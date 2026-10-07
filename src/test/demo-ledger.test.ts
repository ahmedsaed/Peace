/**
 * @jest-environment node
 *
 * The demo ledger is checked like any other fixture, and written out on request:
 *
 *   DEMO_LEDGER_OUT=.demo/peace-demo.db npx jest src/test/demo-ledger
 *
 * (`npm run demo:ledger` does that and pushes the file to the device.)
 */
import fs from 'node:fs';
import path from 'node:path';

import { balanceByCurrency } from '../db/repo/accounts';
import { broughtForward } from '../db/repo/carry';
import { periodSummary } from '../db/repo/records';
import { dueProposals } from '../db/repo/recurring';
import { toYmd } from '../lib/recurrence';
import { periodOf } from '../lib/period';
import { createTestDb } from './db';
import { buildDemoLedger } from './demo-ledger';

const NOW = new Date(Number(process.env.DEMO_LEDGER_NOW ?? Date.now()));

describe('the demo ledger', () => {
  const { sqlite, db } = createTestDb();
  const summary = buildDemoLedger(db, NOW);

  it('has a year of records in it', () => {
    expect(summary.records).toBeGreaterThan(300);
  });

  it('leaves no standing order owing — every occurrence was posted against its rule', () => {
    expect(dueProposals(db, toYmd(NOW)).proposals).toEqual([]);
  });

  it('reconciles the way the real screens must: carried + this month = what the accounts hold', () => {
    const period = periodOf(NOW);
    const carried = broughtForward(db, period, 'EGP').amountMinor;
    const month = periodSummary(db, period, 'EGP').balanceMinor;
    expect(carried + month).toBe(balanceByCurrency(db).find((t) => t.currency === 'EGP')!.balanceMinor);
  });

  it('writes the file when asked', () => {
    const out = process.env.DEMO_LEDGER_OUT;
    if (!out) return;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, sqlite.serialize());
    expect(fs.statSync(out).size).toBeGreaterThan(0);
  });
});
