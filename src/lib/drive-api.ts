/**
 * The slice of the Google Drive REST API this app uses.
 *
 * Everything here targets `appDataFolder` — a hidden per-app space that does
 * not appear in the user's Drive, cannot be read by any other app, and is
 * deleted by Google when they disconnect Peace. That is WhatsApp's arrangement,
 * chosen deliberately over a visible folder.
 *
 * It has a consequence worth stating plainly at the top of the file it is
 * implemented in: a backup in here is NOT reachable without this app. It is a
 * convenience copy, not the safety net. The reachable backup is still the local
 * one in `db/backup.ts`, which writes a plain SQLite file to a folder the user
 * picks.
 *
 * Uploads are RESUMABLE rather than multipart. Multipart would mean hand-packing
 * binary between boundary strings in JavaScript, which is easy to get subtly
 * wrong and hard to see when it is; resumable sends JSON metadata and raw bytes
 * as two separate, ordinary requests, and survives a dropped mobile connection.
 */

const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

/** The hidden space. Both a `spaces` value and a magic parent id. */
export const APP_DATA_FOLDER = 'appDataFolder';

export type DriveFile = {
  id: string;
  name: string;
  /**
   * Bytes, or NULL when Drive did not report it.
   *
   * The distinction is load-bearing and was learned the hard way: a resumable
   * upload's final response carries only the fields it feels like unless
   * `fields` is asked for, so `size` arrives undefined. Coercing that to 0
   * turned "Drive did not say" into "Drive stored nothing", and a backup that
   * had uploaded perfectly was reported to the user as incomplete.
   *
   * An absent measurement is not a measurement of zero.
   */
  size: number | null;
  /** RFC3339, as Drive sends it. */
  createdTime: string;
};

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** 401 — the access token aged out. Refresh and retry; do not alarm anyone. */
    readonly unauthorized: boolean = status === 401
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

type Opts = { fetchImpl?: typeof fetch; timeoutMs?: number };

async function request(
  url: string,
  init: RequestInit,
  { fetchImpl = fetch, timeoutMs = 60_000 }: Opts = {}
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      // Drive puts a real explanation in the body. Reading it costs one await
      // and is the difference between "Drive rejected this (403)" and
      // "storageQuotaExceeded" — one of which can be acted on.
      let detail = '';
      try {
        const body = (await response.json()) as { error?: { message?: string } };
        detail = body?.error?.message ?? '';
      } catch {
        /* not JSON; the status is all there is */
      }
      throw new DriveError(
        detail || `Drive returned ${response.status}.`,
        response.status
      );
    }
    return response;
  } catch (error) {
    if (error instanceof DriveError) throw error;
    console.warn('[drive] request failed', url, error);
    throw new DriveError('Could not reach Google Drive.', 0);
  } finally {
    clearTimeout(timer);
  }
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * Drive sends int64 fields as STRINGS — `"size": "1234"`.
 *
 * Left as a string it compares and sorts as text, so 9 KB looks larger than
 * 10 KB. Absent stays ABSENT rather than becoming 0 — see `DriveFile.size`.
 */
export function parseFile(raw: unknown): DriveFile {
  const r = (raw ?? {}) as Record<string, unknown>;
  const size = r.size === undefined || r.size === null ? null : Number(r.size);

  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    size: size !== null && Number.isFinite(size) ? size : null,
    createdTime: String(r.createdTime ?? ''),
  };
}

/** The fields worth asking for. Drive returns a bare minimum without this. */
const FILE_FIELDS = 'id,name,size,createdTime';

/** One file's metadata, with the fields explicitly requested. */
export async function getFile(token: string, id: string, opts: Opts = {}): Promise<DriveFile> {
  const response = await request(
    `${FILES_URL}/${encodeURIComponent(id)}?fields=${FILE_FIELDS}`,
    { headers: auth(token) },
    opts
  );
  return parseFile(await response.json());
}

/**
 * What is already in the hidden folder, newest first.
 *
 * `fields` is NOT optional decoration. Ask for nothing and Drive returns only
 * id, name and mimeType — so `size` arrives undefined, every backup reads as
 * 0 bytes, and the pruning below would happily treat them all as junk.
 */
export async function listBackups(token: string, opts: Opts = {}): Promise<DriveFile[]> {
  const query = new URLSearchParams({
    spaces: APP_DATA_FOLDER,
    fields: `files(${FILE_FIELDS})`,
    orderBy: 'createdTime desc',
    pageSize: '100',
  });

  const response = await request(`${FILES_URL}?${query}`, { headers: auth(token) }, opts);
  const body = (await response.json()) as { files?: unknown[] };
  return (body.files ?? []).map(parseFile);
}

/**
 * Upload, in the two steps a resumable upload takes.
 *
 * Step one posts the metadata and gets a session URL back in the `Location`
 * HEADER — not in the body, which is empty. Step two PUTs the bytes there.
 */
export async function startUpload(
  token: string,
  name: string,
  opts: Opts = {}
): Promise<string> {
  const response = await request(
    `${UPLOAD_URL}?uploadType=resumable&fields=${FILE_FIELDS}`,
    {
      method: 'POST',
      headers: { ...auth(token), 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name, parents: [APP_DATA_FOLDER] }),
    },
    opts
  );

  const session = response.headers.get('Location') ?? response.headers.get('location');
  if (!session) {
    throw new DriveError('Drive did not return an upload session.', response.status);
  }
  return session;
}

/** Send the bytes. Verification is separate — see `uploadBackup`. */
export async function finishUpload(
  session: string,
  bytes: Uint8Array,
  opts: Opts = {}
): Promise<DriveFile> {
  const response = await request(
    session,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes as unknown as BodyInit,
    },
    opts
  );
  return parseFile(await response.json());
}

/**
 * Upload, then ask Drive what it actually stored.
 *
 * THE SIZE CHECK IS THE POINT — this app has already shipped a backup that was
 * a perfectly named 0-byte file, because nothing downstream could tell "wrote a
 * file" from "wrote the contents".
 *
 * But the check has to ask a question Drive is guaranteed to answer. The first
 * version read `size` straight off the upload response, which does NOT include
 * it unless `fields` is requested, and Google's own documentation does not say
 * whether `fields` on the initiation request survives to the final one. So it
 * read as absent, absent was coerced to 0, and a backup that had uploaded
 * perfectly told the user it was incomplete — while the failure ALSO meant the
 * success was never recorded, so every launch re-uploaded and nothing was ever
 * pruned. One misread field, three symptoms.
 *
 * A separate metadata GET with an explicit `fields` removes the guesswork: one
 * small request, an unambiguous answer, and a size check that means something.
 */
export async function uploadBackup(
  token: string,
  name: string,
  bytes: Uint8Array,
  opts: Opts = {}
): Promise<DriveFile> {
  if (bytes.byteLength === 0) {
    // Refused before it leaves the device: an empty upload would otherwise
    // succeed, pass the size check trivially, and replace a good backup.
    throw new DriveError('Refusing to upload an empty backup.', 0);
  }

  const uploaded = await finishUpload(await startUpload(token, name, opts), bytes, opts);
  if (!uploaded.id) {
    throw new DriveError('Drive did not say what it stored the backup as.', 0);
  }

  const stored = await getFile(token, uploaded.id, opts);
  if (stored.size !== null && stored.size !== bytes.byteLength) {
    throw new DriveError(
      `Drive stored ${stored.size} bytes of ${bytes.byteLength}. The backup is incomplete.`,
      0
    );
  }
  // A null size here would mean Drive ignored an explicit `fields` — worth a
  // line in the log, but NOT worth failing an upload that plainly worked.
  if (stored.size === null) {
    console.warn('[drive] Drive did not report a size; upload not size-verified');
  }
  return stored;
}

export async function downloadBackup(
  token: string,
  id: string,
  opts: Opts = {}
): Promise<Uint8Array> {
  const response = await request(
    `${FILES_URL}/${encodeURIComponent(id)}?alt=media`,
    { headers: auth(token) },
    opts
  );
  return new Uint8Array(await response.arrayBuffer());
}

export async function deleteBackup(token: string, id: string, opts: Opts = {}): Promise<void> {
  await request(
    `${FILES_URL}/${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: auth(token) },
    opts
  );
}
