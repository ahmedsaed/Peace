const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const { THEMES } = require('../src/constants/themes');

/**
 * Launcher shortcuts: hold the Peace icon for Expense, Receipt and Penny.
 *
 * STATIC shortcuts, declared in `res/xml/shortcuts.xml`, so they exist from the
 * moment the app is installed and need no JavaScript to have run. Each one is a
 * deep link to a screen with the same params the in-app buttons already use
 * (`capture` is the one holding + passes), so there is no second way in to keep
 * in step. The root layout's `anchor` puts Records underneath, which is what
 * Back and Save return to.
 *
 * Income had a slot and lost it to Penny: income is a few records a month,
 * and three slots are for what gets done daily. Penny's shortcut is offered
 * whether or not she is switched on — a static shortcut cannot know — and the
 * assistant screen's own gate says what is missing and links to the setting.
 *
 * EVERY INTENT NAMES ITS PACKAGE. Both flavors register the `peace` scheme, so
 * a bare `peace://record` on a phone with the GitHub build AND the Play build
 * would open a chooser — or the other app. `targetPackage` is the application
 * id this build is being made with.
 *
 * Icons are adaptive on Android 8+ (the launcher masks them like any other
 * shortcut) with a plain circle for older phones. The glyphs are the app's own
 * 24-unit paths, in Ledger's accent, so a shortcut looks like the + button it
 * stands in for. They are fixed, not themed: a launcher draws them long before
 * the app knows which theme is chosen.
 */

const ACCENT = THEMES.ledger.colors.accent;
const ON_ACCENT = THEMES.ledger.colors['accent-ink'];

// Same paths as src/components/icon.tsx. `minus` has no counterpart there.
const GLYPHS = {
  minus: 'M4 10.8h16v2.4H4z',
  sparkle:
    'M13 2l1.9 5.6L20.5 9.5l-5.6 1.9L13 17l-1.9-5.6L5.5 9.5l5.6-1.9L13 2zM5.5 14l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6L2 17.5l2.6-.9L5.5 14z',
  camera:
    'M9.2 3h5.6l1.2 2H20a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l1.2-2zM12 8a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 1 1 0-5.6z',
};

/** Order is the order the launcher lists them, nearest the icon first. */
const SHORTCUTS = [
  { id: 'expense', glyph: 'minus', short: 'Expense', long: 'New expense', link: 'record' },
  { id: 'receipt', glyph: 'camera', short: 'Receipt', long: 'Photograph a receipt', link: 'record?capture=1' },
  // Larger than the others: the sparkle is two thin four-point stars, and at
  // the solid glyphs' size it rasterised to a speck at 48dp.
  { id: 'penny', glyph: 'sparkle', short: 'Penny', long: 'Ask Penny', link: 'assistant', scale: 1.36 },
];

const escape = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The 24-unit glyph, scaled and centred on a square canvas of `size`. */
const glyphGroup = (glyph, size, scale) => {
  const offset = (size / 2 - 12 * scale).toFixed(2);
  return `<group android:translateX="${offset}" android:translateY="${offset}" android:scaleX="${scale}" android:scaleY="${scale}">
        <path android:fillColor="${ON_ACCENT}" android:pathData="${GLYPHS[glyph]}" />
    </group>`;
};

/** Pre-26: a filled circle with the glyph at about half its width. */
const circleIcon = (glyph, scale = 1) => `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="48dp" android:height="48dp"
    android:viewportWidth="48" android:viewportHeight="48">
    <path android:fillColor="${ACCENT}" android:pathData="M24 2a22 22 0 1 0 0 44 22 22 0 1 0 0-44z" />
    ${glyphGroup(glyph, 48, scale)}
</vector>
`;

/**
 * 26+: the foreground layer of an adaptive icon. 108 units, of which the
 * middle 72 survive any mask and the middle 66 are safe — the glyph is drawn
 * 44 wide (the sparkle 60), scaled from its 24-unit box, inside the safe zone.
 */
const foreground = (glyph, scale = 1) => `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    ${glyphGroup(glyph, 108, 1.8333 * scale)}
</vector>
`;

const background = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="${ACCENT}" android:pathData="M0 0h108v108H0z" />
</vector>
`;

const adaptive = (id) => `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/peace_shortcut_bg" />
    <foreground android:drawable="@drawable/peace_shortcut_${id}_fg" />
</adaptive-icon>
`;

function shortcutsXml(pkg) {
  const entries = SHORTCUTS.map(
    (s) => `    <shortcut
        android:shortcutId="${s.id}"
        android:enabled="true"
        android:icon="@drawable/peace_shortcut_${s.id}"
        android:shortcutShortLabel="@string/peace_shortcut_${s.id}_short"
        android:shortcutLongLabel="@string/peace_shortcut_${s.id}_long">
        <intent
            android:action="android.intent.action.VIEW"
            android:data="${escape(`peace://${s.link}`)}"
            android:targetPackage="${pkg}"
            android:targetClass="${pkg}.MainActivity" />
    </shortcut>`
  ).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
${entries}
</shortcuts>
`;
}

// Labels are string resources because the launcher requires them to be.
const stringsXml = () => `<?xml version="1.0" encoding="utf-8"?>
<resources>
${SHORTCUTS.map(
  (s) =>
    `    <string name="peace_shortcut_${s.id}_short">${escape(s.short)}</string>\n    <string name="peace_shortcut_${s.id}_long">${escape(s.long)}</string>`
).join('\n')}
</resources>
`;

function withShortcutFiles(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const pkg = cfg.android?.package;
      if (!pkg) throw new Error('with-shortcuts: android.package is not set');
      const res = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res');
      const write = (rel, contents) => {
        const file = path.join(res, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, contents);
      };

      write('xml/peace_shortcuts.xml', shortcutsXml(pkg));
      write('values/peace_shortcuts.xml', stringsXml());
      write('drawable/peace_shortcut_bg.xml', background);
      for (const s of SHORTCUTS) {
        write(`drawable/peace_shortcut_${s.id}.xml`, circleIcon(s.glyph, s.scale));
        write(`drawable/peace_shortcut_${s.id}_fg.xml`, foreground(s.glyph, s.scale));
        write(`drawable-anydpi-v26/peace_shortcut_${s.id}.xml`, adaptive(s.id));
      }
      return cfg;
    },
  ]);
}

function withShortcutMetadata(config) {
  return withAndroidManifest(config, (cfg) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    activity['meta-data'] = (activity['meta-data'] ?? []).filter(
      (m) => m.$['android:name'] !== 'android.app.shortcuts'
    );
    activity['meta-data'].push({
      $: { 'android:name': 'android.app.shortcuts', 'android:resource': '@xml/peace_shortcuts' },
    });
    return cfg;
  });
}

module.exports = function withShortcuts(config) {
  return withShortcutMetadata(withShortcutFiles(config));
};

module.exports.SHORTCUTS = SHORTCUTS;
