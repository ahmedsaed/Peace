#!/usr/bin/env bash
# Regenerate the README's Penny screenshots.
#
#   PEACE_GEMINI_KEY_FILE=<file> npm run shots:penny
#
# COSTS MONEY — a handful of Gemini requests. Needs a booted device with a
# RELEASE build installed. Wipes the app's data on the device and leaves the
# demo ledger behind. Review the three PNGs before committing them: a real model
# words things its own way, and a screenshot is only as good as that one answer.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${PEACE_GEMINI_KEY_FILE:-}" || ! -s "$PEACE_GEMINI_KEY_FILE" ]]; then
  echo "Set PEACE_GEMINI_KEY_FILE to a file holding a Gemini API key." >&2
  exit 1
fi
adb get-state >/dev/null 2>&1 || { echo "no device — run 'npm run emu' first"; exit 1; }

# The demo ledger and the fixture receipt, in both folders the picker may open on.
DEMO_LEDGER_OUT=.demo/peace-demo.db npx jest src/test/demo-ledger --silent
for dir in Download Documents; do
  adb push .demo/peace-demo.db "/sdcard/$dir/peace-demo.db" >/dev/null
  adb push src/assistant/__fixtures__/receipt.jpg "/sdcard/$dir/peace-receipt.jpg" >/dev/null
  for f in peace-demo.db peace-receipt.jpg; do
    adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/$dir/$f" >/dev/null 2>&1 || true
  done
done

key="$(tr -d '[:space:]' < "$PEACE_GEMINI_KEY_FILE")"
maestro test -e GEMINI_KEY="$key" scripts/penny-shots.yaml

SRC=$(ls -td "$HOME"/.maestro/tests/*/penny-shots/takeScreenshot 2>/dev/null | head -1)
[ -n "$SRC" ] || { echo "no screenshots produced"; exit 1; }
DEST=docs/screenshots
for name in penny-ask penny-chart penny-receipt; do
  [ -f "$SRC/$name.png" ] || { echo "missing $name.png in $SRC" >&2; exit 1; }
  cp "$SRC/$name.png" "$DEST/$name.png"
done
if command -v magick >/dev/null 2>&1; then
  magick mogrify -resize 540x "$DEST"/penny-*.png
fi
echo "wrote $DEST/penny-{ask,chart,receipt}.png — look at them before committing"
