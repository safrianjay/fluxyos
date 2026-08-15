#!/usr/bin/env bash
# Pre-edit doc-read gate for FluxyOS.
#
# BLOCKS the first Edit/Write/NotebookEdit on code until the docs that actually
# matter for THAT change have been Read in the current session.
#
# Selective by design. The previous version demanded PROJECT_BACKGROUND.md
# (2,490 lines) and DESIGN_SYSTEM.md (939 lines) for every edit, so a Netlify
# function change paid for the full design system and a CSS tweak paid for the
# entire Firestore schema — ~60k tokens per session before any work started.
#
# Now:
#   PROJECT_BACKGROUND.md  always (854 lines after sharding; holds the
#                          workspace-scoping invariant, shared APIs, element IDs)
#   DESIGN_SYSTEM.md       only for UI work (HTML / CSS / page JS)
#   data-model/<shard>.md  only the collection domain the file touches
#
# EXEMPT: docs/, .claude/, .qa/, .githooks/, cbm-extracted/, and any *.md.
#
# Exit codes: 0 = allow, 2 = block (stderr shown to Claude).

INPUT=$(cat)
TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""')

case "$TOOL_NAME" in
  Edit|Write|NotebookEdit) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""')

case "$FILE_PATH" in
  */docs/*|*.md|*/.claude/*|*/.qa/*|*/.githooks/*|*/cbm-extracted/*)
    exit 0 ;;
esac

TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // ""')
if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  exit 0   # CI / non-interactive: nothing to check against.
fi

BASE=$(basename "$FILE_PATH")

# --- always required ---------------------------------------------------------
REQUIRED=("docs/PROJECT_BACKGROUND.md")
WHY=("architecture, workspace scoping, shared APIs, element IDs")

# --- design system: UI surfaces only -----------------------------------------
case "$FILE_PATH" in
  *.html|*.css|*/assets/js/*)
    REQUIRED+=("docs/DESIGN_SYSTEM.md")
    WHY+=("component reuse, tokens, numeric format, anti-slop rules")
    ;;
esac

# --- data-model shard: match the collection domain the file touches ----------
# First match wins; order matters where prefixes overlap (bank-statement before
# bank, accounting-journal before accounting).
SHARD=""
case "$BASE" in
  bank-statement*|*bank_statement*)          SHARD="bank-statement-imports" ;;
  bank-recon*|bank-account*|bank*)           SHARD="bank-accounts" ;;
  dimension*)                                SHARD="dimensions" ;;
  accounting-engine*|accounting*|journal*)   SHARD="accounting" ;;
  invoice*)                                  SHARD="invoices" ;;
  bill*)                                     SHARD="bills" ;;
  budget*)                                   SHARD="budgets" ;;
  tax*)                                      SHARD="tax-center" ;;
  commerce*)                                 SHARD="commerce" ;;
  subscription*)                             SHARD="subscriptions" ;;
  internal*)                                 SHARD="internal-ops" ;;
  billing*|checkout*|voucher*|payment*)      SHARD="billing" ;;
  onboarding*|platform-learning*)            SHARD="onboarding" ;;
  document-attachment*|documents*)           SHARD="documents" ;;
  settings*)                                 SHARD="settings" ;;
  ledger*|transaction*)                      SHARD="transactions" ;;
  audit*|activity-log*)                      SHARD="audit-logs" ;;
esac

if [ -n "$SHARD" ]; then
  REQUIRED+=("docs/data-model/${SHARD}.md")
  WHY+=("exact field names and value sets for this collection")
fi

# --- check the transcript ----------------------------------------------------
MISSING=()
MISSING_WHY=()
for i in "${!REQUIRED[@]}"; do
  doc="${REQUIRED[$i]}"
  # A Read on this doc appears as one JSON line containing both the tool name
  # and the path. Match on the path tail so /docs/x.md and docs/x.md both count.
  if ! grep -q "\"name\":\"Read\".*${doc}" "$TRANSCRIPT" 2>/dev/null; then
    MISSING+=("$doc")
    MISSING_WHY+=("${WHY[$i]}")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  {
    echo "🛑 PRE-EDIT GATE — Read the docs for this change first"
    echo ""
    echo "Editing: $FILE_PATH"
    echo ""
    echo "Not yet Read in this session:"
    for i in "${!MISSING[@]}"; do
      echo "  - ${MISSING[$i]}"
      echo "      ${MISSING_WHY[$i]}"
    done
    echo ""
    echo "This gate is selective — it asks only for what THIS file needs, not the"
    echo "whole doc set. Read them with the Read tool, then retry."
    echo ""
    echo "Exempt: docs/, .claude/, .qa/, .githooks/, cbm-extracted/, any *.md."
  } >&2
  exit 2
fi

exit 0
