import { recordSubtitle } from './record-subtitle';

const row = (over: Partial<Parameters<typeof recordSubtitle>[0]> = {}) => ({
  accountName: 'Bank',
  counterAccountName: null,
  note: null,
  tags: [],
  isTransfer: false,
  isRefund: false,
  isAdjustment: false,
  reversesId: null,
  ...over,
});

describe('the second line of a record', () => {
  it('shows the account and the note of an ordinary record', () => {
    expect(recordSubtitle(row({ note: 'Lunch' }))).toBe('Bank · “Lunch”');
    expect(recordSubtitle(row())).toBe('Bank');
  });

  /** It was "Loan → Bank" and nothing else, whatever the user had written. */
  it('shows the note of a transfer after where the money went', () => {
    expect(
      recordSubtitle(
        row({ isTransfer: true, accountName: 'Loan', counterAccountName: 'Bank', note: 'October instalment' })
      )
    ).toBe('Loan → Bank · “October instalment”');
  });

  it('leaves a transfer with no note as just the two accounts', () => {
    expect(
      recordSubtitle(row({ isTransfer: true, accountName: 'Loan', counterAccountName: 'Bank' }))
    ).toBe('Loan → Bank');
  });

  it('says a transfer is a reversal before its note, and puts labels last', () => {
    expect(
      recordSubtitle(
        row({
          isTransfer: true,
          accountName: 'Cash',
          counterAccountName: 'Bank',
          reversesId: 't1',
          note: 'Wrong account',
          tags: ['fix'],
        })
      )
    ).toBe('Cash → Bank · reversal · “Wrong account” · #fix');
  });

  it('keeps a refund and a correction as they were', () => {
    expect(recordSubtitle(row({ isRefund: true, note: 'Jacket' }))).toBe('Bank · refunded · “Jacket”');
    expect(recordSubtitle(row({ isAdjustment: true, note: 'ignored' }))).toBe(
      'Bank · not counted as spending'
    );
  });
});
