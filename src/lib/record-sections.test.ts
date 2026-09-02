import { recordSections, type Section } from './record-sections';

const day = (key: string, data: string[]): Section<string> => ({
  key,
  title: key,
  total: -100,
  unvalued: 0,
  data,
});

const build = (over: Partial<Parameters<typeof recordSections<string>>[0]> = {}) =>
  recordSections<string>({ due: [], captures: [], upcoming: [], days: [], ...over });

describe('what the records screen is made of', () => {
  it('omits a band with nothing in it', () => {
    // A heading with nothing under it says the app is waiting on you when it
    // is not.
    expect(build({ days: [day('mon', ['a'])] }).map((s) => s.key)).toEqual(['mon']);
  });

  it('is empty when there is nothing at all', () => {
    // Gated on the SECTIONS, which is what the screen renders — the empty
    // state used to be gated on the records alone, so a month with no records
    // but a standing order owing money said "No records this month" and hid
    // the very thing the feature exists for.
    expect(build()).toEqual([]);
  });

  it('is not empty when only a proposal is owed', () => {
    expect(build({ due: ['rent'] })).toHaveLength(1);
  });
});

describe('the order', () => {
  it('puts everything not yet real above the ledger', () => {
    const sections = build({
      due: ['rent'],
      captures: ['sms'],
      upcoming: ['electricity'],
      days: [day('mon', ['a']), day('tue', ['b'])],
    });

    expect(sections.map((s) => s.key)).toEqual(['due', 'bank', 'upcoming', 'mon', 'tue']);
  });

  it('keeps Upcoming above the ledger, not after it', () => {
    // The bug this file exists for. Last, a standing order for the 28th was a
    // month of scrolling away — the one section that exists to be acted on was
    // the only one you had to go looking for.
    const sections = build({
      upcoming: ['electricity'],
      days: [day('mon', ['a'])],
    });

    expect(sections.map((s) => s.key)).toEqual(['upcoming', 'mon']);
  });

  it('keeps Upcoming directly under the bank messages', () => {
    const sections = build({
      captures: ['sms'],
      upcoming: ['electricity'],
      days: [day('mon', ['a'])],
    });

    expect(sections.map((s) => s.key)).toEqual(['bank', 'upcoming', 'mon']);
  });

  it('leaves the days in the order they were given', () => {
    // They arrive newest-first from `groupByDay`, and re-sorting them here
    // would be a second opinion about an order that is already decided.
    const days = [day('wed', ['c']), day('mon', ['a']), day('tue', ['b'])];
    expect(build({ days }).map((s) => s.key)).toEqual(['wed', 'mon', 'tue']);
  });
});

describe('the headings', () => {
  it('counts what is waiting on you', () => {
    expect(build({ due: ['a', 'b'] })[0].title).toBe('Due · 2');
    expect(build({ captures: ['a', 'b', 'c'] })[0].title).toBe('From your bank · 3');
  });

  it('drops the count when there is one, because "Due · 1" reads badly', () => {
    expect(build({ due: ['a'] })[0].title).toBe('Due');
    expect(build({ captures: ['a'] })[0].title).toBe('From your bank');
  });

  it('never counts Upcoming', () => {
    // These are not waiting on you today. A number would be urgency the
    // section does not have.
    expect(build({ upcoming: ['a', 'b', 'c'] })[0].title).toBe('Upcoming');
  });
});

describe('the totals', () => {
  it('gives no total to anything that has not happened', () => {
    // A figure there would read as money already spent.
    const sections = build({ due: ['a'], captures: ['b'], upcoming: ['c'] });
    expect(sections.map((s) => s.total)).toEqual([null, null, null]);
  });

  it("leaves a day's own total alone", () => {
    expect(build({ days: [day('mon', ['a'])] })[0].total).toBe(-100);
  });
});
