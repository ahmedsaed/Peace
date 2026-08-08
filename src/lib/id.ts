/**
 * Row identifiers.
 *
 * UUIDs rather than autoincrement integers, because ids generated on two
 * devices must never collide if a sync layer is added later — and retrofitting
 * that onto integer keys means rewriting every foreign key in the database.
 *
 * Uses the platform's crypto when present (Hermes exposes `crypto.randomUUID`
 * on recent React Native) and falls back to a Math.random construction. The
 * fallback is not cryptographically strong, which is fine: these are row keys,
 * never secrets or anything an attacker benefits from guessing.
 */
export function newId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
