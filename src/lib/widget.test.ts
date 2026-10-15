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
  headline: { label: 'Now', minor: 411_000 },
  locked: false,
  theme: 'ledger',
};

describe('widgetSnapshot', () => {
  afterEach(() => configurePeriods({ monthStart: 1 }));

  it('measures spending against the budget, like the Budgets screen', () => {
    const s = widgetSnapshot(base, plain);
    expect(s.figures).toEqual({
      amount: '$690.00',
      tone: 'expense',
      beside: 'of $1,200.00 budget',
      bar: { fraction: 0.575, over: false },
      foot: '$510.00 left',
      daysLeft: true,
    });
  });

  it('says by how much a budget is exceeded, and fills the bar', () => {
    const s = widgetSnapshot({ ...base, budgetSpentMinor: 134_000 }, plain);
    expect(s.figures?.foot).toBe('$140.00 over');
    expect(s.figures?.bar).toEqual({ fraction: 1, over: true });
  });

  // No budget: the same third cell the Records header shows, so the widget and
  // the app cannot disagree about what "now" is.
  it('shows the running position when nothing is budgeted', () => {
    const s = widgetSnapshot({ ...base, budgetMinor: 0, budgetSpentMinor: 0 }, plain);
    expect(s.figures).toEqual({
      amount: '$4,110.00',
      tone: 'income',
      beside: 'now',
      bar: null,
      foot: 'Spent $690.00 this month',
      daysLeft: false,
    });
  });

  it('calls it the balance when carry-over is off, and colours a negative one', () => {
    const s = widgetSnapshot(
      { ...base, budgetMinor: 0, headline: { label: 'Balance', minor: -2_500 } },
      plain
    );
    expect(s.figures?.beside).toBe('balance');
    expect(s.figures?.tone).toBe('expense');
  });

  // The formatter is the caller's, so Hide amounts masks the widget exactly as
  // it masks the app — and no figure escapes it. The bar is geometry and stays.
  it('masks every figure when amounts are hidden, and keeps the bar', () => {
    const s = widgetSnapshot(base, masked);
    const text = [s.figures?.amount, s.figures?.beside, s.figures?.foot].join(' ');
    expect(text).not.toMatch(/\d/);
    expect(s.figures?.bar?.fraction).toBe(0.575);
  });

  it('shows no figures at all while the app lock is on', () => {
    const s = widgetSnapshot({ ...base, locked: true }, plain);
    expect(s.figures).toBeNull();
    expect(s.locked).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/\$/);
  });

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
