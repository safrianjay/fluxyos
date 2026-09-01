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
      # Full finance-collection list from docs/PROJECT_BACKGROUND.md §4. The
      # earlier copy of this regex stopped at audit_logs, so a scope leak in any
      # Tax Center, Commerce, or accounting-kernel collection passed the gate
      # unnoticed (verified 2026-08-07: a `users/${userId}/tax_transactions`
      # query was not detected). scripts/qa-run.js carries the same list; keep
      # the two in sync when a workspace-scoped collection is added.
      FIN_RE='users/\$\{[a-zA-Z_.]+\}/(transactions|bills|subscriptions|budgets|budget_allocations|invoices|bank_accounts|bank_balance_snapshots|bank_statement_imports|documents|report_exports|accounting_mappings|audit_logs|chart_of_accounts|business_categories|journals|counters|ledger_balances|ledger_balances_by_dim|periods|vendors|dimensions|items|goods_receipts|stock_movements|stock_adjustments|pos_tables|pos_orders|pos_shifts|pos_reservations|company_tax_profile|tax_mappings|tax_transactions|tax_periods|tax_filings|commerce_accounts|commerce_orders|commerce_transactions|commerce_refunds|commerce_settlements|commerce_payouts|commerce_sync_jobs|commerce_sync_errors|commerce_webhook_logs)'
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

    # --- QA artifact verification -------------------------------------------
    # QA_PASS=1 alone is no longer sufficient. `npm run qa` writes
    # .qa/qa-run.json stamped with the HEAD sha; this gate only accepts the push
    # when that artifact exists, passed in full, and describes THIS commit.
    # Typing QA_PASS=1 without a matching run now fails, which is the point:
    # the previous version ended with "lying to bypass this gate is on you",
    # i.e. it was an honour system.
    ART="$REPO_ROOT/.qa/qa-run.json"
    if ! printf '%s' "$COMMAND" | grep -q 'QA_PASS=1'; then
      cat >&2 <<'EOF'
🛑 QA GATE — Production push blocked

This push targets main/master. Run the automated QA suite first:

  npm run qa

It runs three lanes selected from your diff:
  BE       syntax, workspace-scoping invariant, check:* regressions, rules tests
  FE       design-system lint + real-browser console sweep of affected pages
  PRODUCT  i18n EN/ID pairing, two-site page classification, SEO essentials

When it passes it writes .qa/qa-run.json for the current commit. Then:

  QA_PASS=1 <your original push command>
EOF
      exit 2
    fi

    if [ ! -f "$ART" ]; then
      cat >&2 <<'EOF'
🛑 QA GATE — QA_PASS=1 given, but no QA run exists

.qa/qa-run.json is missing. QA_PASS=1 is no longer a promise you can type —
it must be backed by an actual run:

  npm run qa
EOF
      exit 2
    fi

    if command -v jq >/dev/null 2>&1; then
      ART_HEAD=$(jq -r '.head // ""' "$ART" 2>/dev/null)
      ART_PASSED=$(jq -r '.passed // false' "$ART" 2>/dev/null)
      ART_PARTIAL=$(jq -r '.partial // false' "$ART" 2>/dev/null)
      ART_WHEN=$(jq -r '.ran_at // "?"' "$ART" 2>/dev/null)
      CUR_HEAD=$(cd "$REPO_ROOT" && git rev-parse HEAD 2>/dev/null)
      # Batching economics. One push builds BOTH Netlify sites, so a two-commit
      # publish costs the same as a twenty-commit one. Advisory, never blocking:
      # a real hotfix must always be able to go out.
      N_COMMITS=$(cd "$REPO_ROOT" && git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
      if [ "$N_COMMITS" -le 2 ] 2>/dev/null && [ "$N_COMMITS" -gt 0 ] 2>/dev/null; then
        printf '\n  \342\232\240 SMALL BATCH: publishing %s commit(s) costs the same build\n' "$N_COMMITS" >&2
        printf '    minutes as publishing twenty. Bundle unless this is urgent.\n' >&2
        printf '    See docs/DEVELOPMENT_WORKFLOW.md \302\2470 and \302\2475.\n\n' >&2
      fi

      if [ "$ART_PASSED" != "true" ]; then
        FAILED=$(jq -r '.results[]? | select(.ok == false) | "  ✗ [\(.lane)] \(.name)"' "$ART" 2>/dev/null)
        cat >&2 <<EOF
🛑 QA GATE — last QA run FAILED

Run at: $ART_WHEN
$FAILED

Fix these and re-run \`npm run qa\` before pushing.
EOF
        exit 2
      fi

      if [ "$ART_PARTIAL" = "true" ]; then
        cat >&2 <<'EOF'
🛑 QA GATE — last QA run was PARTIAL

It ran with --skip-browser or --lane=, so the browser console sweep did not
cover this change. Run the full suite:

  npm run qa
EOF
        exit 2
      fi

      if [ -n "$CUR_HEAD" ] && [ "$ART_HEAD" != "$CUR_HEAD" ]; then
        cat >&2 <<EOF
🛑 QA GATE — QA run is STALE

  QA ran against: ${ART_HEAD:0:8}
  you are pushing: ${CUR_HEAD:0:8}

Commits landed after QA passed, so the tested tree is not the pushed tree.
Re-run \`npm run qa\` on the current commit.
EOF
        exit 2
      fi
    fi

    exit 0
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
