/**
 * What an attachment is allowed to be, and what it gets called on disk.
 *
 * Pure — no filesystem, no React Native — so the naming and the limits are
 * tested directly. The code that actually moves bytes lives in
 * `src/db/attachments.ts`.
 *
 * FILES ARE CONTENT-ADDRESSED: the name on disk is the SHA-256 of the bytes
 * plus an extension. Three things fall out of that and all three are the reason
 * for it rather than a happy accident:
 *
 *   Photographing the same receipt twice, or attaching one file to two records,
 *   writes ONE file. The `sha256` column in the schema exists to make that
 *   check possible; naming by hash is what makes it automatic.
 *
 *   The name is always safe. A picked document arrives with whatever the user's
 *   file manager called it — `../../evil`, an emoji, 300 characters, a name
 *   another attachment already has. None of that reaches the disk or the
 *   backup container.
 *
 *   A file cannot silently change under its own name, so a restored attachment
 *   either matches its row or is provably not the same file.
 *
 * The ORIGINAL name is not lost; it is what the UI shows for a PDF, and it
 * lives in the database rather than in the filename.
 */

/**
 * Everything the pickers may produce, mapped to the extension it gets on disk.
 *
 * A closed list rather than "whatever the picker said": the mime type comes
 * from the OS and ends up in a filename, and an app that will write any
 * extension it is handed is one `image/svg+xml.html` away from a problem.
 * Anything not here is refused with a message naming the type.
 */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
  // An e-receipt pasted into a note app, an order confirmation saved as text.
  'text/plain': 'txt',
};

/** What the document picker offers. Images, PDFs and text — receipts arrive as all three. */
export const ACCEPTED_MIME = Object.keys(EXTENSIONS);

/**
 * A ceiling per file, checked AFTER downscaling.
 *
 * Not about disk — phones have plenty. It is about the backup: every attachment
 * is packed into the container that gets sealed and uploaded, in memory, on a
 * phone. A 40MB scan attached without thinking is a backup that fails much
 * later, on a different screen, for reasons nobody will connect to the receipt
 * they added a month ago.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * What a photo is reduced to before it is stored.
 *
 * A receipt has to be LEGIBLE, not archival. A modern phone camera produces
 * ~4MB of 12-megapixel JPEG; 1600px on the long edge at quality 0.7 is around
 * 200-400KB, still reads a total and a date, and is the difference between a
 * year of receipts weighing 20MB and weighing 400MB — which is the difference
 * between a weekly Drive backup that works and one the user turns off.
 */
export const IMAGE_MAX_EDGE = 1600;
export const IMAGE_QUALITY = 0.7;

/**
 * Which edge to constrain when shrinking a photo, or null to leave it alone.
 *
 * TWO WAYS TO GET THIS WRONG, AND BOTH MAKE THE FILE BIGGER.
 *
 * Constraining the WIDTH unconditionally is the first. A receipt photo is
 * portrait, so pinning its width to 1600 turns 1200x1800 into 1600x2400 — an
 * upscale, in the function whose whole job is to make the file smaller. The
 * LONG edge is the one that has to be capped, and which edge is long is not
 * knowable without measuring.
 *
 * Resizing a photo that is already small enough is the second. It cannot add
 * detail and it re-encodes a JPEG that has already been through a JPEG.
 *
 * Pure, because this is arithmetic and the failure is invisible on screen —
 * a slightly larger file looks exactly like a slightly smaller one.
 */
export function resizeTarget(
  width: number,
  height: number,
  maxEdge = IMAGE_MAX_EDGE
): { width: number } | { height: number } | null {
  // A dimension the manipulator could not report. Resizing against a zero or a
  // NaN would produce a garbage target; leaving it alone is always safe.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  if (Math.max(width, height) <= maxEdge) return null;
  return width >= height ? { width: maxEdge } : { height: maxEdge };
}

export class AttachmentError extends Error {}

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

/** Everything else is rendered as a labelled tile rather than a thumbnail. */
export function isPdfMime(mime: string): boolean {
  return mime === 'application/pdf';
}

export function isTextMime(mime: string): boolean {
  return mime === 'text/plain';
}

/**
 * Whether "read this" can be offered on a file: a photo, a PDF or text. The
 * model takes all three, and the read button is shown on exactly these, so a
 * button that can never work is never drawn.
 */
export function isReadableMime(mime: string): boolean {
  return isImageMime(mime) || isPdfMime(mime) || isTextMime(mime);
}

/**
 * How much of a text file goes to the model. A receipt is a few hundred
 * characters; a file of tens of thousands is not a receipt, and sending all of
 * it would cost the user's key for nothing.
 */
export const MAX_TEXT_CHARS = 20_000;

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 to bytes, by hand — whichever of `atob` and `Buffer` the engine has. */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let n = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const quad = [0, 1, 2, 3].map((k) => BASE64.indexOf(clean[i + k] ?? 'A'));
    const value = (quad[0] << 18) | (quad[1] << 12) | (quad[2] << 6) | quad[3];
    const present = Math.min(4, clean.length - i);
    if (present > 1) bytes[n++] = (value >> 16) & 255;
    if (present > 2) bytes[n++] = (value >> 8) & 255;
    if (present > 3) bytes[n++] = value & 255;
  }
  return bytes.subarray(0, n);
}

/**
 * A text attachment's bytes, read back as UTF-8 text.
 *
 * Text goes to the model as TEXT rather than as an inline file: plain text in
 * the prompt is the one input every model reads, and it is cut to
 * `MAX_TEXT_CHARS`. Decoded here, by hand, so it does not depend on which of
 * `atob` and `Buffer` a given JavaScript engine happens to provide.
 */
export function base64ToText(base64: string, maxChars = MAX_TEXT_CHARS): string {
  const bytes = base64ToBytes(base64);
  const text = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[…the rest of the file was left out]` : text;
}

export function extensionFor(mime: string): string {
  const extension = EXTENSIONS[mime.toLowerCase()];
  if (!extension) {
    throw new AttachmentError(`Peace cannot attach ${mime || 'that kind of file'} yet.`);
  }
  return extension;
}

/**
 * The name on disk, and the name inside the backup container.
 *
 * Relative — never absolute. The schema comment says why: the sandbox path
 * changes between installs and OS updates, so a stored absolute path turns
 * every old receipt into a broken image on the next upgrade.
 */
export function attachmentFileName(sha256: string, mime: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new AttachmentError('An attachment must be named by a full SHA-256 hash.');
  }
  return `${sha256}.${extensionFor(mime)}`;
}

/**
 * A short label for a file that has no thumbnail.
 *
 * Middle-elided rather than truncated, because the informative half of an
 * invoice filename is usually the end — `...-march-2026.pdf` tells you more
 * than `statement-acme-inter...` does.
 */
export function shortName(name: string, max = 18): string {
  if (name.length <= max) return name;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${name.slice(0, head)}…${name.slice(name.length - tail)}`;
}

/**
 * Guard the size at the boundary, in one place.
 *
 * Both pickers and the restore path go through here, so "too big" is one
 * sentence with one number in it rather than three that disagree.
 */
export function assertWithinLimit(bytes: number, name: string): void {
  if (bytes <= 0) {
    // The same failure that once produced a 0-byte backup. A file that exists
    // is not a file that has content.
    throw new AttachmentError(`${name} is empty — nothing was attached.`);
  }
  if (bytes > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentError(
      `${name} is ${Math.round(bytes / (1024 * 1024))}MB. Attachments are limited to ${
        MAX_ATTACHMENT_BYTES / (1024 * 1024)
      }MB so backups stay manageable.`
    );
  }
}
