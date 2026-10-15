import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';

/**
 * What every generated image shares: the palette, the fonts, and a phone.
 *
 * The social cards (`social-card.tsx`) and the Play Store graphics
 * (`store-graphics.tsx`) are drawn by Satori at build time from the app's real
 * screenshots. Satori reads TTF/OTF/WOFF but not WOFF2, which is why the fonts
 * come from @fontsource's `.woff` files rather than from next/font.
 */

// The app's "Ledger" palette, as in globals.css.
export const ground = '#17140f';
export const surface = '#241f17';
export const line = '#2e271d';
export const ink = '#efe4ce';
export const muted = '#9a8e79';
export const accent = '#e3a33c';

const site = process.cwd();
const read = (path: string) => readFileSync(join(site, path));

/** A PNG as a data URI. Paths are relative to `site/`. */
export const dataUri = (path: string) => `data:image/png;base64,${read(path).toString('base64')}`;

/** A PNG's pixel size, from its header — Satori needs it to place an image. */
export const pngSize = (path: string) => {
  const png = read(path);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

const font = (pkg: string, file: string) => read(`node_modules/@fontsource/${pkg}/files/${file}`);

export const fonts = () => [
  { name: 'Roboto', data: font('roboto', 'roboto-latin-400-normal.woff'), weight: 400 as const },
  { name: 'Roboto', data: font('roboto', 'roboto-latin-700-normal.woff'), weight: 700 as const },
  { name: 'Roboto', data: font('roboto', 'roboto-latin-900-normal.woff'), weight: 900 as const },
  { name: 'Pacifico', data: font('pacifico', 'pacifico-latin-400-normal.woff'), weight: 400 as const },
];

export const words = (text: string) => text.split(' ').filter(Boolean);

/**
 * A screenshot in a phone-shaped frame. `width` is the SCREEN's width; the
 * screenshots are 9:20, and whatever runs past the canvas edge is cut off by it.
 */
export function Phone({
  src,
  screen,
  width,
  rotate = 0,
  style,
}: {
  /** A screenshot to show… */
  src?: string;
  /** …or a screen drawn here, at `width` wide and 9:20 like the screenshots. */
  screen?: ReactNode;
  width: number;
  rotate?: number;
  style?: Record<string, string | number>;
}) {
  const pad = Math.round(width * 0.03);
  return (
    <div
      style={{
        display: 'flex',
        position: 'absolute',
        padding: pad,
        borderRadius: Math.round(width * 0.11),
        border: `${Math.max(1, Math.round(width / 270))}px solid ${line}`,
        background: surface,
        // Absent rather than `undefined` when upright: Satori rejects the key.
        ...(rotate ? { transform: `rotate(${rotate}deg)` } : {}),
        boxShadow: `0 ${Math.round(width / 9)}px ${Math.round(width / 4.5)}px rgba(0, 0, 0, 0.5)`,
        ...style,
      }}
    >
      {screen ? (
        <div
          style={{
            display: 'flex',
            width,
            height: Math.round((width * 20) / 9),
            borderRadius: Math.round(width * 0.08),
            overflow: 'hidden',
          }}
        >
          {screen}
        </div>
      ) : (
        <img
          src={src}
          width={width}
          height={Math.round((width * 20) / 9)}
          style={{ borderRadius: Math.round(width * 0.08) }}
        />
      )}
    </div>
  );
}

/** A warm glow, so a phone does not float on flat black. */
export function Glow({ size, style }: { size: number; style: Record<string, string | number> }) {
  return (
    <div
      style={{
        position: 'absolute',
        width: size,
        height: size,
        // Fades out at 70% of the corner distance, i.e. inside the square, so
        // the gradient's box never shows as an edge.
        background: 'radial-gradient(circle at center, rgba(227,163,60,0.2) 0%, rgba(227,163,60,0) 70%)',
        ...style,
      }}
    />
  );
}
