const { TOKENS, THEMES, cssVariables } = require('./src/constants/themes.js');

/** @type {import('tailwindcss').Config} */

/**
 * Colours are THEMED: every token is a CSS variable, set at the root from the
 * active theme (src/state/theme.tsx). Values live in src/constants/themes.js;
 * nothing outside that file hard-codes a hex value for the chrome.
 *
 * `<alpha-value>` keeps opacity modifiers working — `border-expense/40` is the
 * theme's expense at 40%, whichever theme that is.
 *
 * The `:root` block is Ledger, so anything drawn before the theme is known —
 * the database gate, the very first frame — is drawn in the original colours.
 */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: Object.fromEntries(
        TOKENS.map((token) => [token, `rgb(var(--color-${token}) / <alpha-value>)`])
      ),
    },
  },
  plugins: [
    ({ addBase }) => {
      addBase({ ':root': cssVariables(THEMES.ledger.colors) });
    },
  ],
};
