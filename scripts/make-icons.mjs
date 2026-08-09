/**
 * Generates every launcher/splash asset from one vector definition.
 *
 *   npm i --no-save sharp && node scripts/make-icons.mjs
 *
 * `sharp` is deliberately NOT a dependency: it ships a large platform-specific
 * binary and this script runs about twice a year. Installing it with --no-save
 * keeps it out of package.json and the lockfile, which `npm ci` validates
 * strictly (see AGENTS.md).
 *
 * The SVGs are written to assets/logo/ alongside the PNGs so the artwork stays
 * editable and diffable. Never hand-edit the PNGs — change the geometry here
 * and re-run.
 *
 * ANDROID ADAPTIVE ICON GEOMETRY, which is why the art looks "too small" here:
 * the launcher composes a 108x108dp canvas and masks it down to 72x72dp, with
 * only the central 66x66dp circle guaranteed visible on every launcher. So the
 * artwork is scaled to fit a circle of radius 0.5 * 66/108 = 30.6% of the
 * canvas. Art drawn edge-to-edge gets its corners eaten by a circular mask.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES = resolve(root, 'assets/images');
const LOGO = resolve(root, 'assets/logo');

const palette = {
  ground: '#17140F',
  surface: '#241F17',
  ink: '#EFE4CE',
  accent: '#E3A33C',
  transfer: '#75A8C4',
};

/** Wallet greens — deeper and more saturated than the in-app `income` sage. */
const WALLET = '#3F8055';
const CLASP = '#4A9463';
const CARD_BACK = '#2F6341';

const S = 1024;

// ---------------------------------------------------------------------------
// Geometry
//
// One coordinate system (0 0 1024 1024) shared by every layer, so the
// monochrome silhouette lines up with the colour art by construction rather
// than by two sets of numbers that drift.
// ---------------------------------------------------------------------------

/**
 * Back to front. The cards are drawn first and the wallet covers their lower
 * halves, so only the fan shows.
 *
 * The clasp is not decoration: without something breaking the right edge this
 * silhouette reads as a folder, not a wallet. It is the cheapest signal that
 * survives to 48px.
 */
const SHAPES = [
  { rect: { x: 270, y: 250, w: 300, h: 240, r: 36 }, fill: CARD_BACK },
  { rect: { x: 340, y: 296, w: 300, h: 210, r: 36 }, fill: palette.accent },
  { rect: { x: 410, y: 342, w: 300, h: 180, r: 36 }, fill: palette.transfer },
  { rect: { x: 200, y: 430, w: 560, h: 330, r: 66 }, fill: WALLET },
  { rect: { x: 650, y: 520, w: 180, h: 150, r: 48 }, fill: CLASP },
  { circle: { cx: 748, cy: 595, r: 30 }, fill: palette.accent, hole: true },
];

/**
 * Two leaves and a stem, drawn on the wallet face left of the clasp. Money that
 * grows — and at 48px the only part of the mark still legible, which is why it
 * is also what the monochrome layer knocks out.
 */
const SPROUT = {
  stem: 'M 548 560 C 536 632 532 690 532 744',
  stemWidth: 18,
  leaves: [
    'M 536 648 C 604 627 634 579 624 508 C 556 529 526 577 536 648 Z',
    'M 520 664 C 464 661 434 631 432 574 C 488 577 518 607 520 664 Z',
  ],
  // Drawn centred on (533,628); moved onto the wallet face, clear of the clasp.
  place: 'translate(420 595) translate(-533 -628)',
};

/**
 * Bounding box of everything above, and the scale that fits its furthest point
 * inside the guaranteed-visible circle (radius 341 of 1024). Recompute both if
 * the geometry moves.
 */
const BBOX = { cx: 515, cy: 505 };
const SAFE_SCALE = 0.9;

const rect = (c, fill) =>
  `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="${c.r}" fill="${fill}"/>`;
const circle = (c, fill) => `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" fill="${fill}"/>`;
const draw = (s, fill) => (s.rect ? rect(s.rect, fill) : circle(s.circle, fill));

/** Same shape, grown by `g` on every side — used to punch gaps in the mask. */
const grow = (s, g) =>
  s.rect
    ? { rect: { x: s.rect.x - g, y: s.rect.y - g, w: s.rect.w + g * 2, h: s.rect.h + g * 2, r: s.rect.r + g } }
    : { circle: { cx: s.circle.cx, cy: s.circle.cy, r: s.circle.r + g } };

const sprout = (fill) => `<g transform="${SPROUT.place}">
      <path d="${SPROUT.stem}" fill="none" stroke="${fill}" stroke-width="${SPROUT.stemWidth}" stroke-linecap="round"/>
      ${SPROUT.leaves.map((d) => `<path d="${d}" fill="${fill}"/>`).join('\n      ')}
    </g>`;

/** @param scale 1 draws the art as defined; the adaptive foreground shrinks. */
const art = (scale, sproutFill = palette.ink) =>
  `<g transform="translate(512 512) scale(${scale}) translate(${-BBOX.cx} ${-BBOX.cy})">
    ${SHAPES.map((s) => draw(s, s.fill)).join('\n    ')}
    ${sprout(sproutFill)}
  </g>`;

const GROUND = `<defs>
    <radialGradient id="g" cx="50%" cy="42%" r="72%">
      <stop offset="0%" stop-color="${palette.surface}"/>
      <stop offset="100%" stop-color="${palette.ground}"/>
    </radialGradient>
  </defs>
  <rect width="${S}" height="${S}" fill="url(#g)"/>`;

const svg = (body, background = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
${background}
${body}
</svg>`;

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/** Adaptive foreground: transparent, art inside the safe circle. */
const foreground = svg(art(SAFE_SCALE));

/**
 * Adaptive background. Flat #17140F vanishes into a dark wallpaper, so this is
 * a soft radial that lifts the centre just enough to read as a tile.
 */
const background = svg('', GROUND);

/**
 * Themed icons (Android 13+) use ONLY this image's alpha channel — the colour
 * is discarded and replaced by the wallpaper theme. So the shapes have to be
 * separated by transparent gaps rather than by colour: flattened to a single
 * silhouette, the cards and the clasp would merge into an unreadable blob. The
 * mask paints a gap around every shape before filling it, and knocks the sprout
 * and the clasp button out as holes.
 */
const GAP = 16;
const monochrome = svg(
  `<defs>
    <mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${S}" height="${S}">
      <g transform="translate(512 512) scale(${SAFE_SCALE}) translate(${-BBOX.cx} ${-BBOX.cy})">
        ${SHAPES.map((s, i) =>
          [
            // The first shape has nothing in front of it to separate from.
            i === 0 ? '' : draw(grow(s, GAP), '#000'),
            draw(s, s.hole ? '#000' : '#fff'),
          ]
            .filter(Boolean)
            .join('\n        ')
        ).join('\n        ')}
        ${sprout('#000')}
      </g>
    </mask>
  </defs>
  <rect width="${S}" height="${S}" fill="#fff" mask="url(#m)"/>`
);

/**
 * Legacy square icon (pre-adaptive launchers, web, stores). Only rounded
 * corners are applied, so the art can run larger than the adaptive layer.
 */
const legacy = svg(art(1.06), GROUND);

/** Splash: transparent, sized by `imageWidth` in app.json over a flat ground. */
const splash = svg(art(1.0));

// ---------------------------------------------------------------------------

const layers = [
  ['peace-icon-foreground', foreground, `${IMAGES}/android-icon-foreground.png`],
  ['peace-icon-background', background, `${IMAGES}/android-icon-background.png`],
  ['peace-icon-monochrome', monochrome, `${IMAGES}/android-icon-monochrome.png`],
  ['peace-icon', legacy, `${IMAGES}/icon.png`],
  ['peace-splash', splash, `${IMAGES}/splash-icon.png`],
];

mkdirSync(LOGO, { recursive: true });
mkdirSync(IMAGES, { recursive: true });

for (const [name, source, out] of layers) {
  writeFileSync(`${LOGO}/${name}.svg`, source);
  await sharp(Buffer.from(source), { density: 384 }).resize(S, S).png().toFile(out);
  console.log(`${out}  ${S}x${S}`);
}

// In-app mark for the drawer header. Rendered at 40dp, so 144px covers a 3.5x
// screen — pointing <Image> at the 1024px launcher icon would decode a
// megapixel to draw a thumbnail.
await sharp(Buffer.from(splash), { density: 384 })
  .resize(144, 144)
  .png()
  .toFile(`${IMAGES}/logo-mark.png`);
console.log(`${IMAGES}/logo-mark.png  144x144`);

// Favicon is the legacy icon downscaled; browsers render it at 16-32px.
await sharp(Buffer.from(legacy), { density: 384 })
  .resize(48, 48)
  .png()
  .toFile(`${IMAGES}/favicon.png`);
console.log(`${IMAGES}/favicon.png  48x48`);
