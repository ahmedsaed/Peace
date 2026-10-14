#!/usr/bin/env bash
# Files the flows pick from the system file picker, put where it looks.
#
# Maestro cannot push a file, so anything a flow chooses from "Files" has to be
# on the device before the suite starts — `npm run e2e` and the E2E workflow
# both run this first. Pushed to BOTH Download and Documents, with a media
# scan: the picker opens wherever it was last used, and a file in only one of
# them is found on some runs and not others.
set -euo pipefail

cd "$(dirname "$0")/.."
for name in peace-import.csv; do
  for dir in Download Documents; do
    adb push "scripts/fixtures/$name" "/sdcard/$dir/$name" >/dev/null
    adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
      -d "file:///sdcard/$dir/$name" >/dev/null 2>&1 || true
  done
done
