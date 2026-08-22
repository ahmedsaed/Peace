import {
  BankSmsError,
  EMPTY_BANK_READING,
  buildBankPrompt,
  captureKey,
  isUsableReading,
  matchAccount,
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
  };

  it('turns a clean reply into fields a record can use', () => {
    expect(parseBankReading(good)).toEqual({
      amountMinor: 45_050,
      currency: 'EGP',
      direction: 'out',
      merchant: 'CARREFOUR',
      account: null,
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
   * A field nothing reads must not be asked for.
   *
   * The card tail was read, stored, and used by nothing — the account NAME is
   * what resolves to an account, and the raw message is on the review sheet for
   * anyone wanting the digits. Anything extra the model volunteers is dropped
   * here rather than carried, so it cannot quietly acquire a meaning later.
   */
  it('keeps nothing the reading has no field for', () => {
    expect(parseBankReading({ ...good, accountTail: '0042' })).not.toHaveProperty('accountTail');
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

/**
 * A bank writes "card ending 0042", which means nothing to this app on its own.
 * The user's own account names are offered to the model and their guidance is
 * where the mapping lives — this is the half that resolves the answer back.
 */
describe('matching an account the user actually has', () => {
  const accounts = [
    { id: 'a1', name: 'Kenana' },
    { id: 'a2', name: 'Bank' },
  ];

  it('matches regardless of case and spacing', () => {
    expect(matchAccount('kenana', accounts)?.id).toBe('a1');
    expect(matchAccount('  Kenana ', accounts)?.id).toBe('a1');
  });

  it('never invents one', () => {
    // Filing against the default and letting the user move it is far better
    // than an account this ledger has never heard of.
    expect(matchAccount('Visa', accounts)).toBeNull();
    expect(matchAccount(null, accounts)).toBeNull();
    expect(matchAccount('Kenana', [])).toBeNull();
  });
});

describe('the prompt', () => {
  it('quotes the message rather than describing it', () => {
    const prompt = buildBankPrompt('Purchase of EGP 450 at CARREFOUR');
    expect(prompt).toContain('Purchase of EGP 450 at CARREFOUR');
  });

  it('says to read the direction from the words', () => {
    expect(buildBankPrompt('x')).toMatch(/Read the WORDS/);
  });

  /**
   * The model cannot know which account "card ending 0042" is. Offering the
   * user's own names is what makes their guidance ("0042 is Kenana") resolvable.
   */
  it('offers the user\'s own accounts to choose from', () => {
    expect(buildBankPrompt('x', ['Kenana', 'Bank'])).toContain('Kenana, Bank');
    expect(buildBankPrompt('x', [])).toContain('none');
  });

  it('adds the user\'s own rules without displacing the contract', () => {
    const prompt = buildBankPrompt('x', [], 'the card ending 0042 is Kenana');
    expect(prompt).toContain('the card ending 0042 is Kenana');
    // The field rules are still there — the user's half is an ADDITION, never a
    // replacement, or an empty box would send a prompt with no contract in it.
    expect(prompt).toContain('Read the WORDS');
    expect(prompt).toContain('Return only what the message actually states');
  });

  /**
   * THEIR RULES COME LAST, so a specific instruction can qualify a general one.
   * Put first, "instalment messages are not purchases" argues with a field rule
   * the model has not read yet.
   */
  it('puts their rules after the field rules', () => {
    const prompt = buildBankPrompt('x', [], 'MINE');
    expect(prompt.indexOf('MINE')).toBeGreaterThan(prompt.indexOf('Read the WORDS'));
  });

  /**
   * THE EMPTY BOX IS THE NORMAL STATE. Almost nobody writes rules, so the prompt
   * has to be complete without them — and must not carry an empty heading
   * announcing rules that are not there.
   */
  it('is complete, and says nothing about rules, when there are none', () => {
    for (const guidance of ['', '   ']) {
      const prompt = buildBankPrompt('x', [], guidance);
      expect(prompt).toContain('Read the WORDS');
      expect(prompt).not.toContain('own rules');
    }
  });

  it('says to ignore the things that are not transactions', () => {
    // Balance alerts and OTPs vastly outnumber transactions in a bank's SMS
    // traffic, and each one read as a purchase is a junk record.
    expect(buildBankPrompt('x')).toMatch(/OTPs/);
  });
});
