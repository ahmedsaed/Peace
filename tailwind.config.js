const palette = require('./src/constants/palette.js');

/** @type {import('tailwindcss').Config} */

/**
 * Palette: "Ledger" — warm, low-contrast dark. Chosen in Stage 0; see
 * docs/design-system.md for the rationale and the two rejected directions.
 *
 * Colour values live in src/constants/palette.js so that TypeScript can share
 * them with the places that need literals rather than class names. Nothing
 * outside that file should hard-code a hex value.
 *
 * The app is dark-only, so these are plain colours rather than dark: variants.
 */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: palette,
    },
  },
  plugins: [],
};
