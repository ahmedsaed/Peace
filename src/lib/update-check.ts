/**
 * Whether a newer build exists on the Releases page.
 *
 * NOT LOAD-BEARING, in the same sense as the rate fetch: a dead network, a
 * rate limit or a GitHub outage leaves the app exactly as it was. There is no
 * error state and no spinner, because nothing here is worth interrupting an
 * expense tracker for — it either has something quiet to say or it says
 * nothing.
 *
 * The comparison is pure and lives here so the awkward cases can be tested
 * without a network: the semver repeats across releases, and the installed
 * build is routinely AHEAD of the latest one.
 */

/** What the Releases page offers, once read. */
export type Release = {
  /** The full version, for display: `1.2.0`. */
  version: string;
  /** The build number, which is what actually orders two releases. */
  buildNumber: number;
  /** Where to send someone who wants it. */
  url: string;
};

export class UpdateCheckError extends Error {}

/**
 * The build number out of a release tag.
 *
 * The tag is `v1.2.0+build.117` because THE SEMVER ALONE REPEATS: `1.0.0` has
 * been released five separate times, and two releases a week apart routinely
 * share one. The build number is `git rev-list --count HEAD`, so it is the
 * only field that orders two builds.
 *
 * The asset filename carries the same number a second time. Reading the tag
 * rather than the filename keeps one encoding authoritative — and the asset
 * name is a place a signing-secret substitution has already gone wrong once.
 */
export function parseReleaseTag(tag: string): { version: string; buildNumber: number } | null {
  const match = /^v?(\d+\.\d+\.\d+)\+build\.(\d+)$/.exec(tag.trim());
  if (!match) return null;
  return { version: match[1], buildNumber: Number(match[2]) };
}

/**
 * Is the release worth telling anyone about?
 *
 * STRICTLY NEWER, and that is the whole rule. Peace is installed from PR builds
 * as often as from releases, so the installed build is frequently AHEAD of the
 * newest release — build 121 against release 117 was the state of this app for
 * a week. "Different means update" would have nagged, constantly, to install a
 * DOWNGRADE.
 *
 * A build number of zero means the app is not reporting one: a dev build, where
 * `Constants.expoConfig` reflects whatever the dev server last evaluated. It
 * would otherwise claim an update forever.
 */
export function updateAvailable(installed: number, release: Release | null): boolean {
  if (!release || installed <= 0) return false;
  return release.buildNumber > installed;
}

/** Read the newest release, or throw. The caller decides that throwing is fine. */
export async function fetchLatestRelease(options: {
  repo: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<Release> {
  const { repo, timeoutMs = 8_000, fetchImpl = fetch } = options;

  const controller = new AbortController();
  // Without a timeout a captive portal leaves this pending forever, holding a
  // fetch open for a feature nobody is waiting on.
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      // 403 is the rate limit, 404 is a repo with no releases yet. Neither is
      // worth a different behaviour: say nothing, try again tomorrow.
      throw new UpdateCheckError(`GitHub answered ${response.status}`);
    }

    const body = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
    const tag = typeof body.tag_name === 'string' ? parseReleaseTag(body.tag_name) : null;
    if (!tag) throw new UpdateCheckError('The newest release has no build number in its tag.');

    return {
      ...tag,
      url:
        typeof body.html_url === 'string'
          ? body.html_url
          : `https://github.com/${repo}/releases/latest`,
    };
  } finally {
    clearTimeout(timer);
  }
}
