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
// The SQLite half of the check. Mocked here so the ORDER of the check can be
// tested on its own — which is the whole reason it was moved out of this file.
jest.mock('./inspect', () => ({
  inspectBackup: jest.fn(() => ({ records: 43, accounts: 3, categories: 37 })),
}));
jest.mock('./restore', () => ({
  restoreFrom: jest.fn(async () => ({ copied: { transactions: 43 }, safetyBytes: 1000 })),
  currentCounts: jest.fn(() => ({ transactions: 0, accounts: 0 })),
  refreshAfterRestore: jest.fn(),
}));

/* eslint-disable import/first */
import { databaseBackup } from './backup';
import { deleteBackup, downloadBackup, listBackups, uploadBackup } from '../lib/drive-api';
import { getPassphrase } from '../lib/secrets';
import { packContainer, readContainer } from '../lib/container';
import { isSealed, seal } from '../lib/seal';
import { inspectBackup } from './inspect';
import { restoreFrom } from './restore';
import { checkLatestBackup, restoreFromDrive, runBackup } from './drive';
/* eslint-enable import/first */

const mocked = {
  databaseBackup: databaseBackup as jest.Mock,
  uploadBackup: uploadBackup as jest.Mock,
  listBackups: listBackups as jest.Mock,
  deleteBackup: deleteBackup as jest.Mock,
  downloadBackup: downloadBackup as jest.Mock,
  getPassphrase: getPassphrase as jest.Mock,
  restoreFrom: restoreFrom as jest.Mock,
  inspectBackup: inspectBackup as jest.Mock,
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
  mocked.restoreFrom.mockResolvedValue({ copied: { transactions: 43 }, safetyBytes: 1000 });
  mocked.inspectBackup.mockReturnValue({ records: 43, accounts: 3, categories: 37 });
});

/**
 * THE BUTTON THAT ANSWERS "AM I ACTUALLY COVERED?"
 *
 * A backup nobody has ever opened is a promise, not a safety net, and every way
 * this can be wrong is silent: an upload that was really 0 bytes, a passphrase
 * changed since the last backup, a file truncated in transit, a container whose
 * receipts did not travel. All of them look exactly like a working setup until
 * the day they do not.
 *
 * What is asserted here is the ORDER and the REPORTING. The SQLite half lives
 * in `inspect.ts` and is mocked, which is the entire reason it was moved there.
 */
describe('checking the latest backup', () => {
  const PASS = 'a good long passphrase';
  const RECEIPT = new Uint8Array([...'a receipt photo'].map((c) => c.charCodeAt(0)));

  const inDrive = (over: Partial<{ id: string; name: string; size: number | null; createdTime: string }> = {}) => ({
    id: 'newest',
    name: 'peace-2026-08-13-1200.zip',
    size: 42_359,
    createdTime: '2026-08-13T09:14:30Z',
    ...over,
  });

  it('checks the NEWEST backup and reports what is in it', () => {
    // `listBackups` returns newest first; checking any other one would answer a
    // question nobody asked.
    mocked.listBackups.mockResolvedValue([inDrive(), inDrive({ id: 'older', name: 'old.zip' })]);
    mocked.downloadBackup.mockResolvedValue(packContainer({ database: LEDGER, files: [] }));

    return checkLatestBackup().then((result) => {
      expect(mocked.downloadBackup).toHaveBeenCalledWith('token', 'newest');
      expect(result.name).toBe('peace-2026-08-13-1200.zip');
      expect(result.records).toBe(43);
      expect(result.accounts).toBe(3);
      expect(result.categories).toBe(37);
      expect(result.bytes).toBe(42_359);
      expect(result.sealed).toBe(false);
    });
  });

  /**
   * "43 records" stopped being the whole answer once records could carry
   * receipts. A backup that checks out on rows while holding NONE of the photos
   * is exactly the silent failure this button exists to catch.
   */
  it('counts the receipts in the container, not just the rows', async () => {
    mocked.listBackups.mockResolvedValue([inDrive()]);
    mocked.downloadBackup.mockResolvedValue(
      packContainer({ database: LEDGER, files: [{ name: 'r.jpg', bytes: RECEIPT }] })
    );

    expect((await checkLatestBackup()).attachments).toBe(1);
  });

  it('unwraps the container before SQLite ever sees it', async () => {
    mocked.listBackups.mockResolvedValue([inDrive()]);
    mocked.downloadBackup.mockResolvedValue(
      packContainer({ database: LEDGER, files: [{ name: 'r.jpg', bytes: RECEIPT }] })
    );

    await checkLatestBackup();

    // A zip handed to ATTACH fails in a way that reads like a corrupt backup.
    const [handed] = mocked.inspectBackup.mock.calls[0];
    expect(Array.from(handed as Uint8Array)).toEqual(Array.from(LEDGER));
  });

  it('opens a sealed backup and says it was sealed', async () => {
    mocked.listBackups.mockResolvedValue([inDrive({ name: 'peace.zip.enc' })]);
    mocked.downloadBackup.mockResolvedValue(
      await seal(packContainer({ database: LEDGER, files: [] }), PASS, { logN: 8, r: 8, p: 1 })
    );
    mocked.getPassphrase.mockResolvedValue(PASS);

    const result = await checkLatestBackup();

    expect(result.sealed).toBe(true);
    expect(result.records).toBe(43);
  });

  it('still checks a bare .db from before attachments existed', async () => {
    mocked.listBackups.mockResolvedValue([inDrive({ name: 'peace-2026-08-10.db' })]);
    mocked.downloadBackup.mockResolvedValue(LEDGER);

    const result = await checkLatestBackup();

    expect(result.records).toBe(43);
    // No container, so no receipts — not a failure, just the age of the file.
    expect(result.attachments).toBe(0);
  });

  describe('when it cannot vouch for the backup', () => {
    it('says there are none rather than checking nothing', async () => {
      mocked.listBackups.mockResolvedValue([]);
      await expect(checkLatestBackup()).rejects.toThrow(/no backups in Drive/i);
      expect(mocked.inspectBackup).not.toHaveBeenCalled();
    });

    /**
     * The failure this whole button exists for. A 0-byte upload is what actually
     * happened on a real device, and it reported success everywhere else.
     */
    it('refuses an empty download instead of reporting an empty ledger', async () => {
      mocked.listBackups.mockResolvedValue([inDrive({ size: 0 })]);
      mocked.downloadBackup.mockResolvedValue(new Uint8Array(0));

      await expect(checkLatestBackup()).rejects.toThrow(/empty/i);
      expect(mocked.inspectBackup).not.toHaveBeenCalled();
    });

    /** The backup is fine; the passphrase is missing. Worth its own sentence. */
    it('blames the missing passphrase, not the backup', async () => {
      mocked.listBackups.mockResolvedValue([inDrive()]);
      mocked.downloadBackup.mockResolvedValue(
        await seal(packContainer({ database: LEDGER, files: [] }), PASS, { logN: 8, r: 8, p: 1 })
      );
      mocked.getPassphrase.mockResolvedValue(null);

      await expect(checkLatestBackup()).rejects.toThrow(/sealed.*no passphrase/i);
    });

    it('refuses a file that is neither sealed nor a Peace backup', async () => {
      mocked.listBackups.mockResolvedValue([inDrive()]);
      mocked.downloadBackup.mockResolvedValue(
        new Uint8Array([...'a holiday photo'].map((c) => c.charCodeAt(0)))
      );

      await expect(checkLatestBackup()).rejects.toThrow(/neither sealed nor/i);
      expect(mocked.inspectBackup).not.toHaveBeenCalled();
    });

    /**
     * A container that lost entries in transit still unzips. Without the
     * manifest count this would report a clean bill of health over a backup
     * missing half its receipts.
     */
    it('refuses a container whose receipts went missing in transit', async () => {
      const { unzipSync, zipSync } = jest.requireActual('fflate');
      const entries = unzipSync(
        packContainer({ database: LEDGER, files: [{ name: 'a.jpg', bytes: RECEIPT }] })
      );
      delete entries['attachments/a.jpg'];

      mocked.listBackups.mockResolvedValue([inDrive()]);
      mocked.downloadBackup.mockResolvedValue(zipSync(entries));

      await expect(checkLatestBackup()).rejects.toThrow(/lists 1 attachment/);
      expect(mocked.inspectBackup).not.toHaveBeenCalled();
    });
  });
});

describe('taking a backup', () => {
  it('uploads the checkpointed copy and reports what it did', async () => {
    stageFile();
    const outcome = await runBackup(new Date(2026, 7, 12, 9, 5));

    expect(mocked.uploadBackup).toHaveBeenCalledTimes(1);
    const [, name, payload] = mocked.uploadBackup.mock.calls[0];
    expect(name).toBe('peace-2026-08-12-0905.zip');
    expect(Array.from(payload as Uint8Array)).toEqual(Array.from(LEDGER));
    expect(outcome.sealed).toBe(false);
    expect(outcome.bytes).toBe(LEDGER.byteLength);
  });

  it('seals when a passphrase is set, and says so in the name', async () => {
    stageFile();
    mocked.getPassphrase.mockResolvedValue('a good long passphrase');

    const outcome = await runBackup(new Date(2026, 7, 12, 9, 5));

    const [, name, payload] = mocked.uploadBackup.mock.calls[0];
    expect(name).toBe('peace-2026-08-12-0905.zip.enc');
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

  /**
   * THE COMPOUNDING FAILURE, seen on a real device.
   *
   * Once the upload has landed the backup exists and is safe. If anything after
   * it throws, the caller never records the success — so the app believes it
   * has never backed up, considers one due at every launch, re-uploads every
   * time, and never reaches this pruning step to clean up the copies it is
   * making. One late failure, three symptoms.
   */
  it('still reports success when pruning fails after a good upload', async () => {
    stageFile();
    mocked.listBackups.mockRejectedValue(new Error('drive list failed'));

    const outcome = await runBackup();

    expect(outcome.at).toBeGreaterThan(0);
    expect(outcome.pruned).toBe(0);
  });

  it('still reports success when a delete fails part-way through', async () => {
    stageFile();
    mocked.listBackups.mockResolvedValue(driveFiles(8));
    mocked.deleteBackup.mockRejectedValue(new Error('permission denied'));

    await expect(runBackup()).resolves.toMatchObject({ pruned: 0 });
  });
});

/**
 * `appdata` is reachable by nothing but this app — no browser, no file manager.
 * Without this path a backup in Drive could be read by no software on earth,
 * which makes it not a backup.
 */
describe('restoring from Drive', () => {
  const PASS = 'a good long passphrase';

  it('hands the plain database to the ordinary restore path', async () => {
    // Reusing `restoreFrom` is what makes a Drive restore validate before
    // deleting, park a safety copy, and share the same Undo button.
    mocked.downloadBackup.mockResolvedValue(LEDGER);

    const result = await restoreFromDrive('file-1');

    expect(mocked.restoreFrom).toHaveBeenCalledTimes(1);
    expect(result.copied.transactions).toBe(43);
  });

  it('decrypts a sealed backup before restoring it', async () => {
    mocked.downloadBackup.mockResolvedValue(await seal(LEDGER, PASS, { logN: 8, r: 8, p: 1 }));
    mocked.getPassphrase.mockResolvedValue(PASS);

    // Read DURING the call: the staged file is deleted as soon as the restore
    // returns, which is the behaviour that keeps a decrypted copy of the whole
    // ledger from lingering in the cache.
    let handed: Uint8Array | null = null;
    mocked.restoreFrom.mockImplementation(async (file: { bytes: () => Promise<Uint8Array> }) => {
      handed = await file.bytes();
      return { copied: { transactions: 43 }, safetyBytes: 1000 };
    });

    await restoreFromDrive('file-1');

    // What reached the restore path is the LEDGER, not the ciphertext.
    expect(handed).not.toBeNull();
    expect(isSealed(handed!)).toBe(false);
    expect(Array.from(handed!)).toEqual(Array.from(LEDGER));
  });

  it('says the passphrase is missing rather than blaming the backup', async () => {
    mocked.downloadBackup.mockResolvedValue(await seal(LEDGER, PASS, { logN: 8, r: 8, p: 1 }));
    mocked.getPassphrase.mockResolvedValue(null);

    await expect(restoreFromDrive('file-1')).rejects.toThrow(/sealed.*passphrase/i);
    expect(mocked.restoreFrom).not.toHaveBeenCalled();
  });

  it('refuses a wrong passphrase without touching the ledger', async () => {
    mocked.downloadBackup.mockResolvedValue(await seal(LEDGER, PASS, { logN: 8, r: 8, p: 1 }));
    mocked.getPassphrase.mockResolvedValue('not the passphrase at all');

    await expect(restoreFromDrive('file-1')).rejects.toThrow();
    expect(mocked.restoreFrom).not.toHaveBeenCalled();
  });

  it('refuses an empty download rather than wiping the ledger with nothing', async () => {
    mocked.downloadBackup.mockResolvedValue(new Uint8Array(0));

    await expect(restoreFromDrive('file-1')).rejects.toThrow(/empty/i);
    expect(mocked.restoreFrom).not.toHaveBeenCalled();
  });

  it('refuses a file that is neither sealed nor a database', async () => {
    mocked.downloadBackup.mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));

    await expect(restoreFromDrive('file-1')).rejects.toThrow(/neither sealed nor/i);
    expect(mocked.restoreFrom).not.toHaveBeenCalled();
  });
});

/**
 * A backup is a CONTAINER now — the database beside the receipt files. Drive's
 * job is to move bytes and decrypt them; deciding what those bytes are belongs
 * to `restoreFrom`, which is the one place that opens a backup.
 */
describe('restoring a container from Drive', () => {
  const PASS = 'a good long passphrase';
  const RECEIPT = new Uint8Array([...'a receipt photo'].map((c) => c.charCodeAt(0)));
  const container = () => packContainer({ database: LEDGER, files: [{ name: 'r.jpg', bytes: RECEIPT }] });

  const captureHandover = () => {
    const seen: { bytes: Uint8Array | null } = { bytes: null };
    mocked.restoreFrom.mockImplementation(async (file: { bytes: () => Promise<Uint8Array> }) => {
      // Read DURING the call: the staged file is deleted the moment the restore
      // returns, so a decrypted ledger never lingers in the cache.
      seen.bytes = await file.bytes();
      return { copied: { transactions: 43 }, safetyBytes: 1000, filesRestored: 1, filesRemoved: 0, filesMissing: 0 };
    });
    return seen;
  };

  /**
   * STILL WRAPPED when it is handed over, deliberately. Unwrapping here would
   * make this the second implementation of "what is this file", and the two
   * would drift — which is exactly how the ledger-side rules ended up written
   * out in four places.
   */
  it('hands the container over intact rather than opening it here', async () => {
    mocked.downloadBackup.mockResolvedValue(container());
    const seen = captureHandover();

    await restoreFromDrive('file-1');

    expect(seen.bytes).not.toBeNull();
    const reopened = readContainer(seen.bytes!);
    expect(Array.from(reopened.database)).toEqual(Array.from(LEDGER));
    expect(reopened.files.map((f) => f.name)).toEqual(['r.jpg']);
  });

  it('decrypts a sealed container, receipts and all', async () => {
    mocked.downloadBackup.mockResolvedValue(await seal(container(), PASS, { logN: 8, r: 8, p: 1 }));
    mocked.getPassphrase.mockResolvedValue(PASS);
    const seen = captureHandover();

    await restoreFromDrive('file-1');

    expect(isSealed(seen.bytes!)).toBe(false);
    // The photo survived the seal, which is the whole point of putting it in
    // the container rather than leaving it on disk.
    const receipt = readContainer(seen.bytes!).files[0];
    expect(Array.from(receipt.bytes)).toEqual(Array.from(RECEIPT));
  });

  /**
   * Every backup made before attachments existed is a bare `.db`, including the
   * ones in the user's Drive folder right now.
   */
  it('still restores a bare database from before attachments existed', async () => {
    mocked.downloadBackup.mockResolvedValue(LEDGER);
    const seen = captureHandover();

    await restoreFromDrive('file-1');

    expect(Array.from(seen.bytes!)).toEqual(Array.from(LEDGER));
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
