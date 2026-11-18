const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Portrait is a PREFERENCE, not a hardware requirement.
 *
 * `"orientation": "portrait"` writes `screenOrientation="portrait"`, and
 * Android reads that as an IMPLIED `<uses-feature android.hardware.screen.portrait>`
 * with required="true" — so Play filters the app away from every device that
 * does not declare a portrait screen (some tablets, Chromebooks, XR), and its
 * pre-review check blocks the production release over it. Peace already lays
 * itself out on wide and rotated screens (see CONTENT_MAX_WIDTH; Android 16
 * ignores the lock at 600dp+ anyway), so the honest declaration is optional.
 */
const FEATURE = 'android.hardware.screen.portrait';

module.exports = function withOptionalPortrait(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const features = (manifest['uses-feature'] ??= []);
    const existing = features.find((f) => f.$['android:name'] === FEATURE);
    if (existing) existing.$['android:required'] = 'false';
    else features.push({ $: { 'android:name': FEATURE, 'android:required': 'false' } });
    return cfg;
  });
};
