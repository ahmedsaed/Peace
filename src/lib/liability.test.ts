import {
  availableCredit,
  bpToPercent,
  hasCardProfile,
  isLiability,
  owedDisplay,
  percentToBp,
  targetBalanceFromAvailable,
  targetBalanceFromOwed,
} from './liability';

describe('isLiability', () => {
  it('is true for the accounts whose balance is debt', () => {
    expect(isLiability('card')).toBe(true);
    expect(isLiability('loan')).toBe(true);
  });

  it('is false for the accounts whose balance is money you hold', () => {
    for (const type of ['cash', 'bank', 'savings'] as const) {
      expect(isLiability(type)).toBe(false);
    }
  });
});

describe('owedDisplay', () => {
  /**
   * The bug this exists to fix: a card at −5,000 rendered like a drained
   * current account, as though the money had been spent out of it.
   */
  it('turns a negative balance into an unsigned amount owed', () => {
    expect(owedDisplay(-500_000)).toEqual({
      magnitudeMinor: 500_000,
      label: 'owed',
      isDebt: true,
    });
  });

  /**
   * A refund after the balance was settled leaves the bank owing you. Rare, but
   * it happens — and "−E£500 owed" is a double negative nobody should parse.
   */
  it('says "in credit" when the card owes you', () => {
    expect(owedDisplay(50_000)).toEqual({
      magnitudeMinor: 50_000,
      label: 'in credit',
      isDebt: false,
    });
  });

  it('says "clear" at zero rather than "0 owed"', () => {
    expect(owedDisplay(0)).toEqual({ magnitudeMinor: 0, label: 'clear', isDebt: false });
  });

  it('never returns a negative magnitude', () => {
    for (const balance of [-1, 0, 1, -999_999, 999_999]) {
      expect(owedDisplay(balance).magnitudeMinor).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('availableCredit', () => {
  it('is the limit less what is owed', () => {
    expect(availableCredit(-500_000, 5_000_000)).toBe(4_500_000);
  });

  it('is the whole limit when nothing is owed', () => {
    expect(availableCredit(0, 5_000_000)).toBe(5_000_000);
  });

  it('is absent when no limit is recorded', () => {
    // Nothing, rather than an authoritative-looking zero.
    expect(availableCredit(-500_000, null)).toBeNull();
    expect(availableCredit(-500_000, 0)).toBeNull();
  });

  it('floors at zero when over the limit', () => {
    // Being over is a real state, but "−E£200 available" is not a sentence —
    // and the owed figure beside it already tells that story.
    expect(availableCredit(-5_200_000, 5_000_000)).toBe(0);
  });

  it('does not count a credit balance as extra headroom', () => {
    // The bank owing you E£500 does not raise your limit.
    expect(availableCredit(50_000, 5_000_000)).toBe(5_000_000);
  });
});

describe('reading the number off a bank app', () => {
  /**
   * Banking apps disagree about which figure they show. Making someone do the
   * subtraction at the exact moment they are trying to correct an error is how
   * a correction becomes a second error.
   */
  it('takes what is owed', () => {
    expect(targetBalanceFromOwed(520_000)).toBe(-520_000);
  });

  it('treats a typed minus in an "owed" field as the same thing', () => {
    // Nobody owes negative five thousand; they mistyped.
    expect(targetBalanceFromOwed(-520_000)).toBe(-520_000);
  });

  it('takes available credit and converts it', () => {
    // E£44,800 available on a E£50,000 limit means E£5,200 owed.
    expect(targetBalanceFromAvailable(4_480_000, 5_000_000)).toBe(-520_000);
  });

  it('reads a full limit available as owing nothing', () => {
    expect(targetBalanceFromAvailable(5_000_000, 5_000_000)).toBe(0);
  });

  /**
   * Negating zero gives NEGATIVE zero, and it is a different value: `Object.is`
   * separates the two, a `=== 0` guard elsewhere may not, and it can reach the
   * screen as "-E£0.00" on a card that is exactly settled. `toBe` uses
   * Object.is, which is why these fail without the guard and `toEqual` would
   * not have caught it.
   */
  it('never returns negative zero', () => {
    expect(Object.is(targetBalanceFromOwed(0), -0)).toBe(false);
    expect(Object.is(targetBalanceFromAvailable(5_000_000, 5_000_000), -0)).toBe(false);
  });

  /**
   * The two routes have to agree, or the same reconciliation would produce two
   * different corrections depending on which number the user happened to read.
   */
  it('agrees whichever number was typed', () => {
    const limit = 5_000_000;
    for (const owed of [0, 1, 520_000, 4_999_999, 5_000_000]) {
      expect(targetBalanceFromAvailable(limit - owed, limit)).toBe(targetBalanceFromOwed(owed));
    }
  });
});

describe('fee rates', () => {
  it('converts a percentage to basis points', () => {
    expect(percentToBp('3')).toBe(300);
    expect(percentToBp('3.5')).toBe(350);
    expect(percentToBp('0.75')).toBe(75);
  });

  it('tolerates a typed percent sign and spaces', () => {
    expect(percentToBp(' 3 % ')).toBe(300);
  });

  it('is empty for an empty field, not zero', () => {
    // Zero would read as "no fee" and quietly stop charging one.
    expect(percentToBp('')).toBeNull();
    expect(percentToBp('   ')).toBeNull();
  });

  it('refuses nonsense rather than coercing it', () => {
    for (const bad of ['abc', '3,5', '-2', '--']) {
      expect(percentToBp(bad)).toBeNull();
    }
  });

  it('refuses a rate over 100%, which is a typo that would double a purchase', () => {
    expect(percentToBp('300')).toBeNull();
    expect(percentToBp('100')).toBe(10_000);
  });

  it('round-trips what the user typed', () => {
    for (const typed of ['3', '3.5', '0.75', '12']) {
      expect(bpToPercent(percentToBp(typed))).toBe(typed);
    }
  });

  it('shows a whole percent without decimals', () => {
    // "3.00" in a field someone is about to edit is noise.
    expect(bpToPercent(300)).toBe('3');
    expect(bpToPercent(null)).toBe('');
  });
});

/**
 * THE TWO QUESTIONS, AND WHERE THEY DISAGREE.
 *
 * A loan is the whole reason there are two predicates: it is debt, so it reads
 * as "owed", and it has none of a card's paperwork. Written as one predicate —
 * which it was — the account form offered a loan a credit limit in place of its
 * opening balance, two fees it cannot charge, and no way at all to enter the
 * principal.
 */
describe('isLiability vs hasCardProfile', () => {
  it('agree about a card', () => {
    expect(isLiability('card')).toBe(true);
    expect(hasCardProfile('card')).toBe(true);
  });

  it('disagree about a loan, which is the point', () => {
    expect(isLiability('loan')).toBe(true);
    expect(hasCardProfile('loan')).toBe(false);
  });

  it('agree about everything you hold rather than owe', () => {
    for (const type of ['cash', 'bank', 'savings'] as const) {
      expect([type, isLiability(type)]).toEqual([type, false]);
      expect([type, hasCardProfile(type)]).toEqual([type, false]);
    }
  });
});
