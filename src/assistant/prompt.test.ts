import { configurePeriods } from '../lib/period';
import { systemPrompt } from './prompt';

const shape = { accounts: [], categories: [], tags: [] };
const now = new Date(2026, 9, 13, 10);

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
