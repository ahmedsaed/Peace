/**
 * Currencies offered in the pickers.
 *
 * A curated list, not all 180 ISO 4217 codes. Scrolling past Malagasy ariary to
 * reach US dollar is worse than not being able to pick it at all — and the ones
 * that matter here are the home currency and whatever the card gets billed in.
 *
 * Nothing enforces this list. `accounts.currency` and `transactions.currency`
 * are free text, so a code that is missing here still stores and formats
 * correctly; it just cannot be chosen from the picker. Add one when it is
 * actually needed rather than pre-emptively.
 *
 * Decimal places are NOT declared here — `decimalsFor` in money.ts owns that,
 * and two lists of the same fact would drift.
 */
export type Currency = { code: string; name: string };

export const CURRENCIES: Currency[] = [
  { code: 'EGP', name: 'Egyptian pound' },
  { code: 'USD', name: 'US dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'Pound sterling' },
  { code: 'SAR', name: 'Saudi riyal' },
  { code: 'AED', name: 'UAE dirham' },
  { code: 'KWD', name: 'Kuwaiti dinar' },
  { code: 'QAR', name: 'Qatari riyal' },
  { code: 'BHD', name: 'Bahraini dinar' },
  { code: 'OMR', name: 'Omani rial' },
  { code: 'JOD', name: 'Jordanian dinar' },
  { code: 'TRY', name: 'Turkish lira' },
  { code: 'CHF', name: 'Swiss franc' },
  { code: 'CAD', name: 'Canadian dollar' },
  { code: 'AUD', name: 'Australian dollar' },
  { code: 'JPY', name: 'Japanese yen' },
  { code: 'CNY', name: 'Chinese yuan' },
  { code: 'INR', name: 'Indian rupee' },
];

/**
 * Never returns undefined: a currency stored before it was removed from the
 * list, or typed straight into the database, still needs a label rather than a
 * blank row.
 */
export function currencyName(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.name ?? code;
}
