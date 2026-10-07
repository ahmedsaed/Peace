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
exec maestro test -e GEMINI_KEY="$key" "${@:-.maestro/live/}"
