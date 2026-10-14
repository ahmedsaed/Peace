import { readFileSync } from 'fs';
import { join } from 'path';

import { parseCsv } from './csv';
import { importTemplate, parseStrictAmount, parseWhen, planImport, type ImportPlan, type LedgerSnapshot } from './import-csv';

const ledger = (over: Partial<LedgerSnapshot> = {}): LedgerSnapshot => ({
  homeCurrency: 'EGP',
  accounts: [
    { id: 'cash', name: 'Cash', currency: 'EGP' },
    { id: 'usd', name: 'Dollars', currency: 'USD' },
  ],
  categories: [
    { id: 'food', name: 'Food', kind: 'expense', parentId: null },
    { id: 'groceries', name: 'Groceries', kind: 'expense', parentId: 'food' },
    { id: 'car', name: 'Car', kind: 'expense', parentId: null },
    { id: 'car-other', name: 'Other', kind: 'expense', parentId: 'car' },
    { id: 'food-other', name: 'Other', kind: 'expense', parentId: 'food' },
    { id: 'salary', name: 'Salary', kind: 'income', parentId: null },
  ],
  tagKeys: new Set(['work']),
  existingIds: new Set(['already']),
  ...over,
});

const HEAD = 'date,type,amount,account';

function run(lines: string[], header = HEAD, snapshot = ledger()): ImportPlan {
  const result = planImport(parseCsv([header, ...lines].join('\n')), snapshot);
  if ('error' in result) throw new Error(result.error);
  return result;
}

const problems = (plan: ImportPlan) => plan.problems.map((p) => `${p.line}: ${p.message}`);

describe('the file', () => {
  it('names the columns it is missing', () => {
    expect(planImport(parseCsv('date,amount\n2026-08-01,5'), ledger())).toEqual({
      error: expect.stringContaining('no type, account columns'),
    });
  });

  it('matches headers whatever their case or padding', () => {
    expect(run(['2026-08-01,expense,5,Cash'], ' Date , TYPE,Amount,account').rows).toHaveLength(1);
  });

  it('refuses an empty file and a header with nothing under it', () => {
    expect(planImport([], ledger())).toEqual({ error: 'The file is empty.' });
    expect(planImport(parseCsv(HEAD), ledger())).toEqual({
      error: 'The file has a header and no records.',
    });
  });
});

describe('dates and amounts', () => {
  it('reads YYYY-MM-DD as a local day at noon, and HH:MM when given', () => {
    expect(parseWhen('2026-08-09', '')).toEqual(new Date(2026, 7, 9, 12, 0));
    expect(parseWhen('2026-08-09', '07:05')).toEqual(new Date(2026, 7, 9, 7, 5));
  });

  // 13/08/2026 is a valid date under two conventions; a file is fixed once in
  // a spreadsheet rather than guessed at here.
  it('refuses every other date order, and dates that do not exist', () => {
    expect(parseWhen('13/08/2026', '')).toMatch(/not YYYY-MM-DD/);
    expect(parseWhen('2026-02-30', '')).toMatch(/not a real date/);
    expect(parseWhen('2026-08-09', '25:00')).toMatch(/not HH:MM/);
  });

  it('reads amounts strictly, never rounding or guessing separators', () => {
    expect(parseStrictAmount('-155.50', 'EGP')).toBe(-15550);
    expect(parseStrictAmount('+12', 'EGP')).toBe(1200);
    expect(parseStrictAmount('1,234.50', 'EGP')).toMatch(/comma/);
    expect(parseStrictAmount('1.005', 'EGP')).toMatch(/2 decimals/);
    expect(parseStrictAmount('1.5', 'JPY')).toMatch(/no decimals/);
    expect(parseStrictAmount('1.250', 'KWD')).toBe(1250);
    expect(parseStrictAmount('ten', 'EGP')).toMatch(/not a number/);
  });
});

describe('sides', () => {
  // The type decides the side and the amount gives the size — a hand-written
  // "50" and Peace's own "-50.00" are the same lunch.
  it('takes the magnitude, whatever the sign', () => {
    const plan = run(['2026-08-01,expense,50,Cash', '2026-08-02,expense,-50.00,Cash', '2026-08-03,income,-20,Cash']);
    expect(plan.rows.map((r) => [r.kind, 'type' in r ? r.type : null, r.amountMinor])).toEqual([
      ['record', 'expense', 5000],
      ['record', 'expense', 5000],
      ['record', 'income', 2000],
    ]);
  });

  it('reads a refund from is_refund, and only on an expense', () => {
    const plan = run(
      ['2026-08-01,expense,800,Cash,1', '2026-08-01,income,800,Cash,yes', '2026-08-01,expense,8,Cash,maybe'],
      `${HEAD},is_refund`
    );
    expect(plan.rows).toEqual([expect.objectContaining({ isRefund: true, type: 'expense' })]);
    expect(problems(plan)).toEqual(['3: only an expense can be a refund', expect.stringMatching(/^4: is_refund/)]);
  });

  it('keeps the sign of a correction, which is the whole of its meaning', () => {
    const plan = run(['2026-08-01,correction,-12.34,Cash', '2026-08-01,Correction,5,Cash']);
    expect(plan.rows.map((r) => r.amountMinor)).toEqual([-1234, 500]);
    expect(plan.counts.correction).toBe(2);
  });

  it('names an unknown type', () => {
    expect(problems(run(['2026-08-01,spending,5,Cash']))).toEqual([
      '2: "spending" is not a type — use expense, income, transfer or correction',
    ]);
  });
});

describe('currencies', () => {
  it('takes the account’s currency when the row gives none', () => {
    expect(run(['2026-08-01,expense,5,Cash']).rows[0].currency).toBe('EGP');
  });

  it('refuses a row in a currency its account is not in', () => {
    expect(problems(run(['2026-08-01,expense,5,Cash,USD'], `${HEAD},currency`))).toEqual([
      '2: Cash is in EGP, but this row is in USD',
    ]);
  });

  it('needs home_amount for a foreign record, and derives the day’s rate from it', () => {
    const plan = run(
      ['2026-08-01,expense,49.99,Dollars,', '2026-08-02,expense,10,Dollars,485.00', '2026-08-03,expense,10,Dollars,9'],
      `${HEAD},home_amount`
    );
    expect(problems(plan)).toEqual(['2: a USD record needs home_amount — what it cost in EGP']);
    expect(plan.rows[0].fxRate).toBeCloseTo(48.5, 10);
    expect(plan.rows[1].fxRate).toBeCloseTo(0.9, 10);
  });

  it('refuses a home_amount in some other home currency', () => {
    expect(
      problems(run(['2026-08-01,expense,10,Dollars,9,GBP'], `${HEAD},home_amount,home_currency`))
    ).toEqual(['2: home_amount is in GBP, but your home currency is EGP']);
  });

  it('opens a new account in the row’s currency, or the home one', () => {
    const plan = run(['2026-08-01,expense,5,Revolut,EUR,5', '2026-08-01,expense,5,Wallet,,'], `${HEAD},currency,home_amount`);
    expect(plan.newAccounts).toEqual([
      { key: 'revolut', name: 'Revolut', currency: 'EUR' },
      { key: 'wallet', name: 'Wallet', currency: 'EGP' },
    ]);
  });
});

describe('transfers', () => {
  const H = `${HEAD},counter_account,id,transfer_pair_id`;

  it('reads a hand-written row as account → counter_account', () => {
    const [row] = run(['2026-08-01,transfer,300,Cash,Wallet,,'], H).rows;
    expect(row).toMatchObject({ kind: 'transfer', from: { id: 'cash' }, to: { create: 'wallet' }, amountMinor: 30000 });
  });

  it('plans an exported pair once, from its outgoing leg, keeping both ids', () => {
    const plan = run(['2026-08-01,transfer,300.00,Cash,Wallet,in1,p1', '2026-08-01,transfer,-300.00,Wallet,Cash,out1,p1'], H);
    expect(plan.rows).toEqual([
      expect.objectContaining({ from: { create: 'wallet' }, to: { id: 'cash' }, id: 'out1', inId: 'in1', pairId: 'p1' }),
    ]);
  });

  it('turns a lone incoming leg round', () => {
    const [row] = run(['2026-08-01,transfer,300.00,Cash,Wallet,in1,p1'], H).rows;
    expect(row).toMatchObject({ from: { create: 'wallet' }, to: { id: 'cash' }, id: null, inId: 'in1' });
  });

  it('needs somewhere for the money to go, and one currency', () => {
    expect(
      problems(run(['2026-08-01,transfer,5,Cash,,,', '2026-08-01,transfer,5,Cash,cash,,', '2026-08-01,transfer,5,Cash,Dollars,,'], H))
    ).toEqual([
      '2: a transfer needs counter_account — where the money went',
      '3: a transfer needs two different accounts',
      '4: Cash is in EGP and Dollars in USD — import moves money within one currency',
    ]);
  });
});

describe('categories', () => {
  const H = `${HEAD},category,parent_category`;
  const cat = (plan: ImportPlan) => plan.rows.map((r) => (r.kind === 'record' ? r.category : undefined));

  it('finds a category by name, top level first, any case', () => {
    expect(cat(run(['2026-08-01,expense,5,Cash,food,', '2026-08-01,expense,5,Cash,GROCERIES,'], H))).toEqual([
      { id: 'food' },
      { id: 'groceries' },
    ]);
  });

  it('asks for the parent when two sub-categories share a name', () => {
    const plan = run(['2026-08-01,expense,5,Cash,Other,', '2026-08-01,expense,5,Cash,Other,Car'], H);
    expect(problems(plan)).toEqual([
      '2: more than one expense category is called "Other" — add its parent_category',
    ]);
    expect(cat(plan)).toEqual([{ id: 'car-other' }]);
  });

  it('creates what is missing, under a parent that may be new too, once each', () => {
    const plan = run(
      ['2026-08-01,expense,5,Cash,Snacks,Food', '2026-08-01,expense,5,Cash,Gym,Health', '2026-08-02,expense,5,Cash,gym,health'],
      H
    );
    expect(plan.newCategories).toEqual([
      { key: 'expense/food/snacks', name: 'Snacks', kind: 'expense', parent: { id: 'food' }, parentName: 'Food' },
      { key: 'expense//health', name: 'Health', kind: 'expense', parent: null, parentName: null },
      {
        key: 'expense/health/gym',
        name: 'Gym',
        kind: 'expense',
        parent: { create: 'expense//health' },
        parentName: 'Health',
      },
    ]);
  });

  it('looks for an income category among income categories', () => {
    const plan = run(['2026-08-01,income,5,Cash,Food,'], H);
    expect(plan.newCategories.map((c) => c.kind)).toEqual(['income']);
  });
});

describe('what the preview reports', () => {
  it('skips and counts rows already in the ledger, and refuses an id used twice', () => {
    const plan = run(['2026-08-01,expense,5,Cash,already', '2026-08-01,expense,5,Cash,x', '2026-08-01,expense,5,Cash,x'], `${HEAD},id`);
    expect(plan.alreadyThere).toBe(1);
    expect(plan.rows).toHaveLength(1);
    expect(problems(plan)).toEqual(['4: the id x appears twice in the file']);
  });

  // Every bad row is named and the rest still import — and an account named
  // ONLY by rows that failed is not created for nothing.
  it('lists bad rows and creates nothing for them alone', () => {
    const plan = run(['2026-08-01,expense,5,Cash', '13/08/2026,expense,5,Nowhere', '2026-08-01,expense,1.234,Cash']);
    expect(problems(plan)).toEqual([
      '3: the date "13/08/2026" is not YYYY-MM-DD',
      '4: EGP has 2 decimals, but the amount is 1.234',
    ]);
    expect(plan.newAccounts).toEqual([]);
    expect(plan.rows).toHaveLength(1);
  });

  it('lists only the tags that are new, once, as they will be written', () => {
    const plan = run(['2026-08-01,expense,5,Cash,Work; trip ', '2026-08-02,expense,5,Cash,TRIP;  Big   day'], `${HEAD},tags`);
    expect(plan.newTags).toEqual(['trip', 'Big day']);
    expect(plan.rows[0].tags).toEqual(['Work', 'trip']);
  });

  it('counts each side and spans the dates imported', () => {
    const plan = run(['2026-08-09,expense,5,Cash', '2026-07-01,income,5,Cash', '2026-08-20,correction,5,Cash']);
    expect(plan.counts).toEqual({ expense: 1, income: 1, transfer: 0, correction: 1 });
    expect(plan.span).toEqual({ from: new Date(2026, 6, 1, 12), to: new Date(2026, 7, 20, 12) });
  });
});

describe('the template', () => {
  // The file people start from must import as it is, in any home currency.
  it.each(['EGP', 'JPY', 'KWD'])('imports cleanly in %s', (home) => {
    const plan = planImport(
      importTemplate(home),
      ledger({
        homeCurrency: home,
        accounts: [
          { id: 'cash', name: 'Cash', currency: home },
          { id: 'bank', name: 'Bank', currency: home },
        ],
      })
    );
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.problems).toEqual([]);
    expect(plan.counts).toEqual({ expense: 2, income: 1, transfer: 1, correction: 1 });
  });
});

describe('the template on peace.merope.dev', () => {
  // site/public/peace-import-template.csv is what somebody without the app to
  // hand downloads. Blank currency and whole amounts, so it fits any ledger.
  const file = readFileSync(join(__dirname, '../../site/public/peace-import-template.csv'), 'utf8');

  it.each(['EGP', 'USD', 'JPY'])('imports cleanly in %s', (home) => {
    const plan = planImport(
      parseCsv(file),
      ledger({ homeCurrency: home, accounts: [{ id: 'cash', name: 'Cash', currency: home }, { id: 'bank', name: 'Bank', currency: home }] })
    );
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.problems).toEqual([]);
    expect(plan.rows).toHaveLength(5);
  });
});
