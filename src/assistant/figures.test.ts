import { decimalsFor } from '../lib/money';
import { citedFigures, FigureBook, maskStrayFigures, splitFigures } from './figures';

describe('FigureBook', () => {
  it('hands the model a major-unit amount and a token, and keeps the minor units', () => {
    const book = new FigureBook('t7', decimalsFor);
    const cited = book.cite(-124050, 'egp');
    expect(cited).toEqual({ amount: -1240.5, currency: 'EGP', cite: '{{t7f1}}' });
    expect(book.get('t7f1')).toEqual({ minor: -124050, currency: 'EGP' });
  });

  it('respects each currency’s decimals — yen has none, dinars have three', () => {
    const book = new FigureBook('t1', decimalsFor);
    expect(book.cite(1200, 'JPY').amount).toBe(1200);
    expect(book.cite(12345, 'KWD').amount).toBe(12.345);
  });

  it('normalises negative zero, which would render as "-E£0.00"', () => {
    const book = new FigureBook('t1', decimalsFor);
    book.cite(-0, 'EGP');
    expect(Object.is(book.get('t1f1')!.minor, -0)).toBe(false);
  });

  it('resolves refs it was given as well as its own, but registers only its own', () => {
    const known = new Map([['t1f1', { minor: 5, currency: 'EGP' }]]);
    const book = new FigureBook('t2', decimalsFor, known);
    book.cite(9, 'EGP');
    expect(book.get('t1f1')).toEqual({ minor: 5, currency: 'EGP' });
    expect(Object.keys(book.registered())).toEqual(['t2f1']);
  });
});

describe('splitFigures and citedFigures', () => {
  it('splits prose around tokens, tolerating spaces inside the braces', () => {
    expect(splitFigures('You spent {{t3f2}} on fuel, up from {{ t3f1 }}.')).toEqual([
      { kind: 'text', text: 'You spent ' },
      { kind: 'figure', ref: 't3f2', abs: false },
      { kind: 'text', text: ' on fuel, up from ' },
      { kind: 'figure', ref: 't3f1', abs: false },
      { kind: 'text', text: '.' },
    ]);
  });

  it('reads the |abs modifier, and resolves the ref without it', () => {
    expect(splitFigures('over by {{t1f1|abs}}')).toEqual([
      { kind: 'text', text: 'over by ' },
      { kind: 'figure', ref: 't1f1', abs: true },
    ]);
    expect(citedFigures('{{t1f1 | abs}}', () => ({ minor: -5, currency: 'EGP' }))).toEqual({ t1f1: { minor: -5, currency: 'EGP' } });
  });

  it('keeps only refs that resolve', () => {
    const known: Record<string, { minor: number; currency: string }> = { t1f1: { minor: 100, currency: 'EGP' } };
    expect(citedFigures('{{t1f1}} and {{t9f9}}', (ref) => known[ref])).toEqual({ t1f1: { minor: 100, currency: 'EGP' } });
  });
});

describe('maskStrayFigures', () => {
  const mask = (s: string) => maskStrayFigures(s, '••••');

  it('masks amounts the model typed instead of citing', () => {
    expect(mask('You spent E£1,240.50 on fuel')).toBe('You spent •••• on fuel');
    expect(mask('about EGP 1240 this month')).toBe('about •••• this month');
    expect(mask('roughly 1240 EGP')).toBe('roughly ••••');
    expect(mask('it came to 12,500')).toBe('it came to ••••');
    expect(mask('a $12 coffee')).toBe('a •••• coffee');
    expect(mask('it was 45.50 each')).toBe('it was •••• each');
  });

  it('leaves dates, years, counts and percentages alone', () => {
    const plain = 'On 12 Dec 2025 you made 3 purchases, 40% of the month, 2.5x more.';
    expect(mask(plain)).toBe(plain);
  });
});
