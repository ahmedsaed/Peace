import type { ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * Slug -> glyph resolution.
 *
 * Categories and accounts store an icon *slug* (see src/db/seed.ts), never a
 * glyph, so replacing this set later is a code change rather than a data
 * migration. Unknown slugs fall back to `dots` instead of rendering nothing —
 * a missing icon should look deliberate, not broken.
 *
 * Paths are 24x24, single-path, designed to stay legible at 14px inside a
 * 26px circle.
 */
const PATHS: Record<string, string> = {
  // --- tab bar ---
  records: 'M5 2h14v20l-2.3-1.6L14.4 22l-2.4-1.7L9.6 22l-2.3-1.6L5 22V2zm3 5v2h8V7H8zm0 4v2h8v-2H8z',
  // Pie chart: a disc with one wedge cut away, which reads at 22px far better
  // than a wedge alone (that renders as an ambiguous blob).
  analysis: 'M11 2.05A10 10 0 1 0 21.95 13H11V2.05zM13 2v9h9a10 10 0 0 0-9-9z',
  budgets:
    'M4 2h16v20H4V2zm3 4v3h10V6H7zm0 6v2h3v-2H7zm7 0v2h3v-2h-3zm-7 4v2h3v-2H7zm7 0v2h3v-2h-3z',
  accounts: 'M3 6h18v12H3V6zm2 3v6h14V9H5zm10 1.5h3v3h-3v-3z',
  categories: 'M2 11V3h8l11 11-8 8L2 11zm4-6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',

  // --- categories ---
  food: 'M8 2v8H6V2H4v8a4 4 0 0 0 3 3.9V22h2v-8.1A4 4 0 0 0 12 10V2h-2v8H8V2zm9 0c-1.7 0-3 2.7-3 6 0 2.6.8 4.8 2 5.6V22h2V2z',
  fork: 'M8 2v8H6V2H4v8a4 4 0 0 0 3 3.9V22h2v-8.1A4 4 0 0 0 12 10V2h-2v8H8V2zm9 0c-1.7 0-3 2.7-3 6 0 2.6.8 4.8 2 5.6V22h2V2z',
  cart: 'M4 4h2l2.7 9.6a2 2 0 0 0 2 1.4h6.6a2 2 0 0 0 1.9-1.4L21 7H7m1 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zm8 0a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0z',
  cup: 'M4 4h13v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V4zm13 2h2a2 2 0 0 1 0 4h-2V6zM3 18h15v2H3v-2z',
  bus: 'M4 16V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v10h-1.5a2 2 0 1 1-4 0h-5a2 2 0 1 1-4 0H4zm2-9v4h12V7H6z',
  taxi: 'M5 11l1.5-4A2 2 0 0 1 8.4 6h7.2a2 2 0 0 1 1.9 1.4L19 11v6h-2a1.5 1.5 0 1 1-3 0h-4a1.5 1.5 0 1 1-3 0H5v-6zm2.2-1h9.6l-1-3H8.2l-1 3zM9 2h6v2H9V2z',
  fuel: 'M4 3h9v18H4V3zm2 3v4h5V6H6zm10 1l3 3v8a2 2 0 0 1-4 0v-5h-1V9l2-2z',
  car: 'M5 11l1.6-4.3A2 2 0 0 1 8.5 5.4h7a2 2 0 0 1 1.9 1.3L19 11v6h-2.2a1.6 1.6 0 1 1-3.2 0h-3.2a1.6 1.6 0 1 1-3.2 0H5v-6zm2.3-1h9.4l-1.1-3H8.4l-1.1 3z',
  receipt: 'M5 2h14v20l-2.3-1.6L14.4 22l-2.4-1.7L9.6 22l-2.3-1.6L5 22V2zm3 5v2h8V7H8zm0 4v2h8v-2H8z',
  bolt: 'M13 2L4 14h6l-1 8 9-12h-6l1-8z',
  wifi: 'M12 20l3-3.5a4 4 0 0 0-6 0L12 20zM5.5 12.5a9 9 0 0 1 13 0l-2 2a6 6 0 0 0-9 0l-2-2zM2 9a14 14 0 0 1 20 0l-2 2a11 11 0 0 0-16 0L2 9z',
  bag: 'M6 7h12l1.2 13H4.8L6 7zm3 0a3 3 0 0 1 6 0h-2a1 1 0 0 0-2 0H9z',
  film: 'M3 4h18v16H3V4zm2 2v2h2V6H5zm12 0v2h2V6h-2zM5 10v4h14v-4H5zm0 6v2h2v-2H5zm12 0v2h2v-2h-2z',
  heart: 'M12 21S3 14.5 3 8.8A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 9 2.8C21 14.5 12 21 12 21z',
  // Every segment must be a closed filled shape — this Path has no stroke, so
  // open line segments (M5 8l3 2) render as nothing at all.
  flower:
    'M12 3a3 3 0 0 1 3 3 3 3 0 0 1-3 3 3 3 0 0 1-3-3 3 3 0 0 1 3-3zm0 8c3.3 0 6 2.5 6 5.5S15.3 22 12 22s-6-2.5-6-5.5S8.7 11 12 11zM4 6.5l3.5 2-1 1.7-3.5-2zM20 6.5l1 1.7-3.5 2-1-1.7z',
  shirt: 'M8 2l4 2 4-2 5 3-2 4-2-1v14H7V8L5 9 3 5l5-3z',
  house: 'M12 3l9 8h-3v10h-5v-6h-2v6H6V11H3l9-8z',
  book: 'M4 3h11a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3V3zm2 2v13c0 .6.4 1 1 1h9V6a1 1 0 0 0-1-1H6z',
  phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm3 17h4v-1h-4v1z',
  plane: 'M2 13l20-9-4 18-5-6-4 4v-5L2 13z',
  gift: 'M3 9h18v3H3V9zm1 5h16v8H4v-8zm8-11a3 3 0 0 1 5 2h-5V3zm0 0v2H7a3 3 0 0 1 5-2zM11 9h2v13h-2V9z',
  paw: 'M6 12a2.2 2.2 0 1 0 0-4.4A2.2 2.2 0 0 0 6 12zm12 0a2.2 2.2 0 1 0 0-4.4A2.2 2.2 0 0 0 18 12zM9.5 7.5A2.2 2.2 0 1 0 9.5 3a2.2 2.2 0 0 0 0 4.5zm5 0A2.2 2.2 0 1 0 14.5 3a2.2 2.2 0 0 0 0 4.5zM12 12c-3 0-5.5 2.6-5.5 5A3 3 0 0 0 9.5 20c1 0 1.7-.6 2.5-.6s1.5.6 2.5.6a3 3 0 0 0 3-3c0-2.4-2.5-5-5.5-5z',
  bottle: 'M10 2h4v3l1.5 2A4 4 0 0 1 16 9.4V20a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V9.4c0-.9.3-1.7.5-2.4L10 5V2zm-1 9h6v3H9v-3z',
  shield: 'M12 2l8 3v6c0 5-3.4 9.2-8 11-4.6-1.8-8-6-8-11V5l8-3z',
  wallet: 'M3 6h15a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H3V6zm0-2h13v2H3V4zm13.5 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  star: 'M12 2l3 6.5 7 .9-5 4.9 1.2 7L12 18l-6.2 3.3L7 14.3l-5-4.9 7-.9L12 2z',
  refresh: 'M12 4V1L8 5l4 4V6a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z',
  key: 'M14 2a6 6 0 0 0-5.7 8L2 16.3V22h5.7v-2.4h2.4v-2.4h2.4l1.6-1.6A6 6 0 1 0 14 2zm2.5 3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  tag: 'M2 11V3h8l11 11-8 8L2 11zm4-6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  // The slash is a filled quad, not a line, for the same reason as `flower`.
  percent:
    'M6.5 3a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm11 11a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM18.3 2.2l2.5 1.7L5.7 21.8l-2.5-1.7z',
  cash: 'M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4V6zm9 2.5L10.6 11H13l-1 4.5L13.4 13H11l1-4.5z',
  bank: 'M12 2l10 6H2l10-6zM4 10h2v8H4v-8zm5 0h2v8H9v-8zm5 0h2v8h-2v-8zm5 0h2v8h-2v-8zM2 20h20v2H2v-2z',
  dots: 'M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  calendar:
    'M7 2v2h10V2h2v2h2v18H1V4h2V2h2zm12 8H3v10h16V10zM6 12h3v3H6v-3zm5 0h3v3h-3v-3z',
  clock: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm1 5h-2v6.4l4.6 2.8 1-1.7-3.6-2.2V7z',
  // Two opposed arrows. Deliberately NOT the same glyph as `refresh`, which is
  // already the Installments category — a transfer and a recurring charge
  // looking identical in the list is a real misread.
  transfer: 'M4 8h11V5l5 4.5-5 4.5v-3H4V8zm16 8H9v-3l-5 4.5L9 22v-3h11v-3z',
};

export type IconName = keyof typeof PATHS;

export function hasIcon(name: string): boolean {
  return name in PATHS;
}

export function Icon({
  name,
  size = 20,
  color = '#EFE4CE',
}: {
  name: string;
  size?: number;
  // ColorValue, not string: React Navigation hands tabBarIcon an opaque colour
  // on some platforms rather than a hex literal.
  color?: ColorValue;
}) {
  const d = PATHS[name] ?? PATHS.dots;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={d} fill={color} />
    </Svg>
  );
}
