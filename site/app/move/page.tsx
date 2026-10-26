import type { Metadata } from 'next';
import Link from 'next/link';

import { pageMeta } from '@/lib/meta';

export const metadata: Metadata = pageMeta({
  title: 'Moving to Google Play',
  description:
    'How to move your records, receipts and settings from the GitHub version of Peace to the Google Play version: back up, install, restore.',
  path: '/move/',
  card: 'move',
});

/**
 * Sideload → Play. The two builds have different application ids ON PURPOSE
 * (see AGENTS.md › Build flavors), so Play installs BESIDE the GitHub copy
 * rather than over it, and the only bridge between them is a backup file.
 * Every label quoted below is the app's own — if one changes in
 * `src/app/export.tsx` or the setup welcome step, change it here too.
 */
const PLAY_URL = 'https://play.google.com/store/apps/details?id=dev.merope.peace';

/** Flip when the listing is public; until then the page says it is early. */
const ON_PLAY = false;

export default function MoveToPlay() {
  return (
    <div className="wrap">
      <article className="prose">
        <h1>Moving to Google Play</h1>
        {ON_PLAY ? null : (
          <p>
            <em>
              Peace is not on Google Play yet. This page is ready for the day it is — until then, the version from
              GitHub is the one to use.
            </em>
          </p>
        )}
        <p>
          If you installed Peace from GitHub, the Google Play version is a <strong>separate app</strong>, not an
          update. It installs beside the one you have, starts empty, and is called <strong>Peace</strong> where the
          GitHub one is <strong>Peace OSS</strong>. There is no account to sign in to, so your records move the same
          way they would to a new phone: in a backup file. It takes a couple of minutes.
        </p>

        <h2>1. Back up the GitHub version</h2>
        <ol>
          <li>
            In <strong>Peace OSS</strong>, open <em>Settings › Backup &amp; export</em>.
          </li>
          <li>
            Under <em>Backup file</em>, tap <strong>Save to device</strong> and pick a folder — Documents works.
            Android does not let apps use the Download folder itself, but a folder inside it is fine.
          </li>
          <li>Check that the screen says the file was saved, with a size above zero.</li>
        </ol>
        <p>
          The backup is one zip holding your records, accounts, categories, budgets, recurring payments, settings and
          receipt photos.
        </p>

        <h2>2. Install from Google Play</h2>
        <p>
          {ON_PLAY ? (
            <a href={PLAY_URL}>Install Peace from Google Play</a>
          ) : (
            'Install Peace from Google Play'
          )}
          . Leave Peace OSS where it is for now — both can be installed at once, and keeping the old one until you
          have checked the new one costs nothing.
        </p>

        <h2>3. Restore into the Play version</h2>
        <ol>
          <li>
            Open <strong>Peace</strong>. On the welcome screen, tap <strong>I have a backup to restore</strong>.
          </li>
          <li>
            Tap <strong>Choose a backup</strong> and pick the file from step 1.
          </li>
        </ol>
        <p>
          Already went through setup? The same button is in <em>Settings › Backup &amp; export</em>, under{' '}
          <em>Replace everything</em>. Whatever was in the app before is kept aside, and{' '}
          <strong>Undo last restore</strong> brings it back.
        </p>
        <p>
          If the Play version refuses the file as coming from a newer version of Peace, the GitHub build is ahead of
          the one on Play. Wait for the Play update and try again — nothing is lost in the meantime.
        </p>

        <h2>4. Switch the extras back on</h2>
        <p>
          A backup carries your data, never your secrets or Android’s permissions. These belong to the app they were
          given to, so the new one asks again:
        </p>
        <ul>
          <li>
            <strong>AI API keys</strong> — for reading receipts and bank messages, voice, and Penny. Paste each in{' '}
            <em>Settings › AI › Providers &amp; keys</em>. It is kept in Android’s encrypted storage and is never put in a backup.
          </li>
          <li>
            <strong>Google Drive backups</strong> — connect again in <em>Settings › Backup &amp; export</em>. If your
            Drive backups had a passphrase, enter the same one.
          </li>
          <li>
            <strong>Bank messages</strong> — Android grants notification access to one app at a time. Turn it on in{' '}
            <em>Settings › Bank messages</em> and allow <strong>Peace</strong> when Android asks.
          </li>
          <li>
            <strong>Daily reminder</strong> — if you used it, allow notifications when the new app asks.
          </li>
        </ul>

        <h2>5. Remove Peace OSS</h2>
        <p>
          Once the records, balances and receipts look right in the Play version, uninstall <strong>Peace OSS</strong>.
          Uninstalling deletes everything it held on the phone, so check first — and keep the backup file from step 1
          until you are sure.
        </p>
        <p>
          Two copies left installed do not share anything: a record added to one never appears in the other. Keep
          one.
        </p>

        <h2>Staying on GitHub instead</h2>
        <p>
          That is fine too. The GitHub version is the same app, built from the same code, and it checks for updates
          itself. The only differences: Play delivers updates for you, and Android’s Play Protect does not get in the
          way of installing them. See <Link href="/data/">Your data</Link> for exactly what each version can send.
        </p>
      </article>
    </div>
  );
}
