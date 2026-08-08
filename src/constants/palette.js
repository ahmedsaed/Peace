/**
 * The "Ledger" palette — single source of truth.
 *
 * Plain CommonJS because it has two consumers that cannot share a module
 * format: tailwind.config.js requires it at build time, and TypeScript imports
 * it for the places that need literal colour values rather than class names
 * (React Navigation options, react-native-svg fills, ActivityIndicator).
 *
 * Duplicating these hexes into a .ts file is the obvious-looking alternative
 * and the wrong one — the two copies drift, and the drift shows up as a tab bar
 * that is subtly the wrong shade.
 *
 * Rationale for each choice: docs/design-system.md
 */
const palette = {
  // surfaces — warm-biased neutrals, never flat grey
  ground: '#17140F',
  surface: '#241F17',
  raised: '#302818',
  line: '#2E271D',

  // text
  ink: '#EFE4CE',
  muted: '#9A8E79',

  // interaction only: FAB, active tab, progress fill
  accent: '#E3A33C',
  'accent-ink': '#17140F',

  // semantic money colours — never decoration.
  // Separated by lightness as well as hue, and always paired with a +/- sign,
  // so they survive red-green colour deficiency.
  income: '#8FBF6A',
  expense: '#E5806A',
  transfer: '#75A8C4',
};

module.exports = palette;
