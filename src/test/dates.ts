/**
 * Dates for ledger fixtures.
 *
 * LOCAL noon, never midnight and never UTC: a record at 00:00 sits one
 * timezone offset away from the previous day, and a fixture that lands on the
 * wrong side of a month boundary under some `TZ` passes on one machine and
 * fails on the next. Noon is as far from either edge as a day allows.
 */

/** Local noon on a calendar date. `month` is 1-based, as people write it. */
export const localNoon = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day, 12, 0);

/** Local noon on a day of August 2026 — the month most repository fixtures live in. */
export const augustNoon = (day: number) => localNoon(2026, 8, day);
