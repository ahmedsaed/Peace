import { formatCommit, formatVersion } from './version';

describe('formatVersion', () => {
  it('always shows the build number, because the semver alone cannot identify a build', () => {
    expect(formatVersion({ version: '1.0.0', buildNumber: 25 })).toBe('1.0.0 (build 25)');
  });

  it('survives the fallback build number from a checkout with no git history', () => {
    expect(formatVersion({ version: '1.0.0', buildNumber: 0 })).toBe('1.0.0 (build 0)');
  });
});

describe('formatCommit', () => {
  it('shows the short sha', () => {
    expect(formatCommit({ gitSha: 'f7014d7', dirty: false })).toBe('f7014d7');
  });

  // A dirty build is not reproducible from its sha. Showing the sha unqualified
  // is how you end up debugging code that was never in the APK.
  it('marks a build made from a dirty tree', () => {
    expect(formatCommit({ gitSha: 'f7014d7', dirty: true })).toBe('f7014d7-dirty');
  });
});
