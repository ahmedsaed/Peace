import { ImageResponse } from 'next/og';

import { accent, dataUri, fonts, ground, ink, muted, Phone, pngSize, words } from './render';

/**
 * The Play Store listing's graphics, drawn at build time and published under
 * `/store/` (see `store/README.md` for what goes where in Play Console).
 *
 * WHY FRAMED, AND NOT THE RAW CAPTURES: Play refuses a screenshot whose long
 * side is more than twice its short side, and a modern phone's 1080×2400 is
 * 2.22. A 1080×1920 canvas is the size Play recommends for phone screenshots,
 * and the room above the phone carries a caption — the only text a browsing
 * user reads before deciding whether to scroll on.
 *
 * Drawn from `store/screenshots/` — FULL resolution, written by
 * `npm run shots` — never from the halved copies the README and website use,
 * which would come out soft at this size.
 */

const raw = (name: string) => dataUri(`../store/screenshots/${name}.png`);

/**
 * A home screen with the widgets on it, `width` px wide (designed at 1080).
 *
 * The widgets are the REAL renders, cropped off the emulator by
 * `npm run shots:widgets` with their corners already transparent; only the
 * wallpaper and the arrangement are drawn here. A launcher's own furniture —
 * a clock, a search bar, other apps' icons — is left out on purpose: it would
 * be somebody else's interface in our listing, and none of it is Peace.
 */
export function HomeScreen({ width }: { width: number }) {
  const scale = width / 1080;
  const widget = (name: string, left: number, top: number) => {
    const path = `../store/screenshots/widget-${name}.png`;
    const size = pngSize(path);
    return (
      <img
        src={dataUri(path)}
        width={Math.round(size.width * scale)}
        height={Math.round(size.height * scale)}
        style={{ position: 'absolute', left: Math.round(left * scale), top: Math.round(top * scale) }}
      />
    );
  };
  return (
    <div
      style={{
        display: 'flex',
        position: 'relative',
        width: '100%',
        height: '100%',
        // A wallpaper in the app's own warm dark, lit from the top corner.
        backgroundImage: `radial-gradient(circle at 20% 8%, #5a4526 0%, #2b2217 38%, ${ground} 75%)`,
      }}
    >
      {/* Centred down the screen, 60px apart — at the 1080 the crops are
          taken at. The store shot shows the top three; the site, all four. */}
      {widget('balance', 67, 250)}
      {widget('budget', 67, 898)}
      {widget('balance-compact', 67, 1546)}
      {widget('quick', 67, 1879)}
    </div>
  );
}

/** The home screen on its own, 1080×2400, for the website's feature section. */
export function homeScreenImage() {
  return new ImageResponse(<HomeScreen width={1080} />, { width: 1080, height: 2400 });
}

export const SHOT_SIZE = { width: 1080, height: 1920 };
export const FEATURE_SIZE = { width: 1024, height: 500 };
export const ICON_SIZE = { width: 512, height: 512 };

type StoreShot = {
  /** A capture in store/screenshots, or `home`: the widgets on a home screen. */
  shot: string;
  title: string;
  /** Trailing words of the title in the accent colour. */
  highlight?: string;
  subtitle: string;
};

/**
 * The warm light behind the phones, as the canvas's own background.
 *
 * Opaque colours on the ROOT rather than the translucent `Glow` box the social
 * cards use: at these sizes Satori showed that box's edge as a hard line across
 * the feature graphic. A gradient that IS the background has no edge to show.
 */
const glow = (at: string) => `radial-gradient(circle at ${at}, #2a2115 0%, ${ground} 60%)`;

/** In listing order: the first two are what a search result shows. */
export const STORE_SHOTS: StoreShot[] = [
  {
    shot: 'records',
    title: 'Peace of mind.',
    highlight: 'Piece of cake.',
    subtitle: 'A private expense tracker that lives on your phone.',
  },
  {
    shot: 'record',
    title: 'Log a spend',
    highlight: 'in seconds.',
    subtitle: 'A calculator keypad that walks you from the amount to saved.',
  },
  {
    shot: 'home',
    title: 'On your',
    highlight: 'home screen.',
    subtitle: 'Your balance and budget at a glance, and a spend added in one tap.',
  },
  {
    shot: 'budgets',
    title: 'Know what',
    highlight: "is left.",
    subtitle: 'A budget per category, with the room you still have this month.',
  },
  {
    shot: 'analysis',
    title: 'See where',
    highlight: 'it went.',
    subtitle: 'Spending ranked by category, with shares that add up to 100%.',
  },
  {
    shot: 'accounts',
    title: 'Every account,',
    highlight: 'adding up.',
    subtitle: 'Cash, bank and cards — and a card reads as what you owe.',
  },

  {
    shot: 'recurring',
    title: 'Bills that',
    highlight: 'ask first.',
    subtitle: 'Repeating payments come due as suggestions, never posted behind your back.',
  },
  {
    shot: 'welcome',
    title: 'No account.',
    highlight: 'No tracking.',
    subtitle: 'Nothing leaves your phone unless you turn it on. Free and open source.',
  },
];

function Headline({
  title,
  highlight,
  size,
}: {
  title: string;
  highlight?: string;
  size: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        fontSize: size,
        fontWeight: 900,
        lineHeight: 1.08,
        letterSpacing: -size / 40,
      }}
    >
      {words(title).map((word, i) => (
        <span key={`t${i}`} style={{ margin: `0 ${size / 8}px` }}>
          {word}
        </span>
      ))}
      <div style={{ width: '100%' }} />
      {words(highlight ?? '').map((word, i) => (
        <span key={`h${i}`} style={{ margin: `0 ${size / 8}px`, color: accent }}>
          {word}
        </span>
      ))}
    </div>
  );
}

export function storeShot(index: number) {
  const { shot, title, highlight, subtitle } = STORE_SHOTS[index];
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: '100%',
          height: '100%',
          backgroundImage: glow('50% 62%'),
          color: ink,
          fontFamily: 'Roboto',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '120px 80px 0',
            textAlign: 'center',
          }}
        >
          <Headline title={title} highlight={highlight} size={92} />
          <div style={{ fontSize: 40, lineHeight: 1.35, color: muted, marginTop: 32, maxWidth: 860 }}>
            {subtitle}
          </div>
        </div>
        {/* Bleeds off the bottom edge on purpose: the top of a screen is the
            part that says what it is, and a whole phone shrunk to fit is a
            screenshot nobody can read at listing size. */}
        {shot === 'home' ? (
          <Phone screen={<HomeScreen width={760} />} width={760} style={{ top: 600 }} />
        ) : (
          <Phone src={raw(shot)} width={760} style={{ top: 600 }} />
        )}
      </div>
    ),
    { ...SHOT_SIZE, fonts: fonts() },
  );
}

/**
 * 1024×500, shown above the listing and wherever Play promotes the app. Play
 * may crop its edges and lay its own play button over the centre, so the words
 * sit left and the phones right with nothing that matters in the middle.
 */
export function featureGraphic() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          backgroundImage: glow('78% 40%'),
          color: ink,
          fontFamily: 'Roboto',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            width: 560,
            paddingLeft: 64,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <img src={dataUri('public/logo-mark.png')} width={84} height={84} />
            <span style={{ fontFamily: 'Pacifico', fontSize: 80, color: accent, lineHeight: 1, marginTop: -12 }}>
              Peace
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontSize: 44,
              fontWeight: 900,
              lineHeight: 1.1,
              marginTop: 26,
              letterSpacing: -0.9,
            }}
          >
            <span>Peace of mind.</span>
            <span style={{ color: accent }}>Piece of cake.</span>
          </div>
          <div style={{ fontSize: 24, color: muted, marginTop: 16 }}>
            A private expense tracker for Android.
          </div>
        </div>
        <div style={{ display: 'flex', position: 'relative', flex: 1 }}>
          <Phone src={raw('analysis')} width={220} rotate={8} style={{ left: 170, top: 46 }} />
          <Phone src={raw('records')} width={220} rotate={-4} style={{ left: 20, top: 78 }} />
        </div>
      </div>
    ),
    { ...FEATURE_SIZE, fonts: fonts() },
  );
}

/** The 512×512 store icon: the launcher icon, at the size Play asks for. */
export function storeIcon() {
  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        <img src={dataUri('public/icon.png')} width={512} height={512} />
      </div>
    ),
    ICON_SIZE,
  );
}
