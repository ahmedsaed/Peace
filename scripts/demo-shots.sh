#!/usr/bin/env bash
# Regenerate the README screenshots.
#
#   npm run shots
#
# Needs a booted device with a RELEASE build installed — the dev build is the
# wrong target for flows (see AGENTS.md), and it also renders a debug banner
# that has no business in a README.
#
# Maestro writes captures into ~/.maestro/tests/<timestamp>/, not where they are
# wanted, so this copies them into docs/screenshots/ under stable names. The
# names are what README.md references; changing one means editing both.
set -euo pipefail

cd "$(dirname "$0")/.."

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$HOME/.maestro/bin"

command -v maestro >/dev/null || { echo "maestro not on PATH"; exit 1; }
adb get-state >/dev/null 2>&1 || { echo "no device — run 'npm run emu' first"; exit 1; }

# A dev build here would produce screenshots with a Metro banner and a
# development-mode overlay, which is worse than no screenshots at all because it
# looks like the shipped app.
if adb shell pm list packages -f com.ahmed.peace | grep -q "debug"; then
  echo "warning: a debug build appears to be installed — install the release APK first" >&2
fi

DEST=docs/screenshots
mkdir -p "$DEST"

echo "running the demo flow (this seeds a ledger and takes ~5 minutes)..."
maestro test scripts/demo-shots.yaml

SRC=$(ls -td "$HOME"/.maestro/tests/*/demo-shots/takeScreenshot 2>/dev/null | head -1)
[ -n "$SRC" ] || { echo "no screenshots produced — the flow must have failed early"; exit 1; }

for name in records record budgets analysis search; do
  if [ ! -f "$SRC/$name.png" ]; then
    echo "missing $name.png in $SRC" >&2
    exit 1
  fi
  cp "$SRC/$name.png" "$DEST/$name.png"
done

# Halve the pixels. At 1080x2400 each shot is ~300 KB and renders in a README
# table at a few hundred pixels wide, so full resolution is weight nobody sees.
# Optional: if neither tool is installed the originals are kept rather than the
# script failing over a nicety.
if command -v magick >/dev/null 2>&1; then
  magick mogrify -resize 540x "$DEST"/*.png
elif command -v convert >/dev/null 2>&1; then
  convert -resize 540x "$DEST"/records.png "$DEST"/records.png
  for name in record budgets analysis search; do
    convert -resize 540x "$DEST/$name.png" "$DEST/$name.png"
  done
else
  echo "note: ImageMagick not found — screenshots kept at full resolution" >&2
fi

echo
du -h "$DEST"/*.png
echo
echo "updated $DEST — commit them if they look right"
