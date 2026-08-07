/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Semantic colors for a money app: money in vs money out.
        income: '#16a34a',
        expense: '#dc2626',
      },
    },
  },
  plugins: [],
};
