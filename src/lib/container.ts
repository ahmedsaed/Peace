/**
 * The backup container: the database AND the files it refers to, in one file.
 *
 * WHY THIS EXISTS. Attachments are receipt photos and PDFs stored on disk, with
 * only their filenames in the `attachments` table. A backup that copied the
 * SQLite file alone would therefore restore a ledger full of rows pointing at
 * files that are not there — every receipt a broken thumbnail, on the one day
 * the backup is being used at all. The seal's promise is "the file and the
 * passphrase and NOTHING ELSE"; a `.db` on its own stopped being able to keep it
 * the moment records could carry files.
 *
 * WHY A ZIP, of all things. The local backup's other job is to be openable
 * without this app ever existing again — that is why it was a plain `.db` in the
 * first place. A zip keeps that: double-click it anywhere and there is
 * `peace.db` next to an `attachments/` folder, no special tool and nothing to
 * reverse-engineer. A bespoke container would have been smaller to write and
 * would have made the recovery story worse.
 *
 * Pure — no React Native, no filesystem — so the format is tested in Node
 * against real bytes rather than mocked out.
 */

import { unzipSync, Zip, ZipDeflate, ZipPassThrough } from 'fflate';

/** Where the database sits inside the container. */
export const DB_ENTRY = 'peace.db';
/** Everything under here is an attachment, named by its row's `file_name`. */
export const ATTACHMENT_PREFIX = 'attachments/';
/** Names the format to a human who unzipped it, and to `readContainer`. */
export const MANIFEST_ENTRY = 'peace-backup.json';

export const CONTAINER_VERSION = 1;

/** Local file header of any zip: "PK\x03\x04". */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export class ContainerError extends Error {}

export type ContainerFile = { name: string; bytes: Uint8Array };

export type Container = {
  database: Uint8Array;
  files: ContainerFile[];
};

export type Manifest = {
  format: 'peace-backup';
  version: number;
  createdAt: string;
  /** What the writer believed it was packing, so a truncated zip is detectable. */
  attachments: number;
};

/**
 * Is this a zip at all?
 *
 * Restore sniffs BYTES, never the filename — the same rule `isSealed` follows,
 * and for the same reason: a name is the one part of a file anybody can change.
 */
export function looksLikeZip(bytes: Uint8Array): boolean {
  if (bytes.byteLength < ZIP_MAGIC.length) return false;
  return ZIP_MAGIC.every((b, i) => bytes[i] === b);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Pack a database and its attachments.
 *
 * COMPRESSION IS PER-ENTRY AND THAT IS DELIBERATE. A SQLite file is mostly
 * padding and repeated structure and shrinks by ~80%; a JPEG or a PDF is
 * already compressed, so deflating it burns CPU on a phone to save nothing —
 * occasionally to lose, since a deflate stream over incompressible input is
 * slightly larger than the input. Attachments are STORED, the database is
 * deflated, and a backup of a big photo library stays roughly as fast as
 * copying it.
 *
 * Synchronous: for tests and fixtures. The app packs with `packContainerTo`,
 * which runs the very same steps without holding the thread.
 */
export function packContainer(container: Container, now = new Date()): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const out of packSteps(container, now)) chunks.push(...out);
  return concat(chunks);
}

/** How much of an entry one step feeds the zip. */
const STEP_BYTES = 32 * 1024;

/** How long packing may hold the thread before it lets a tap through. */
const BUDGET_MS = 12;

/**
 * Pack a container into `write`, handing the thread back as it goes.
 *
 * THIS IS WHAT FROZE THE APP. The Drive catch-up runs when the app opens, and
 * packing used to be one `zipSync` over the database and every receipt: a CRC
 * over tens of megabytes and a deflate of the ledger, in an interpreter, in a
 * single call. For those seconds the screen drew and nothing on it answered a
 * tap. Now packing is a series of small steps, and whenever one has held the
 * thread for `BUDGET_MS` it waits for `pause` — a macrotask, so every touch
 * that queued up meanwhile is handled first. Slower in total; never stuck.
 *
 * `write` receives the zip in order, so the file is written as it is made
 * rather than built whole in memory and written in one more blocking call.
 */
export async function packContainerTo(
  container: Container,
  write: (chunk: Uint8Array) => void,
  {
    now = new Date(),
    pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    clock = () => Date.now(),
  }: { now?: Date; pause?: () => Promise<void>; clock?: () => number } = {}
): Promise<void> {
  let since = clock();
  for (const out of packSteps(container, now)) {
    for (const chunk of out) write(chunk);
    if (clock() - since >= BUDGET_MS) {
      await pause();
      since = clock();
    }
  }
}

/**
 * The one implementation of the format, as steps.
 *
 * Each yield is what the zip produced during one step. Both drivers above run
 * this, so the synchronous fixtures in tests and the backups on a phone cannot
 * drift into two formats.
 */
function* packSteps(container: Container, now: Date): Generator<Uint8Array[]> {
  const manifest: Manifest = {
    format: 'peace-backup',
    version: CONTAINER_VERSION,
    createdAt: now.toISOString(),
    attachments: container.files.length,
  };

  for (const file of container.files) {
    // A name with a slash in it would place the entry outside the folder the
    // reader looks in — and, once unpacked, outside the attachments directory
    // altogether. Names come from `attachment.ts`, which builds them from a
    // hash, so this cannot currently fire; it is here because the day someone
    // stores a user-supplied name is the day it matters and nobody will
    // remember to add it then.
    if (file.name.includes('/') || file.name.includes('\\') || file.name.startsWith('.')) {
      throw new ContainerError(`Refusing to pack an attachment with an unsafe name: ${file.name}`);
    }
  }

  let pending: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((error, data) => {
    if (error) failure = error;
    else pending.push(data);
  });
  const take = () => {
    if (failure) throw failure;
    const out = pending;
    pending = [];
    return out;
  };

  const entries: [ZipDeflate | ZipPassThrough, Uint8Array][] = [
    [new ZipDeflate(MANIFEST_ENTRY, { level: 6 }), encoder.encode(JSON.stringify(manifest, null, 2))],
    [new ZipDeflate(DB_ENTRY, { level: 6 }), container.database],
    ...container.files.map(
      (file): [ZipPassThrough, Uint8Array] => [
        new ZipPassThrough(ATTACHMENT_PREFIX + file.name),
        file.bytes,
      ]
    ),
  ];

  for (const [entry, bytes] of entries) {
    zip.add(entry);
    if (bytes.byteLength === 0) entry.push(bytes, true);
    for (let at = 0; at < bytes.byteLength; at += STEP_BYTES) {
      const end = Math.min(at + STEP_BYTES, bytes.byteLength);
      entry.push(bytes.subarray(at, end), end === bytes.byteLength);
      yield take();
    }
  }

  zip.end();
  yield take();
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.byteLength, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/**
 * Read a container back.
 *
 * Every failure names what is wrong with the FILE rather than throwing whatever
 * the zip library says. Someone restoring is already having a bad day, and
 * "invalid distance too far back" is not a sentence they can act on.
 */
export function readContainer(bytes: Uint8Array): Container {
  if (!looksLikeZip(bytes)) {
    throw new ContainerError('That file is not a Peace backup container.');
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (error) {
    console.warn('[restore] could not read the backup container', error);
    throw new ContainerError('That backup is damaged and could not be opened.');
  }

  const manifestBytes = entries[MANIFEST_ENTRY];
  if (!manifestBytes) {
    // A zip of something else entirely — a photo album, an export from another
    // app. Saying so beats "no database inside", which sounds like corruption.
    throw new ContainerError('That zip is not a Peace backup — it has no backup manifest.');
  }

  const manifest = parseManifest(manifestBytes);
  if (manifest.version > CONTAINER_VERSION) {
    throw new ContainerError(
      `That backup was made by a newer version of Peace (container format ${manifest.version}). Update the app first.`
    );
  }

  const database = entries[DB_ENTRY];
  if (!database) {
    throw new ContainerError('That backup is incomplete — it contains no database.');
  }

  const files: ContainerFile[] = [];
  for (const [name, content] of Object.entries(entries)) {
    if (!name.startsWith(ATTACHMENT_PREFIX)) continue;
    const short = name.slice(ATTACHMENT_PREFIX.length);
    // Zip writers record directories as zero-length entries ending in a slash.
    if (short.length === 0 || short.endsWith('/')) continue;
    files.push({ name: short, bytes: content });
  }

  /**
   * The count is checked, not trusted.
   *
   * A backup truncated in transit still unzips — the entries that survived read
   * back perfectly well — so nothing else here would notice that half the
   * receipts are gone. Restoring it would delete the originals and report
   * success. The manifest is what makes the loss visible BEFORE anything is
   * deleted.
   */
  if (files.length !== manifest.attachments) {
    throw new ContainerError(
      `That backup is incomplete — it lists ${manifest.attachments} attachment(s) but contains ${files.length}.`
    );
  }

  return { database, files };
}

function parseManifest(bytes: Uint8Array): Manifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new ContainerError('That backup is damaged — its manifest could not be read.');
  }

  const record = (parsed ?? {}) as Record<string, unknown>;
  if (record.format !== 'peace-backup') {
    throw new ContainerError('That zip is not a Peace backup.');
  }

  const version = Number(record.version);
  const attachments = Number(record.attachments);
  if (!Number.isInteger(version) || !Number.isInteger(attachments)) {
    throw new ContainerError('That backup is damaged — its manifest is malformed.');
  }

  return {
    format: 'peace-backup',
    version,
    createdAt: String(record.createdAt ?? ''),
    attachments,
  };
}

/** What a container will weigh, for the screen to say so before it is written. */
export function describeContainer(container: Container): { files: number; bytes: number } {
  return {
    files: container.files.length,
    bytes:
      container.database.byteLength +
      container.files.reduce((total, file) => total + file.bytes.byteLength, 0),
  };
}
