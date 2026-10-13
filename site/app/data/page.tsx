import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Your data',
  description:
    'Everything Peace can send off your phone, when, and to whom — and everything it keeps on the phone instead.',
};

/**
 * The plain-language version of the Play Store's Data safety section. Every row
 * here is also in the privacy policy; if a feature changes what it sends, both
 * change in the same PR (see content/README.md).
 */
const CONNECTIONS = [
  {
    to: 'Google Gemini',
    host: 'generativelanguage.googleapis.com',
    what: 'A receipt photo you ask to have read; the text of a bank message from a sender you listed; a question to Penny, with the parts of your ledger it looks up to answer.',
    when: 'Only after you add your own Gemini API key. Penny has its own switch on top of that.',
  },
  {
    to: 'Your Google Drive',
    host: 'googleapis.com/drive',
    what: 'A backup of your ledger and receipt photos, into a private app folder only Peace can read — encrypted first if you set a passphrase.',
    when: 'Only after you connect Drive in Settings.',
  },
  {
    to: 'Frankfurter',
    host: 'api.frankfurter.dev',
    what: 'Two currency codes, to fetch one exchange rate.',
    when: 'Only when you tap to fetch a rate for a foreign-currency record.',
  },
  {
    to: 'GitHub',
    host: 'api.github.com',
    what: 'Nothing about you — a check for a newer version.',
    when: 'Only in the version downloaded from GitHub. The Play Store version is updated by Play.',
  },
];

export default function YourData() {
  return (
    <div className="wrap">
      <article className="prose">
        <h1>Your data</h1>
        <p>
          Peace keeps your records <strong>on your phone</strong>. There is no Peace account and no Peace server,
          so we hold nothing about you — not your spending, not your email, not a device ID. The app contains no
          analytics, advertising or crash-reporting code, and neither does this website.
        </p>

        <h2>What can leave your phone</h2>
        <p>
          Four connections exist, and <span className="off">all four are off</span> until you do something to start
          them.
        </p>
      </article>

      <div className="table-scroll" style={{ maxWidth: '64em' }}>
        <table>
          <thead>
            <tr>
              <th>Goes to</th>
              <th>What is sent</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {CONNECTIONS.map((c) => (
              <tr key={c.to}>
                <td>
                  <strong>{c.to}</strong>
                  <br />
                  <code>{c.host}</code>
                </td>
                <td>{c.what}</td>
                <td>{c.when}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <article className="prose">
        <h2>What stays on your phone</h2>
        <ul>
          <li>Every record, account, category, tag, budget and recurring payment.</li>
          <li>Receipt photos and invoices you attach.</li>
          <li>
            Your Gemini API key and backup passphrase, in Android’s encrypted storage — and never inside a
            backup, so a backup you share does not carry them.
          </li>
          <li>
            Bank messages from senders you did not list. Peace discards them on the phone; they are never sent
            anywhere.
          </li>
        </ul>

        <h2>What Peace asks Android for</h2>
        <ul>
          <li>
            <strong>Camera</strong> — to photograph a receipt, only when you tap the camera button.
          </li>
          <li>
            <strong>Notifications</strong> — for the optional daily reminder, scheduled on the phone. No push
            service is involved.
          </li>
          <li>
            <strong>Notification access</strong> — for the optional bank-message reading. You grant it in Android’s
            settings and can withdraw it there at any time.
          </li>
          <li>
            <strong>Internet</strong> — for the four connections above.
          </li>
        </ul>
        <p>No microphone, no contacts, no location, no SMS inbox, no storage access.</p>

        <h2>Deleting your data</h2>
        <ul>
          <li>Uninstalling Peace, or clearing its storage, deletes everything on the phone.</li>
          <li>
            Drive backups are deleted from Google Drive: <em>Settings › Manage apps › Peace › Delete hidden app
            data</em>.
          </li>
          <li>
            We hold nothing on our side, so there is nothing for us to delete — and no account to close.
          </li>
          <li>Before you go, Settings › Export gives you everything as CSV or as a full backup.</li>
        </ul>

        <p>
          The full detail is in the <Link href="/privacy/">privacy policy</Link>, and the app is free software — every
          line of the above can be checked in <a href="https://github.com/ahmedsaed/Peace">the source</a>.
        </p>
      </article>
    </div>
  );
}
