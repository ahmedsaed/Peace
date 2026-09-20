/**
 * A regex-safe key for a testID built out of data.
 *
 * Maestro matches testIDs as REGULAR EXPRESSIONS, so an id carrying the
 * characters real data is full of — the colons in `seed:acct:cash`, the spaces
 * and apostrophes in a name somebody typed — is a pattern rather than a name.
 * `key-op-+` is the case that shipped: it read as "`key-op` then one or more
 * hyphens" and silently tapped the minus key, under a green E2E test claiming
 * to add.
 *
 * Letters, digits and single hyphens, which is what AGENTS.md asks for and
 * what a flow can be written against by hand.
 */
export function idSlug(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}
