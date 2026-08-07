#!/usr/bin/env bash
# Capture the attached device's screen to a PNG and print the path.
# This is how the agent "sees" the running app.
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.screenshots"
mkdir -p "$DIR"

NAME="${1:-screen-$(date +%H%M%S)}"
OUT="$DIR/${NAME%.png}.png"

adb exec-out screencap -p > "$OUT"

if [ ! -s "$OUT" ]; then
  echo "ERROR: screenshot was empty — is a device attached? (adb devices)" >&2
  exit 1
fi

echo "$OUT"
