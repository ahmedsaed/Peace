import { escapeField, toCsv, toCsvFile } from './csv';

describe('escapeField', () => {
  it('leaves ordinary text alone', () => {
    expect(escapeField('Groceries')).toBe('Groceries');
    expect(escapeField('-155.00')).toBe('-155.00');
    expect(escapeField('')).toBe('');
  });

  // Every one of these silently shifts the columns of a spreadsheet if it is
  // written unquoted, and only from the offending row onwards — so the file
  // looks fine until you scroll.
  it('quotes a field containing a comma', () => {
    expect(escapeField('Lunch, then coffee')).toBe('"Lunch, then coffee"');
  });

  it('doubles internal quotes', () => {
    expect(escapeField('the "good" one')).toBe('"the ""good"" one"');
  });

  it('quotes a field containing a newline', () => {
    expect(escapeField('line one\nline two')).toBe('"line one\nline two"');
    expect(escapeField('line one\r\nline two')).toBe('"line one\r\nline two"');
  });

  it('handles a field that needs every rule at once', () => {
    expect(escapeField('a "quote", then\na newline')).toBe('"a ""quote"", then\na newline"');
  });
});

describe('escapeField — spreadsheet formula guard', () => {
  // "=lunch with A" arrives in Excel as #NAME? and the note looks lost.
  it('marks a leading = as text', () => {
    expect(escapeField('=lunch with A')).toBe("'=lunch with A");
  });

  // The amount column must stay a number. Escaping every leading - would turn
  // every expense into text and break the SUM anyone exports this to compute.
  it('does not touch a negative number', () => {
    expect(escapeField('-155.00')).toBe('-155.00');
  });

  it('leaves + and @ alone — neither app evaluates them as formulas', () => {
    expect(escapeField('+5 tip')).toBe('+5 tip');
    expect(escapeField('@home')).toBe('@home');
  });
});

describe('toCsv', () => {
  it('joins fields with commas and rows with CRLF', () => {
    // CRLF, not LF: Excel on Windows folds a bare LF into the field and turns
    // one row into two.
    expect(
      toCsv([
        ['date', 'amount'],
        ['2026-08-09', '-155.00'],
      ])
    ).toBe('date,amount\r\n2026-08-09,-155.00');
  });

  it('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('');
  });
});

describe('toCsvFile', () => {
  /**
   * The file used to start with a UTF-8 BOM, to stop Excel reading it in the
   * system codepage. Google Sheets renders that BOM as visible junk on the
   * first header cell — `﻿date` instead of `date` — which was reported from
   * a real export. The header has to be usable as a column name.
   */
  it('does NOT lead with a byte-order mark', () => {
    const out = toCsvFile([['date', 'note'], ['2026-08-10', 'x']]);
    expect(out.charCodeAt(0)).not.toBe(0xfeff);
    expect(out.startsWith('date,note')).toBe(true);
  });

  it('still writes non-ASCII notes as UTF-8', () => {
    expect(toCsvFile([['note'], ['قهوة']])).toContain('قهوة');
  });
});
