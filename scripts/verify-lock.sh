#!/usr/bin/env bash
# Reproduce CI's `npm ci` lockfile validation, locally, in seconds.
#
# `npm ci` is stricter than `npm install`: it refuses to run when package.json
# and package-lock.json disagree. That disagreement is invisible in a working
# tree that already has node_modules, so it is only ever discovered in CI —
# twice so far on this repo.
#
# --ignore-scripts because the validation happens before any postinstall runs,
# and @shopify/react-native-skia's postinstall fails outside a real checkout
# for reasons that have nothing to do with the lockfile.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/.nvmrc" "$TMP/"
cd "$TMP"

echo "node $(node -v), npm $(npm -v)"
if npm ci --ignore-scripts >/dev/null 2>"$TMP/err"; then
  echo "lockfile OK"
else
  echo "LOCKFILE OUT OF SYNC — this is what CI will say:"
  grep -E "npm error (code|Missing|Invalid)" "$TMP/err" | head -20 || cat "$TMP/err" | tail -20
  exit 1
fi
