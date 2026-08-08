import { decodeSetting, encodeSetting, SETTING_DEFAULTS } from './settings';

describe('settings codec', () => {
  it('round-trips strings without JSON quoting', () => {
    expect(encodeSetting('homeCurrency', 'USD')).toBe('USD');
    expect(decodeSetting('homeCurrency', 'USD')).toBe('USD');
  });

  it('round-trips booleans', () => {
    expect(encodeSetting('carryOver', false)).toBe('false');
    expect(decodeSetting('carryOver', 'false')).toBe(false);
    expect(decodeSetting('carryOver', 'true')).toBe(true);
  });

  it('falls back to the default when the row is missing', () => {
    expect(decodeSetting('homeCurrency', undefined)).toBe(SETTING_DEFAULTS.homeCurrency);
    expect(decodeSetting('carryOver', null)).toBe(SETTING_DEFAULTS.carryOver);
  });

  it('survives a corrupt value rather than throwing', () => {
    // A half-written row must not brick every screen that reads a preference.
    expect(decodeSetting('carryOver', '{{{')).toBe(SETTING_DEFAULTS.carryOver);
  });

  it('rejects a value of the wrong type', () => {
    // An older build could have stored a string where a boolean now lives.
    expect(decodeSetting('carryOver', '"yes"')).toBe(SETTING_DEFAULTS.carryOver);
    expect(decodeSetting('showTotal', '1')).toBe(SETTING_DEFAULTS.showTotal);
  });

  it('keeps EGP as the home currency default', () => {
    // The app is built for EGP first; money.ts carries the E£ symbol override.
    expect(SETTING_DEFAULTS.homeCurrency).toBe('EGP');
  });
});
