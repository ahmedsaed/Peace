/**
 * @jest-environment node
 *
 * The two things this gets wrong if nobody writes them down: the semver does
 * not order releases, and the installed build is often AHEAD of the newest one.
 */

import {
  describeUpdate,
  fetchLatestRelease,
  parseReleaseTag,
  updateAvailable,
  UpdateCheckError,
  type Release,
} from './update-check';

const release = (buildNumber: number): Release => ({
  version: '1.2.0',
  buildNumber,
  url: 'https://example.invalid/r',
});

describe('reading a release tag', () => {
  it('takes the build number out of the tag', () => {
    expect(parseReleaseTag('v1.2.0+build.117')).toEqual({ version: '1.2.0', buildNumber: 117 });
    expect(parseReleaseTag('1.2.0+build.9')).toEqual({ version: '1.2.0', buildNumber: 9 });
  });

  it('refuses a tag with no build number in it', () => {
    for (const tag of ['v1.2.0', 'build.117', 'v1.2+build.1', 'nightly', '']) {
      expect(parseReleaseTag(tag)).toBeNull();
    }
  });
});

describe('whether to say anything', () => {
  /**
   * THE BUG THIS RULE EXISTS FOR.
   *
   * Peace is installed from PR builds as often as from releases, so the
   * installed build is frequently ahead of the newest release — 121 against
   * release 117 was true of this app for a week. "Different means update" would
   * have nagged constantly to install a DOWNGRADE.
   */
  it('says nothing when the installed build is ahead', () => {
    expect(updateAvailable(121, release(117))).toBe(false);
  });

  it('says nothing when they match', () => {
    expect(updateAvailable(117, release(117))).toBe(false);
  });

  it('speaks up only for a strictly newer build', () => {
    expect(updateAvailable(117, release(118))).toBe(true);
  });

  /**
   * A dev build reports whatever the dev server last evaluated, which can be no
   * build number at all — and would otherwise claim an update forever.
   */
  it('says nothing when the app does not know its own build', () => {
    expect(updateAvailable(0, release(999))).toBe(false);
  });

  it('says nothing when the check found nothing', () => {
    expect(updateAvailable(1, null)).toBe(false);
  });
});

describe('asking GitHub', () => {
  const ok = (body: unknown) =>
    jest.fn(async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response);

  it('reads the tag and the page to send someone to', async () => {
    const fetchImpl = ok({ tag_name: 'v1.2.0+build.117', html_url: 'https://example.invalid/rel' });

    await expect(fetchLatestRelease({ repo: 'a/b', fetchImpl })).resolves.toEqual({
      version: '1.2.0',
      buildNumber: 117,
      url: 'https://example.invalid/rel',
    });
  });

  /**
   * 403 is the rate limit and 404 is a repo with no releases yet. Neither
   * deserves its own behaviour — the caller's answer to all of it is to say
   * nothing and try again tomorrow.
   */
  it('throws on a refusal rather than inventing a release', async () => {
    const fetchImpl = jest.fn(
      async () => ({ ok: false, status: 403, json: async () => ({}) }) as unknown as Response
    );

    await expect(fetchLatestRelease({ repo: 'a/b', fetchImpl })).rejects.toBeInstanceOf(
      UpdateCheckError
    );
  });

  it('throws on a release whose tag carries no build number', async () => {
    const fetchImpl = ok({ tag_name: 'nightly' });

    await expect(fetchLatestRelease({ repo: 'a/b', fetchImpl })).rejects.toBeInstanceOf(
      UpdateCheckError
    );
  });

  /** A captive portal must not leave a fetch open for a feature nobody awaits. */
  it('gives up rather than hanging', async () => {
    const fetchImpl = jest.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        })
    ) as unknown as typeof fetch;

    await expect(
      fetchLatestRelease({ repo: 'a/b', fetchImpl, timeoutMs: 10 })
    ).rejects.toBeDefined();
  });
});

/**
 * The silence that read as a bug.
 *
 * The drawer says nothing when there is no newer build, which is right — and
 * indistinguishable from a check that never ran. Asked directly, every outcome
 * has to have a sentence, and "not newer" is TWO of them.
 */
describe('what to tell someone who asked', () => {
  const installed = { version: '1.10.0', buildNumber: 164 };

  it('names the release when there is a newer one', () => {
    expect(
      describeUpdate(installed, { version: '1.11.0', buildNumber: 170, url: 'x' })
    ).toBe('1.11.0 (build 170) is available.');
  });

  it('says so when the installed build IS the newest release', () => {
    expect(describeUpdate(installed, { version: '1.10.0', buildNumber: 164, url: 'x' })).toBe(
      'You are on the newest release.'
    );
  });

  it('says AHEAD rather than nothing, because that is the normal state here', () => {
    // PR builds are how this app reaches a phone, so the installed build is
    // routinely ahead of the newest release. Lumping this in with "up to date"
    // is what made the feature look broken to somebody who was simply ahead.
    expect(describeUpdate(installed, { version: '1.9.0', buildNumber: 162, url: 'x' })).toBe(
      'You are ahead of the newest release, 1.9.0 (build 162).'
    );
  });

  it('reports the installed build when nothing has been asked yet', () => {
    expect(describeUpdate(installed, null)).toBe('You have 1.10.0 (build 164).');
  });
});
