#!/usr/bin/env bash
# Build a year of invented demo data and put it on the device, ready to restore.
#
#   npm run demo:ledger
#
# Writes .demo/peace-demo.db through the real repository code (see
# src/test/demo-ledger.ts), then pushes it to the device's Download folder.
# Load it in the app with Menu › Export & backup › Restore, and pick
# peace-demo.db. Restoring REPLACES the ledger on the device — and is undoable
# from the same screen.
set -euo pipefail
cd "$(dirname "$0")/.."

out=.demo/peace-demo.db
DEMO_LEDGER_OUT="$out" npx jest src/test/demo-ledger --silent

if adb get-state >/dev/null 2>&1; then
  adb push "$out" /sdcard/Download/peace-demo.db >/dev/null
  # Without a media scan the document picker may not list the new file yet.
  adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
    -d file:///sdcard/Download/peace-demo.db >/dev/null 2>&1 || true
  echo "pushed to /sdcard/Download/peace-demo.db — restore it from Export & backup"
else
  echo "wrote $out (no device attached, nothing pushed)"
fi
