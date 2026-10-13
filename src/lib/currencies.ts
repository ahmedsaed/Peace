/**
 * Currencies offered in the pickers.
 *
 * A curated list, not all 180 ISO 4217 codes. Scrolling past Malagasy ariary to
 * reach US dollar is worse than not being able to pick it at all — and the ones
 * that matter here are the home currency and whatever the card gets billed in.
 * Sorted by name, because that is what a person scans for; the sheet opens on
 * the current choice, so the usual one is never a scroll away.
 *
 * The home currency is DETECTED from the phone's region on first launch
 * (`lib/first-run.ts`), so a region whose currency is missing here still gets
 * the right one — setup offers it alongside this list.
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
  { code: 'DZD', name: 'Algerian dinar' },
  { code: 'ARS', name: 'Argentine peso' },
  { code: 'AUD', name: 'Australian dollar' },
  { code: 'BHD', name: 'Bahraini dinar' },
  { code: 'BDT', name: 'Bangladeshi taka' },
  { code: 'BRL', name: 'Brazilian real' },
  { code: 'CAD', name: 'Canadian dollar' },
  { code: 'CLP', name: 'Chilean peso' },
  { code: 'CNY', name: 'Chinese yuan' },
  { code: 'COP', name: 'Colombian peso' },
  { code: 'CZK', name: 'Czech koruna' },
  { code: 'DKK', name: 'Danish krone' },
  { code: 'EGP', name: 'Egyptian pound' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GHS', name: 'Ghanaian cedi' },
  { code: 'HKD', name: 'Hong Kong dollar' },
  { code: 'HUF', name: 'Hungarian forint' },
  { code: 'INR', name: 'Indian rupee' },
  { code: 'IDR', name: 'Indonesian rupiah' },
  { code: 'IQD', name: 'Iraqi dinar' },
  { code: 'ILS', name: 'Israeli new shekel' },
  { code: 'JPY', name: 'Japanese yen' },
  { code: 'JOD', name: 'Jordanian dinar' },
  { code: 'KES', name: 'Kenyan shilling' },
  { code: 'KWD', name: 'Kuwaiti dinar' },
  { code: 'LBP', name: 'Lebanese pound' },
  { code: 'MYR', name: 'Malaysian ringgit' },
  { code: 'MXN', name: 'Mexican peso' },
  { code: 'MAD', name: 'Moroccan dirham' },
  { code: 'TWD', name: 'New Taiwan dollar' },
  { code: 'NZD', name: 'New Zealand dollar' },
  { code: 'NGN', name: 'Nigerian naira' },
  { code: 'NOK', name: 'Norwegian krone' },
  { code: 'OMR', name: 'Omani rial' },
  { code: 'PKR', name: 'Pakistani rupee' },
  { code: 'PHP', name: 'Philippine peso' },
  { code: 'PLN', name: 'Polish złoty' },
  { code: 'GBP', name: 'Pound sterling' },
  { code: 'QAR', name: 'Qatari riyal' },
  { code: 'RON', name: 'Romanian leu' },
  { code: 'SAR', name: 'Saudi riyal' },
  { code: 'SGD', name: 'Singapore dollar' },
  { code: 'ZAR', name: 'South African rand' },
  { code: 'KRW', name: 'South Korean won' },
  { code: 'SEK', name: 'Swedish krona' },
  { code: 'CHF', name: 'Swiss franc' },
  { code: 'THB', name: 'Thai baht' },
  { code: 'TND', name: 'Tunisian dinar' },
  { code: 'TRY', name: 'Turkish lira' },
  { code: 'AED', name: 'UAE dirham' },
  { code: 'UAH', name: 'Ukrainian hryvnia' },
  { code: 'USD', name: 'US dollar' },
  { code: 'VND', name: 'Vietnamese đồng' },
];

/**
 * Never returns undefined: a currency stored before it was removed from the
 * list, or typed straight into the database, still needs a label rather than a
 * blank row.
 */
export function currencyName(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.name ?? code;
}
