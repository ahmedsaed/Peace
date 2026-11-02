import type { Metadata } from 'next';
import Link from 'next/link';

import { pageMeta } from '@/lib/meta';

export const metadata: Metadata = pageMeta({
  title: 'Join the beta',
  description:
    'Get Peace from Google Play before it is public: join the tester group, then become a tester and install. No emails.',
  path: '/beta/',
  card: 'beta',
});

/**
 * The closed test's tester list is this Google Group, so joining it is what
 * lets the opt-in link open — anyone who skips step 1 lands on a 404 from
 * Play. The group is open to join and only managers can post or see members,
 * which is what makes the two promises under step 1 true; change those group
 * settings and this page has to change with them.
 */
const GROUP_URL = 'https://groups.google.com/g/peace-testers';
const OPT_IN_URL = 'https://play.google.com/apps/testing/dev.merope.peace';
const PLAY_URL = 'https://play.google.com/store/apps/details?id=dev.merope.peace';

export default function JoinBeta() {
  return (
    <div className="wrap">
      <article className="prose">
        <h1>Join the beta</h1>
        <p>
          Peace is in a closed test on Google Play before it goes public. Testers get the Play version now, and Play
          keeps it updated from then on. It takes two steps, and both need the <strong>same Google account</strong>{' '}
          your phone uses for the Play Store.
        </p>

        <h2>1. Join the tester group</h2>
        <p className="ctas">
          <a className="button primary" href={GROUP_URL}>
            Join the tester group
          </a>
        </p>
        <p>
          Tap <strong>Join group</strong>. The group is only a list of who may test: you will not get emails from it,
          and other members cannot see your address.
        </p>

        <h2>2. Become a tester and install</h2>
        <p className="ctas">
          <a className="button primary" href={OPT_IN_URL}>
            Become a tester
          </a>
        </p>
        <p>
          Tap <strong>Become a tester</strong>, then{' '}
          <a href={PLAY_URL}>install Peace from Google Play</a>. If the link says the app is not available, step 1
          has not reached Play yet — wait a minute and open it again.
        </p>

        <h2>What helps most</h2>
        <p>
          Use Peace for your real spending for a couple of weeks — a few times a week is plenty — and say what
          annoyed you, confused you or did not work. Two ways to tell me:
        </p>
        <ul>
          <li>
            A review on Peace’s Play Store page. While Peace is in testing, reviews are private: only I can read
            them.
          </li>
          <li>
            Email <a href="mailto:support@merope.dev">support@merope.dev</a>.
          </li>
        </ul>

        <h2>Already using the GitHub version?</h2>
        <p>
          The Play version is a separate app called <strong>Peace</strong>, installed beside <strong>Peace OSS</strong>{' '}
          rather than over it. Your records move across in a backup file — see{' '}
          <Link href="/move/">Moving to Google Play</Link>.
        </p>

        <h2>Leaving</h2>
        <p>
          Open the <a href={OPT_IN_URL}>tester page</a> again and tap <strong>Leave the program</strong>, or leave
          the group. Uninstalling Peace deletes what it holds on the phone, so make a backup first if you want to
          keep your records.
        </p>
      </article>
    </div>
  );
}
