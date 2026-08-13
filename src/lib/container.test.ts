import { unzipSync, zipSync } from 'fflate';

import {
  ATTACHMENT_PREFIX,
  ContainerError,
  CONTAINER_VERSION,
  DB_ENTRY,
  MANIFEST_ENTRY,
  describeContainer,
  looksLikeZip,
  packContainer,
  readContainer,
  type Manifest,
} from './container';

const ascii = (text: string) => new Uint8Array([...text].map((c) => c.charCodeAt(0)));

/** A stand-in for the database file: it must start with SQLite's own magic. */
const database = (tail = 'the ledger') => ascii(`SQLite format 3 ${tail}`);

const receipt = (name: string, body = 'jpeg bytes') => ({ name, bytes: ascii(body) });

const manifestOf = (bytes: Uint8Array): Manifest =>
  JSON.parse(new TextDecoder().decode(unzipSync(bytes)[MANIFEST_ENTRY]));

describe('recognising a container', () => {
  it('reads the zip magic, never the filename', () => {
    expect(looksLikeZip(packContainer({ database: database(), files: [] }))).toBe(true);
    expect(looksLikeZip(database())).toBe(false);
    // The NAME proves nothing — restore reads bytes.
    expect(looksLikeZip(ascii('peace-2026-08-13.zip'))).toBe(false);
  });

  it('does not read past the end of a short file', () => {
    expect(looksLikeZip(new Uint8Array([]))).toBe(false);
    expect(looksLikeZip(new Uint8Array([0x50, 0x4b]))).toBe(false);
  });
});

/**
 * THE TEST THIS FORMAT EXISTS FOR.
 *
 * A `.db` on its own restores a ledger whose receipts are all broken images.
 * Everything the rows refer to has to be inside the one file.
 */
describe('restoring on a new device', () => {
  it('carries the database and every attachment through a round trip', () => {
    const original = {
      database: database('salary 76079, rent 12000'),
      files: [receipt('a1.jpg', 'first receipt'), receipt('b2.pdf', '%PDF-1.4 invoice')],
    };

    const read = readContainer(packContainer(original));

    expect(Array.from(read.database)).toEqual(Array.from(original.database));
    expect(read.files.map((f) => f.name).sort()).toEqual(['a1.jpg', 'b2.pdf']);
    const pdf = read.files.find((f) => f.name === 'b2.pdf');
    expect(new TextDecoder().decode(pdf!.bytes)).toBe('%PDF-1.4 invoice');
  });

  it('round-trips a ledger with no attachments at all', () => {
    // The common case for anyone who has never photographed a receipt, and the
    // shape every backup made before this feature existed will have.
    const read = readContainer(packContainer({ database: database(), files: [] }));
    expect(read.files).toEqual([]);
    expect(Array.from(read.database)).toEqual(Array.from(database()));
  });

  it('leaves the database recognisable as SQLite once unpacked', () => {
    // The whole point of a zip over a bespoke container: unpack it anywhere and
    // there is an ordinary database sitting there.
    const raw = unzipSync(packContainer({ database: database(), files: [receipt('a.jpg')] }));
    expect(new TextDecoder().decode(raw[DB_ENTRY]).startsWith('SQLite format 3')).toBe(true);
    expect(raw[`${ATTACHMENT_PREFIX}a.jpg`]).toBeDefined();
  });
});

describe('the manifest', () => {
  it('records the format, the version and the count', () => {
    const manifest = manifestOf(
      packContainer(
        { database: database(), files: [receipt('a.jpg'), receipt('b.jpg')] },
        new Date('2026-08-13T09:00:00Z')
      )
    );
    expect(manifest.format).toBe('peace-backup');
    expect(manifest.version).toBe(CONTAINER_VERSION);
    expect(manifest.attachments).toBe(2);
    expect(manifest.createdAt).toBe('2026-08-13T09:00:00.000Z');
  });

  /**
   * A backup from a LATER version can hold entries this build knows nothing
   * about, and restoring it would silently drop them. Same rule the database
   * side already enforces by counting migrations.
   */
  it('names a newer format rather than restoring part of it', () => {
    const entries = unzipSync(packContainer({ database: database(), files: [] }));
    entries[MANIFEST_ENTRY] = ascii(
      JSON.stringify({ format: 'peace-backup', version: CONTAINER_VERSION + 1, attachments: 0 })
    );
    expect(() => readContainer(zipSync(entries))).toThrow(/newer version of Peace/);
  });
});

describe('refusing what it should not restore', () => {
  it('refuses a plain database rather than treating it as a container', () => {
    expect(() => readContainer(database())).toThrow(/not a Peace backup container/);
  });

  it('refuses a zip of something else, and says which problem it is', () => {
    const foreign = zipSync({ 'holiday.jpg': ascii('not a backup') });
    expect(() => readContainer(foreign)).toThrow(/no backup manifest/);
  });

  it('refuses a container with no database inside', () => {
    const entries = unzipSync(packContainer({ database: database(), files: [] }));
    delete entries[DB_ENTRY];
    expect(() => readContainer(zipSync(entries))).toThrow(/contains no database/);
  });

  /**
   * THE FAILURE THAT LOOKS LIKE SUCCESS.
   *
   * A container that lost entries in transit still unzips — the ones that
   * survived read back perfectly — so without the count, restore would delete
   * the originals and report success over a backup missing half its receipts.
   */
  it('refuses a container whose attachments went missing in transit', () => {
    const entries = unzipSync(
      packContainer({ database: database(), files: [receipt('a.jpg'), receipt('b.jpg')] })
    );
    delete entries[`${ATTACHMENT_PREFIX}b.jpg`];

    expect(() => readContainer(zipSync(entries))).toThrow(/lists 2 attachment\(s\) but contains 1/);
  });

  it('refuses a malformed manifest instead of guessing', () => {
    const entries = unzipSync(packContainer({ database: database(), files: [] }));
    entries[MANIFEST_ENTRY] = ascii('{not json');
    expect(() => readContainer(zipSync(entries))).toThrow(ContainerError);
  });

  it('refuses a manifest whose count is not a number', () => {
    const entries = unzipSync(packContainer({ database: database(), files: [] }));
    entries[MANIFEST_ENTRY] = ascii(
      JSON.stringify({ format: 'peace-backup', version: 1, attachments: 'lots' })
    );
    expect(() => readContainer(zipSync(entries))).toThrow(/malformed/);
  });

  /**
   * `../../etc/passwd` as an entry name is the classic zip escape. Names are
   * built from a hash today, so this cannot fire — it is here for the day
   * somebody stores a user-supplied name and does not think of it.
   */
  it('refuses to pack an attachment whose name could escape the folder', () => {
    for (const name of ['../evil.jpg', 'nested/evil.jpg', '.hidden']) {
      expect(() => packContainer({ database: database(), files: [receipt(name)] })).toThrow(
        /unsafe name/
      );
    }
  });
});

describe('what it packs and how', () => {
  /**
   * Photos are already compressed. Deflating them again costs CPU on a phone to
   * save nothing, and can make the file slightly BIGGER — so attachments are
   * stored and only the database is deflated.
   */
  it('stores attachments uncompressed and deflates the database', () => {
    // Incompressible-ish attachment content next to a database that is nothing
    // but repetition, so the two treatments are visibly different.
    const repetitive = ascii(`SQLite format 3 ${'a'.repeat(4000)}`);
    const photo = ascii(
      Array.from({ length: 2000 }, (_, i) => String.fromCharCode(32 + ((i * 37) % 90))).join('')
    );

    const packed = packContainer({ database: repetitive, files: [{ name: 'p.jpg', bytes: photo }] });

    // The photo's bytes survive verbatim inside the archive, which is what
    // "stored" means and is why packing a big photo set stays cheap.
    expect(packed.byteLength).toBeGreaterThan(photo.byteLength);
    // And the whole thing is still far smaller than the sum, because the
    // database part was deflated.
    expect(packed.byteLength).toBeLessThan(repetitive.byteLength + photo.byteLength);
  });

  it('ignores directory entries a foreign zip tool may have written', () => {
    const entries = unzipSync(packContainer({ database: database(), files: [receipt('a.jpg')] }));
    // fflate does not emit these, but Windows Explorer and `zip -r` both do.
    const withDir = zipSync({ ...entries, [ATTACHMENT_PREFIX]: new Uint8Array([]) });
    expect(readContainer(withDir).files.map((f) => f.name)).toEqual(['a.jpg']);
  });

  it('reports what a container weighs before it is written', () => {
    expect(
      describeContainer({ database: new Uint8Array(100), files: [receipt('a.jpg', 'ab')] })
    ).toEqual({ files: 1, bytes: 102 });
  });
});
