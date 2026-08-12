import { deleteBackup, downloadBackup, listBackups, parseFile, uploadBackup } from './drive-api';

type Call = { url: string; init: RequestInit };

/** A fetch stand-in that records calls and replays queued responses. */
function transport(replies: Partial<Response>[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = replies.shift();
    if (!next) throw new Error('transport called more times than expected');
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
      ...next,
    } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const ok = (body: unknown, headers: Record<string, string> = {}) => ({
  ok: true,
  status: 200,
  headers: new Headers(headers),
  json: async () => body,
});

describe('reading a file record', () => {
  /**
   * Drive sends int64 fields as STRINGS. Left as one, sizes compare as text —
   * "9000" sorts above "10000" — and the emptiness check passes on "0".
   */
  it('turns the string size into a number', () => {
    const file = parseFile({ id: 'a', name: 'b.db', size: '204800', createdTime: '2026-08-12T…' });
    expect(file.size).toBe(204_800);
    expect(typeof file.size).toBe('number');
  });

  it('reads a missing size as zero rather than NaN', () => {
    // NaN would silently fail every comparison it touched, including the size
    // check that is supposed to catch a broken upload.
    expect(parseFile({ id: 'a', name: 'b' }).size).toBe(0);
    expect(parseFile({ id: 'a', size: 'not-a-number' }).size).toBe(0);
  });
});

describe('listing what is in the hidden folder', () => {
  it('asks for the app-data space and for the fields it needs', async () => {
    const { fetchImpl, calls } = transport([ok({ files: [] })]);
    await listBackups('tok', { fetchImpl });

    const url = new URL(calls[0].url);
    expect(url.searchParams.get('spaces')).toBe('appDataFolder');
    // Without an explicit `fields`, Drive returns only id/name/mimeType — so
    // size arrives undefined and every backup reads as 0 bytes.
    expect(url.searchParams.get('fields')).toContain('size');
    expect(url.searchParams.get('fields')).toContain('createdTime');
    expect(url.searchParams.get('orderBy')).toBe('createdTime desc');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('returns the parsed files', async () => {
    const { fetchImpl } = transport([
      ok({ files: [{ id: '1', name: 'a.db', size: '10', createdTime: 't' }] }),
    ]);
    expect(await listBackups('tok', { fetchImpl })).toEqual([
      { id: '1', name: 'a.db', size: 10, createdTime: 't' },
    ]);
  });
});

describe('uploading', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);

  it('posts metadata, then puts the bytes at the session URL', async () => {
    const { fetchImpl, calls } = transport([
      ok({}, { Location: 'https://upload.example/session-1' }),
      ok({ id: 'new', name: 'peace.db', size: '4', createdTime: 't' }),
    ]);

    const file = await uploadBackup('tok', 'peace.db', bytes, { fetchImpl });

    expect(calls[0].url).toContain('uploadType=resumable');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      name: 'peace.db',
      parents: ['appDataFolder'],
    });
    // Step two goes to the session URL from the Location HEADER, not to the
    // files endpoint — the response body of step one is empty.
    expect(calls[1].url).toBe('https://upload.example/session-1');
    expect(calls[1].init.method).toBe('PUT');
    expect(file.id).toBe('new');
  });

  /**
   * This app has already shipped a backup that was a perfectly named 0-byte
   * file. Drive reports what it actually stored; comparing it against what was
   * sent is the only evidence the upload was real.
   */
  it('rejects an upload Drive stored short', async () => {
    const { fetchImpl } = transport([
      ok({}, { Location: 'https://upload.example/s' }),
      ok({ id: 'new', name: 'peace.db', size: '0', createdTime: 't' }),
    ]);

    await expect(uploadBackup('tok', 'peace.db', bytes, { fetchImpl })).rejects.toThrow(
      /stored 0 bytes of 4/
    );
  });

  it('refuses to send an empty backup at all', async () => {
    // Would otherwise upload happily, pass the size check trivially, and
    // become the newest backup — displacing a good one.
    const { fetchImpl, calls } = transport([]);
    await expect(uploadBackup('tok', 'p.db', new Uint8Array(0), { fetchImpl })).rejects.toThrow(
      /empty/i
    );
    expect(calls).toHaveLength(0);
  });

  it('fails clearly when Drive returns no upload session', async () => {
    const { fetchImpl } = transport([ok({})]);
    await expect(uploadBackup('tok', 'p.db', bytes, { fetchImpl })).rejects.toThrow(/session/i);
  });
});

describe('errors', () => {
  it('flags a 401 as unauthorized so the caller refreshes instead of alarming the user', async () => {
    const { fetchImpl } = transport([
      { ok: false, status: 401, json: async () => ({ error: { message: 'Invalid Credentials' } }) },
    ]);

    await expect(listBackups('stale', { fetchImpl })).rejects.toMatchObject({
      unauthorized: true,
      status: 401,
    });
  });

  it('surfaces Drive’s own explanation rather than just a status code', async () => {
    // "Drive returned 403" is not something anyone can act on;
    // "storageQuotaExceeded" is.
    const { fetchImpl } = transport([
      {
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'The user has exceeded their Drive storage quota.' } }),
      },
    ]);

    await expect(listBackups('tok', { fetchImpl })).rejects.toThrow(/exceeded their Drive storage/);
  });

  it('does not mistake a network failure for a rejection', async () => {
    const dead = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    await expect(listBackups('tok', { fetchImpl: dead })).rejects.toMatchObject({
      status: 0,
      unauthorized: false,
    });
  });
});

describe('download and delete', () => {
  it('downloads with alt=media and returns bytes', async () => {
    const payload = new Uint8Array([9, 8, 7]);
    const { fetchImpl, calls } = transport([
      { ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => payload.buffer },
    ]);

    const bytes = await downloadBackup('tok', 'file-id', { fetchImpl });
    expect(calls[0].url).toContain('alt=media');
    expect(Array.from(bytes)).toEqual([9, 8, 7]);
  });

  it('deletes by id', async () => {
    const { fetchImpl, calls } = transport([ok({})]);
    await deleteBackup('tok', 'file-id', { fetchImpl });
    expect(calls[0].init.method).toBe('DELETE');
    expect(calls[0].url).toContain('file-id');
  });

  it('escapes an id rather than pasting it into a URL', async () => {
    const { fetchImpl, calls } = transport([ok({})]);
    await deleteBackup('tok', 'a/b?c', { fetchImpl });
    expect(calls[0].url).toContain(encodeURIComponent('a/b?c'));
  });
});
