import {
  backupDue,
  backupName,
  describeAge,
  DEFAULT_KEEP,
  prunable,
  type BackupState,
} from './drive-backup';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = 1_800_000_000_000;

const state = (over: Partial<BackupState> = {}): BackupState => ({
  lastBackupAt: T0,
  cadence: 'daily',
  ...over,
});

describe('deciding whether a backup is owed', () => {
  it('is not due before the interval has passed', () => {
    expect(backupDue(state(), T0 + 23 * HOUR)).toBe(false);
  });

  it('is due once it has', () => {
    expect(backupDue(state(), T0 + DAY)).toBe(true);
  });

  it('respects the cadence', () => {
    expect(backupDue(state({ cadence: 'weekly' }), T0 + 6 * DAY)).toBe(false);
    expect(backupDue(state({ cadence: 'weekly' }), T0 + 7 * DAY)).toBe(true);
    expect(backupDue(state({ cadence: 'monthly' }), T0 + 29 * DAY)).toBe(false);
    expect(backupDue(state({ cadence: 'monthly' }), T0 + 30 * DAY)).toBe(true);
  });

  it('is due when there has never been a backup', () => {
    expect(backupDue(state({ lastBackupAt: null }), T0)).toBe(true);
  });

  /**
   * The one that matters. "Never backed up" reads as maximally overdue, so a
   * naive due-check would upload the ledger of someone who had switched the
   * whole feature off — the opposite of what the setting says.
   */
  it('is NEVER due when the cadence is off, including on a fresh install', () => {
    expect(backupDue(state({ cadence: 'off', lastBackupAt: null }), T0)).toBe(false);
    expect(backupDue(state({ cadence: 'off' }), T0 + 365 * DAY)).toBe(false);
  });

  it('does not stay stuck when the clock moves backwards', () => {
    // A timezone change or a manually set clock leaves lastBackupAt in the
    // future. Subtracting gives a negative age, which is never >= the interval,
    // so backups would stop forever and nothing would say why.
    expect(backupDue(state({ lastBackupAt: T0 + DAY }), T0)).toBe(true);
  });
});

describe('naming a backup', () => {
  it('distinguishes two backups taken on the same day', () => {
    const morning = backupName(new Date(2026, 7, 12, 9, 5), false);
    const evening = backupName(new Date(2026, 7, 12, 21, 30), false);
    expect(morning).toBe('peace-2026-08-12-0905.zip');
    expect(evening).toBe('peace-2026-08-12-2130.zip');
    expect(morning).not.toBe(evening);
  });

  it('marks a sealed backup for a human reading the list', () => {
    expect(backupName(new Date(2026, 7, 12, 9, 5), true)).toBe('peace-2026-08-12-0905.zip.enc');
  });
});

describe('pruning old backups', () => {
  const files = Array.from({ length: 8 }, (_, i) => ({ id: `f${i}` }));

  it('keeps the newest and returns the rest', () => {
    // Drive returns newest first, so the tail is the oldest.
    expect(prunable(files, 3).map((f) => f.id)).toEqual(['f3', 'f4', 'f5', 'f6', 'f7']);
  });

  it('deletes nothing when there are fewer than the keep count', () => {
    expect(prunable(files.slice(0, 2), DEFAULT_KEEP)).toEqual([]);
  });

  /**
   * A misconfigured keep count must not be able to empty the folder — that
   * turns a retention policy into a delete button.
   */
  it('never prunes the newest backup, whatever the keep count', () => {
    expect(prunable(files, 0).map((f) => f.id)).not.toContain('f0');
    expect(prunable(files, -5).map((f) => f.id)).not.toContain('f0');
  });
});

describe('describing how fresh the backup is', () => {
  it.each([
    [null, 'Never backed up'],
    [T0, 'Backed up just now'],
    [T0 - 60_000, 'Backed up 1 minute ago'],
    [T0 - 5 * 60_000, 'Backed up 5 minutes ago'],
    [T0 - HOUR, 'Backed up 1 hour ago'],
    [T0 - 3 * HOUR, 'Backed up 3 hours ago'],
    [T0 - DAY, 'Backed up 1 day ago'],
    [T0 - 9 * DAY, 'Backed up 9 days ago'],
  ])('%s reads as %s', (at, expected) => {
    expect(describeAge(at, T0)).toBe(expected);
  });

  it('does not say "-1 minutes ago" when the clock has drifted', () => {
    expect(describeAge(T0 + 5 * 60_000, T0)).toBe('Backed up just now');
  });
});
