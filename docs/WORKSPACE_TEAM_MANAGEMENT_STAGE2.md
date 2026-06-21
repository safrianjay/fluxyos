# Workspace Team Management & RBAC — Stage 2 runbook (finance-data migration)

> Stage 1 AND the Stage 2 **code** are built and emulator-verified. This doc
> covers Stage 2: physically moving finance data from `users/{uid}/*` to
> `workspaces/{workspaceId}/*` so teammates get role-gated access to finance
> records. **Activation is destructive against live data — do not big-bang it.**
> Run it emulator → single seeded account → broad rollout, keeping `users/{uid}`
> as an untouched fallback.

## STATUS: Stage 2 code is implemented and flag-gated (default OFF)

The code below is shipped behind `window.FLUXY_WORKSPACE_MODE` (default **off** =
today's exact `users/{uid}` behaviour). Deploying it changes nothing until the flag
is flipped after the data migration runs.

- `assets/js/db-service.js` — finance collections route through `_scope(id)` (off →
  `users/{id}`, on → `workspaces/{id}`); attribution uses `this.actorUid || userId`.
- `firestore.rules` — role-gated `workspaces/{id}` finance blocks (transactions,
  bills, subscriptions, budgets, budget_allocations, invoices+items, bank_accounts,
  bank_balance_snapshots, bank_statement_imports+rows, documents, report_exports,
  accounting_mappings) reusing the existing field validators. `users/{uid}` blocks
  untouched (fallback). **Tested: `tests/team-rbac-rules-emulator-test.mjs` 21/21;
  existing user-scoped rules tests still pass.**
- `scripts/migrate-to-workspaces.js` — idempotent copier (recursive, no source
  delete). Emulator smoke-tested (top-level + subcollections + bootstrap).
- `assets/js/shared-dashboard.js` — Add-Transaction/Bill/Subscription write through
  the workspace scope + `setActor`; viewers blocked from create + Fluxy AI (UX gate;
  rules are the hard boundary).

### Activation runbook (per account, then broad)
```bash
# 1. Dry-run on the emulator, then a single prod account:
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/migrate-to-workspaces.js <uid> --dry-run
GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/migrate-to-workspaces.js <uid>
# 2. Deploy the rules (separate from the Netlify push):
firebase deploy --only firestore:rules
# 3. Flip the flag (set before db-service loads, e.g. a small config script or inline
#    head script on app pages):  window.FLUXY_WORKSPACE_MODE = true;
# 4. Verify that account in the browser, then run --all and keep the flag on.
GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/migrate-to-workspaces.js --all
```

### Remaining for full teammate parity (incremental, owners already work)
- Per-page **read** call-sites still pass `user.uid` (fine for owners: uid == wsId).
  Update them to `window.FluxyWorkspace.id` + `ds.setActor(user.uid, role)` page by
  page for full teammate read access (dashboard.js, ledger, bill, budget*, invoices).
- Server functions that read finance data server-side (`weekly-digest.js` /
  `netlify/functions/api.js` `digest`) must become workspace-aware when the flag is
  on (they currently read `users/{uid}`).
- Storage: document/bank-statement uploads still write to `users/{uid}/...` storage
  paths; the workspace `documents` rule already accepts `(users|workspaces)/...`.

---

## Original step detail (reference)

## What Stage 1 already shipped (live-safe, additive)

- `assets/js/perms-service.js` — role→capability matrix + `can(role, cap)`.
- `assets/js/workspace-service.js` — resolves `window.FluxyWorkspace` ({ id, role,
  status, can() }); fail-safe fallback to owner-of-self (id == uid) pre-migration.
  Wired into `sidebar-loader.js` auth hook.
- `firestore.rules` — additive `workspaces/{workspaceId}` block: profile, `members`,
  `invites` (email-keyed), `audit_logs`, + `user_workspaces/{uid}` pointer.
  `hasRole()/isMember()` helpers. **The existing `users/{uid}` block is untouched.**
- `assets/js/db-service.js` — `setActor(uid, role)` + team methods: `ensureWorkspace`,
  `getMembers`, `getInvites`, `inviteMember`, `revokeInvite`, `updateMemberRole`,
  `removeMember`, `acceptInvite`, `getWorkspaceAuditLogs`, `getWorkspaceProfile`.
- `settings-team.html` (+ sidebar `nav-team`) — members, role assignment, invite
  drawer, pending invites, role reference, owner/admin activity panel.
- `netlify/functions/send-team-invite.js` + `team_invite` template — Firebase-token
  gated, owner/admin-verified, sent from `hello@fluxyos.com`. Kill switch
  `TEAM_INVITES_ENABLED` (default off). `login.html` accepts `?invite=&ws=`.
- `tests/team-rbac-rules-emulator-test.mjs` — 15/15 passing.

### Seeding rule (carries into Stage 2)
For every existing account, **workspaceId == owner uid**. The migration is then a
pure path copy `users/{uid}/*` → `workspaces/{uid}/*` with no id remapping, so
uid-embedded references (bank_account_id, audit target_id, storage paths) stay valid.

## Stage 2 steps

### 1. Migration function (`functions/` — Admin SDK)
A callable/HTTP one-shot, per user, idempotent:
- Copy every doc under `users/{uid}/<collection>/**` → `workspaces/{uid}/<collection>/**`
  for the **finance/operational** collections only:
  `transactions, bills, subscriptions, vendors, budgets, budget_allocations,
  invoices (+items), audit_logs, bank_accounts, bank_balance_snapshots,
  bank_statement_imports (+rows), documents, report_exports, accounting_mappings,
  settings`.
- Leave **per-identity** collections under `users/{uid}` (do NOT move):
  `billing_subscription, billing_payment_requests, billing_invoices, billing,
  payment_verifications, usage_limits, onboarding, platform_learning, mail_log`,
  and the top-level `internal_users`. Billing/trial/AI-quota are per-user.
- Ensure `workspaces/{uid}` profile + `members/{uid}` (owner) + `user_workspaces/{uid}`.
- **Do not delete the source** — `users/{uid}/*` stays as fallback this stage.
- Verify: per-collection source count == destination count (dry-run on emulator first).

### 2. `db-service.js` re-scope (the careful part)
- Change finance path prefixes `users/${userId}/<c>` → `workspaces/${workspaceId}/<c>`
  for the migrated collections **only**. Leave billing/onboarding/usage_limits/
  internal paths on `users/${uid}`.
- **Critical:** the positional scope arg becomes `workspaceId`, but audit/attribution
  fields (`actor_uid`, `created_by`, `updated_by`, `voided_by`) must use
  `this.actorUid` (already added), NOT the scope arg — Firestore rules pin those to
  `request.auth.uid`, and for a teammate `workspaceId !== actorUid`. A blind rename
  would mis-attribute every record and be rejected by rules.

### 3. Page call-site cutover
- Pages currently call `ds.method(user.uid, …)`. Change to pass `FluxyWorkspace.id`
  and call `ds.setActor(user.uid, FluxyWorkspace.role)` once at boot. Representative:
  `assets/js/dashboard.js`, `ledger.html`, `bill.html`, `subscription.html`,
  `budget*.js`, `invoices`, and the `getTransactionDataService()` helper + Add-
  Transaction submit in `assets/js/shared-dashboard.js`.
- Gate behind a feature flag so reads can revert to `users/{uid}` if needed.

### 4. Finance rules under `workspaces/{workspaceId}`
- Add role-gated `match` blocks for each finance collection, reusing the existing
  field validators (`isValidBaseRecord`, `isValidTransactionRecordUpdate`,
  `isValidAuditLog`, invoice/budget/bank validators) inside the workspace scope:
  - read: `hasRole(wsId, ['owner','admin','finance','viewer'])`
  - create/update: `hasRole(wsId, ['owner','admin','finance'])`
  - delete/void: `hasRole(wsId, ['owner','admin'])`
- Extend `isValidWorkspaceAuditLog` target_collection enum as needed.
- Keep `users/{uid}` rules until the migration is verified for all users.

### 5. UI write gating (Phase 8)
- In `shared-dashboard.js`, gate write entry points by `FluxyWorkspace.can(...)`:
  Add-Transaction, Mark-as-Paid, exports, and the Fluxy AI launcher
  (`toggleFluxyAI` / `ai-chat.js`) — hide/disable for viewers. Rules remain the
  hard boundary; UI gating is UX only.

## Deploy / activation notes
- **Rules deploy is separate from the Netlify push:** `firebase deploy --only firestore:rules`.
- **Enable invite email:** set `TEAM_INVITES_ENABLED=true` and `RESEND_API_KEY` on
  Netlify. Leave off to ship the feature with manual link-sharing (the invite doc +
  `/login?invite=&ws=` link work without email).
- Do **not** touch `NOTIFY_ENABLED` / the paused notify sweep — invites are a
  separate 1:1 transactional path from `hello@fluxyos.com`.

## QA (browser, per docs/QA_CHECKLIST.md)
1. Owner opens `/settings-team` → sees self as Owner; workspace auto-bootstraps.
2. Invite a teammate → pending invite appears; (if email on) they receive it.
3. Teammate opens `/login?invite=<email>&ws=<id>`, signs in with that email → joins.
4. Change a member's role / remove a member → reflected + audited.
5. Sign in as a Viewer → after Stage 2, add/edit/mark-paid/AI are disabled and
   writes are rejected by rules; reads still work.
6. Console clean (no CSP/CORS/404/Firebase errors). Confirm all finance pages still
   load and write against the new scope.
