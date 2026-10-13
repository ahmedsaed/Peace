import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { marked } from 'marked';

/**
 * A page of `content/*.md`, rendered to HTML at build time.
 *
 * The markdown is the source, not this site: `content/privacy.md` is checked
 * against the app's code and changes in the same PR as a feature that sends
 * something new, so the page can never say something the file does not.
 */
export function renderContent(name: string): string {
  const source = readFileSync(join(process.cwd(), 'content', `${name}.md`), 'utf8')
    // Editor notes at the top of a file are for whoever edits it, not readers.
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  return marked.parse(source, { async: false });
}

/**
 * Placeholders still waiting for a real value.
 *
 * The deploy workflow refuses to publish while any remain: a privacy policy
 * that says "[SUPPORT EMAIL]" is worse than none, because it looks finished.
 */
export function placeholdersIn(name: string): string[] {
  const source = readFileSync(join(process.cwd(), 'content', `${name}.md`), 'utf8');
  return [...new Set(source.match(/\[[A-Z][A-Z ]+\]/g) ?? [])];
}
