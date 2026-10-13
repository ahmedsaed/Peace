#!/usr/bin/env bash
# Fail if the merged release manifest requests a permission not listed in
# scripts/allowed-permissions.txt. Run after a release build (APK or AAB):
#
#   scripts/check-permissions.sh [path/to/merged/AndroidManifest.xml]
#
# The merged manifest, not app.json: most permissions arrive from libraries,
# and that is exactly where an unreviewed one comes from.
set -euo pipefail
cd "$(dirname "$0")/.."

MANIFEST="${1:-android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml}"
[ -f "$MANIFEST" ] || { echo "no merged manifest at $MANIFEST — build a release first" >&2; exit 2; }

ALLOWED=$(grep -v '^\s*#' scripts/allowed-permissions.txt | sed '/^\s*$/d')
REQUESTED=$(grep -oP '<uses-permission(-sdk-23)?\s[^>]*android:name="\K[^"]+' "$MANIFEST" | sort -u)

bad=0
while read -r perm; do
  [ -n "$perm" ] || continue
  ok=0
  while read -r pattern; do
    # Patterns are shell globs, so `*.DYNAMIC_…` covers every application id.
    # shellcheck disable=SC2053
    [[ "$perm" == $pattern ]] && { ok=1; break; }
  done <<< "$ALLOWED"
  if [ "$ok" = 0 ]; then
    echo "::error::$perm is requested but not in scripts/allowed-permissions.txt"
    bad=1
  fi
done <<< "$REQUESTED"

echo "$REQUESTED" | sed 's/^/  /'
[ "$bad" = 0 ] && echo "every requested permission is on the allowlist"
exit "$bad"
