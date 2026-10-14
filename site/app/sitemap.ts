import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/meta';

export const dynamic = 'force-static';

/**
 * Every page under app/, found on disk at build time — never a list typed out
 * by hand. The hand list it replaces had to be remembered with each new page,
 * and a forgotten one fails silently: the page works, it is just never found.
 *
 * A page opts out the same way it opts out of search: `robots: { index: false }`
 * in its metadata (the /store/ graphics page does). Read from the source rather
 * than by importing the page, which would pull every page's component tree
 * into this route.
 */
const APP = join(process.cwd(), 'app');
const NOINDEX = /robots:\s*\{\s*index:\s*false/;
/** `renderContent('privacy')` — the page's words live in content/privacy.md. */
const CONTENT = /renderContent\('([\w-]+)'\)/g;

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Dynamic segments are files a page links to (/store/[file]), not pages.
      return entry.name.startsWith('[') ? [] : pages(path);
    }
    return entry.name === 'page.tsx' ? [path] : [];
  });
}

/**
 * The last commit to touch the page or the markdown it renders; the build time
 * outside a git checkout.
 */
function lastModified(file: string, source: string): Date {
  const words = [...source.matchAll(CONTENT)].map((m) => join(process.cwd(), 'content', `${m[1]}.md`));
  try {
    const iso = execFileSync('git', ['log', '-1', '--format=%cI', '--', file, ...words], {
      encoding: 'utf8',
    }).trim();
    if (iso) return new Date(iso);
  } catch {
    // No git, or not a repository — fall through.
  }
  return new Date();
}

export default function sitemap(): MetadataRoute.Sitemap {
  return pages(APP)
    .map((file) => ({ file, source: readFileSync(file, 'utf8') }))
    .filter(({ source }) => !NOINDEX.test(source))
    .map(({ file, source }) => {
      const dir = relative(APP, file).split(sep).slice(0, -1).join('/');
      const path = dir ? `/${dir}/` : '/';
      return {
        url: `${SITE_URL}${path}`,
        lastModified: lastModified(file, source),
        priority: path === '/' ? 1 : 0.6,
      };
    })
    .sort((a, b) => a.url.localeCompare(b.url));
}
