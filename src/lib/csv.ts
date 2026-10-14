/**
 * CSV writing, to RFC 4180.
 *
 * Pure and tested, because an export is the one artefact nobody checks until
 * they need it — a quoting bug shows up months later as a spreadsheet with the
 * columns shifted from row 400 onwards, and by then the original is gone.
 */

/** Characters that force a field to be quoted, per RFC 4180. */
const NEEDS_QUOTES = /[",\r\n]/;

/**
 * Text fields only. A note that begins with `=` is evaluated as a FORMULA by
 * Excel and Google Sheets, so "=lunch with A" arrives as `#NAME?` and the note
 * looks lost. A leading apostrophe is the spreadsheet's own "this is text"
 * marker and is not displayed as part of the value.
 *
 * Only `=` is guarded. `-20 discount` and `+5 tip` are not valid formulas, so
 * both apps already render them as text — and escaping every leading `-` would
 * mangle the amount column, which must stay a number.
 */
function guardFormula(field: string): string {
  return field.startsWith('=') ? `'${field}` : field;
}

export function escapeField(value: string): string {
  const guarded = guardFormula(value);
  if (!NEEDS_QUOTES.test(guarded)) return guarded;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/**
 * CRLF line endings, as the spec requires. Excel on Windows treats a bare LF as
 * part of the field, which turns one multi-line note into a broken file.
 */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(escapeField).join(',')).join('\r\n');
}

/**
 * NO BYTE-ORDER MARK.
 *
 * There was one. The reasoning was that Excel assumes the system codepage for a
 * .csv without one and turns Arabic notes into mojibake, and that "every sane
 * parser ignores it".
 *
 * Google Sheets does not ignore it. It renders the BOM as visible junk on the
 * first header cell — `﻿date` instead of `date` — which breaks the column name
 * for anything that then references it by header. That is a certain bug in the
 * tool actually being used, traded against a hypothetical one in a tool that is
 * not; Excel can still read UTF-8 correctly through Data > From Text/CSV.
 *
 * If Excel ever becomes the target, add the BOM back as an option rather than
 * unconditionally, and check the header cell in Sheets before believing it is
 * harmless.
 */
export function toCsvFile(rows: readonly (readonly string[])[]): string {
  return toCsv(rows);
}

/**
 * CSV reading, to RFC 4180 — the other half of `toCsv`.
 *
 * Quoted fields may hold commas, doubled quotes and line breaks, which is
 * exactly what a note with an address in it produces, so splitting on lines
 * first and commas second is not an option. CRLF and bare LF both end a row.
 *
 * Three concessions to the files people actually have:
 * - A leading byte-order mark is dropped. Excel writes one, and left in place
 *   it becomes part of the first header — `﻿date` matches nothing.
 * - A SEMICOLON delimiter is accepted when the header line has semicolons and
 *   no commas: spreadsheets in locales that write decimals with a comma save
 *   CSV that way, and the person holding one did nothing wrong.
 * - The writer's formula guard is undone: `'=lunch` was written so a
 *   spreadsheet shows "=lunch" as text, and reading it back must give "=lunch".
 */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith('﻿') ? text.slice(1) : text;
  const firstLine = source.slice(0, source.search(/\r?\n|$/));
  const delimiter = !firstLine.includes(',') && firstLine.includes(';') ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let wasQuoted = false;

  const endField = () => {
    // Quoted or not: the writer guards first and quotes after, so a guarded
    // note with a comma in it arrives as "'=…, …".
    row.push(field.startsWith("'=") ? field.slice(1) : field);
    field = '';
    wasQuoted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === '') {
      quoted = true;
      wasQuoted = true;
    } else if (c === delimiter) {
      endField();
    } else if (c === '\r' && source[i + 1] === '\n') {
      endRow();
      i++;
    } else if (c === '\n' || c === '\r') {
      endRow();
    } else {
      field += c;
    }
  }
  // A final row without a trailing newline — and nothing for one with it.
  if (field !== '' || row.length > 0 || wasQuoted) endRow();

  // Blank lines carry nothing; a spreadsheet leaves them at the end.
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}
