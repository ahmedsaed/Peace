#!/usr/bin/env bash
# Run the flows that need a real Gemini key.
#
# The key is read from a FILE named by PEACE_GEMINI_KEY_FILE and handed to
# Maestro as an env var, so it never appears in a flow, a commit or a log line.
# Keep that file outside the repository's tracked tree (on the Fedora box,
# .toolchain/ is excluded).
set -euo pipefail

if [[ -z "${PEACE_GEMINI_KEY_FILE:-}" || ! -s "$PEACE_GEMINI_KEY_FILE" ]]; then
  echo "Set PEACE_GEMINI_KEY_FILE to a file holding a Gemini API key." >&2
  exit 1
fi

key="$(tr -d '[:space:]' < "$PEACE_GEMINI_KEY_FILE")"

# The receipt the attachment flow picks from Files. A media scan so the picker
# lists it straight away.
# Pushed to BOTH Download and Documents: the system picker opens wherever it was
# last used, so a receipt in only one of them is found on some runs and not others.
for dir in Download Documents; do
  adb push src/assistant/__fixtures__/receipt.jpg "/sdcard/$dir/peace-receipt.jpg" >/dev/null
  adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
    -d "file:///sdcard/$dir/peace-receipt.jpg" >/dev/null 2>&1 || true
done
# Revoke rather than grant the keyboard's microphone: granted, Gboard drops
# into voice typing the moment its mic key is brushed and covers the composer.
# Flows hide the keyboard before tapping Send, so nothing should touch it.
adb shell pm revoke com.google.android.inputmethod.latin android.permission.RECORD_AUDIO >/dev/null 2>&1 || true

exec maestro test -e GEMINI_KEY="$key" "${@:-.maestro/live/}"
