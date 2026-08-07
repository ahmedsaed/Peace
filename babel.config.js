module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      // Drizzle's generated migrations import .sql files. Without this they are
      // handed to the JS parser and blow up on the first CREATE TABLE.
      ['inline-import', { extensions: ['.sql'] }],
    ],
  };
};
