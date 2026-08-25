/**
 * Blank lines left above extracted text, so a comment of your own has somewhere
 * to go — and the separator between what you wrote and what was read.
 *
 * One constant doing both jobs is not a coincidence. At the START of a note it
 * renders as two empty lines you can tap into; BETWEEN two blocks it is the
 * single blank line that already separates a merchant from its basket. Same
 * string, and the position decides what it means.
 */
export const COMMENT_GAP = '\n\n';

/**
 * Fold something a model read — a receipt, a bank message — into the note.
 *
 * EXTRACTED TEXT NEVER DESTROYS TYPED TEXT. Reading a receipt used to call
 * `setNote(filled)`, so photographing one after typing "lunch with Sara" threw
 * the typing away — silently, at the moment the user was watching the amount
 * appear and had no reason to look at a field they had already filled in. What
 * a model produces is a suggestion; what a person typed is the record.
 *
 * So the reading goes UNDERNEATH, and the top of the note stays theirs. When
 * nothing has been typed yet the gap is left empty for them, which is the whole
 * request: a comment belongs at the beginning, where the list shows it, and
 * tapping precisely before the first character of a block of text is fiddly on
 * a phone.
 *
 * `leaveRoom` is false in split-screen, where the note field is a SINGLE LINE
 * 44px tall rather than a box. Blank lines there do not read as room to write
 * in — they push the text out of the one visible line, and the field looks
 * empty at exactly the moment it has just been filled in. Logging a record
 * beside a bank notification is the case this whole layout exists for, so it
 * is the last place to hand someone an apparently broken field.
 *
 * Nothing here has to guard the stored value: every save path already calls
 * `note.trim()`, so a gap the user never wrote in cannot reach the ledger.
 */
export function noteWithReading(
  existing: string,
  extracted: string,
  opts: { leaveRoom?: boolean } = {}
): string {
  const text = extracted.trim();
  // A reading that found nothing must not clear a note, and must not add a gap
  // to one. This is the failure path, and it has to be the quietest.
  if (!text) return existing;

  // Whitespace-only counts as empty: a note holding a stray newline should get
  // the same room as one holding nothing.
  const typed = existing.trimEnd();
  if (!typed.trim()) return opts.leaveRoom ? COMMENT_GAP + text : text;

  // Reading the same receipt twice — which is exactly what someone does when
  // the first answer looked wrong — would otherwise stack two copies of it.
  if (typed.includes(text)) return existing;

  return `${typed}${COMMENT_GAP}${text}`;
}
