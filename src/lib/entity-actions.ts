/**
 * What a long press on an account, a category or a tag may offer.
 *
 * Pure, and in one place, for the same reason `record-actions.ts` is: these
 * rules overlap and differ by kind, and a rule spelled out at each call site is
 * a rule that gets forgotten at one of them. Three lists — Accounts, Categories
 * and Tags — ask these questions about three different tables, and every answer
 * has to be the same answer.
 *
 * THE RULE THIS MODULE EXISTS TO MAKE STRUCTURAL: a refusal is never a
 * sentence, it is always a destination. An entity that cannot be deleted
 * because records point at it does not get a disabled button and an apology —
 * its Delete row carries the count and goes to those records. The app never
 * names a number it will not show you. That used to be true in exactly one
 * place (Settings, behind a count chip, inside a modal, reachable only after
 * archiving the thing) while the editors offered a dead sentence or, for a
 * category, silently destroyed what the money was spent on.
 */

export type EntityKind = 'account' | 'category' | 'tag';

/**
 * The part of an entity these rules read.
 *
 * Structural rather than a row from any one table: the three kinds have almost
 * nothing in common as records, and an action must not start depending on a
 * column only one of them has.
 */
export type EntitySubject = {
  kind: EntityKind;
  archived: boolean;
  /**
   * Records that mention it at all. For a tag, what would forget it.
   */
  records: number;
  /**
   * Records that must move before it can be deleted — always 0 for a tag,
   * whose links cascade through `transaction_tags` and touch no money.
   */
  blocking: number;
};

/**
 * Where its records are is always worth asking, as long as it has some.
 *
 * This is the action the app was missing entirely: the filtered search existed
 * only as the consequence of a refused delete, so the single most ordinary
 * question about a category — "what did I actually put in here?" — had no
 * answer anywhere in the UI.
 */
export function canShowRecords(subject: EntitySubject): boolean {
  return subject.records > 0;
}

/**
 * Only an account has a balance to correct, and an ARCHIVED one still does.
 *
 * Deliberately not gated on `archived`. An archived account keeps its money and
 * is still counted in the Accounts total, so a drifted balance on one is a
 * wrong total on a screen that never mentions it. Making the user restore it,
 * fix it and put it away again would be three steps to reach a number the
 * archive was never supposed to hide.
 */
export function canUpdateBalance(subject: EntitySubject): boolean {
  return subject.kind === 'account';
}

/**
 * Accounts and categories have an editor screen; a tag is only a name.
 *
 * So a tag renames in place and the other two open the form — which, once the
 * archive toggle and the delete button move in here, is a form that does
 * nothing but edit.
 */
export function canEdit(subject: EntitySubject): boolean {
  return subject.kind !== 'tag';
}

export function canRename(subject: EntitySubject): boolean {
  return subject.kind === 'tag';
}

/**
 * How the Delete row behaves, which is three different things.
 *
 * - `blocked`  — records stand in the way. The row is a LINK to them, not a
 *                disabled control: pressing it opens the search that lists
 *                exactly what it counted.
 * - `costly`   — nothing blocks it, but going ahead changes records. Only a
 *                tag reaches this: its records keep their money, categories and
 *                notes and lose a label. The count is said BEFORE the second
 *                tap, which is the only moment it can still change a mind.
 * - `free`     — nothing points at it. Confirm and it is gone.
 *
 * `blocked` is decided by `blocking`, never by `records`: the two differ for a
 * tag, and reading the wrong one would either wall off a tag that nothing
 * prevents or wave through an account carrying a year of history.
 */
export type DeleteMode = 'blocked' | 'costly' | 'free';

export function deleteMode(subject: EntitySubject): DeleteMode {
  if (subject.blocking > 0) return 'blocked';
  return subject.records > 0 ? 'costly' : 'free';
}

/** Plural-aware "3 records" / "1 record". */
export function recordCount(n: number): string {
  return `${n} record${n === 1 ? '' : 's'}`;
}

/**
 * The line under Delete, which has to say what pressing it will do.
 *
 * Written here rather than in the sheet because it is the sentence that has to
 * match `deleteMode` — copy tied to a computed value belongs in the same place
 * as the value, or the two drift and the screen contradicts itself.
 */
export function deleteHint(subject: EntitySubject): string {
  switch (deleteMode(subject)) {
    case 'blocked':
      return `${recordCount(subject.blocking)} must move first — tap to see them`;
    case 'costly':
      return `${recordCount(subject.records)} would lose this label`;
    case 'free':
      return 'Nothing points at it';
  }
}

/**
 * What the confirmation says once Delete is armed.
 *
 * Only reached from `costly` and `free`; `blocked` never arms, because there is
 * nothing to confirm when the answer is "not yet".
 */
export function deleteCost(subject: EntitySubject): string | null {
  if (deleteMode(subject) !== 'costly') return null;
  return (
    `${recordCount(subject.records)} will lose the label. ` +
    'Their money, categories and notes are untouched.'
  );
}

/**
 * Archiving is a toggle, and the word has to say which way it goes.
 *
 * The editor used to render this as a switch labelled "Archived" reading
 * "Hidden from pickers" / "Active" — a control whose own label described a
 * STATE while every other control on the screen described an ACTION.
 */
export function archiveLabel(subject: EntitySubject): string {
  return subject.archived ? 'Restore' : 'Archive';
}

export function archiveHint(subject: EntitySubject): string {
  if (subject.archived) {
    return subject.kind === 'category'
      ? 'Back in the pickers — its parent comes back too'
      : 'Back in the pickers';
  }
  return subject.kind === 'category'
    ? 'Keeps its records, off the pickers — sub-categories go too'
    : 'Keeps its records, off the pickers';
}
