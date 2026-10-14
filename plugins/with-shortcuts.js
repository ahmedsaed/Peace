const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const { THEMES } = require('../src/constants/themes');

/**
 * Launcher shortcuts: hold the Peace icon for Expense, Income and Receipt.
 *
 * STATIC shortcuts, declared in `res/xml/shortcuts.xml`, so they exist from the
 * moment the app is installed and need no JavaScript to have run. Each one is a
 * deep link into the record screen with the same params the in-app buttons
 * already use (`startAs`, `capture`), so there is no second way of opening a
 * record to keep in step. The root layout's `anchor` puts Records underneath,
 * which is what Back and Save return to.
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
  plus: 'M10.8 4h2.4v6.8H20v2.4h-6.8V20h-2.4v-6.8H4v-2.4h6.8V4z',
  camera:
    'M9.2 3h5.6l1.2 2H20a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l1.2-2zM12 8a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 1 1 0-5.6z',
};

/** Order is the order the launcher lists them, nearest the icon first. */
const SHORTCUTS = [
  { id: 'expense', glyph: 'minus', short: 'Expense', long: 'New expense', query: '' },
  { id: 'income', glyph: 'plus', short: 'Income', long: 'New income', query: '?startAs=income' },
  { id: 'receipt', glyph: 'camera', short: 'Receipt', long: 'Photograph a receipt', query: '?capture=1' },
];

const escape = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Pre-26: a filled circle with the glyph at about half its width. */
const circleIcon = (glyph) => `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="48dp" android:height="48dp"
    android:viewportWidth="48" android:viewportHeight="48">
    <path android:fillColor="${ACCENT}" android:pathData="M24 2a22 22 0 1 0 0 44 22 22 0 1 0 0-44z" />
    <group android:translateX="12" android:translateY="12">
        <path android:fillColor="${ON_ACCENT}" android:pathData="${GLYPHS[glyph]}" />
    </group>
</vector>
`;

/**
 * 26+: the foreground layer of an adaptive icon. 108 units, of which the
 * middle 72 survive any mask and the middle 66 are safe — the glyph is drawn
 * 44 wide, scaled from its 24-unit box, so it never touches the mask.
 */
const foreground = (glyph) => `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <group android:translateX="32" android:translateY="32" android:scaleX="1.8333" android:scaleY="1.8333">
        <path android:fillColor="${ON_ACCENT}" android:pathData="${GLYPHS[glyph]}" />
    </group>
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
            android:data="${escape(`peace://record${s.query}`)}"
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
        write(`drawable/peace_shortcut_${s.id}.xml`, circleIcon(s.glyph));
        write(`drawable/peace_shortcut_${s.id}_fg.xml`, foreground(s.glyph));
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
