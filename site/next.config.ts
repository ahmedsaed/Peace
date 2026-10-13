import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

/**
 * Static HTML only. GitHub Pages serves files and runs nothing, so every page
 * is rendered at build time and there is no server to keep alive — which also
 * means the site cannot collect anything, by construction.
 */
const config: NextConfig = {
  output: 'export',
  // Pages serves `/privacy/index.html` for `/privacy`; without this a link
  // shared as `/privacy` 404s on Pages while working in `next dev`.
  trailingSlash: true,
  // The image optimiser is a server; a static export has none.
  images: { unoptimized: true },
  // This folder is its own project inside the app's repository; without this,
  // Next sees the app's lockfile one level up and guesses the wrong root.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
};

export default config;
