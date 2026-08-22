import {
  EMPTY_READING,
  ReceiptError,
  buildPrompt,
  isEmptyReading,
  matchCategory,
  parseReading,
} from './receipt';

/**
 * THE MODEL IS A TYPIST, NOT AN ACCOUNTANT.
 *
 * Everything it returns is treated as text somebody typed badly. These are the
 * replies a model actually produces — including the malformed ones, which are
 * the interesting cases and which no amount of testing on a device would cover.
 */
describe('reading what came back', () => {
  const good = {
    total: 120.5,
    currency: 'EGP',
    date: '2026-08-13',
    merchant: 'Grocery Mart',
    category: 'Groceries',
  };

  it('turns a clean reply into fields the record screen can use', () => {
    expect(parseReading(good)).toEqual({
      amountMinor: 12_050,
      currency: 'EGP',
      occurredOn: '2026-08-13',
      merchant: 'Grocery Mart',
      category: 'Groceries',
    });
  });

  /**
   * Money is integer minor units, and the number of places is per-currency.
   * Yen has none and dinars have three, so multiplying by 100 here would be
   * wrong by a factor of a hundred in both directions.
   */
  it('respects how many decimal places the currency actually has', () => {
    expect(parseReading({ ...good, total: 1200, currency: 'JPY' }).amountMinor).toBe(1200);
    expect(parseReading({ ...good, total: 12.345, currency: 'KWD' }).amountMinor).toBe(12_345);
  });

  it('uses the fallback currency when the receipt names none', () => {
    const reading = parseReading({ ...good, currency: null }, 'JPY');
    expect(reading.currency).toBeNull();
    // 120.5 in a currency with no minor unit is 121 — rounded, not truncated.
    expect(reading.amountMinor).toBe(121);
  });

  /**
   * Which side of the ledger a record sits on is decided by its TYPE, never by
   * the sign of a number — the rule that exists because a refund is an expense
   * with a positive amount.
   */
  it('returns an unsigned magnitude even when the model signs it', () => {
    expect(parseReading({ ...good, total: -120.5 }).amountMinor).toBe(12_050);
  });

  it('drops a total that is not a number', () => {
    for (const total of ['120.50', null, undefined, NaN, Infinity, {}, []]) {
      expect(parseReading({ ...good, total }).amountMinor).toBeNull();
    }
  });

  it('drops a zero total, which is never a receipt', () => {
    expect(parseReading({ ...good, total: 0 }).amountMinor).toBeNull();
  });

  /**
   * A misread decimal point or a barcode read as a price. Writing it would
   * wreck every total on every screen until somebody found it.
   */
  it('drops an absurd total rather than wrecking every screen', () => {
    expect(parseReading({ ...good, total: 1e12 }).amountMinor).toBeNull();
    // Generous on purpose: this catches nonsense, it does not second-guess an
    // expensive purchase.
    expect(parseReading({ ...good, total: 999_999_999 }).amountMinor).toBe(99_999_999_900);
  });

  it('rounds a total with too many places for its currency', () => {
    // A model returning 120.005 for a 2-place currency must not fail to parse;
    // the receipt says 120.01.
    expect(parseReading({ ...good, total: 120.005 }).amountMinor).toBe(12_001);
  });

  /**
   * "2026-02-31" matches the pattern and is not a day. Left unchecked it
   * becomes a Date that rolls into March and dates the record to a day the
   * user was not shopping.
   */
  it('refuses a date that is well-shaped but not real', () => {
    expect(parseReading({ ...good, date: '2026-02-31' }).occurredOn).toBeNull();
    expect(parseReading({ ...good, date: '2026-13-01' }).occurredOn).toBeNull();
    // A real leap day still passes.
    expect(parseReading({ ...good, date: '2028-02-29' }).occurredOn).toBe('2028-02-29');
  });

  it('refuses a date in any other shape', () => {
    for (const date of ['13/08/2026', 'yesterday', '2026-8-13', '', 42, null]) {
      expect(parseReading({ ...good, date }).occurredOn).toBeNull();
    }
  });

  it('only accepts a currency that looks like a code', () => {
    expect(parseReading({ ...good, currency: 'egp' }).currency).toBe('EGP');
    for (const currency of ['E£', 'pounds', 'USD dollars', '', 12, null]) {
      expect(parseReading({ ...good, currency }).currency).toBeNull();
    }
  });

  it('trims the strings and drops empty ones', () => {
    const reading = parseReading({ ...good, merchant: '  Grocery Mart  ', category: '   ' });
    expect(reading.merchant).toBe('Grocery Mart');
    expect(reading.category).toBeNull();
  });

  /**
   * A model that returns a paragraph has misunderstood the question — and a
   * 4,000-character "merchant" would be pasted straight into the note field.
   */
  it('caps a runaway string rather than pasting an essay into the note', () => {
    const reading = parseReading({ ...good, merchant: 'x'.repeat(4000) });
    expect(reading.merchant).toHaveLength(80);
  });

  /**
   * A receipt whose date is unreadable but whose total is clear is a USEFUL
   * reading. Refusing the whole thing over one junk field would throw away the
   * part that saves the typing.
   */
  it('keeps the fields it could read when others are junk', () => {
    const reading = parseReading({ total: 120.5, currency: 'EGP', date: 'smudged' });
    expect(reading.amountMinor).toBe(12_050);
    expect(reading.occurredOn).toBeNull();
    expect(reading.merchant).toBeNull();
  });

  it('refuses only a reply that is not an object at all', () => {
    for (const raw of [null, 'a sentence', 42]) {
      expect(() => parseReading(raw)).toThrow(ReceiptError);
    }
    // An object with nothing in it is a legitimate "I could not read this".
    expect(parseReading({})).toEqual(EMPTY_READING);
  });
});

describe('knowing when nothing was found', () => {
  it('spots a reading with nothing worth filling in', () => {
    expect(isEmptyReading(EMPTY_READING)).toBe(true);
    // A currency alone fills in no field the user cares about — the account
    // already decides that.
    expect(isEmptyReading({ ...EMPTY_READING, currency: 'EGP' })).toBe(true);
  });

  it('spots one that found something', () => {
    expect(isEmptyReading({ ...EMPTY_READING, amountMinor: 100 })).toBe(false);
    expect(isEmptyReading({ ...EMPTY_READING, merchant: 'Shop' })).toBe(false);
  });
});

/**
 * A returned category that does not exist in this ledger is useless, and
 * inventing one would fill the picker with junk within a week.
 */
describe('matching a category the user actually has', () => {
  const categories = [
    { id: 'c1', name: 'Groceries' },
    { id: 'c2', name: 'Restaurants' },
  ];

  it('matches regardless of case and spacing', () => {
    expect(matchCategory('groceries', categories)?.id).toBe('c1');
    expect(matchCategory('  Groceries ', categories)?.id).toBe('c1');
  });

  it('never invents one', () => {
    expect(matchCategory('Sundries', categories)).toBeNull();
    expect(matchCategory(null, categories)).toBeNull();
    expect(matchCategory('Groceries', [])).toBeNull();
  });
});

describe('the prompt', () => {
  /**
   * The category list is passed IN rather than left to the model's imagination.
   * Without it every reply is a plausible category this ledger does not have.
   */
  it('names the user\'s own categories to choose from', () => {
    const prompt = buildPrompt(['Groceries', 'Transport']);
    expect(prompt).toContain('Groceries, Transport');
  });

  it('says so plainly when there are none', () => {
    expect(buildPrompt([])).toContain('none');
  });

  it('adds the user\'s own rules after the field rules, never instead of them', () => {
    const prompt = buildPrompt(['Groceries'], 'Ignore the service charge at Zooba.');
    expect(prompt).toContain('Ignore the service charge at Zooba.');
    expect(prompt).toMatch(/FINAL amount paid/);
    expect(prompt.indexOf('Zooba')).toBeGreaterThan(prompt.indexOf('FINAL amount paid'));
  });

  it('is complete, and mentions no rules, when the user has written none', () => {
    for (const guidance of ['', '   ']) {
      const prompt = buildPrompt(['Groceries'], guidance);
      expect(prompt).toMatch(/FINAL amount paid/);
      expect(prompt).not.toContain('own rules');
    }
  });

  it('asks for the final total rather than a subtotal or a line item', () => {
    // The single most valuable field, and the one with the most ways to be
    // wrong on a receipt that lists twenty things.
    expect(buildPrompt([])).toMatch(/FINAL amount paid/);
    expect(buildPrompt([])).toMatch(/Not a subtotal/);
  });
});
