#!/usr/bin/env bash
# Crop the home-screen widgets out of the emulator's screen, for the store
# listing and the website (store/screenshots/widget-*.png).
#
#   npm run shots:widgets
#
# A launcher cannot be driven by a flow — placing and sizing a widget is a drag
# — so this half is by hand, ONCE, and the script only photographs:
#   1. Run `npm run shots` (or its opening, up to the budgets screenshot) so the
#      ledger holds the invented dollar month and its budget.
#   2. On the home screen, place Budget (4×2), Balance stretched to 4×2, and on
#      a second page Balance at its default 4×1 and Quick add (2×1).
#   3. Run this on each page. It writes whichever widgets it finds.
#
# Every crop is the widget's own pixels, found by its view id — not a mock-up —
# so a widget that changes is re-photographed, never re-drawn. The corners are
# made transparent so the composite (site/lib/store-graphics.tsx) can sit them
# on any wallpaper.
set -euo pipefail
cd "$(dirname "$0")/.."

adb get-state >/dev/null 2>&1 || { echo "no device — run 'npm run emu' first"; exit 1; }
command -v magick >/dev/null || { echo "needs ImageMagick (magick)"; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
adb exec-out screencap -p > "$tmp/screen.png"
adb shell uiautomator dump /sdcard/widgets.xml >/dev/null
adb pull -q /sdcard/widgets.xml "$tmp/ui.xml" 2>/dev/null || adb shell cat /sdcard/widgets.xml > "$tmp/ui.xml"
density=$(adb shell wm density | grep -oE '[0-9]+' | tail -1)

# Which widget a `widget_root` is, from the views inside it: only the Budget
# widget has a bar, only Balance has account rows, and the one-row Balance is
# the only one with an amount and no wordmark.
python3 - "$tmp/ui.xml" > "$tmp/found.txt" <<'PY'
import re, sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
for node in root.iter('node'):
    if not node.get('resource-id', '').endswith(':id/widget_root'):
        continue
    ids = {n.get('resource-id', '').split('/')[-1] for n in node.iter('node')}
    if 'bar_holder' in ids:
        kind = 'budget'
    elif 'acc_1' in ids:
        kind = 'balance'
    elif 'amount' in ids:
        kind = 'balance-compact'
    else:
        kind = 'quick'
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds')))
    print(kind, x1, y1, x2 - x1, y2 - y1)
PY

[ -s "$tmp/found.txt" ] || { echo "no Peace widgets on this screen"; exit 1; }

mkdir -p store/screenshots
# The widget background's corner radius (24dp), in pixels at this density.
radius=$(( 24 * density / 160 ))
while read -r kind x y w h; do
  out="store/screenshots/widget-$kind.png"
  magick "$tmp/screen.png" -crop "${w}x${h}+${x}+${y}" +repage \
    \( -size "${w}x${h}" xc:none -fill white -draw "roundrectangle 0,0,$((w - 1)),$((h - 1)),$radius,$radius" \) \
    -compose CopyOpacity -composite "PNG32:$out"
  echo "wrote $out (${w}x${h})"
done < "$tmp/found.txt"
