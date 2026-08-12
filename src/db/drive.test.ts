/**
 * The ORDER of a backup, which is where the destructive mistakes live.
 *
 * Each piece is tested where it is defined; what this file guards is the
 * sequence — specifically that nothing is deleted until something has
 * successfully landed.
 */

jest.mock('./backup', () => ({
  databaseBackup: jest.fn(),
}));
jest.mock('./client', () => ({
  sqliteDb: { execSync: jest.fn() },
  db: {},
  DATABASE_NAME: 'peace.db',
}));
jest.mock('../lib/drive-api', () => {
  const actual = jest.requireActual('../lib/drive-api');
  return {
    ...actual,
    uploadBackup: jest.fn(),
    listBackups: jest.fn(async () => []),
    deleteBackup: jest.fn(async () => undefined),
    downloadBackup: jest.fn(),
  };
});
jest.mock('../lib/google-auth', () => ({
  // The token lifecycle is tested in google-auth.test.ts; here it is a pipe.
  withDriveToken: jest.fn(async (call: (t: string) => unknown) => call('token')),
}));
jest.mock('../lib/secrets', () => ({ getPassphrase: jest.fn(async () => null) }));

/* eslint-disable import/first */
import { databaseBackup } from './backup';
import { deleteBackup, listBackups, uploadBackup } from '../lib/drive-api';
import { getPassphrase } from '../lib/secrets';
import { isSealed } from '../lib/seal';
import { runBackup } from './drive';
/* eslint-enable import/first */

const mocked = {
  databaseBackup: databaseBackup as jest.Mock,
  uploadBackup: uploadBackup as jest.Mock,
  listBackups: listBackups as jest.Mock,
  deleteBackup: deleteBackup as jest.Mock,
  getPassphrase: getPassphrase as jest.Mock,
};

/** A SQLite-looking payload, since `seal` refuses anything else on the way back. */
const LEDGER = new Uint8Array([...'SQLite format 3 ledger'].map((c) => c.charCodeAt(0)));

function stageFile(bytes = LEDGER) {
  const file = {
    exists: true,
    bytes: jest.fn(async () => bytes),
    delete: jest.fn(function (this: { exists: boolean }) {
      file.exists = false;
    }),
  };
  mocked.databaseBackup.mockResolvedValue({ file, bytes: bytes.byteLength });
  return file;
}

const driveFiles = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `f${i}`,
    name: `peace-${i}.db`,
    size: 100,
    createdTime: `t${i}`,
  }));

beforeEach(() => {
  jest.clearAllMocks();
  mocked.getPassphrase.mockResolvedValue(null);
  mocked.listBackups.mockResolvedValue([]);
  mocked.uploadBackup.mockResolvedValue({ id: 'new', name: 'n', size: 1, createdTime: 't' });
});

describe('taking a backup', () => {
  it('uploads the checkpointed copy and reports what it did', async () => {
    stageFile();
    const outcome = await runBackup(new Date(2026, 7, 12, 9, 5));

    expect(mocked.uploadBackup).toHaveBeenCalledTimes(1);
    const [, name, payload] = mocked.uploadBackup.mock.calls[0];
    expect(name).toBe('peace-2026-08-12-0905.db');
    expect(Array.from(payload as Uint8Array)).toEqual(Array.from(LEDGER));
    expect(outcome.sealed).toBe(false);
    expect(outcome.bytes).toBe(LEDGER.byteLength);
  });

  it('seals when a passphrase is set, and says so in the name', async () => {
    stageFile();
    mocked.getPassphrase.mockResolvedValue('a good long passphrase');

    const outcome = await runBackup(new Date(2026, 7, 12, 9, 5));

    const [, name, payload] = mocked.uploadBackup.mock.calls[0];
    expect(name).toBe('peace-2026-08-12-0905.db.enc');
    expect(outcome.sealed).toBe(true);
    // What leaves the device is NOT the ledger.
    expect(isSealed(payload as Uint8Array)).toBe(true);
    expect(Array.from(payload as Uint8Array)).not.toEqual(Array.from(LEDGER));
  });

  it('uploads the plain database when no passphrase is set', async () => {
    stageFile();
    const [, , payload] = (await runBackup(), mocked.uploadBackup.mock.calls[0]);
    expect(isSealed(payload as Uint8Array)).toBe(false);
  });
});

/**
 * THE RULE THIS FILE EXISTS FOR. Pruning before uploading means a failed upload
 * leaves the user with FEWER backups than they started with — the system
 * destroying its own safety margin at the exact moment it is failing.
 */
describe('pruning old backups', () => {
  it('deletes nothing until the upload has succeeded', async () => {
    stageFile();
    mocked.listBackups.mockResolvedValue(driveFiles(8));

    const order: string[] = [];
    mocked.uploadBackup.mockImplementation(async () => {
      order.push('upload');
      return { id: 'new', name: 'n', size: 1, createdTime: 't' };
    });
    mocked.deleteBackup.mockImplementation(async () => {
      order.push('delete');
    });

    await runBackup();

    expect(order[0]).toBe('upload');
    expect(order.slice(1).every((step) => step === 'delete')).toBe(true);
  });

  it('deletes NOTHING when the upload fails', async () => {
    stageFile();
    mocked.listBackups.mockResolvedValue(driveFiles(8));
    mocked.uploadBackup.mockRejectedValue(new Error('drive is full'));

    await expect(runBackup()).rejects.toThrow(/drive is full/);
    expect(mocked.deleteBackup).not.toHaveBeenCalled();
  });

  it('keeps the newest five and reports how many went', async () => {
    stageFile();
    mocked.listBackups.mockResolvedValue(driveFiles(8));

    const outcome = await runBackup();

    expect(outcome.pruned).toBe(3);
    expect(mocked.deleteBackup.mock.calls.map((c) => c[1])).toEqual(['f5', 'f6', 'f7']);
  });

  it('deletes nothing when there are fewer than the keep count', async () => {
    stageFile();
    mocked.listBackups.mockResolvedValue(driveFiles(2));

    expect((await runBackup()).pruned).toBe(0);
    expect(mocked.deleteBackup).not.toHaveBeenCalled();
  });
});

describe('the staging copy', () => {
  it('is deleted after a successful backup', async () => {
    const file = stageFile();
    await runBackup();
    expect(file.delete).toHaveBeenCalled();
  });

  /**
   * A whole second copy of the ledger lives in the cache during a backup.
   * Leaking it on the failure path is how an app quietly doubles its footprint
   * on exactly the phones where backups keep failing.
   */
  it('is deleted even when the upload throws', async () => {
    const file = stageFile();
    mocked.uploadBackup.mockRejectedValue(new Error('offline'));

    await expect(runBackup()).rejects.toThrow();
    expect(file.delete).toHaveBeenCalled();
  });
});
