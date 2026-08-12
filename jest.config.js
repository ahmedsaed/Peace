/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest-setup.js'],
  // RN ships untranspiled ESM; these packages must go through babel.
  // `@noble/hashes` is ESM-only too — without it here, `seal.ts` fails to parse
  // with "Cannot use import statement outside a module", which reads like a
  // broken test file rather than a missing transform.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|nativewind|react-native-css-interop|@noble/hashes|drizzle-orm)',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/app/**', // screens are covered by Maestro E2E, not unit tests
  ],
};
