/**
 * What a tag name IS, as rules rather than as validation scattered at each
 * place one gets typed.
 *
 * Pure, so every one of them is testable without a device — and in one place,
 * because "are these the same tag?" is asked when creating one, when renaming
 * one, and when a picker decides whether to offer "create". Three answers that
 * disagree is two projects with the same name and a total that is wrong for
 * both.
 */

/** Longer than this is a note, not a label. */
export const MAX_TAG_LENGTH = 32;

/**
 * The name as it will be SHOWN: NFC-normalised, trimmed, inner whitespace
 * collapsed to single spaces.
 *
 * NFC because the same accented character can be typed as one code point or as
 * two depending on the keyboard, and the two are different strings — so
 * "Café" typed on one keyboard would not match "Café" typed on another, and
 * nothing on screen would explain why. The same trap `seal.ts` records for
 * passphrases, where it only bites on the worst day.
 */
export function cleanTagName(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * The same name reduced to what makes two tags THE SAME.
 *
 * Case-folded on top of the cleaning above. "Kitchen" and "kitchen" are one
 * project; storing them as two splits its total in half and neither figure is
 * wrong in any way a person could spot.
 *
 * `toLowerCase` rather than `toLocaleLowerCase`: the locale-aware form makes
 * the answer depend on the phone's language, so the same ledger would decide
 * two tags are the same on one device and different on another — and both
 * would be right about their own rule while the database disagreed with one
 * of them.
 */
export function tagKey(raw: string): string {
  return cleanTagName(raw).toLowerCase();
}

export type TagNameProblem = 'empty' | 'too-long';

/**
 * Why this name cannot be used, or null when it can.
 *
 * Returns the REASON rather than a boolean: the picker has to say which of the
 * two it is, and a caller handed `false` would have to re-derive it and get to
 * disagree with this function about the answer.
 */
export function tagNameProblem(raw: string): TagNameProblem | null {
  const clean = cleanTagName(raw);
  if (clean === '') return 'empty';
  // Counted on the CLEANED name, not on what was typed: trailing spaces are
  // removed before this matters, so refusing them would be refusing a name
  // that is about to be shortened anyway.
  if (clean.length > MAX_TAG_LENGTH) return 'too-long';
  return null;
}

/**
 * The names a row shows, in the order the picker offered them.
 *
 * `#` prefixed, which is the one thing that separates a tag from the note it
 * sits beside in the same line: `Cash · "Winter jacket" · kitchen` reads as
 * more note, and this list has to survive being glanced at.
 */
export function formatTags(names: string[]): string {
  return names.map((name) => `#${name}`).join(' ');
}

/**
 * Whether a typed name would create a NEW tag rather than match one that
 * exists.
 *
 * The picker asks this on every keystroke to decide whether to offer "create",
 * and it must agree with what the write will actually do — offering to create
 * a tag that then merges into an existing one is a promise the save breaks.
 */
export function isNewTagName(raw: string, existing: { normalised: string }[]): boolean {
  if (tagNameProblem(raw) !== null) return false;
  const key = tagKey(raw);
  return !existing.some((tag) => tag.normalised === key);
}
