import type { Metadata } from 'next';
import Link from 'next/link';

import { pageMeta } from '@/lib/meta';

export const metadata: Metadata = pageMeta({
  title: 'Importing records',
  description:
    'Bring records into Peace from a CSV file: the columns Peace reads, what each one means, and a template to start from.',
  path: '/import/',
  card: 'import',
});

/**
 * The import format, for somebody laying out a spreadsheet on a computer.
 *
 * It is Peace's own CSV export — the reader is `src/lib/import-csv.ts`, and
 * every rule written here is one of its tests. Change one, change both.
 */
const COLUMNS: { name: string; required?: boolean; what: React.ReactNode }[] = [
  {
    name: 'date',
    required: true,
    what: (
      <>
        <code>YYYY-MM-DD</code>, like <code>2026-08-31</code>. No other order is accepted: 03/08/2026 is a real
        date in two different months, and guessing wrong is a mistake nobody would spot.
      </>
    ),
  },
  { name: 'time', what: <><code>HH:MM</code>, 24-hour. Leave it empty and the record is put at midday.</> },
  {
    name: 'type',
    required: true,
    what: (
      <>
        <code>expense</code>, <code>income</code>, <code>transfer</code> or <code>correction</code>. The type
        decides which side a record is on — not the sign of the amount.
      </>
    ),
  },
  {
    name: 'amount',
    required: true,
    what: (
      <>
        A plain number with a dot for decimals: <code>1234.50</code>. No thousands separators, no currency
        symbol, and no more decimals than the currency has. For an expense, income or transfer the sign is
        ignored — <code>50</code> and <code>-50</code> are the same lunch. For a correction the sign is the
        direction: <code>-12</code> takes twelve off the balance.
      </>
    ),
  },
  {
    name: 'currency',
    what: (
      <>
        A three-letter code like <code>EGP</code> or <code>USD</code>. Leave it empty to use the account’s own. It
        must match the account’s currency.
      </>
    ),
  },
  {
    name: 'account',
    required: true,
    what: 'The account the money moved in, by name. An account Peace does not have yet is created.',
  },
  {
    name: 'counter_account',
    what: 'For a transfer: where the money went. The money leaves account and arrives here.',
  },
  {
    name: 'category',
    what: 'By name, for an expense or income. Empty leaves the record uncategorised; a name Peace does not have is created.',
  },
  {
    name: 'parent_category',
    what: (
      <>
        To put <code>category</code> under another one — <code>Snacks</code> under <code>Food</code>. Needed only
        when two sub-categories share a name.
      </>
    ),
  },
  { name: 'note', what: 'Any text. Commas and line breaks are fine inside quotes, which spreadsheets add for you.' },
  { name: 'tags', what: <>Separated by semicolons: <code>Holiday 2026;work</code>.</> },
  {
    name: 'is_refund',
    what: (
      <>
        <code>1</code> on an expense that is money coming back — a return. It then counts against the category
        instead of as income.
      </>
    ),
  },
  {
    name: 'home_amount',
    what: (
      <>
        Required for a record in a currency other than your home one: what it was worth in your home currency on
        the day. Peace works out the rate from it.
      </>
    ),
  },
];

export default function ImportFormat() {
  return (
    <div className="wrap">
      <article className="prose">
        <h1>Importing records</h1>
        <p>
          Peace imports one CSV format, and it is <strong>the one Peace exports</strong>. A file from Settings ›
          Backup &amp; export › Spreadsheet comes back in untouched. A file from another app needs its columns renamed
          and arranged once, in any spreadsheet, to match the table below.
        </p>
        <p>
          <a href="/peace-import-template.csv" download>
            Download the template
          </a>{' '}
          — five example rows, one of each kind. The app can save the same template for you from Backup &amp; export.
        </p>

        <h2>Columns</h2>
        <p>
          The first row names the columns, in any order and any case. Only the four marked{' '}
          <strong>required</strong> must be there; leave out any of the others. Columns Peace does not know are
          ignored.
        </p>
      </article>

      <div className="table-scroll" style={{ maxWidth: '64em' }}>
        <table>
          <thead>
            <tr>
              <th>Column</th>
              <th>What goes in it</th>
            </tr>
          </thead>
          <tbody>
            {COLUMNS.map((c) => (
              <tr key={c.name}>
                <td>
                  <code>{c.name}</code>
                  {c.required ? (
                    <>
                      <br />
                      <strong>required</strong>
                    </>
                  ) : null}
                </td>
                <td>{c.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <article className="prose">
        <h2>Before anything is added</h2>
        <ul>
          <li>
            Peace shows how many records the file holds and over which dates, every account and category it would
            create, and every row it cannot import — <strong>by line number and reason</strong>, so you can fix it in
            the spreadsheet. The rest can be imported without it.
          </li>
          <li>
            Records already in Peace are skipped. A Peace export carries an <code>id</code> for each record, so
            importing the same file twice adds nothing the second time.
          </li>
          <li>
            Nothing is written until you tap Import, and the whole import can be undone afterwards — from the same
            screen, or later from Backup &amp; export.
          </li>
        </ul>

        <h2>Files from other apps</h2>
        <ul>
          <li>
            Spreadsheets in some languages save CSV with semicolons between columns. Peace reads those too — but the
            amounts must still use a dot for decimals.
          </li>
          <li>
            If your app writes expenses and income in separate columns, make one <code>amount</code> column and a{' '}
            <code>type</code> column beside it.
          </li>
          <li>
            A transfer is one row: <code>account</code> is where the money left, <code>counter_account</code> where it
            arrived. Moving between accounts in different currencies is not imported — record it in the app, where the
            rate is asked for.
          </li>
        </ul>

        <p>
          Importing happens on your phone; the file is not sent anywhere. See <Link href="/data/">Your data</Link>.
        </p>
      </article>
    </div>
  );
}
