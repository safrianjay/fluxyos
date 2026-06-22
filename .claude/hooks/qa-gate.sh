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

    # --- Workspace-scoping invariant (blocks even with QA_PASS=1) ---
    # Finance/operational collections are workspace-scoped and shared across team
    # members; they MUST be read/written via DataService._scope(userId), never a
    # hardcoded users/{uid}/<financeCollection>. A hardcoded path silently shows
    # invited members 0 data while owners look fine. Inline page queries (in *.html
    # / page JS) are the easiest place to reintroduce this, so scan and hard-block.
    # See docs/PROJECT_BACKGROUND.md §4 + docs/TEAM_MANAGEMENT_HANDOFF.md §8.
    REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)
    if [ -n "$REPO_ROOT" ]; then
      FIN_RE='users/\$\{[a-zA-Z_.]+\}/(transactions|bills|subscriptions|budgets|budget_allocations|invoices|bank_accounts|bank_balance_snapshots|bank_statement_imports|documents|report_exports|accounting_mappings|audit_logs)'
      LEAKS=$(grep -rnE "$FIN_RE" "$REPO_ROOT"/*.html "$REPO_ROOT"/assets/js/*.js 2>/dev/null | grep -v '/db-service.js:')
      if [ -n "$LEAKS" ]; then
        cat >&2 <<EOF
🛑 WORKSPACE SCOPING GATE — Production push blocked (QA_PASS cannot override)

Hardcoded user-scoped path(s) on a finance collection were found. These read the
member's own (empty) users/{uid} data, so invited members see 0 data while the
owner looks fine. Route through the workspace seam instead:

  users/\${userId}/transactions   ->   \${this._scope(userId)}/transactions   (db-service.js)
                                   ->   \${ds._scope(userId)}/transactions     (inline page query)

Offending lines:
$LEAKS

Fix them, confirm the guard is clean, then re-push:
  grep -rnE '$FIN_RE' *.html assets/js/*.js | grep -v db-service.js   # must be empty
EOF
        exit 2
      fi
    fi

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
