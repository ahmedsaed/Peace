/** @type {import('tailwindcss').Config} */

/**
 * Palette: "Ledger" — warm, low-contrast dark.
 * Chosen in Stage 0; see docs/design-system.md for the rationale and the two
 * rejected directions.
 *
 * The app is dark-only, so these are plain colours rather than dark: variants.
 * Nothing outside this file should ever hard-code a hex value.
 */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // --- surfaces, warm-biased neutrals (never flat grey) ---
        ground: '#17140F', // app background
        surface: '#241F17', // headers, tab bar, cards
        raised: '#302818', // elevated: sheets, menus, pressed rows
        line: '#2E271D', // hairline separators

        // --- text ---
        ink: '#EFE4CE', // primary
        muted: '#9A8E79', // secondary, inactive tabs, placeholders

        // --- interaction only: FAB, active tab, progress fill ---
        accent: '#E3A33C',
        'accent-ink': '#17140F', // text/icon placed ON accent

        /**
         * Semantic money colours. Never decoration.
         *
         * Colour must NEVER be the only signal — always render an explicit
         * +/- sign too. ~1 in 12 men have red-green colour deficiency, and the
         * amount is the most important thing on screen. These three are also
         * separated by lightness, not just hue, so they survive deuteranopia.
         *
         * `transfer` is a third colour because a transfer is a third thing:
         * money between your own accounts is neither income nor expense.
         */
        income: '#8FBF6A',
        expense: '#E5806A',
        transfer: '#75A8C4',
      },
    },
  },
  plugins: [],
};
