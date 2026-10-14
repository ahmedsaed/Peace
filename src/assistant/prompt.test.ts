import { configurePeriods } from '../lib/period';
import { systemPrompt } from './prompt';

const shape = { accounts: [], categories: [], tags: [] };
const now = new Date(2026, 9, 13, 10);

describe("the user's own rules", () => {
  it('are left out entirely when there are none', () => {
    for (const rules of ['', '   ']) {
      expect(systemPrompt(now, 'USD', shape, rules)).not.toContain("USER'S OWN RULES");
    }
  });

  // After the shipped rules so they can qualify them, before the ledger so a
  // long category list cannot bury them — and never above the money contract.
  it('come after the money contract and before the ledger', () => {
    const prompt = systemPrompt(now, 'USD', shape, '  Answer in Arabic.  ');
    expect(prompt).toContain('Answer in Arabic.');
    expect(prompt.indexOf('Answer in Arabic.')).toBeGreaterThan(prompt.indexOf('MONEY IN YOUR REPLIES'));
    expect(prompt.indexOf('Answer in Arabic.')).toBeLessThan(prompt.indexOf('THE LEDGER'));
    expect(prompt).toMatch(/MONEY IN YOUR REPLIES, which always win/);
  });
});

describe('the system prompt and the month start', () => {
  afterEach(() => configurePeriods({ monthStart: 1 }));

  it('says nothing about months when they are calendar months', () => {
    expect(systemPrompt(now, 'USD', shape)).not.toContain('months start on');
  });

  it("says when months start on payday, and names this one the way the screens do", () => {
    configurePeriods({ monthStart: 25 });
    const prompt = systemPrompt(now, 'USD', shape);
    expect(prompt).toContain("This person's months start on the 25th");
    expect(prompt).toContain('"Sep 25 – Oct 24, 2026" is this month');
  });
});
