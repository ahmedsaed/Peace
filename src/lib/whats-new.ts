import ENTRIES from '@/constants/whats-new.json';

/**
 * Release notes, shown once after an update.
 *
 * ONE SOURCE: `constants/whats-new.json` is what this sheet lists, what the
 * Play upload sends as the release notes, and what heads the GitHub release —
 * so the app, the store and the releases page cannot say three different
 * things. A version with nothing worth telling a person has no entry, and then
 * no sheet appears.
 */
export type WhatsNewEntry = { version: string; notes: string[] };

export const WHATS_NEW: readonly WhatsNewEntry[] = ENTRIES;

/** Semver order on the numeric triple; anything unparseable sorts as 0.0.0. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  };
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * What to show on launch, newest first: every entry after the last version
 * seen, up to the one running.
 *
 * An EMPTY `seen` is an install from before this sheet existed — it never
 * recorded a version. Its whole history would be a wall of old news, so it
 * gets the running version's entry alone. A first launch records the running
 * version instead (`lib/first-run.ts`), so a new install sees nothing: setup
 * has just shown it everything. A `seen` AHEAD of the running build (a
 * downgrade, or a backup from a newer one) shows nothing.
 */
export function notesSince(
  seen: string,
  current: string,
  entries: readonly WhatsNewEntry[] = WHATS_NEW
): WhatsNewEntry[] {
  const shown = entries.filter((e) =>
    seen === ''
      ? compareVersions(e.version, current) === 0
      : compareVersions(e.version, seen) > 0 && compareVersions(e.version, current) <= 0
  );
  return newestFirst(shown);
}

/** The most recent entries up to the running version, for About. */
export function recentNotes(
  current: string,
  count = 5,
  entries: readonly WhatsNewEntry[] = WHATS_NEW
): WhatsNewEntry[] {
  return newestFirst(entries.filter((e) => compareVersions(e.version, current) <= 0)).slice(0, count);
}

function newestFirst(entries: WhatsNewEntry[]): WhatsNewEntry[] {
  return [...entries].sort((a, b) => compareVersions(b.version, a.version));
}
