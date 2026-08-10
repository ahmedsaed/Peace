/**
 * How this build identifies itself.
 *
 * Pure formatting so it can be tested — the values themselves come from
 * app.config.js at bundle time and are not knowable here.
 */
export type BuildInfo = {
  version: string;
  buildNumber: number;
  gitSha: string;
  dirty: boolean;
};

/**
 * The one-line form: `1.0.0 (build 25)`.
 *
 * The build number is what actually distinguishes two APKs — the semver only
 * changes when a human decides it should, so two builds a week apart routinely
 * share one. Showing the version alone would make "which build is this?"
 * unanswerable, which is the whole reason this exists.
 */
export function formatVersion({ version, buildNumber }: Pick<BuildInfo, 'version' | 'buildNumber'>) {
  return `${version} (build ${buildNumber})`;
}

/**
 * The commit this came from, marked when the tree it was built from had
 * uncommitted changes. A dirty build is not reproducible from its SHA, and
 * silently showing the SHA anyway is how you end up debugging the wrong code.
 */
export function formatCommit({ gitSha, dirty }: Pick<BuildInfo, 'gitSha' | 'dirty'>) {
  return dirty ? `${gitSha}-dirty` : gitSha;
}
