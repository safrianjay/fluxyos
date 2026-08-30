#!/bin/sh
# Run every rules emulator spec, failing on the first one that fails.
#
# This lives in a file rather than inline in package.json because npm eats `$s`
# in a nested-quoted inline loop — the first cut of `npm run rules:test` looped
# 19 times running `node ""`, printed 19 empty banners, and EXITED 0. A green
# result that tested nothing is worse than no script at all.
set -e
found=0
for s in tests/*-rules-emulator-test.mjs; do
    [ -f "$s" ] || continue
    found=$((found + 1))
    echo "--- $s"
    node "$s"
done
if [ "$found" -eq 0 ]; then
    echo "ERROR: no rules emulator specs matched — the glob is wrong" >&2
    exit 1
fi
echo "ran $found rules emulator spec(s)"
