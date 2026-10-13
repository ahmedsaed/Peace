import { CARDS, type CardName, socialCard } from '@/lib/social-card';

/**
 * /og/<page>.png — the social cards, drawn once at build time.
 *
 * Not Next's `opengraph-image.tsx` convention: in a static export that writes
 * a file called `opengraph-image` with NO extension, and GitHub Pages picks a
 * content type from the extension, so it would go out as
 * application/octet-stream — which Facebook and LinkedIn refuse to unfurl.
 * Naming the file here is what makes Pages serve it as image/png.
 */
export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(CARDS).map((name) => ({ card: `${name}.png` }));
}

export function GET(_request: Request, { params }: { params: Promise<{ card: string }> }) {
  return params.then(({ card }) => socialCard(CARDS[card.replace(/\.png$/, '') as CardName]));
}
