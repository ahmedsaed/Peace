import { BackupFormatError, isBackupPayload, openBackupPayload } from './backup-payload';
import { packContainer } from './container';

const ascii = (text: string) => new Uint8Array([...text].map((c) => c.charCodeAt(0)));
const database = (tail = 'the ledger') => ascii(`SQLite format 3 ${tail}`);

describe('opening whatever the user handed over', () => {
  it('opens a container and hands back its attachments', () => {
    const packed = packContainer({
      database: database(),
      files: [{ name: 'a.jpg', bytes: ascii('photo') }],
    });

    const payload = openBackupPayload(packed);
    expect(payload.legacy).toBe(false);
    expect(payload.files.map((f) => f.name)).toEqual(['a.jpg']);
    expect(Array.from(payload.database)).toEqual(Array.from(database()));
  });

  /**
   * THE COMPATIBILITY TEST.
   *
   * Every backup made before attachments existed is a bare `.db`, including the
   * ones sitting in the user's Drive folder right now. Refusing those would mean
   * shipping a version of the app that cannot restore its own history.
   */
  it('still opens a plain database from before attachments existed', () => {
    const payload = openBackupPayload(database('salary 76079'));
    expect(payload.legacy).toBe(true);
    expect(payload.files).toEqual([]);
    expect(Array.from(payload.database)).toEqual(Array.from(database('salary 76079')));
  });

  /**
   * `legacy` is not cosmetic. A container with no attachments and a plain `.db`
   * look identical once restored — but only the second can leave rows pointing
   * at files that were never in the file, and only it should say so.
   */
  it('tells an empty container apart from an old database', () => {
    expect(openBackupPayload(packContainer({ database: database(), files: [] })).legacy).toBe(false);
    expect(openBackupPayload(database()).legacy).toBe(true);
  });

  it('refuses anything else by shape, not by name', () => {
    expect(() => openBackupPayload(ascii('peace-2026-08-13.db'))).toThrow(BackupFormatError);
    expect(() => openBackupPayload(new Uint8Array([]))).toThrow(/not a Peace backup/);
  });

  it('answers the same question without throwing, for a pre-flight check', () => {
    expect(isBackupPayload(packContainer({ database: database(), files: [] }))).toBe(true);
    expect(isBackupPayload(database())).toBe(true);
    expect(isBackupPayload(ascii('a photo of a cat'))).toBe(false);
  });
});
