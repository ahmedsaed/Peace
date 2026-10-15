import appJson from '../../app.json';
import { compareVersions, notesSince, recentNotes, WHATS_NEW, type WhatsNewEntry } from './whats-new';

const entries: WhatsNewEntry[] = [
  { version: '1.2.0', notes: ['two'] },
  { version: '1.10.0', notes: ['ten'] },
  { version: '1.3.1', notes: ['three-one'] },
];

describe('compareVersions', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.0', '1.2.1')).toBeLessThan(0);
  });
});

describe('notesSince', () => {
  it('lists everything after the last version seen, up to the running one, newest first', () => {
    expect(notesSince('1.2.0', '1.10.0', entries).map((e) => e.version)).toEqual([
      '1.10.0',
      '1.3.1',
    ]);
  });

  it('leaves out entries newer than the running build', () => {
    expect(notesSince('1.0.0', '1.3.1', entries).map((e) => e.version)).toEqual([
      '1.3.1',
      '1.2.0',
    ]);
  });

  it('shows nothing once the running version has been seen', () => {
    expect(notesSince('1.10.0', '1.10.0', entries)).toEqual([]);
  });

  it('shows nothing to a build older than the one that was seen', () => {
    expect(notesSince('1.10.0', '1.3.1', entries)).toEqual([]);
  });

  // An install from before the sheet existed has no row: one release, not its history.
  it('gives an install that never recorded a version only the running release', () => {
    expect(notesSince('', '1.10.0', entries).map((e) => e.version)).toEqual(['1.10.0']);
  });

  it('shows nothing for a release with no entry', () => {
    expect(notesSince('', '1.10.1', entries)).toEqual([]);
    expect(notesSince('1.10.0', '1.10.1', entries)).toEqual([]);
  });
});

describe('recentNotes', () => {
  it('takes the newest entries up to the running version', () => {
    expect(recentNotes('1.3.1', 1, entries).map((e) => e.version)).toEqual(['1.3.1']);
  });
});

// The file is also read by the Play upload and the GitHub release (jq), so its
// shape is a contract with two workflows, not just with this module.
describe('the release notes file', () => {
  it('is well formed, newest first, with no duplicate versions', () => {
    const versions = WHATS_NEW.map((e) => e.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (const e of WHATS_NEW) {
      expect(e.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(e.notes.length).toBeGreaterThan(0);
      for (const note of e.notes) expect(note.trim()).not.toBe('');
    }
    expect([...versions].sort((a, b) => compareVersions(b, a))).toEqual(versions);
  });

  it('never runs ahead of app.json', () => {
    expect(compareVersions(WHATS_NEW[0].version, appJson.expo.version)).toBeLessThanOrEqual(0);
  });

  // Play rejects release notes over 500 characters, and it does so at the
  // END of an upload that has already burned its versionCode.
  it('keeps each release within what Play accepts', () => {
    for (const e of WHATS_NEW) {
      expect(e.notes.map((n) => `• ${n}`).join('\n').length).toBeLessThanOrEqual(500);
    }
  });
});
