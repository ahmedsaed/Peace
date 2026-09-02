/**
 * What the records screen is made of, and in what order.
 *
 * Pure and generic over the row type, so the ORDER is a rule with a test rather
 * than the shape of an array literal buried in a 500-line component — which is
 * how it came to be wrong: "Upcoming" sat last for a reason that made sense in
 * isolation and nothing anywhere recorded the decision or could contradict it.
 */

export type Section<T> = {
  key: string;
  title: string;
  /**
   * What this section did to your position, or null when the question does not
   * apply. Null for all three of the bands above the ledger: none of them has
   * happened, and a figure there would read as money already spent.
   */
  total: number | null;
  unvalued: number;
  data: T[];
};

/**
 * THE ORDER, in one place.
 *
 * Three bands of "not yet real" first — owed now, owed later, and a bank
 * message waiting to be agreed to — and the ledger underneath them. They are
 * the same kind of thing: something the app believes about the month that is
 * not a record yet, and the only things on this screen waiting on a decision.
 *
 * Upcoming used to come LAST, after every day of the month, on the reasoning
 * that it has not happened and would otherwise read as the newest thing in the
 * list. The heading answers that; being last cost more. A standing order for
 * the 28th was a month of scrolling away, so the one section that exists to be
 * acted on was the only one you had to go looking for.
 *
 * Empty bands are omitted rather than rendered empty: a heading with nothing
 * under it says the app is waiting on you when it is not.
 */
export function recordSections<T>({
  due,
  captures,
  upcoming,
  days,
}: {
  due: T[];
  captures: T[];
  upcoming: T[];
  days: Section<T>[];
}): Section<T>[] {
  const band = (key: string, title: string, data: T[]): Section<T>[] =>
    data.length > 0 ? [{ key, title, total: null, unvalued: 0, data }] : [];

  return [
    // Counted in the heading, because "how many are waiting" is the whole
    // reason to look — and singular reads badly with a number beside it.
    ...band('due', due.length === 1 ? 'Due' : `Due · ${due.length}`, due),
    ...band(
      'bank',
      captures.length === 1 ? 'From your bank' : `From your bank · ${captures.length}`,
      captures
    ),
    // Not counted: these are not waiting on you today, so a number would be
    // urgency the section does not have.
    ...band('upcoming', 'Upcoming', upcoming),
    ...days,
  ];
}
