#!/usr/bin/env bash
# Boot the test emulator headlessly and block until it is actually usable.
# Safe to run repeatedly — it is a no-op if a device is already attached.
set -euo pipefail

AVD="${AVD:-peace_test}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"

if adb devices | grep -qE "^(emulator|[0-9.]+:[0-9]+)\s+device$"; then
  echo "device already attached:"
  adb devices | grep -E "device$"
  exit 0
fi

echo "booting AVD '$AVD' (headless)..."
nohup emulator -avd "$AVD" \
  -no-window -no-audio -no-boot-anim -no-snapshot-save \
  -gpu swiftshader_indirect \
  > /tmp/emulator-"$AVD".log 2>&1 &

adb wait-for-device

# wait-for-device returns as soon as adb connects, which is long before Android
# has finished booting. Poll the real signal instead.
printf "waiting for boot"
for _ in $(seq 1 180); do
  if [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
    echo " ok"
    adb shell input keyevent 82 >/dev/null 2>&1 || true  # dismiss lock screen
    adb shell settings put global window_animation_scale 0 || true
    adb shell settings put global transition_animation_scale 0 || true
    adb shell settings put global animator_duration_scale 0 || true

    # Suppress Android's "System UI isn't responding" / ANR dialogs.
    #
    # This machine is tight on RAM, so the first launch after a boot regularly
    # makes SystemUI miss its deadline and Android throws up a modal that sits
    # on top of the app and swallows every tap. Maestro then fails on its FIRST
    # assertion — `home-screen is visible` — which reads exactly like a broken
    # app rather than a busy emulator, and costs a screenshot every time to
    # work out that the app underneath was fine all along. It has now done that
    # three times.
    #
    # Only ever set on the throwaway test AVD, where an ANR dialog carries no
    # information anybody is going to act on.
    adb shell settings put global hide_error_dialogs 1 || true
    echo "emulator ready"
    exit 0
  fi
  printf "."
  sleep 2
done

echo
echo "ERROR: emulator did not finish booting. Log: /tmp/emulator-$AVD.log" >&2
tail -20 /tmp/emulator-"$AVD".log >&2
exit 1
