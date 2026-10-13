import type { Metadata } from 'next';

import { cardSize, CARDS, type CardName } from './social-card';

export const SITE_URL = 'https://peace.merope.dev';
export const SITE_NAME = 'Peace';

/**
 * A page's title, description, canonical URL and the Open Graph and Twitter
 * tags that repeat them.
 *
 * Next merges metadata SHALLOWLY: a page that sets `openGraph` replaces the
 * layout's whole object, and a page that does not inherits the layout's — so
 * the privacy policy unfurled with the home page's title until every page went
 * through this. The card is drawn by `app/og/[card]/route.tsx`.
 */
export function pageMeta({
  title,
  description,
  path,
  card,
}: {
  /** Undefined on the home page, which uses the layout's default title. */
  title?: string;
  description: string;
  /** With a trailing slash, as the static export serves it. */
  path: string;
  card: CardName;
}): Metadata {
  const fullTitle = title ? `${title} · ${SITE_NAME}` : HOME_TITLE;
  const image = { url: `/og/${card}.png`, ...cardSize, type: 'image/png', alt: CARDS[card].alt };
  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: 'en_US',
      url: path,
      title: fullTitle,
      description,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [image],
    },
  };
}

export const HOME_TITLE = 'Peace — an expense tracker that keeps its mouth shut';
export const HOME_DESCRIPTION =
  'Peace of mind, piece of cake. A local-first expense tracker for Android: every record lives on your phone, with no account, no server, no ads and no analytics.';
