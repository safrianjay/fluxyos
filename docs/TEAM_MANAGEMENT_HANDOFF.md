# FluxyOS — Workspace Team Management & RBAC — Session Handoff Memo

> Written 2026-06-22. Purpose: hand off the Team Management / multi-user workspace
> work to a fresh chat. This is **live in production**. Read this before touching
> anything related to workspaces, billing scope, invites, onboarding, or the
> `users/{uid}` → `workspaces/{id}` data model.
> Companion doc: `docs/WORKSPACE_TEAM_MANAGEMENT_STAGE2.md` (migration runbook).

---

## 1. What was built

Multi-user workspaces with roles **Owner / Admin / Finance / Viewer**, email
invites, role-gated access, audit logging, and **real-time** shared finance data.
Originally a single-user app (`users/{uid}/*`); now finance data is workspace-scoped
(`workspaces/{workspaceId}/*`) and shared across members.

**Status: shipped & live on `main` (Netlify auto-deploy). Stage 2 ACTIVE.**

---

## 2. Production state (IMPORTANT — already done)

- **`window.FLUXY_WORKSPACE_MODE = true`** — set at the top of `assets/js/sidebar-loader.js`
  (line ~10). This is the master switch; finance reads/writes go to `workspaces/{id}`.
  **Rollback = set it to `false`** (instant; source `users/{uid}` data was NOT deleted).
- **Data migration ran for all 15 users** (`users/{uid}/*` → `workspaces/{uid}/*`,
  0 mismatches). Source retained as a fallback/rollback safety net (not cleaned up).
- **Firestore rules deployed** (workspaces RBAC + collection-group members read).
  Reminder: **`firebase deploy --only firestore:rules` is SEPARATE from git push.**
- **Firestore index deployed**: `members.uid` collection-group (in `firestore.indexes.json`).
- **Invite emails LIVE**: Netlify env `TEAM_INVITES_ENABLED=true`, `RESEND_API_KEY` set,
  `APP_BASE_URL=https://fluxyos.com`. Sends from **hello@fluxyos.com**.
  (Pre-existing `NOTIFY_ENABLED=true` was left untouched — do not conflate.)
- Firebase CLI is authenticated locally (`safrianjayadi77@gmail.com`); `gcloud` is NOT
  installed and there is no service-account key on disk (deleted after migration).

---

## 3. Core architecture & data model

**Seeding rule:** `workspaceId == the owner's uid`. So an owner's uid IS their
workspace id; migration was a pure path copy (no id remapping).

**Workspace-scoped (moved to `workspaces/{wsId}/...`):** transactions, bills,
subscriptions, budgets, budget_allocations, invoices(+items), audit_logs,
bank_accounts, bank_balance_snapshots, bank_statement_imports(+rows), documents,
report_exports, accounting_mappings.

**Still user-scoped (NOT moved, by design):** billing_subscription, billing_payment_requests,
billing_invoices, billing, payment_verifications, usage_limits, onboarding,
platform_learning, ai_chats, settings, receipts, internal_users.

**New collections:**
- `workspaces/{wsId}` — `{ owner_uid, name, created_at, updated_at }` + denormalized
  subscription summary `{ plan_id, plan_name, subscription_status, billing_frequency, plan_synced_at }`
  (owner-written, member-readable — so members see the plan; owner billing stays private).
- `workspaces/{wsId}/members/{uid}` — `{ uid, email, display_name, role, status, invited_by, joined_at, updated_at }`.
- `workspaces/{wsId}/invites/{emailLowercased}` — `{ email, role, status, invited_by, invited_by_email, created_at, updated_at, expires_at, accepted_by, accepted_at }` (doc id = lowercased email so rules can verify self-join).
- `user_workspaces/{uid}` — `{ workspaceIds[], default }` reverse pointer. **Now only a tie-break hint** (resolution is collection-group-authoritative).

**`db-service._scope(scopeId)`** is the seam: returns `workspaces/{wsId}` when
`window.FLUXY_WORKSPACE_MODE === true`, else `users/{scopeId}`. In workspace mode it
resolves the workspace id from `window.FluxyWorkspace.id` → `sessionStorage 'fluxy_ws'`
cache → the passed `scopeId` (owner-safe: owner uid == workspaceId).

---

## 4. RBAC matrix (`assets/js/perms-service.js` mirrors `firestore.rules`)

| Capability | Owner | Admin | Finance | Viewer |
|---|---|---|---|---|
| Read all finance data | ✅ | ✅ | ✅ | ✅ |
| Create/edit transactions, bills, subs, budgets, invoices; mark paid; export; AI | ✅ | ✅ | ✅ | ❌ |
| Invite members + revoke invites (`team.invite`) | ✅ | ✅ | ❌ | ❌ |
| **Change roles / remove members** (`team.manage_members`) | ✅ | ❌ | ❌ | ❌ |
| Rename workspace / settings | ✅ | ✅ | ❌ | ❌ |
| Audit log read | ✅ | ✅ | ❌ | ❌ |
| Billing / change plan / delete workspace / transfer ownership | ✅ | ❌ | ❌ | ❌ |

**Hard rules (UI + Firestore):** member role-change/removal is **Owner-only**;
**no self-modification** (you cannot change your own role or remove yourself);
the `owner` member doc is immutable; no promotion to `owner` (ownership transfer
is a deferred server-side action).

---

## 5. Key flows

**Invite → join:** Owner/Admin invites from **Settings → Team & roles**
(`settings-team.html`; NOT in the sidebar). `inviteMember` writes
`invites/{email}` + `send-team-invite` Netlify function emails an accept link
`/login?invite=<email>&ws=<wsId>` from hello@fluxyos.com.

**Accept (`login.html`):** invite link shows a dedicated **auth-selection screen**
(Continue with Google primary / Continue with email secondary; email path signs in
OR creates the account; verification skipped in invite mode; context mirrored to
`sessionStorage 'fluxy_pending_invite'` to survive Google redirect). On auth,
`acceptPendingInvite` → `acceptInvite` (creates member doc + flips invite + sets pointer)
→ `markInvitedMemberExempt` (skips owner KYC) → `resetPlatformLearningState` → routes to
`/dashboard`.

**Welcome + tutorial (`dashboard.html`):** prominent success modal
("Welcome to <Business>") → on Continue, `startPlatformTour('overview')` runs the
coachmark from **step 1** ("Getting Started · 1/N"). Invited members are
onboarding-exempt (`source: 'invited_member'`) so they NEVER hit the owner
KYC/business-creation flow.

**Workspace resolution (`assets/js/workspace-service.js`):** authoritative via
`collectionGroup('members').where('uid','==',me)` (works without the pointer; **heals
already-joined members**); publishes `window.FluxyWorkspace = { id, role, status, name, plan, can() }`
and caches the id in `sessionStorage 'fluxy_ws'`.

**Self-heal (added):** if resolution finds NO membership in a workspace the user was
*invited to* (i.e. they'd fall back to their own empty `workspaces/{uid}`),
`healFromStoredInvite` recovers from the durable invite context the login page now
persists to `localStorage 'fluxy_invite_heal'` (`{ ws, invite }`). It first does a
direct read of `workspaces/{ws}/members/{uid}` (bypasses any missing `members.uid`
collection-group index), and if there's no member doc yet it calls `acceptInvite` +
`markInvitedMemberExempt` then re-resolves — all *before* any finance read. This fixes
the failure where the one-shot login acceptance silently misses (or the index isn't
deployed) and the member is stranded as a lonely owner of an empty workspace seeing
0 data. Selection also now **prefers a non-self (invited) workspace over the user's own
self-workspace**, so a stray `workspaces/{uid}` can never shadow the shared one.
The key is cleared once membership is confirmed. **Note:** members stranded *before*
this shipped (no `localStorage` key) heal by re-opening their invite link once.

**Real-time (`db-service.watchCollection` + `window.FluxyLive`):** `onSnapshot` fires
only on OTHER members' committed changes (skips initial snapshot + own pending writes).
Dashboard auto-refreshes KPIs; Ledger/Bills/Subscriptions show a non-disruptive
**"New activity · Refresh"** pill (preserves filters/pagination).

---

## 6. File map

| File | Role |
|---|---|
| `assets/js/perms-service.js` | RBAC capability matrix + `can(role, cap)` |
| `assets/js/workspace-service.js` | Resolve `window.FluxyWorkspace` (collection-group) + sessionStorage cache |
| `assets/js/db-service.js` | `_scope()`, `setActor()`, team methods, `markInvitedMemberExempt`, `resetPlatformLearningState`, `syncWorkspacePlan`, `watchCollection` |
| `assets/js/sidebar-loader.js` | `FLUXY_WORKSPACE_MODE` flag; resolves workspace; entity name from workspace; "Role · Plan" sub-line; **owner-only** trial guard; Team nav removed |
| `assets/js/platform-learning.js` | `invited_member` eligible for coachmarks; "Getting Started" label |
| `settings-team.html` | Team page (members, invite drawer, pending invites, roles, audit) |
| `settings.html` | "Team & roles" tile (Workspace group) — the Team entry point |
| `login.html` | Invite auth-selection screen + accept flow |
| `dashboard.html` | Invite success modal, force Getting Started tour, real-time auto-refresh |
| `ledger.html`/`bill.html`/`subscription.html` | resolve-before-read + real-time refresh pill |
| `netlify/functions/send-team-invite.js` | Invite email (Firebase-token gated, owner/admin, Resend) |
| `functions/lib/templates.js` | `team_invite` bilingual email template |
| `scripts/migrate-to-workspaces.js` | One-shot idempotent migration (needs `GOOGLE_APPLICATION_CREDENTIALS`) |
| `firestore.rules` / `firestore.indexes.json` | Workspace RBAC, collection-group members read, `members.uid` index |
| `tests/team-rbac-rules-emulator-test.mjs` | 36/36 emulator rules tests |

---

## 7. Verify / test

- **Emulator rules:** `firebase emulators:exec --only firestore,auth "node tests/team-rbac-rules-emulator-test.mjs"` → expect **36 passed**.
- **Two-account browser test:** Owner + invited Finance in separate browsers. Finance
  adds a transaction → Owner dashboard KPIs auto-update; Owner ledger shows the refresh pill.
- **Invite end-to-end:** Settings → Team & roles → Invite → recipient gets email →
  Accept → success modal → Getting Started coachmark → sees shared data.

---

## 8. Operational gotchas (read before changing things)

- **Rules deploy ≠ git push.** Always `firebase deploy --only firestore:rules` (and
  `:indexes`) after editing rules/indexes. Netlify only deploys static files + functions.
- **Owner seeing data does NOT prove workspace mode** — the owner's data exists in
  BOTH `users/{uid}` and `workspaces/{uid}`. Always test with a teammate.
- **Migration is idempotent and non-destructive** (re-run safe; source kept).
- **Env**: invite emails depend on `TEAM_INVITES_ENABLED=true` + `RESEND_API_KEY`.
- Pre-existing rules-compile warnings (`isValidBillingAccess`/`isValidPaymentVerification`
  unused; `1038:49 null/map`) are **not** from this work — ignore.
- User's workflow: **QA in browser, then they authorize push; commit only task files;
  push `main` with `QA_PASS=1`** (a PreToolUse hook blocks main pushes without it).
- Read `docs/PROJECT_BACKGROUND.md` + `docs/DESIGN_SYSTEM.md` before the first code edit
  (a hook enforces it).

---

## 9. Open items / not yet done

- **Real-time pill not wired on Budget + Reports pages** (they show shared data via
  resolution, but no live "Refresh" pill yet; Budget has no single global loader, Reports
  is generate-on-demand). AI already reads live per-query.
- **"Getting Started" tour has 6 steps** (header shows `1/6`). User referenced `1/7`;
  add a 7th coachmark step if exactly 7 is desired.
- **Ownership transfer** + **delete workspace** are deferred (owner-only, server-side).
- **Workspace switcher UI** is still a stub (entity switcher) — relevant only for users
  in multiple workspaces.
- **New-owner-signup-after-migration**: their `workspaces/{uid}` doc bootstraps when they
  open Team settings (`ensureWorkspace`); a brand-new owner who never opens it could read
  an empty workspace. Consider auto-bootstrapping on first app load.
- **Legacy `users/{uid}` finance copies** retained as rollback safety net — clean up only
  after a confidence period.
- Members see the workspace **plan summary** but not the owner's billing amounts (by design).

---

## 10. Commit history (this work, newest first)

```
df26e85 real-time workspace sync across members
d5dd296 authoritative workspace resolution (collectionGroup) — members see shared data
08f3cf8 polished invite success modal + Getting Started coachmark from step 1
a45f8a5 surface the workspace subscription plan to all members
c629433 business name + workspace-scoped billing + owner-only member management
2ea7a15 invited-member acceptance flow (invite auth screen, skip KYC, welcome, coachmarks)
85baa08 hide Team from sidebar, bilingual invite email, business name in copy
b374d51 activate Stage 2 — workspace-scoped finance data (FLUXY_WORKSPACE_MODE on)
81c3e3a test(voucher): fix stale growth-monthly pricing
2fd76a5 Workspace Team Management & RBAC (Stage 1)
```
