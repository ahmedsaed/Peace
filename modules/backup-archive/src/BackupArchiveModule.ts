import { requireOptionalNativeModule } from 'expo';

/** One zip entry: a file on disk (`path`) or a short `text`. */
export type ZipEntrySpec = { name: string; path?: string; text?: string; deflate: boolean };

declare class BackupArchiveModule {
  zip(destination: string, entries: ZipEntrySpec[], modifiedAt: number): Promise<number>;
  scrypt(
    password: Uint8Array,
    salt: Uint8Array,
    logN: number,
    r: number,
    p: number,
    dkLen: number
  ): Promise<Uint8Array>;
}

/**
 * Optional, so jest (and Node) load the callers without it. Each caller says
 * what it does when this is null, because that differs: the key derivation
 * falls back to the same algorithm in JS, while the zip has no fallback.
 */
export const backupArchive = requireOptionalNativeModule<BackupArchiveModule>('BackupArchive');
