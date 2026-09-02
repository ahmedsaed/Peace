import { canDuplicate, canRefund, canReverse, type ActionSubject } from './record-actions';

const row = (over: Partial<ActionSubject> = {}): ActionSubject => ({
  isTransfer: false,
  isAdjustment: false,
  isRefund: false,
  amountMinor: -25_000,
  reversesId: null,
  reversedByCount: 0,
  ...over,
});

describe('canRefund', () => {
  it('offers a refund on ordinary spending', () => {
    expect(canRefund(row())).toBe(true);
  });

  it('refuses income', () => {
    // Income coming back is simply an expense, and filing it as a refund would
    // put a positive row on the expense side of a category it never touched.
    expect(canRefund(row({ amountMinor: 900_000 }))).toBe(false);
  });

  it('refuses a refund of a refund', () => {
    // A refund is a POSITIVE expense, so the sign test alone would let it
    // through — `isRefund` is what excludes it. This is the assertion that
    // fails if the guard is ever rewritten as `amountMinor < 0`.
    expect(canRefund(row({ isRefund: true, amountMinor: 25_000 }))).toBe(false);
  });

  it('refuses a transfer and a correction', () => {
    expect(canRefund(row({ isTransfer: true }))).toBe(false);
    expect(canRefund(row({ isAdjustment: true }))).toBe(false);
  });

  it('still offers a refund on a purchase already partly refunded', () => {
    // Partial refunds are ordinary — a returned item out of a basket, three
    // people settling a dinner separately. Refusing the second one would make
    // the common case impossible to record.
    expect(canRefund(row({ reversedByCount: 2 }))).toBe(true);
  });
});

describe('canReverse', () => {
  it('offers a reversal on a transfer', () => {
    expect(canReverse(row({ isTransfer: true }))).toBe(true);
  });

  it('refuses everything that is not a transfer', () => {
    // There is no far end to swap on a purchase, and a correction moves a
    // balance rather than money between two accounts.
    expect(canReverse(row())).toBe(false);
    expect(canReverse(row({ isAdjustment: true }))).toBe(false);
    expect(canReverse(row({ isTransfer: true, isAdjustment: true }))).toBe(false);
  });

  it('refuses a transfer that has already been reversed', () => {
    // Reversing twice moves the money back twice, and both transfers look
    // entirely ordinary in the list afterwards.
    expect(canReverse(row({ isTransfer: true, reversedByCount: 1 }))).toBe(false);
  });

  it('refuses to reverse a reversal', () => {
    // That re-creates the original transfer, which is not something anybody
    // means to do from a menu.
    expect(canReverse(row({ isTransfer: true, reversesId: 'original' }))).toBe(false);
  });
});

describe('canDuplicate', () => {
  it('offers a duplicate of ordinary spending and income', () => {
    expect(canDuplicate(row())).toBe(true);
    expect(canDuplicate(row({ amountMinor: 900_000 }))).toBe(true);
  });

  it('refuses a refund, a transfer and a correction', () => {
    // Copying a refund detaches it from the purchase it reverses and makes
    // double-refunding one tap.
    expect(canDuplicate(row({ isRefund: true, amountMinor: 25_000 }))).toBe(false);
    expect(canDuplicate(row({ isTransfer: true }))).toBe(false);
    expect(canDuplicate(row({ isAdjustment: true }))).toBe(false);
  });
});

describe('the actions are mutually exclusive where it matters', () => {
  it('never offers both Refund and Reverse on the same row', () => {
    // They are the same idea applied to two different shapes of record, and a
    // sheet offering both would be asking which kind of undo you meant.
    for (const subject of [
      row(),
      row({ isTransfer: true }),
      row({ isRefund: true, amountMinor: 25_000 }),
      row({ isAdjustment: true }),
      row({ amountMinor: 900_000 }),
      row({ isTransfer: true, reversesId: 'x' }),
    ]) {
      expect(canRefund(subject) && canReverse(subject)).toBe(false);
    }
  });
});
