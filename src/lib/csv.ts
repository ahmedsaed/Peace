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
