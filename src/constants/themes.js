/**
 * The colour themes — single source of truth.
 *
 * Plain CommonJS because it has two consumers that cannot share a module
 * format: tailwind.config.js requires it at build time to name the tokens, and
 * TypeScript imports it for the places that need literal colour values rather
 * than class names (React Navigation options, react-native-svg fills,
 * ActivityIndicator).
 *
 * CLASS NAMES NEVER CARRY A COLOUR. Tailwind's `bg-surface` resolves to
 * `rgb(var(--color-surface))`, and the variables are set once, at the root,
 * from whichever theme is active (`state/theme.tsx`). Literals go through
 * `useTheme()`, never through this file — a component that reads a colour from
 * here directly would stay Ledger-coloured on a Paper screen, and the React
 * Compiler would keep it that way. `no-static-colours.test.ts` enforces it.
 *
 * Every theme here is checked by `themes.test.ts`: contrast for text and for
 * the accent, and income against expense under simulated colour blindness.
 * Rationale for each choice: docs/design-system.md
 */

/** The token names, in the order the design system lists them. */
const TOKENS = [
  'ground',
  'surface',
  'raised',
  'line',
  'ink',
  'muted',
  'accent',
  'accent-ink',
  'income',
  'expense',
  'transfer',
];

const THEMES = {
  // Warm, low-contrast dark: the original, and the default for anybody who had
  // Peace before themes existed.
  ledger: {
    label: 'Ledger',
    dark: true,
    colors: {
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
      // semantic money colours — never decoration, and always paired with a
      // +/- sign. Expense leans ROSE rather than salmon so that it and income
      // sit on opposite ends of the blue–yellow axis, which is the one a
      // red–green deficiency keeps.
      income: '#9CC46A',
      expense: '#E8788F',
      transfer: '#75A8C4',
    },
  },
  // True black for OLED screens, and the most contrast of any theme.
  graphite: {
    label: 'Graphite',
    dark: true,
    colors: {
      ground: '#000000',
      surface: '#121212',
      raised: '#1F1F1F',
      line: '#262626',
      ink: '#F2F2F0',
      muted: '#A3A39D',
      accent: '#E9AC48',
      'accent-ink': '#000000',
      income: '#A3CC70',
      expense: '#F07E97',
      transfer: '#7DB3D1',
    },
  },
  // Ledger in daylight: the same warm neutrals, inverted. The accent darkens to
  // a burnt amber because Ledger's would be unreadable as text on cream.
  paper: {
    label: 'Paper',
    dark: false,
    colors: {
      ground: '#F4EEE3',
      // Cards and sheets are the LIGHTEST thing in a light theme…
      surface: '#FFFDF8',
      // …and `raised` — inputs, chips, the selected segment, a pressed row —
      // a step DARKER, so it still stands out from the card it sits on.
      raised: '#EAE1D1',
      line: '#E2D8C6',
      ink: '#2A231A',
      muted: '#6B5F4C',
      accent: '#985A0C',
      'accent-ink': '#FFFFFF',
      income: '#3C6F18',
      expense: '#B03366',
      transfer: '#2D6A8F',
    },
  },
  // A cool light theme, blue where Paper is amber.
  mist: {
    label: 'Mist',
    dark: false,
    colors: {
      ground: '#EDF0F3',
      surface: '#FFFFFF',
      raised: '#E1E6EB',
      line: '#D5DBE2',
      ink: '#1C232B',
      muted: '#566170',
      accent: '#2B65A0',
      'accent-ink': '#FFFFFF',
      income: '#376D19',
      expense: '#B03366',
      transfer: '#7A4FB0',
    },
  },
};

/** What "Match phone" uses on each side. */
const SYSTEM_PAIR = { dark: 'ledger', light: 'paper' };

/**
 * `#17140F` → `23 20 15`, the form `rgb(var(--x) / <alpha-value>)` needs.
 * @param {string} hex
 */
function channels(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ');
}

/**
 * The CSS variables for one theme's colours.
 * @param {Record<string, string>} colors
 * @returns {Record<string, string>}
 */
function cssVariables(colors) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const token of TOKENS) out[`--color-${token}`] = channels(colors[token]);
  return out;
}

module.exports = { TOKENS, THEMES, SYSTEM_PAIR, channels, cssVariables };
