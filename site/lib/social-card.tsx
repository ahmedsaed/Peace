import { ImageResponse } from 'next/og';

import { accent, dataUri, fonts, Glow, ground, ink, muted, Phone, words } from './render';

/**
 * The 1200×630 card a link to this site unfurls into, rendered to a PNG at
 * BUILD time by `app/og/[card]/route.tsx` and named in each page's metadata
 * through `pageMeta`.
 *
 * Generated rather than drawn once in an editor, because the phones on it are
 * the app's real screenshots: when `npm run shots` replaces them, every card
 * follows on the next build instead of advertising a screen that no longer
 * exists.
 */
export const cardSize = { width: 1200, height: 630 };

type Card = {
  /** Small caps line above the title; omitted on the home card. */
  eyebrow?: string;
  title: string;
  /** Trailing words of the title, drawn in the accent colour. */
  highlight?: string;
  /** Start the highlight on a line of its own. */
  stacked?: boolean;
  subtitle: string;
  /** Two screenshot names from docs/screenshots: back, front. */
  shots: [string, string];
  /** What the card shows, for og:image:alt. */
  alt: string;
};

export const CARDS = {
  home: {
    title: 'Peace of mind.',
    highlight: 'Piece of cake.',
    stacked: true,
    subtitle: 'An expense tracker that keeps its mouth shut. Local-first, for Android: no account, no server, no ads.',
    shots: ['analysis', 'records'],
    alt: 'Peace — peace of mind, piece of cake: an expense tracker for Android, with two screens of the app.',
  },
  data: {
    eyebrow: 'Your data',
    title: 'What leaves your phone?',
    highlight: 'Only what you ask.',
    stacked: true,
    subtitle: 'Four connections, each off until you turn it on. Everything else stays on the phone.',
    shots: ['accounts', 'budgets'],
    alt: 'Your data in Peace: what can leave your phone, when, and to whom.',
  },
  privacy: {
    eyebrow: 'Privacy policy',
    title: 'Peace of mind,',
    highlight: 'by default.',
    stacked: true,
    subtitle: 'No account, no server, no tracking — and exactly what can ever leave your phone.',
    shots: ['search', 'record'],
    alt: 'The Peace privacy policy.',
  },
  move: {
    eyebrow: 'Moving to Google Play',
    title: 'Same ledger,',
    highlight: 'new install.',
    stacked: true,
    subtitle: 'From the GitHub version to the Play version: back up, install, restore.',
    shots: ['records', 'welcome'],
    alt: 'Moving Peace from the GitHub version to the Google Play version.',
  },
  import: {
    eyebrow: 'Importing records',
    title: 'Bring your history',
    highlight: 'with you.',
    stacked: true,
    subtitle: 'One CSV format — the one Peace exports. Previewed before anything is added, and undoable.',
    shots: ['search', 'records'],
    alt: 'Importing records into Peace from a CSV file.',
  },
} satisfies Record<string, Card>;

export type CardName = keyof typeof CARDS;

export function socialCard({ eyebrow, title, highlight, stacked, subtitle, shots }: Card) {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          background: ground,
          color: ink,
          fontFamily: 'Roboto',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Glow size={760} style={{ right: -160, top: -120 }} />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: 700,
            padding: '64px 0 60px 72px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <img src={dataUri('public/logo-mark.png')} width={64} height={64} />
            <span style={{ fontFamily: 'Pacifico', fontSize: 50, color: accent, lineHeight: 1, marginTop: -8 }}>
              Peace
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {eyebrow ? (
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: 3,
                  textTransform: 'uppercase',
                  color: muted,
                  marginBottom: 16,
                }}
              >
                {eyebrow}
              </div>
            ) : null}
            {/* Word by word: Satori lays out multi-child text as flex items, so a
                single highlighted span would wrap as one block, indent and all. */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                fontSize: 62,
                fontWeight: 900,
                lineHeight: 1.08,
                letterSpacing: -1.5,
              }}
            >
              {words(title).map((word, i) => (
                <span key={`t${i}`} style={{ marginRight: 16 }}>
                  {word}
                </span>
              ))}
              {stacked ? <div style={{ width: '100%' }} /> : null}
              {words(highlight ?? '').map((word, i) => (
                <span key={`h${i}`} style={{ marginRight: 16, color: accent }}>
                  {word}
                </span>
              ))}
            </div>
            <div style={{ fontSize: 28, lineHeight: 1.4, color: muted, marginTop: 24, maxWidth: 580 }}>
              {subtitle}
            </div>
          </div>

          <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, color: ink }}>peace.merope.dev</div>
        </div>

        <div style={{ display: 'flex', position: 'relative', flex: 1 }}>
          <div style={{ display: 'flex', position: 'absolute', left: 150 }}>
            <Phone src={dataUri(`public/screenshots/${shots[0]}.png`)} width={270} rotate={8} style={{ top: 70 }} />
          </div>
          <div style={{ display: 'flex', position: 'absolute', left: 0 }}>
            <Phone src={dataUri(`public/screenshots/${shots[1]}.png`)} width={270} rotate={-4} style={{ top: 110 }} />
          </div>
        </div>
      </div>
    ),
    {
      ...cardSize,
      fonts: fonts(),
    },
  );
}
