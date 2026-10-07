import { resolveSpan, spanLabel, ToolInputError, ymd } from './dates';

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe('resolveSpan', () => {
  it('turns a month into its local calendar bounds and names it', () => {
    const span = resolveSpan({ month: '2025-12' });
    expect(span.start).toEqual(at(2025, 12, 1));
    expect(span.end).toEqual(at(2026, 1, 1));
    expect(span.label).toBe('December 2025');
  });

  it('treats "to" as the last day INCLUDED', () => {
    // The model says "to 2026-03-31"; a half-open query ending AT the 31st
    // would silently drop the whole last day.
    const span = resolveSpan({ from: '2026-03-01', to: '2026-03-31' });
    expect(span.end).toEqual(at(2026, 4, 1));
    expect(span.label).toBe('March 2026');
  });

  it('widens a coarse end to the end of its month or year', () => {
    expect(resolveSpan({ from: '2026-01', to: '2026-03' })).toEqual({
      start: at(2026, 1, 1),
      end: at(2026, 4, 1),
      label: 'Jan 2026 – Mar 2026',
    });
    expect(resolveSpan({ from: '2025', to: '2025' }).label).toBe('2025');
  });

  it('allows either end to be open, and nothing at all to mean all time', () => {
    expect(resolveSpan({}).label).toBe('All time');
    expect(resolveSpan({ from: '2026-02-03' }).label).toBe('Since 3 Feb 2026');
    expect(resolveSpan({ to: '2026-02-03' }).label).toBe('Until 3 Feb 2026');
  });

  it('labels an arbitrary range by its first and last days', () => {
    expect(resolveSpan({ from: '2026-02-03', to: '2026-02-10' }).label).toBe('3 Feb 2026 – 10 Feb 2026');
    expect(resolveSpan({ from: '2026-02-03', to: '2026-02-03' }).label).toBe('3 Feb 2026');
  });

  it('refuses a date that rolled over instead of quietly meaning another day', () => {
    expect(() => resolveSpan({ from: '2026-02-30' })).toThrow(ToolInputError);
    expect(() => resolveSpan({ month: '2026-13' })).toThrow(/not a month/);
  });

  it('refuses a backwards span and junk', () => {
    expect(() => resolveSpan({ from: '2026-03-01', to: '2026-02-01' })).toThrow(/before/);
    expect(() => resolveSpan({ from: 'last week' })).toThrow(/YYYY-MM-DD/);
    expect(() => resolveSpan({ from: 20260301 })).toThrow(/date string/);
  });
});

describe('spanLabel and ymd', () => {
  it('names a whole year and a run of months', () => {
    expect(spanLabel(at(2025, 1, 1), at(2026, 1, 1))).toBe('2025');
    expect(spanLabel(at(2025, 11, 1), at(2026, 2, 1))).toBe('Nov 2025 – Jan 2026');
  });

  it('formats local dates without a timezone conversion', () => {
    // 11pm on the 31st is still the 31st where the user lives.
    expect(ymd(new Date(2025, 11, 31, 23, 30))).toBe('2025-12-31');
  });
});
