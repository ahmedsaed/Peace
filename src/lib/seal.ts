/**
 * Sealing a backup before it leaves the device.
 *
 * Drive is a server. An unsealed `.db` sitting in it is a file Google can read
 * — every amount, every category, every note. Sealing is what makes "you own
 * your data" true rather than aspirational, and it is optional because the
 * local backup path deliberately stays plain and openable by any SQLite tool.
 *
 * THE RECOVERY CASE IS THE DESIGN CONSTRAINT, NOT THE ATTACK.
 *
 * The first version of this generated a random 256-bit key and showed it as 64
 * hex digits — cryptographically stronger than any passphrase, and useless. A
 * generated key lives in the device's secure store, so the ONE scenario backups
 * exist for — the phone is lost, stolen or wiped — is exactly the scenario
 * where the key is gone too. Backing the key up somewhere to protect the backup
 * is circular: it is just as losable as the database it was protecting.
 *
 * A passphrase is different in kind because it lives in the user's head, which
 * survives the device. That is worth a slow KDF and a dependency.
 *
 * Everything needed to open a backup therefore travels INSIDE the file — salt,
 * KDF parameters, nonce and tag. A fresh install on a new phone needs the file
 * and the passphrase and NOTHING ELSE. No stored state, no settings, no key
 * escrow. If opening a backup ever required something this app had to remember,
 * the feature would not work on the day it is needed.
 */

import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
  getRandomBytes,
} from 'expo-crypto';
import { scryptAsync } from '@noble/hashes/scrypt.js';

import { looksLikeZip } from './container';

/**
 * Marks a file as sealed, in the file itself.
 *
 * Restore decides whether to decrypt by reading THIS, never by looking at the
 * filename. A name is the one part of a file anybody can change, and a backup
 * renamed on the way through a file manager would otherwise be fed to SQLite as
 * ciphertext and reported as corrupt.
 */
export const MAGIC = 'PEACEBK1';
const MAGIC_BYTES = new Uint8Array([...MAGIC].map((c) => c.charCodeAt(0)));

/** Every SQLite file starts with this. Used to sanity-check what came out. */
const SQLITE_MAGIC = 'SQLite format 3';

export const VERSION = 1;
export const SALT_BYTES = 16;
/** MAGIC ++ version ++ logN ++ r ++ p ++ salt */
export const HEADER_BYTES = MAGIC_BYTES.byteLength + 4 + SALT_BYTES;

/**
 * scrypt cost, chosen for a phone.
 *
 * N=2^14 with r=8 is ~16 MB and a second or two in JavaScript — slow enough to
 * make guessing a passphrase expensive, fast enough that a daily backup does
 * not stall. They are WRITTEN INTO EVERY FILE rather than hardcoded at the read
 * end, so raising them later strengthens new backups without orphaning old
 * ones. A format that cannot be tightened without abandoning history gets
 * tightened by nobody.
 */
export const KDF_PARAMS = { logN: 14, r: 8, p: 1 } as const;
export type KdfParams = { logN: number; r: number; p: number };

/** Short passphrases are the one thing scrypt cannot rescue. */
export const MIN_PASSPHRASE = 8;

export class SealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SealError';
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Prepare a passphrase for hashing.
 *
 * NFC normalisation matters for recovery, not for security: the same accented
 * character can be typed as one code point or two depending on the keyboard,
 * and the two hash differently. Someone restoring on a new phone with a
 * different keyboard would type the "same" passphrase and be told it was wrong.
 *
 * Trimming is applied at BOTH ends of the process, so it is self-consistent — a
 * trailing space picked up from a paste is overwhelmingly an accident, and a
 * passphrase that silently depends on one is a trap.
 */
export function normalisePassphrase(passphrase: string): string {
  return passphrase.normalize('NFC').trim();
}

export function assertUsablePassphrase(passphrase: string): string {
  const normalised = normalisePassphrase(passphrase);
  if (normalised.length < MIN_PASSPHRASE) {
    throw new SealError(`Use at least ${MIN_PASSPHRASE} characters.`);
  }
  return normalised;
}

/** passphrase + salt -> 32-byte AES key. Deterministic; this is the recovery path. */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams = KDF_PARAMS
): Promise<Uint8Array> {
  return scryptAsync(normalisePassphrase(passphrase), salt, {
    N: 2 ** params.logN,
    r: params.r,
    p: params.p,
    dkLen: 32,
  });
}

export type Header = { version: number; params: KdfParams; salt: Uint8Array };

export function buildHeader(salt: Uint8Array, params: KdfParams = KDF_PARAMS): Uint8Array {
  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC_BYTES, 0);
  header[MAGIC_BYTES.byteLength] = VERSION;
  header[MAGIC_BYTES.byteLength + 1] = params.logN;
  header[MAGIC_BYTES.byteLength + 2] = params.r;
  header[MAGIC_BYTES.byteLength + 3] = params.p;
  header.set(salt, MAGIC_BYTES.byteLength + 4);
  return header;
}

/** Does this file carry the seal header? Read the bytes, not the name. */
export function isSealed(bytes: Uint8Array): boolean {
  if (bytes.byteLength < MAGIC_BYTES.byteLength) return false;
  return MAGIC_BYTES.every((b, i) => bytes[i] === b);
}

/** Does this look like the SQLite file it claims to be? */
export function looksLikeSqlite(bytes: Uint8Array): boolean {
  if (bytes.byteLength < SQLITE_MAGIC.length) return false;
  return [...SQLITE_MAGIC].every((c, i) => bytes[i] === c.charCodeAt(0));
}

/**
 * Read the header back off a sealed file.
 *
 * A version this build does not know is refused by NUMBER — "made by a newer
 * version of Peace" is something a person can act on, where letting it fall
 * through to a decryption failure would report a wrong passphrase and send them
 * hunting for a password that was never the problem.
 */
export function parseHeader(bytes: Uint8Array): { header: Header; payload: Uint8Array } {
  if (!isSealed(bytes)) throw new SealError('That file is not a sealed Peace backup.');
  if (bytes.byteLength < HEADER_BYTES) {
    throw new SealError('That backup is truncated — its header is incomplete.');
  }

  const at = MAGIC_BYTES.byteLength;
  const version = bytes[at];
  if (version !== VERSION) {
    throw new SealError(`That backup was made by a newer version of Peace (format ${version}).`);
  }

  return {
    header: {
      version,
      params: { logN: bytes[at + 1], r: bytes[at + 2], p: bytes[at + 3] },
      salt: bytes.slice(at + 4, at + 4 + SALT_BYTES),
    },
    payload: bytes.slice(HEADER_BYTES),
  };
}

/**
 * Seal.
 *
 * A FRESH SALT PER BACKUP. Reusing one would mean the same passphrase always
 * produced the same key, so one cracked backup would open every backup ever
 * made — and it would let anyone holding two files see that they share a key.
 * The nonce is left to expo-crypto, which generates 12 random bytes per call;
 * reusing a GCM nonce under one key is the classic catastrophe, so it is
 * deliberately not a parameter.
 */
export async function seal(
  plain: Uint8Array,
  passphrase: string,
  // Overridable so the cost can be raised later — and so tests can run cheap
  // ones. Whatever is used here is recorded in the file, which is what makes
  // both of those safe.
  params: KdfParams = KDF_PARAMS
): Promise<Uint8Array> {
  assertUsablePassphrase(passphrase);

  const salt = getRandomBytes(SALT_BYTES);
  const key = await AESEncryptionKey.import(await deriveKey(passphrase, salt, params));
  const sealed = await aesEncryptAsync(plain, key);

  // `combined` is IV ++ ciphertext ++ tag, exactly what `fromCombined` reads
  // back. Storing the three separately would mean inventing a layout and
  // keeping both ends of it in agreement forever.
  const payload = await sealed.combined();
  const out = new Uint8Array(HEADER_BYTES + payload.byteLength);
  out.set(buildHeader(salt, params), 0);
  out.set(payload, HEADER_BYTES);
  return out;
}

/**
 * Open a sealed backup, using only the file and the passphrase.
 *
 * A wrong passphrase fails on the GCM authentication tag rather than producing
 * plausible garbage, which is why the message can say "wrong passphrase" with
 * confidence instead of "the backup may be corrupt".
 */
export async function unseal(sealedBytes: Uint8Array, passphrase: string): Promise<Uint8Array> {
  const { header, payload } = parseHeader(sealedBytes);
  const key = await AESEncryptionKey.import(await deriveKey(passphrase, header.salt, header.params));

  let plain: Uint8Array;
  try {
    plain = (await aesDecryptAsync(AESSealedData.fromCombined(payload), key, {
      output: 'bytes',
    })) as Uint8Array;
  } catch (error) {
    console.warn('[drive] unseal failed', error);
    throw new SealError('That passphrase does not open this backup.');
  }

  /**
   * Belt and braces: the tag already proves authenticity, but this turns a
   * decrypted-yet-wrong file into a clear message rather than a confusing
   * SQLite error three screens later.
   *
   * EITHER SHAPE IS VALID. A backup made since attachments existed is a zip
   * container holding the database; one made before is the bare database. This
   * check only asks "did this decrypt to something we recognise" — which of the
   * two it is gets decided once, in `backup-payload.ts`.
   */
  if (!looksLikeSqlite(plain) && !looksLikeZip(plain)) {
    throw new SealError('That backup did not decrypt to a Peace backup.');
  }
  return plain;
}
