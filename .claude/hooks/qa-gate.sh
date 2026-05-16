#!/usr/bin/env bash
# QA gate hook for FluxyOS.
# - BLOCKS `git push` targeting main/master unless command contains QA_PASS=1
# - WARNS (non-blocking) on edits to high-risk files
#
# Input on stdin (JSON):
#   { "tool_name": "Bash" | "Edit" | "Write", "tool_input": { ... } }
# Exit codes:
#   0 = allow
#   2 = block (stderr is shown to Claude)

INPUT=$(cat)
TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""')

if [ "$TOOL_NAME" = "Bash" ]; then
  COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""')

  # Match `git ... push ... main|master` (catches `git push origin main`,
  # `git -C /path push origin main`, etc.)
  if printf '%s' "$COMMAND" | grep -qE 'git[[:space:]].*push' \
     && printf '%s' "$COMMAND" | grep -qE '(^|[[:space:]/:])(main|master)([[:space:]]|$)'; then
    if printf '%s' "$COMMAND" | grep -q 'QA_PASS=1'; then
      exit 0
    fi
    cat >&2 <<'EOF'
🛑 QA GATE — Production push blocked

This push targets main/master. Before proceeding, run through:

  [ ] All new file references (CSS, JS, images) actually EXIST locally
      → `ls` any path you just linked to in HTML
  [ ] Smoke-tested affected pages in a real browser (not just lint/types)
  [ ] Browser console clean — no CSP, CORS, 404, or Firebase errors
  [ ] Read docs/QA_CHECKLIST.md sections for your change type
  [ ] Read docs/PROJECT_BACKGROUND.md if you touched Firestore / data logic

When (and only when) those checks pass, re-run with QA_PASS=1 prepended:

  QA_PASS=1 <your original push command>

Lying to bypass this gate is on you, not the hook.
EOF
    exit 2
  fi
fi

if [ "$TOOL_NAME" = "Edit" ] || [ "$TOOL_NAME" = "Write" ]; then
  FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""')
  case "$FILE_PATH" in
    */firestore.rules|*/storage.rules)
      echo "📋 Security rules — verify schema/field names against docs/PROJECT_BACKGROUND.md before saving." >&2
      ;;
    */dashboard.html|*/ledger.html|*/bill.html|*/subscription.html|*/integration.html|*/login.html)
      echo "📋 Dashboard page — smoke-test in browser after edit. Check console for CSP/404/CORS errors before pushing." >&2
      ;;
    */netlify.toml)
      echo "📋 netlify.toml — if you changed CSP, allowlist EVERY external origin (script-src AND connect-src). Source maps go to connect-src." >&2
      ;;
  esac
fi

exit 0
