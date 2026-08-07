const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Drizzle emits migrations as .sql files that are imported from JS.
config.resolver.sourceExts.push('sql');

module.exports = withNativeWind(config, { input: './src/global.css' });
