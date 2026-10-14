import { detectCurrency, firstRunSettings, LAUNCH_CURRENCY, LAUNCH_ONBOARDING, LAUNCH_THEME } from './first-run';

describe('detectCurrency', () => {
  it('takes the first locale that names a currency', () => {
    expect(detectCurrency([{ currencyCode: null }, { currencyCode: 'EUR' }])).toBe('EUR');
  });

  it('falls back to dollars when no locale has a region', () => {
    expect(detectCurrency([{ currencyCode: null }])).toBe('USD');
    expect(detectCurrency([])).toBe('USD');
  });

  it('ignores anything that is not an ISO 4217 code', () => {
    expect(detectCurrency([{ currencyCode: 'euro' }, { currencyCode: 'gbp' }])).toBe('GBP');
  });
});

describe('firstRunSettings', () => {
  const egypt = [{ currencyCode: 'EGP' }];

  it('greets a person: onboarding pending, the setup card on', () => {
    expect(firstRunSettings({}, egypt)).toEqual({
      homeCurrency: 'EGP',
      onboardingDone: false,
      setupCard: true,
      theme: 'system',
    });
  });

  it('lets a test harness skip onboarding and pin the currency', () => {
    expect(
      firstRunSettings({ [LAUNCH_ONBOARDING]: 'done', [LAUNCH_CURRENCY]: 'jpy' }, egypt)
    ).toEqual({ homeCurrency: 'JPY', onboardingDone: true, setupCard: false, theme: 'system' });
  });

  it('lets a harness pin the theme, and ignores one this build does not have', () => {
    expect(firstRunSettings({ [LAUNCH_THEME]: 'ledger' }, egypt).theme).toBe('ledger');
    expect(firstRunSettings({ [LAUNCH_THEME]: 'neon' }, egypt).theme).toBe('system');
  });

  it('ignores a malformed currency extra rather than storing it', () => {
    expect(firstRunSettings({ [LAUNCH_CURRENCY]: 'pounds' }, egypt).homeCurrency).toBe('EGP');
  });

  it('only skips on the exact value', () => {
    expect(firstRunSettings({ [LAUNCH_ONBOARDING]: 'yes' }, egypt).onboardingDone).toBe(false);
  });
});
