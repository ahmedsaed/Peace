import { cursorUrl, toDisplayMarkdown } from './display-markdown';

const figures = {
  t1f1: { minor: 124050, currency: 'EGP' },
  t1f2: { minor: -25000, currency: 'EGP' },
};
const format = (minor: number, currency: string) => `${minor < 0 ? '-' : ''}${currency} ${Math.abs(minor) / 100}`;

describe('toDisplayMarkdown', () => {
  it('turns cited figures into bold amounts, escaping what markdown would read as syntax', () => {
    expect(toDisplayMarkdown('You spent {{t1f1}}.', figures, format)).toBe('You spent **EGP 1240\\.5**.');
    // A negative amount at the start of a line must not become a list item.
    expect(toDisplayMarkdown('{{t1f2}} came back', figures, format)).toBe('**\\-EGP 250** came back');
    expect(toDisplayMarkdown('{{t1f2|abs}}', figures, format)).toBe('**EGP 250**');
  });

  it('does not wrap a figure that is already inside bold — that would close the bold', () => {
    expect(toDisplayMarkdown('**Total: {{t1f1}}** and {{t1f1}}', figures, format)).toBe(
      '**Total: EGP 1240\\.5** and **EGP 1240\\.5**'
    );
  });

  it('shows an unresolvable cite as a gap, never the raw token', () => {
    expect(toDisplayMarkdown('About {{t9f9}}', figures, format)).toBe('About **—**');
  });

  it('masks figures the model typed when amounts are hidden — and only then', () => {
    expect(toDisplayMarkdown('About E£1,240 and {{t1f1}}', figures, () => '••••', { hidden: true })).toBe(
      'About •••• and **••••**'
    );
    expect(toDisplayMarkdown('About E£1,240', figures, format)).toBe('About E£1,240');
  });

  it('while streaming, holds back half-arrived syntax and puts the coin at the very end', () => {
    const cursor = cursorUrl('#E3A33C', '#17140F');
    expect(cursor).toBe('peace://cursor?color=E3A33C&ink=17140F');
    expect(toDisplayMarkdown('You spent {{t1', figures, format, { streaming: true, cursor })).toBe(
      `You spent ![](${cursor})`
    );
    expect(toDisplayMarkdown('- one\n- tw', figures, format, { streaming: true, cursor })).toBe(
      `- one\n- tw ![](${cursor})`
    );
    // Nothing to follow yet: no lone coin, which markdown would make a block image.
    expect(toDisplayMarkdown('', figures, format, { streaming: true, cursor })).toBe('');
    // A finished reply carries no coin.
    expect(toDisplayMarkdown('Done.', figures, format, { cursor })).toBe('Done.');
  });
});
