import {
  ACCEPTED_MIME,
  AttachmentError,
  MAX_ATTACHMENT_BYTES,
  assertWithinLimit,
  attachmentFileName,
  extensionFor,
  isImageMime,
  isPdfMime,
  shortName,
} from './attachment';

const HASH = 'a'.repeat(64);

describe('naming a file on disk', () => {
  it('names it by its hash, so the same receipt twice is one file', () => {
    expect(attachmentFileName(HASH, 'image/jpeg')).toBe(`${HASH}.jpg`);
    // Same bytes, same name — the dedupe is the naming, not a separate check.
    expect(attachmentFileName(HASH, 'image/jpeg')).toBe(attachmentFileName(HASH, 'image/jpeg'));
  });

  it('gives every accepted type an extension', () => {
    for (const mime of ACCEPTED_MIME) {
      expect(attachmentFileName(HASH, mime)).toMatch(/^[0-9a-f]{64}\.[a-z]+$/);
    }
  });

  it('is case-insensitive about the mime type the OS handed over', () => {
    expect(extensionFor('IMAGE/JPEG')).toBe('jpg');
  });

  /**
   * The name is the whole reason a picked document is safe. A file manager can
   * hand over any name at all, and it would otherwise reach both the disk and
   * the entry list of a zip.
   */
  it('never lets a picked name reach the disk', () => {
    // Whatever it was called, the name is derived from the hash alone.
    expect(attachmentFileName(HASH, 'application/pdf')).toBe(`${HASH}.pdf`);
    expect(attachmentFileName(HASH, 'application/pdf')).not.toMatch(/[/\\]/);
  });

  it('refuses a hash that is not one, rather than writing a strange name', () => {
    for (const bad of ['', 'xyz', HASH.slice(1), `${HASH}0`, `${'A'.repeat(64)}`]) {
      expect(() => attachmentFileName(bad, 'image/jpeg')).toThrow(AttachmentError);
    }
  });

  it('refuses a type it does not handle, and names the type', () => {
    expect(() => extensionFor('application/zip')).toThrow(/application\/zip/);
    expect(() => extensionFor('')).toThrow(/that kind of file/);
  });
});

describe('telling the kinds apart', () => {
  it('knows what can be shown as a thumbnail', () => {
    expect(isImageMime('image/jpeg')).toBe(true);
    expect(isImageMime('application/pdf')).toBe(false);
    expect(isPdfMime('application/pdf')).toBe(true);
  });
});

describe('the size limit', () => {
  it('accepts an ordinary downscaled photo', () => {
    expect(() => assertWithinLimit(300 * 1024, 'receipt.jpg')).not.toThrow();
  });

  it('refuses an empty file — a file that exists is not a file with content', () => {
    expect(() => assertWithinLimit(0, 'receipt.jpg')).toThrow(/empty/);
  });

  it('refuses one big enough to break a backup later, and says why', () => {
    expect(() => assertWithinLimit(MAX_ATTACHMENT_BYTES + 1, 'scan.pdf')).toThrow(
      /scan\.pdf is 10MB.*backups stay manageable/s
    );
  });

  it('allows exactly the limit', () => {
    // An off-by-one here is the kind of thing nobody notices until a file is
    // refused for being precisely the size the message says is allowed.
    expect(() => assertWithinLimit(MAX_ATTACHMENT_BYTES, 'scan.pdf')).not.toThrow();
  });
});

describe('labelling a file with no thumbnail', () => {
  it('leaves a short name alone', () => {
    expect(shortName('receipt.pdf')).toBe('receipt.pdf');
  });

  it('elides the middle, keeping the informative end', () => {
    const elided = shortName('statement-acme-international-march-2026.pdf');
    expect(elided).toHaveLength(18);
    expect(elided.endsWith('2026.pdf')).toBe(true);
    expect(elided.startsWith('statement')).toBe(true);
  });
});
