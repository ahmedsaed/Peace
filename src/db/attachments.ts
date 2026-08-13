/**
 * Where attachment bytes actually live.
 *
 * `<document>/attachments/<sha256>.<ext>` — the document directory, not the
 * cache, because Android may reclaim the cache whenever it likes and a receipt
 * is not disposable. Exports go to the cache precisely because they ARE.
 *
 * The rules this file has to keep, all of which have a test somewhere:
 *
 *   Nothing is written until its bytes have been hashed, so the name always
 *   describes the content and a half-written file cannot be mistaken for a
 *   good one.
 *
 *   A file is only deleted when NO row points at it. `orphanedFiles` in
 *   repo/attachments.ts owns that decision; this file never guesses.
 *
 *   Images are downscaled before they are stored, never after. A 4MB photo
 *   that reaches the disk is 4MB in every backup made from then on.
 */

import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import {
  ACCEPTED_MIME,
  AttachmentError,
  IMAGE_QUALITY,
  assertWithinLimit,
  attachmentFileName,
  extensionFor,
  isImageMime,
  resizeTarget,
} from '../lib/attachment';
import { db } from './client';
import { orphanedFiles, referencedFiles } from './repo/attachments';
import type { Attachment } from './schema';

const DIRECTORY = 'attachments';

/** Created on demand — `idempotent` so a second call is not an error. */
export function attachmentsDirectory(): Directory {
  const directory = new Directory(Paths.document, DIRECTORY);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

/** The absolute uri for an `<Image>` source. NEVER stored — see the schema. */
export function attachmentUri(fileName: string): string {
  return new File(attachmentsDirectory(), fileName).uri;
}

export function attachmentExists(fileName: string): boolean {
  return new File(attachmentsDirectory(), fileName).exists;
}

/** Every file currently in the directory, for the orphan and missing checks. */
export function filesOnDisk(): string[] {
  const directory = attachmentsDirectory();
  return directory
    .list()
    .filter((entry): entry is File => entry instanceof File)
    .map((file) => file.name);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // `BufferSource` is declared over `ArrayBuffer` while a `Uint8Array` is
  // generic over `ArrayBufferLike`, which includes `SharedArrayBuffer` — so the
  // two do not unify even though nothing here is ever shared. The cast is the
  // narrowest fix; copying the array would duplicate the whole file in memory
  // to satisfy a type.
  const view = bytes as Uint8Array<ArrayBuffer>;
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, view);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

type Incoming = {
  uri: string;
  mimeType: string;
  originalName?: string | null;
  width?: number | null;
  height?: number | null;
};

/**
 * A file that is on disk but does not belong to a record yet.
 *
 * THE RECORD DOES NOT EXIST WHEN THE PHOTO IS TAKEN. You open the record
 * screen, photograph the receipt, and then type the amount — so there is no
 * transaction id to attach to for most of the time the screen is open. The
 * bytes are written immediately anyway, and the ROW waits for the save.
 *
 * Writing the bytes straight away rather than holding the picked uri is the
 * safer half of the trade: the camera leaves its output in the cache, which
 * Android may reclaim at any moment, and losing the photo somebody just took
 * because they spent two minutes picking a category would be unforgivable.
 * Backing out of the screen instead leaves a file nothing points at, which the
 * orphan sweep clears on the next launch — a cost paid in bytes, not in
 * receipts.
 */
export type StagedAttachment = {
  fileName: string;
  originalName: string | null;
  mimeType: string;
  byteSize: number;
  sha256: string;
  width: number | null;
  height: number | null;
};

/** What an existing record's rows look like to the screen holding them. */
export function stagedFromRows(rows: Attachment[]): StagedAttachment[] {
  return rows.map((row) => ({
    fileName: row.fileName,
    originalName: row.originalName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    sha256: row.sha256 ?? '',
    width: row.width,
    height: row.height,
  }));
}

/**
 * Copy a picked file into the attachments directory.
 *
 * The order is deliberate: read, hash, size-check, THEN write. Writing first
 * and validating afterwards leaves a rejected file sitting in the directory
 * with nothing pointing at it — which the orphan sweep would eventually clear,
 * but only after it had already been packed into a backup.
 */
export async function stageAttachment(incoming: Incoming): Promise<StagedAttachment> {
  const mimeType = incoming.mimeType.toLowerCase();
  // Throws by name for anything not on the accepted list, before any work.
  extensionFor(mimeType);

  const source = new File(incoming.uri);
  if (!source.exists) {
    throw new AttachmentError('That file could not be read — it may have been moved.');
  }

  const bytes = await source.bytes();
  const label = incoming.originalName ?? source.name;
  assertWithinLimit(bytes.byteLength, label);

  const sha256 = await sha256Hex(bytes);
  const fileName = attachmentFileName(sha256, mimeType);
  const destination = new File(attachmentsDirectory(), fileName);

  // Content-addressed: if it is already there, the bytes are by definition the
  // same ones. Rewriting would be pure cost, and a partial rewrite of a file
  // another record depends on would be worse than that.
  if (!destination.exists) {
    destination.create({ overwrite: true });
    destination.write(bytes);

    // A file that exists is not a file that has content — the 0-byte backup
    // rule, applied at the one other place this app writes bytes.
    if (!destination.exists || destination.size !== bytes.byteLength) {
      destination.delete();
      throw new AttachmentError(`${label} did not copy completely — nothing was attached.`);
    }
  }

  return {
    fileName,
    originalName: incoming.originalName ?? null,
    mimeType,
    byteSize: bytes.byteLength,
    sha256,
    width: incoming.width ?? null,
    height: incoming.height ?? null,
  };
}

/**
 * Shrink a photo before it is stored.
 *
 * A receipt has to be legible, not archival. The camera hands over ~4MB of
 * 12-megapixel JPEG; this returns something around 300KB that still reads a
 * total and a date. Doing it here rather than at render time is the point — a
 * 4MB file that reaches the disk is 4MB in every backup from then on.
 *
 * Failing to shrink is NOT failing to attach. If the manipulator throws — an
 * exotic colour space, a format it will not decode — the original is used and
 * the size guard catches it if it is genuinely too big. Losing the receipt
 * because it could not be optimised would be the wrong trade.
 */
async function downscale(uri: string): Promise<{ uri: string; width: number; height: number }> {
  try {
    /**
     * MEASURE FIRST, THEN DECIDE WHICH EDGE TO CONSTRAIN.
     *
     * `resize({ width })` constrains the WIDTH, and a receipt photo is always
     * portrait — so pinning the width to 1600 takes a 1200x1800 photo and makes
     * it 1600x2400. That is an upscale: more pixels, a bigger file, no more
     * detail, in a function whose entire purpose is to make the file smaller.
     * The long edge is the one that has to be capped, and which edge is long is
     * not knowable without looking.
     */
    const measured = await ImageManipulator.manipulate(uri).renderAsync();
    const target = resizeTarget(measured.width, measured.height);

    const context = ImageManipulator.manipulate(uri);
    // Null when it is already small enough — then this only recompresses. One
    // edge is given and the other is left out, so the aspect ratio is preserved
    // and a portrait receipt is not squashed into a landscape box.
    if (target) context.resize(target);

    const rendered = await context.renderAsync();
    const result = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: IMAGE_QUALITY,
    });
    return { uri: result.uri, width: result.width, height: result.height };
  } catch (error) {
    // Friendly nothing for the user, the real error for whoever has to fix it.
    // Losing a receipt because it could not be OPTIMISED would be the wrong
    // trade — the size guard still catches anything genuinely too big.
    console.warn('[attachments] could not downscale, storing the original', error);
    return { uri, width: 0, height: 0 };
  }
}

export type PickOutcome = { cancelled: true } | { cancelled: false; attachment: StagedAttachment };

/**
 * Take a photo.
 *
 * The permission is requested at the moment the camera button is tapped, never
 * at launch: a permission prompt with no context attached is the one people
 * deny, and denying it here is recoverable — the file picker still works.
 */
export async function attachFromCamera(): Promise<PickOutcome> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new AttachmentError(
      permission.canAskAgain
        ? 'Peace needs the camera to photograph a receipt.'
        : 'Camera access is off for Peace. Turn it on in Android settings to photograph receipts.'
    );
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: 'images',
    // Full quality out of the camera, then downscaled once — compressing twice
    // would put JPEG artefacts through a second round of JPEG.
    quality: 1,
    exif: false,
  });
  if (result.canceled || !result.assets?.[0]) return { cancelled: true };

  const asset = result.assets[0];
  const shrunk = await downscale(asset.uri);
  return {
    cancelled: false,
    attachment: await stageAttachment({
      uri: shrunk.uri,
      mimeType: 'image/jpeg',
      width: shrunk.width || asset.width,
      height: shrunk.height || asset.height,
    }),
  };
}

/**
 * Pick a file: a photo already taken, or a PDF invoice.
 *
 * `copyToCacheDirectory` is left on. A content:// uri from the Storage Access
 * Framework is a permission grant rather than a path, and it can expire between
 * being handed over and being read — the copy is what makes reading it reliable.
 */
export async function attachFromFiles(): Promise<PickOutcome> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ACCEPTED_MIME,
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.[0]) return { cancelled: true };

  const asset = result.assets[0];
  const mimeType = (asset.mimeType ?? '').toLowerCase();
  // The picker's filter is advisory on Android — some file managers ignore it
  // entirely and will happily hand back a .zip.
  extensionFor(mimeType);

  if (isImageMime(mimeType)) {
    const shrunk = await downscale(asset.uri);
    return {
      cancelled: false,
      attachment: await stageAttachment({
        uri: shrunk.uri,
        mimeType: 'image/jpeg',
        originalName: asset.name,
        width: shrunk.width,
        height: shrunk.height,
      }),
    };
  }

  return {
    cancelled: false,
    attachment: await stageAttachment({
      uri: asset.uri,
      mimeType,
      originalName: asset.name,
    }),
  };
}

/**
 * Delete files nothing points at.
 *
 * Run after a record is deleted and after a restore. Returns how many went, so
 * the restore summary can say so rather than doing it invisibly.
 *
 * Deliberately forgiving: a file that cannot be deleted is logged and skipped.
 * A sweep that throws halfway leaves the directory in a worse state than one
 * that misses a file, and nothing here is load-bearing.
 */
export function sweepOrphans(): number {
  let removed = 0;
  for (const name of orphanedFiles(db, filesOnDisk())) {
    try {
      new File(attachmentsDirectory(), name).delete();
      removed += 1;
    } catch (error) {
      console.warn(`[attachments] could not delete orphan ${name}`, error);
    }
  }
  return removed;
}

/** Every file the ledger expects, for the backup container to pack. */
export async function readReferencedFiles(): Promise<{ name: string; bytes: Uint8Array }[]> {
  const wanted = referencedFiles(db);
  const files: { name: string; bytes: Uint8Array }[] = [];

  for (const name of wanted) {
    const file = new File(attachmentsDirectory(), name);
    if (!file.exists) {
      // A row whose file is gone. Not fatal — it is already missing, and
      // refusing to back up because of it would withhold the ledger too.
      console.warn(`[attachments] referenced file is missing, not packing it: ${name}`);
      continue;
    }
    files.push({ name, bytes: await file.bytes() });
  }

  return files;
}

/**
 * Read a stored attachment back as base64, for sending to a model.
 *
 * THE STORED COPY, NOT THE CAMERA ORIGINAL. It has already been downscaled to
 * 1600px, which is smaller to upload and — the part that matters — is the copy
 * the user will still have in two years. If the model cannot read the archived
 * receipt then neither can a person, and finding that out now is worth more
 * than a slightly better reading from a file that is about to be thrown away.
 *
 * `base64()` is native; encoding a 300KB image in JavaScript on Hermes would be
 * both slow and a dependency.
 */
export async function attachmentAsBase64(fileName: string): Promise<string> {
  const file = new File(attachmentsDirectory(), fileName);
  if (!file.exists) {
    throw new AttachmentError('That receipt is not on this phone any more.');
  }
  return file.base64();
}

/** Write the attachments out of a restored container, replacing what is there. */
export function writeRestoredFiles(files: { name: string; bytes: Uint8Array }[]): number {
  const directory = attachmentsDirectory();
  let written = 0;

  for (const entry of files) {
    const file = new File(directory, entry.name);
    if (file.exists) file.delete();
    file.create({ overwrite: true });
    file.write(entry.bytes);
    written += 1;
  }

  return written;
}
