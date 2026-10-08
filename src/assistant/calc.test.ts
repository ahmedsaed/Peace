import { calculate } from './calc';
import { ToolInputError } from './dates';
import type { Figure } from './figures';

const figures: Record<string, Figure> = {
  rent: { minor: 950000, currency: 'EGP' },
  food: { minor: 640050, currency: 'EGP' },
  install: { minor: 450000, currency: 'EGP' },
  spent: { minor: -2_893_300, currency: 'EGP' },
  dollars: { minor: 10000, currency: 'USD' },
  third: { minor: 100, currency: 'EGP' },
};
const lookup = (ref: string) => figures[ref];
const calc = (expression: string) => calculate(expression, lookup);

describe('calculate', () => {
  it('sums figures and scales them by plain numbers — the emergency-fund sum', () => {
    expect(calc('({{rent}} + {{food}}) * 6')).toEqual({ kind: 'money', figure: { minor: 9_540_300, currency: 'EGP' } });
    expect(calc('({{rent}} + {{food}}) × 3')).toEqual({ kind: 'money', figure: { minor: 4_770_150, currency: 'EGP' } });
  });

  it('subtracts and averages', () => {
    expect(calc('{{food}} - {{install}}')).toEqual({ kind: 'money', figure: { minor: 190050, currency: 'EGP' } });
    expect(calc('({{rent}} + {{food}} + {{install}}) / 3')).toEqual({ kind: 'money', figure: { minor: 680017, currency: 'EGP' } });
  });

  it('gives a plain ratio when an amount is divided by an amount', () => {
    expect(calc('{{food}} / {{rent}}')).toEqual({ kind: 'number', value: 0.6737 });
  });

  it('honours |abs and unary minus', () => {
    expect(calc('{{spent|abs}} * 2')).toEqual({ kind: 'money', figure: { minor: 5_786_600, currency: 'EGP' } });
    expect(calc('-{{spent}}')).toEqual({ kind: 'money', figure: { minor: 2_893_300, currency: 'EGP' } });
  });

  it('rounds half away from zero, symmetrically, after trimming float noise', () => {
    expect(calc('{{third}} / 8')).toEqual({ kind: 'money', figure: { minor: 13, currency: 'EGP' } }); // 12.5 → 13
    expect(calc('-{{third}} / 8')).toEqual({ kind: 'money', figure: { minor: -13, currency: 'EGP' } }); // -12.5 → -13
    // 5000 × 3.03 × 0.01 is 151.49999999999997 in floats; it is 151.5 → 152.
    expect(calculate('{{x}} * 3.03 * 0.01', () => ({ minor: 5000, currency: 'EGP' }))).toEqual({
      kind: 'money',
      figure: { minor: 152, currency: 'EGP' },
    });
  });

  it('never yields negative zero', () => {
    const result = calc('{{rent}} - {{rent}}');
    expect(result.kind === 'money' && Object.is(result.figure.minor, -0)).toBe(false);
  });

  it('refuses arithmetic that is nonsense, each with a reason', () => {
    expect(() => calc('{{rent}} * {{food}}')).toThrow(/amount by an amount/);
    expect(() => calc('{{rent}} + 500')).toThrow(/plain number to an amount/);
    expect(() => calc('{{rent}} + {{dollars}}')).toThrow(/converting/);
    expect(() => calc('{{rent}} / 0')).toThrow(/zero/);
    expect(() => calc('E£500 * 6')).toThrow(/cannot appear/);
    expect(() => calc('{{nope}} * 2')).toThrow(/not a figure/);
    expect(() => calc('({{rent}} * 2')).toThrow(/not closed/);
    expect(() => calc('{{rent}} 2')).toThrow(/left over/);
    expect(() => calc('')).toThrow(ToolInputError);
  });
});
