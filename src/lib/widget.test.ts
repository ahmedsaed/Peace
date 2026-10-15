import { formatMinor, maskFormatted } from './money';
import { configurePeriods, periodBounds } from './period';
import { widgetPalette, widgetSnapshot, type WidgetInputs } from './widget';

const plain = (minor: number, currency?: string) => formatMinor(minor, currency);
const masked = (minor: number, currency?: string) => maskFormatted(formatMinor(minor, currency));

const base: WidgetInputs = {
  period: '2026-10',
  currency: 'USD',
  budgetMinor: 120_000,
  budgetSpentMinor: 69_000,
  monthSpentMinor: 69_000,
  monthEarnedMinor: 480_000,
  headline: { label: 'Now', minor: 411_000 },
  accounts: [
    { name: 'Cash', type: 'cash', currency: 'USD', balanceMinor: 12_000, color: '#6E8B3D' },
    { name: 'Visa', type: 'card', currency: 'USD', balanceMinor: -45_000, color: null },
  ],
  locked: false,
  theme: 'ledger',
};

describe('the Budget widget', () => {
  it('measures spending against the budget, like the Budgets screen', () => {
    expect(widgetSnapshot(base, plain).budget).toEqual({
      amount: '$690.00',
      beside: 'of $1,200.00 budget',
      bar: { fraction: 0.575, over: false },
      foot: '$510.00 left',
    });
  });

  it('says by how much a budget is exceeded, and fills the bar', () => {
    const s = widgetSnapshot({ ...base, budgetSpentMinor: 134_000 }, plain);
    expect(s.budget?.foot).toBe('$140.00 over');
    expect(s.budget?.bar).toEqual({ fraction: 1, over: true });
  });

  // It says there is no budget rather than quietly becoming the Balance
  // widget: somebody who placed a budget widget should be told what is missing.
  it('has nothing to show when nothing is budgeted', () => {
    expect(widgetSnapshot({ ...base, budgetMinor: 0, budgetSpentMinor: 0 }, plain).budget).toBeNull();
  });
});

describe('the Balance widget', () => {
  // The same third cell the Records header shows, so the widget and the app
  // cannot disagree about what "now" is.
  it('leads with the running position, and the month under it', () => {
    expect(widgetSnapshot(base, plain).balance).toEqual({
      amount: '$4,110.00',
      tone: 'income',
      beside: 'now',
      foot: 'Spent $690.00 · earned $4,800.00',
    });
  });

  it('calls it the balance when carry-over is off, and colours a negative one', () => {
    const s = widgetSnapshot({ ...base, headline: { label: 'Balance', minor: -2_500 } }, plain);
    expect(s.balance?.beside).toBe('balance');
    expect(s.balance?.tone).toBe('expense');
  });

  // Read the way the Accounts tab reads them: a card's debt is an amount OWED.
  it('lists accounts in order, with a card as what is owed on it', () => {
    expect(widgetSnapshot(base, plain).accounts).toEqual([
      { name: 'Cash', amount: '$120.00', tone: 'income', color: '#6E8B3D' },
      { name: 'Visa', amount: '$450.00 owed', tone: 'expense', color: '#6B5B4A' },
    ]);
  });
});

describe('what may reach a home screen', () => {
  // The formatter is the caller's, so Hide amounts masks the widgets exactly as
  // it masks the app — and no figure escapes it. The bar is geometry and stays.
  it('masks every figure when amounts are hidden, and keeps the bar', () => {
    const s = widgetSnapshot(base, masked);
    const text = [
      s.budget?.amount,
      s.budget?.beside,
      s.budget?.foot,
      s.balance?.amount,
      s.balance?.foot,
      ...s.accounts.map((a) => a.amount),
    ].join(' ');
    expect(text).not.toMatch(/\d/);
    expect(s.budget?.bar.fraction).toBe(0.575);
  });

  it('shows no figures and no account names while the app lock is on', () => {
    const s = widgetSnapshot({ ...base, locked: true }, plain);
    expect(s.locked).toBe(true);
    expect(s.budget).toBeNull();
    expect(s.balance).toBeNull();
    expect(s.accounts).toEqual([]);
    expect(JSON.stringify(s)).not.toMatch(/\$|Cash|Visa/);
  });
});

describe('the month and the theme', () => {
  afterEach(() => configurePeriods({ monthStart: 1 }));

  // The native side compares this with the clock: past it, the snapshot is a
  // month that has ended and must not be shown as the current one.
  it('records when the month ends, following the month-start setting', () => {
    expect(widgetSnapshot(base, plain).endsAt).toBe(new Date(2026, 10, 1).getTime());
    configurePeriods({ monthStart: 25 });
    const s = widgetSnapshot(base, plain);
    expect(s.endsAt).toBe(periodBounds('2026-10').end.getTime());
    expect(s.endsAt).toBe(new Date(2026, 9, 25).getTime());
    expect(s.month).toBe('October');
  });

  it('follows the phone between Paper and Ledger on Match phone', () => {
    const s = widgetSnapshot({ ...base, theme: 'system' }, plain);
    expect(s.theme.system).toBe(true);
    expect(s.theme.light).toEqual(widgetPalette('paper'));
    expect(s.theme.dark).toEqual(widgetPalette('ledger'));
  });

  it('wears one theme when one is chosen', () => {
    const s = widgetSnapshot({ ...base, theme: 'graphite' }, plain);
    expect(s.theme.system).toBe(false);
    expect(s.theme.light).toEqual(widgetPalette('graphite'));
    expect(s.theme.dark).toEqual(widgetPalette('graphite'));
  });
});
