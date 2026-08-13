import {
  BankSmsError,
  EMPTY_BANK_READING,
  buildBankPrompt,
  captureKey,
  isUsableReading,
  matchesSender,
  parseBankReading,
  parseCaptures,
} from './bank-sms';

/**
 * WHICH MESSAGES ARE EVEN LOOKED AT.
 *
 * The forgiving direction is chosen deliberately: a bank message that is not
 * read is a record silently never offered, while one read that should not have
 * been is a single junk proposal dismissed with a tap.
 */
describe('deciding whose messages to read', () => {
  it('matches the bank however the sender happens to be spelled', () => {
    // The same bank arrives under all of these depending on the route.
    for (const sender of ['CIB', 'CIB Bank', 'CIB-Alerts', 'cib']) {
      expect(matchesSender(sender, ['CIB'])).toBe(true);
    }
  });

  it('ignores case and surrounding space in both directions', () => {
    expect(matchesSender('  QNB ALAHLI ', ['qnb'])).toBe(true);
    expect(matchesSender('qnb', ['  QNB  '])).toBe(true);
  });

  it('reads nothing from a sender that is not on the list', () => {
    expect(matchesSender('Mum', ['CIB', 'QNB'])).toBe(false);
    expect(matchesSender('Vodafone', ['CIB'])).toBe(false);
  });

  it('reads nothing at all when the list is empty', () => {
    // The feature is off until the user names a bank. An empty list must never
    // mean "everything" — that would send every text message they receive to
    // Google the moment they granted the permission.
    expect(matchesSender('CIB', [])).toBe(false);
  });

  it('ignores a blank sender or a blank entry', () => {
    expect(matchesSender('   ', ['CIB'])).toBe(false);
    // A blank entry is a substring of everything and would match every message.
    expect(matchesSender('Mum', ['', '   '])).toBe(false);
  });
});

/**
 * A messaging app re-posts a whole conversation when the next message lands, so
 * the same text is captured again AFTER a drain has already cleared the store.
 */
describe('recognising a message already seen', () => {
  it('is stable for the same sender and body', () => {
    expect(captureKey('CIB', 'Purchase of EGP 450')).toBe(captureKey('CIB', 'Purchase of EGP 450'));
  });

  it('ignores case and surrounding space in the sender', () => {
    expect(captureKey(' cib ', 'Purchase of EGP 450')).toBe(captureKey('CIB', 'Purchase of EGP 450'));
  });

  it('differs when the message differs', () => {
    expect(captureKey('CIB', 'Purchase of EGP 450')).not.toBe(
      captureKey('CIB', 'Purchase of EGP 451')
    );
  });

  it('differs when the sender differs', () => {
    expect(captureKey('CIB', 'same text')).not.toBe(captureKey('QNB', 'same text'));
  });

  it('is always eight hex characters', () => {
    // Including for inputs that hash to a small number, which is where a
    // missing pad shows up as a key of a different length.
    for (const body of ['', 'a', 'x'.repeat(500)]) {
      expect(captureKey('CIB', body)).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});

describe('reading what the native side handed over', () => {
  const entry = {
    sender: 'CIB',
    body: 'Purchase of EGP 450.00',
    packageName: 'com.google.android.apps.messaging',
    postedAt: 1_760_000_000_000,
  };

  it('parses a normal drain', () => {
    expect(parseCaptures(JSON.stringify([entry]))).toEqual([entry]);
  });

  it('returns nothing for an empty store', () => {
    expect(parseCaptures('[]')).toEqual([]);
  });

  /**
   * The drain has ALREADY cleared the store by the time this runs, so there is
   * nothing to retry from. One malformed entry must cost that entry and no more.
   */
  it('drops a malformed entry rather than losing the whole drain', () => {
    const json = JSON.stringify([entry, { sender: 'CIB' }, null, 42, { ...entry, sender: '  ' }]);
    expect(parseCaptures(json)).toEqual([entry]);
  });

  it('survives a store that is not JSON at all', () => {
    expect(parseCaptures('not json')).toEqual([]);
    expect(parseCaptures('{"not":"an array"}')).toEqual([]);
  });

  it('trims the strings it keeps', () => {
    const [parsed] = parseCaptures(JSON.stringify([{ ...entry, sender: ' CIB ', body: ' hi ' }]));
    expect(parsed.sender).toBe('CIB');
    expect(parsed.body).toBe('hi');
  });
});

/**
 * The model is a typist here too. These are the replies it actually produces,
 * including the ones that would put a wrong number in a ledger.
 */
describe('reading what came back', () => {
  const good = {
    amount: 450.5,
    currency: 'EGP',
    direction: 'out',
    merchant: 'CARREFOUR',
    date: '2026-08-13',
    accountTail: '0042',
  };

  it('turns a clean reply into fields a record can use', () => {
    expect(parseBankReading(good)).toEqual({
      amountMinor: 45_050,
      currency: 'EGP',
      direction: 'out',
      merchant: 'CARREFOUR',
      occurredOn: '2026-08-13',
      accountTail: '0042',
    });
  });

  /**
   * THE ONE THAT MATTERS MOST. Direction is read from the message's words; a
   * value that is not one of the two is not a direction, and guessing would be
   * how a refund becomes income.
   */
  it('accepts only the two directions it asked for', () => {
    expect(parseBankReading({ ...good, direction: 'in' }).direction).toBe('in');
    for (const direction of ['debit', 'OUT', '', null, 1, true]) {
      expect(parseBankReading({ ...good, direction }).direction).toBeNull();
    }
  });

  it('keeps the amount unsigned whatever sign the model puts on it', () => {
    // The side of the ledger is `direction`'s business, never a sign's.
    expect(parseBankReading({ ...good, amount: -450.5 }).amountMinor).toBe(45_050);
  });

  it('respects how many decimal places the currency has', () => {
    expect(parseBankReading({ ...good, amount: 1200, currency: 'JPY' }).amountMinor).toBe(1200);
    expect(parseBankReading({ ...good, amount: 12.345, currency: 'KWD' }).amountMinor).toBe(12_345);
  });

  it('drops an amount that is not a usable number', () => {
    for (const amount of ['450', null, NaN, Infinity, 0, 1e12, {}]) {
      expect(parseBankReading({ ...good, amount }).amountMinor).toBeNull();
    }
  });

  /**
   * "0042" is not 42. The leading zero is exactly what makes it match the right
   * card, so this is text and stays text.
   */
  it('keeps the account tail as digits, leading zero and all', () => {
    expect(parseBankReading({ ...good, accountTail: '0042' }).accountTail).toBe('0042');
    expect(parseBankReading({ ...good, accountTail: '****0042' }).accountTail).toBe('0042');
    expect(parseBankReading({ ...good, accountTail: 'n/a' }).accountTail).toBeNull();
  });

  it('refuses a date that is well-shaped but not a real day', () => {
    expect(parseBankReading({ ...good, date: '2026-02-31' }).occurredOn).toBeNull();
    expect(parseBankReading({ ...good, date: '13/08/2026' }).occurredOn).toBeNull();
    expect(parseBankReading({ ...good, date: '2028-02-29' }).occurredOn).toBe('2028-02-29');
  });

  it('only accepts a currency that looks like a code', () => {
    expect(parseBankReading({ ...good, currency: 'egp' }).currency).toBe('EGP');
    for (const currency of ['E£', 'pounds', 'EGP pounds', '']) {
      expect(parseBankReading({ ...good, currency }).currency).toBeNull();
    }
  });

  it('keeps the fields it could read when others are junk', () => {
    const reading = parseBankReading({ amount: 450, direction: 'out', merchant: '   ' });
    expect(reading.amountMinor).toBe(45_000);
    expect(reading.direction).toBe('out');
    expect(reading.merchant).toBeNull();
  });

  it('refuses only a reply that is not an object', () => {
    for (const raw of [null, 'a sentence', 42]) {
      expect(() => parseBankReading(raw)).toThrow(BankSmsError);
    }
    // An empty object is a legitimate "this was not a transaction".
    expect(parseBankReading({})).toEqual(EMPTY_BANK_READING);
  });
});

/**
 * An amount and a direction, or there is nothing to offer. A message with a
 * total and no direction is a number with no meaning.
 */
describe('deciding whether to offer it at all', () => {
  it('needs both an amount and a direction', () => {
    expect(isUsableReading({ ...EMPTY_BANK_READING, amountMinor: 100, direction: 'out' })).toBe(true);
    expect(isUsableReading({ ...EMPTY_BANK_READING, amountMinor: 100 })).toBe(false);
    expect(isUsableReading({ ...EMPTY_BANK_READING, direction: 'out' })).toBe(false);
    expect(isUsableReading(EMPTY_BANK_READING)).toBe(false);
  });

  it('does not need a merchant or a date', () => {
    // A balance alert with no shop named is still a real transaction.
    expect(
      isUsableReading({ ...EMPTY_BANK_READING, amountMinor: 100, direction: 'in' })
    ).toBe(true);
  });
});

describe('the prompt', () => {
  it('quotes the message rather than describing it', () => {
    const prompt = buildBankPrompt('Purchase of EGP 450 at CARREFOUR', '2026-08-13');
    expect(prompt).toContain('Purchase of EGP 450 at CARREFOUR');
  });

  /**
   * A model told to fill in a date will happily use today's. The message's own
   * date is the only one worth having — anything else dates the record to when
   * it was read rather than when the money moved.
   */
  it('tells the model today, and tells it not to use it', () => {
    const prompt = buildBankPrompt('x', '2026-08-13');
    expect(prompt).toContain('Today is 2026-08-13');
    expect(prompt).toMatch(/Do NOT return today's date/);
  });

  it('says to read the direction from the words', () => {
    expect(buildBankPrompt('x', '2026-08-13')).toMatch(/Read the WORDS/);
  });

  it('says to ignore the things that are not transactions', () => {
    // Balance alerts and OTPs vastly outnumber transactions in a bank's SMS
    // traffic, and each one read as a purchase is a junk record.
    expect(buildBankPrompt('x', '2026-08-13')).toMatch(/OTPs/);
  });
});
