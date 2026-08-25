#!/usr/bin/env bash
# Decode the committed QR SVG back to a URL and assert it matches.
#
# A QR that does not scan fails SILENTLY, in front of a room of people. The logo
# knockout destroys modules by design, so "it generated without error" proves
# nothing — the only real check is decoding the composited image the way a phone
# camera would. Uses macOS Vision, so it needs no extra dependency.
set -euo pipefail
SVG="${1:-assets/images/qr-event.svg}"
WANT="${2:-https://fluxyos.com/event}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

if ! command -v swift >/dev/null 2>&1; then
  echo "  – QR verify skipped (no swift; macOS only)"; exit 0
fi
qlmanage -t -s 1000 -o "$TMP" "$SVG" >/dev/null 2>&1 || true
PNG="$TMP/$(basename "$SVG").png"
[ -f "$PNG" ] || { echo "  ✗ could not rasterise $SVG"; exit 1; }

GOT="$(swift "$(dirname "$0")/verify-qr.swift" "$PNG" 2>/dev/null | head -1 || true)"
if [ "$GOT" = "$WANT" ]; then
  echo "  ✓ QR decodes to $GOT (logo composited)"
else
  echo "  ✗ QR decoded to '${GOT:-nothing}', expected '$WANT'"
  echo "    The committed SVG would not scan. Regenerate: node scripts/make-qr.js > $SVG"
  exit 1
fi
