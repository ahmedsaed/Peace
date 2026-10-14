import type { Metadata } from 'next';
import Link from 'next/link';

import { pageMeta } from '@/lib/meta';

export const metadata: Metadata = pageMeta({
  title: 'Deleting your data',
  description:
    'How to delete everything Peace: Expense Tracker has stored — on your phone, in your Google Drive, and with Google Gemini.',
  path: '/delete/',
  card: 'data',
});

/**
 * The page the Play Store's Data safety section links to as "request that
 * your data is deleted".
 *
 * Play's form assumes a server holding the data, and asks for a page that names
 * the app and its developer, gives the steps, and says what is deleted, what is
 * kept and for how long. Peace has no server, so every step here is one the
 * person takes themselves — which is the honest answer to the form, and better
 * than "No", which the listing would show as "data can't be deleted".
 * Keep it in step with privacy.md and /data/.
 */
export default function DeleteData() {
  return (
    <div className="wrap">
      <article className="prose">
        <h1>Deleting your data</h1>
        <p>
          This page is for <strong>Peace: Expense Tracker</strong>, made by <strong>Merope</strong>. Peace has no
          account and no server, so we hold nothing about you and there is nothing to send us a request for. Every
          copy of your data is somewhere you control, and you can delete each one yourself, right away.
        </p>

        <h2>1. On your phone</h2>
        <p>Your records, accounts, categories, receipt photos and settings live only on your phone.</p>
        <ul>
          <li>
            <strong>Uninstall Peace</strong>, or keep it and open Android’s <em>Settings › Apps › Peace › Storage ›
            Clear storage</em> (names vary slightly between phones).
          </li>
          <li>Either one deletes everything immediately. Nothing is kept anywhere else.</li>
        </ul>

        <h2>2. In your Google Drive (only if you turned on Drive backup)</h2>
        <p>Backups sit in a private app folder in your own Drive, which only Peace can read.</p>
        <ul>
          <li>
            Open <a href="https://drive.google.com/drive/settings">Google Drive settings</a> on a computer, go to{' '}
            <em>Manage apps</em>, find Peace, and choose <em>Delete hidden app data</em>.
          </li>
          <li>
            Every Peace backup in that Drive is deleted. Disconnecting Drive inside the app stops new backups but
            leaves existing ones in place, so the step above is the one that deletes them.
          </li>
        </ul>

        <h2>3. With Google Gemini (only if you added your own API key)</h2>
        <p>
          Receipt photos, bank messages and questions to Penny are sent straight from your phone to Google, using
          your own key. They never pass through us, so we cannot see or delete them.
        </p>
        <ul>
          <li>
            How long Google keeps them is set by Google’s{' '}
            <a href="https://ai.google.dev/gemini-api/terms">Gemini API terms</a> for your key, not by Peace.
          </li>
          <li>
            To stop anything further being sent, clear the key in Peace (<em>Settings › Gemini key</em>, saved blank), and delete it in{' '}
            <a href="https://aistudio.google.com/app/apikey">Google AI Studio</a>.
          </li>
        </ul>

        <h2>What is kept</h2>
        <p>
          Nothing, by us: there is no Peace server, no account to close, and no retention period, because nothing was
          ever collected on our side. Before deleting, <em>Settings › Backup &amp; export</em> in the app can save
          everything as a backup file or a spreadsheet, in case you want it back later.
        </p>

        <p>
          Questions: <a href="mailto:support@merope.dev">support@merope.dev</a>. The full detail is in the{' '}
          <Link href="/privacy/">privacy policy</Link> and on <Link href="/data/">Your data</Link>.
        </p>
      </article>
    </div>
  );
}
