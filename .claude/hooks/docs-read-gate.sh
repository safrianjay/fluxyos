#!/usr/bin/env bash
# Pre-edit doc-read gate for FluxyOS.
# - BLOCKS the first Edit/Write/NotebookEdit on code (HTML/JS/CSS/rules) in a
#   session until the assistant has Read PROJECT_BACKGROUND.md and DESIGN_SYSTEM.md.
# - EXEMPT: edits to docs/, .claude/, .qa/, .githooks/, and any *.md file.
#
# Rationale: CLAUDE.md says "MANDATORY: read PROJECT_BACKGROUND.md before
# implementing any feature." Without enforcement, the rule degrades to a
# suggestion. This hook converts it to a hard gate, same shape as qa-gate.sh.
#
# Input on stdin (JSON):
#   { "tool_name": "...", "tool_input": { "file_path": "..." },
#     "transcript_path": "/abs/path/to/conversation.jsonl", ... }
# Exit codes:
#   0 = allow
#   2 = block (stderr is shown to Claude)

INPUT=$(cat)
TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""')

case "$TOOL_NAME" in
  Edit|Write|NotebookEdit) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""')

# Allowlist: paths where the gate doesn't apply.
case "$FILE_PATH" in
  */docs/*|*.md|*/.claude/*|*/.qa/*|*/.githooks/*)
    exit 0 ;;
esac

TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // ""')
if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  # No transcript available (CI / non-interactive). Don't block.
  exit 0
fi

REQUIRED_DOCS=("PROJECT_BACKGROUND.md" "DESIGN_SYSTEM.md")
MISSING=()
for doc in "${REQUIRED_DOCS[@]}"; do
  # A Read tool call on this doc in the current session shows up as a single
  # JSON line containing both `"name":"Read"` and the doc filename.
  if ! grep -q "\"name\":\"Read\".*$doc" "$TRANSCRIPT" 2>/dev/null; then
    MISSING+=("$doc")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  cat >&2 <<EOF
🛑 PRE-EDIT GATE — Read required docs first

You're about to edit code without having Read these in this session:
$(for d in "${MISSING[@]}"; do echo "  - docs/$d"; done)

CLAUDE.md MANDATORY rule. Open each via the Read tool, then retry.
Exemptions: edits to docs/, .claude/, .qa/, .githooks/, and any *.md file.

This gate exists because design-system rules (component reuse, no native
date inputs, etc.) live in DESIGN_SYSTEM.md, and Firestore field names /
existing helpers live in PROJECT_BACKGROUND.md. Skipping them causes
duplicate widgets, wrong field names, and rework.
EOF
  exit 2
fi

exit 0
