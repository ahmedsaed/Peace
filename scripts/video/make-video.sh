#!/usr/bin/env bash
# The Play listing's promo video, recorded from the real app and composed with
# ffmpeg.
#
#   PEACE_GEMINI_KEY_FILE=<file> bash scripts/video/make-video.sh record
#   bash scripts/video/make-video.sh compose
#
# Re-record some scenes over the current state, skipping setup:
#   SKIP_SETUP=1 bash scripts/video/make-video.sh record scene-3 scene-4
#
# COSTS MONEY: the bank, invoice and Penny scenes call the real Gemini API —
# a few requests per recording. Needs a booted emulator with a RELEASE build.
# `record` wipes the app's data and leaves the demo year behind. The widgets
# scene is not recorded: compose.sh uses the website's home-screen image.
#
# Output: .video/clips/*.mp4 (raw), then .video/peace-promo.mp4 (1920×1080).
set -euo pipefail
cd "$(dirname "$0")/../.."

OUT=.video
CLIPS=$OUT/clips
mkdir -p "$CLIPS"

record() {
  local only=("$@")
  [[ -n "${SKIP_SETUP:-}" ]] || [[ -s "${PEACE_GEMINI_KEY_FILE:-}" ]] || { echo "Set PEACE_GEMINI_KEY_FILE to a file holding a Gemini API key." >&2; exit 1; }
  adb get-state >/dev/null 2>&1 || { echo "no device — run 'npm run emu' first"; exit 1; }
  local key pkg=dev.merope.peace.oss
  if [[ -z "${SKIP_SETUP:-}" ]]; then
    key="$(tr -d '[:space:]' < "$PEACE_GEMINI_KEY_FILE")"

    # The demo year and the invoice, where the file picker will find them.
    DEMO_LEDGER_OUT=.demo/peace-demo.db npx jest src/test/demo-ledger --silent
    google-chrome --headless --disable-gpu --no-pdf-header-footer \
      --print-to-pdf="$OUT/northwind-invoice.pdf" "file://$PWD/scripts/video/invoice.html" 2>/dev/null
    for f in .demo/peace-demo.db "$OUT/northwind-invoice.pdf"; do
      adb push "$f" "/sdcard/Download/$(basename "$f")" >/dev/null
      adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
        -d "file:///sdcard/Download/$(basename "$f")" >/dev/null 2>&1 || true
    done

    maestro test -e GEMINI_KEY="$key" scripts/video/setup.yaml
    # After setup.yaml, not before: its `clearState` revokes notification access.
    adb shell cmd notification allow_listener "$pkg/dev.merope.peace.notifications.NotificationCaptureService"
    maestro test scripts/video/setup-bank.yaml
  fi

  # What a viewer should see of the phone itself: taps drawn, a tidy status bar.
  adb shell settings put system show_touches 1
  adb shell settings put global sysui_demo_allowed 1
  local demo=(adb shell am broadcast -a com.android.systemui.demo)
  "${demo[@]}" -e command enter >/dev/null
  "${demo[@]}" -e command clock -e hhmm 0941 >/dev/null
  "${demo[@]}" -e command battery -e level 100 -e plugged false >/dev/null
  "${demo[@]}" -e command network -e wifi show -e level 4 >/dev/null
  "${demo[@]}" -e command network -e mobile show -e datatype none -e level 4 >/dev/null
  "${demo[@]}" -e command notifications -e visible false >/dev/null

  for flow in scripts/video/scene-*.yaml; do
    local name
    name=$(basename "$flow" .yaml)
    # With scene names given, record only those ("scene-3" matches scene-3-invoice).
    if (( ${#only[@]} )); then
      local keep=0 want
      for want in "${only[@]}"; do [[ $name == "$want"* ]] && keep=1; done
      (( keep )) || continue
    fi
    # Every scene starts from the app in front.
    adb shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
    sleep 2
    adb shell rm -f /sdcard/scene.mp4
    adb shell screenrecord --bit-rate 16000000 /sdcard/scene.mp4 &
    local rec=$!
    sleep 1.5
    if [[ $name == *bank ]]; then
      # The bank's text, a moment into the shot, so it arrives on camera.
      (sleep 1.5 && adb emu sms send NBANK \
        "NBANK: Card ending 4421 was charged USD 18.75 at METRO MARKET. Available balance USD 3,912.40." >/dev/null) &
    fi
    maestro test "$flow"
    sleep 1.5
    adb shell pkill -INT screenrecord || true
    wait "$rec" 2>/dev/null || true
    sleep 1
    adb pull /sdcard/scene.mp4 "$CLIPS/$name.mp4" >/dev/null
    echo "recorded $CLIPS/$name.mp4"
  done

  "${demo[@]}" -e command exit >/dev/null
  adb shell settings put system show_touches 0
}

case "${1:-}" in
  record) shift; record "$@" ;;
  compose) bash scripts/video/compose.sh ;;
  *) echo "usage: $0 record|compose" >&2; exit 1 ;;
esac
