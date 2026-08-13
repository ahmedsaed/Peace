import { maskKey } from './secrets';

/**
 * The Settings row has to show SOMETHING, or there is no way to tell a saved
 * key from an empty field — but printing it in full puts a live billable
 * credential on screen in every screenshot and every shoulder-surfer's view.
 */
describe('showing a key without showing the key', () => {
  it('shows the last four, which is how people recognise a key they have', () => {
    expect(maskKey('AIzaSyD-1234567890abcdEFGH')).toBe('••••EFGH');
  });

  it('never reveals the rest of it', () => {
    const key = 'AIzaSyD-1234567890abcdEFGH';
    const masked = maskKey(key);
    expect(masked).not.toContain('AIzaSyD');
    expect(masked).not.toContain('1234567890');
    // Only four characters of the real key survive.
    expect(masked.replace(/•/g, '')).toHaveLength(4);
  });

  it('says so plainly when there is none', () => {
    expect(maskKey(null)).toBe('Not set');
    expect(maskKey('')).toBe('Not set');
    // Whitespace is not a key — it would reach the API as a guaranteed 401.
    expect(maskKey('   ')).toBe('Not set');
  });

  /**
   * A key this short is not a real one, but masking must not turn it into a
   * hint. `••••abcd` for a four-character key would print the whole thing.
   */
  it('reveals nothing at all for a key too short to mask', () => {
    expect(maskKey('abcd')).toBe('••••');
    expect(maskKey('ab')).toBe('••••');
  });
});
