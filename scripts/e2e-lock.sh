#!/usr/bin/env bash
# The app-lock flows, which need a screen lock on the device.
#
# Sets the PIN to 1111, runs .maestro/lock/, and ALWAYS clears it again: the
# rest of the suite expects a phone with no screen lock (.maestro/app-lock.yaml
# asserts exactly that), and a PIN left behind would also put Android's own
# lock screen in front of every flow after a reboot.
set -uo pipefail

adb shell locksettings set-pin 1111 >/dev/null
trap 'adb shell locksettings clear --old 1111 >/dev/null 2>&1 || true' EXIT

maestro test "${@:-.maestro/lock/}"
