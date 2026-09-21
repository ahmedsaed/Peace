import {
  archiveHint,
  archiveLabel,
  canEdit,
  canRename,
  canShowRecords,
  canUpdateBalance,
  deleteCost,
  deleteHint,
  deleteMode,
  recordCount,
  type EntitySubject,
} from './entity-actions';

const subject = (over: Partial<EntitySubject> = {}): EntitySubject => ({
  kind: 'account',
  archived: false,
  records: 0,
  blocking: 0,
  ...over,
});

describe('which actions an entity offers', () => {
  it('offers its records only when it has some', () => {
    expect(canShowRecords(subject({ records: 0 }))).toBe(false);
    expect(canShowRecords(subject({ records: 1 }))).toBe(true);
  });

  it('offers a balance correction on an account, archived or not', () => {
    // An archived account still holds money and is still counted in the
    // Accounts total, so a drifted balance on one is a wrong total.
    expect(canUpdateBalance(subject({ archived: true }))).toBe(true);
    expect(canUpdateBalance(subject({ kind: 'category' }))).toBe(false);
    expect(canUpdateBalance(subject({ kind: 'tag' }))).toBe(false);
  });

  it('sends accounts and categories to an editor, and renames a tag in place', () => {
    expect(canEdit(subject())).toBe(true);
    expect(canEdit(subject({ kind: 'category' }))).toBe(true);
    expect(canEdit(subject({ kind: 'tag' }))).toBe(false);

    expect(canRename(subject({ kind: 'tag' }))).toBe(true);
    expect(canRename(subject())).toBe(false);
  });
});

describe('how Delete behaves', () => {
  it('is blocked when records stand in the way', () => {
    expect(deleteMode(subject({ records: 4, blocking: 4 }))).toBe('blocked');
  });

  it('is free when nothing points at it', () => {
    expect(deleteMode(subject())).toBe('free');
  });

  it('is costly for a tag, which nothing blocks but records still feel', () => {
    // The case that separates `blocking` from `records`: reading `records` to
    // decide would wall off a tag nothing prevents deleting.
    expect(deleteMode(subject({ kind: 'tag', records: 2, blocking: 0 }))).toBe('costly');
  });

  it('never arms a confirmation for a blocked entity', () => {
    // Nothing to confirm when the answer is "not yet".
    expect(deleteCost(subject({ records: 4, blocking: 4 }))).toBeNull();
  });

  it('says the cost before the second tap, not after it', () => {
    expect(deleteCost(subject({ kind: 'tag', records: 2 }))).toMatch(/2 records will lose the label/);
    expect(deleteCost(subject({ kind: 'tag', records: 2 }))).toMatch(/untouched/);
  });

  it('points a blocked delete AT the records rather than apologising', () => {
    expect(deleteHint(subject({ records: 1, blocking: 1 }))).toBe(
      '1 record must move first — tap to see them'
    );
  });

  it('counts in the singular when there is one of something', () => {
    expect(recordCount(1)).toBe('1 record');
    expect(recordCount(0)).toBe('0 records');
    expect(recordCount(2)).toBe('2 records');
  });
});

describe('the archive toggle names an action, not a state', () => {
  it('flips its word with the state', () => {
    expect(archiveLabel(subject({ archived: false }))).toBe('Archive');
    expect(archiveLabel(subject({ archived: true }))).toBe('Restore');
  });

  it('warns that a category takes its family with it', () => {
    // Both cascades live in `updateCategory`; the sheet has to say so, because
    // a sub-category silently becoming a heading reads as a bug in the picker
    // rather than as something the user did.
    expect(archiveHint(subject({ kind: 'category' }))).toMatch(/sub-categories go too/i);
    expect(archiveHint(subject({ kind: 'category', archived: true }))).toMatch(/parent comes back/i);
    expect(archiveHint(subject({ kind: 'account' }))).not.toMatch(/sub-categories/i);
  });
});
