const { execSync } = require('node:child_process');

/**
 * Dynamic layer over app.json.
 *
 * app.json stays the source of truth for everything static — Expo passes it in
 * as `config` — and this file only adds the three things that cannot be written
 * down by hand because they change with every build.
 *
 * VERSIONING SCHEME
 *
 *   version      semver, in app.json, bumped BY HAND when you decide a release
 *                is worth a new number. This is the only human decision.
 *   versionCode  the number of commits on the branch. Android requires a
 *                monotonically increasing integer to allow an in-place upgrade,
 *                and a commit count gives one for free: it is deterministic,
 *                reproducible from any checkout, and never needs a "bump
 *                version" commit that would itself change the number.
 *   gitSha       which commit this APK actually came from. The version alone
 *                cannot answer that, and "is the fix in the build I installed?"
 *                is the question you ask when something looks wrong.
 *
 * A SHALLOW CLONE BREAKS THE COUNT. `actions/checkout` defaults to
 * `fetch-depth: 1`, which makes `git rev-list --count HEAD` return 1 — so every
 * CI build would claim to be build 1 and Android would refuse the upgrade. The
 * workflows set `fetch-depth: 0` for this reason. PEACE_BUILD_NUMBER overrides
 * it if a build ever needs to be pinned by hand.
 */
function git(command, fallback) {
  try {
    return execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return fallback;
  }
}

const buildNumber = Number(
  process.env.PEACE_BUILD_NUMBER ?? git('git rev-list --count HEAD', '0')
);

/**
 * BUILD FLAVORS
 *
 * One codebase, two apps. `PEACE_FLAVOR` picks which one this build is:
 *
 *   oss   the open build: GitHub Releases, its own update check, bring your
 *         own Gemini key. The DEFAULT, so a fresh clone, CI and every local
 *         build are this one unless something asks otherwise.
 *   play  the Play Store build: Play delivers updates, so the self-updater is
 *         left out — Play policy forbids an app updating itself any other way.
 *
 * The two have DIFFERENT application ids on purpose. Android treats them as two
 * apps, so somebody trying a GitHub release keeps their Play install untouched
 * beside it; moving data between them is backup and restore. The launcher name
 * differs too, or two identical icons sit side by side.
 *
 * An unknown value throws rather than falling back: a typo in a release job
 * that silently built the wrong app would ship the wrong updater.
 */
const FLAVORS = {
  oss: { package: 'dev.merope.peace.oss', name: 'Peace OSS' },
  play: { package: 'dev.merope.peace', name: 'Peace' },
};
const flavor = process.env.PEACE_FLAVOR || 'oss';
if (!FLAVORS[flavor]) {
  throw new Error(`PEACE_FLAVOR must be one of ${Object.keys(FLAVORS).join(', ')}; got "${flavor}"`);
}

const gitSha = process.env.GITHUB_SHA?.slice(0, 7) ?? git('git rev-parse --short HEAD', 'unknown');

module.exports = ({ config }) => ({
  ...config,
  name: FLAVORS[flavor].name,
  android: {
    ...config.android,
    package: FLAVORS[flavor].package,
    versionCode: buildNumber,
  },
  extra: {
    ...config.extra,
    flavor,
    buildNumber,
    gitSha,
    // A working tree with uncommitted changes does not match its own SHA, so
    // say so rather than letting the About screen quietly lie about it.
    dirty: git('git status --porcelain', '') !== '',
  },
});
