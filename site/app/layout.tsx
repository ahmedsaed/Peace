import type { Metadata } from 'next';
import { Pacifico } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';

import './globals.css';

// Downloaded at BUILD time and served from this site, so a visitor's browser
// never contacts Google — the privacy page would otherwise be the one page on
// the site that phones home.
const pacifico = Pacifico({ weight: '400', subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL('https://peace.merope.dev'),
  title: {
    default: 'Peace — an expense tracker that keeps its mouth shut',
    template: '%s · Peace',
  },
  description:
    'A local-first expense tracker for Android. Every record lives on your phone: no account, no server, no ads, no analytics.',
  icons: { icon: '/icon.png' },
  openGraph: {
    title: 'Peace — an expense tracker that keeps its mouth shut',
    description: 'A local-first expense tracker for Android. No account, no server, no ads, no analytics.',
    images: ['/screenshots/records.png'],
  },
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
              <a href="https://github.com/ahmedsaed/Peace">Source code</a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
