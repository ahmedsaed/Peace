import type { Metadata, Viewport } from 'next';
import { Pacifico } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { HOME_DESCRIPTION, HOME_TITLE, pageMeta, SITE_NAME, SITE_URL } from '@/lib/meta';

import './globals.css';

// Downloaded at BUILD time and served from this site, so a visitor's browser
// never contacts Google — the privacy page would otherwise be the one page on
// the site that phones home.
const pacifico = Pacifico({ weight: '400', subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: HOME_TITLE, template: `%s · ${SITE_NAME}` },
  applicationName: SITE_NAME,
  authors: [{ name: 'Merope', url: 'https://merope.dev' }],
  creator: 'Merope',
  icons: { icon: '/icon.png', apple: '/icon.png' },
  // Every page sets its own through pageMeta(); this covers any that forgets.
  ...pageMeta({ description: HOME_DESCRIPTION, path: '/', card: 'home' }),
};

export const viewport: Viewport = {
  themeColor: '#17140f',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="wrap">
            <Link href="/" className="brand" aria-label="Peace, home">
              <img src="/logo-mark.png" alt="" width={32} height={32} />
              <span className={`wordmark ${pacifico.className}`}>Peace</span>
            </Link>
            <nav className="site-nav" aria-label="Site">
              <Link href="/#features" className="optional">
                Features
              </Link>
              <Link href="/#themes" className="optional">
                Themes
              </Link>
              <Link href="/data/">Your data</Link>
              <Link href="/privacy/">Privacy</Link>
            </nav>
          </div>
        </header>

        <main>{children}</main>

        <footer className="site-footer">
          <div className="wrap">
            <span>
              Peace is made by <a href="https://merope.dev">Merope</a>. Free software under the GPL-3.0.
            </span>
            <nav aria-label="Footer">
              <Link href="/data/">Your data</Link>
              <Link href="/privacy/">Privacy policy</Link>
              <Link href="/delete/">Deleting your data</Link>
              <Link href="/move/">Moving to Play</Link>
              <Link href="/import/">Importing records</Link>
              <a href="https://github.com/ahmedsaed/Peace">Source code</a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
