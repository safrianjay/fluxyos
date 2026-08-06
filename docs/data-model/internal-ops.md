---
status: current
owns: [internal_users]
updated: 2026-08-07
source: docs/PROJECT_BACKGROUND.md §4 (sharded 2026-08-07)
---

# Internal Operations Console

> Workspace-scoping rules for these collections live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

### 4j. Internal Operations Console (Phase 1 MVP)

The Internal Operations Console (`internal.html` + `assets/js/internal-dashboard.js`)
is an internal-only activation & verification tool. It is **not** a customer page:
no marketing footer, no public nav, no customer sidebar, and it is never linked
from public navigation, the dashboard sidebar, or `sitemap.xml`. Full spec:
`docs/internal_operations_console_plan.md`.

**Auth (temporary):** a client-side credential gate (`username "fluxyos admin"`,
sessionStorage key `fluxy_internal_admin_session`) marked
`MVP_INTERNAL_ONLY_TEMPORARY_AUTH`. It is **not** a Firebase identity, so the
console is unauthenticated to Firestore. Replace with Firebase custom claims or a
backend-verified admin session before production.

These are the only **top-level (non-user-scoped)** collections in the schema, and
their `firestore.rules` are intentionally open (field-validated). They hold
operational metadata only — never financial ledger rows, balances, secrets, or
formatted currency strings.

#### `internal_users/{userId}` (open: read/create/update; client delete blocked)

| Field | Type | Notes |
|-------|------|-------|
| `user_id` | string | Matches the Firebase Auth UID / doc id. |
| `email`, `display_name`, `phone_number` | string \| null | Identity, refreshed by self-sync. |
| `business_name`, `role` | string \| null | Derived from `onboarding/profile` (`role` is the self-described onboarding title, not the workspace permission role). |
| `organization` | string \| null | Workspace/org name the user belongs to (owner's org for members); falls back to the user's own `business_name`. Powers the console Users tab **Organization** column. |
| `workspace_role` | string \| null | The user's **actual workspace permission role** — `owner` / `admin` / `finance` / `accountant` / `viewer` (per `perms-service.js`). Powers the **Account Type** column. Distinct from the onboarding `role` above. |
| `account_status` | string | See §13 of the plan (`registered`…`suspended`). |
| `kyc_status` | string | `not_started`…`rejected`. |
| `payment_status` | string | `not_required`…`expired`. |
| `onboarding_completed` | bool | Mirrors `onboarding/progress`. |
| `kyc_submitted_at`, `kyc_reviewed_at`, `payment_submitted_at`, `payment_verified_at` | Timestamp \| null | |
| `plan_id`, `payment_method` | string \| null | Denormalized payment fields. |
| `payment_amount` | number \| null | Raw integer Rupiah. Never a formatted string. |
| `assigned_reviewer_id`, `last_internal_note`, `risk_level` | string \| null | Internal metadata. |
| `last_active_at` | Timestamp \| null | Presence heartbeat — last time the user was active in the app. Powers the console Users tab **Activity** column (Online / last-seen). |
| `archived` | bool | Soft-archive flag. `true` hides the user from the console's active surfaces (Users table default view, KYC/Payment queues, Overview, tab badges) — reversible, and never deletes data. |
| `archived_at` | Timestamp \| null | When the user was archived; cleared to `null` on restore. |
| `created_at`, `updated_at` | Timestamp | `serverTimestamp()`. |

**Population:** each user's own client upserts its own row via
`DataService.syncSelfToInternalIndex(uid, { email, display_name })`, called from the
`sidebar-loader.js` auth handler (every app page load) and from `onboarding.js`
`onSubmit`. Self-sync always refreshes identity/profile fields but **only seeds
status fields on first create** (or advances `not_started`/`in_progress` →
`submitted` on onboarding completion), so a reviewer's decision is never clobbered.
Self-sync only covers a user who signs in and whose own client can write.

**Roster mirror (invited members):** because self-sync is per-user, an invited
teammate who never personally opened a dashboard — or whose own client is blocked
from Firestore (shields/extensions) — would never get a row and would be invisible
in the console (or appear with a blank **Account Type** because `workspace_role`
was never stamped). To close that gap, the **workspace owner's** session mirrors
the whole roster: after the owner's self-sync, `sidebar-loader.js` calls
`DataService.mirrorWorkspaceMembersToInternalIndex(workspaceId, orgName, { skipUid })`,
which reads `workspaces/{wsId}/members` (owners can) and upserts each member's
`internal_users/{memberUid}` via `mirrorMemberInternalRow`. The mirror only knows
roster facts (uid, email, display_name, `workspace_role`, shared `organization`):
it **creates** a minimal row with safe default statuses, or on an existing row
**patches only** `workspace_role`/`organization` (+ email/display_name when
missing) and only when they changed — it never reads the member's user-scoped
onboarding and never touches their KYC/payment/account status. Throttled to
**≤1 sweep / 5 min per workspace** (sessionStorage) so repeated owner page loads
don't re-read the roster. Pending invites (no Auth uid yet) still can't appear —
`internal_users` is uid-keyed. For an immediate whole-fleet backfill (rather than
waiting for each owner to next log in), run the hand-run Admin SDK script
`scripts/backfill-internal-roster.js` (`--dry-run` supported), which walks every
workspace's `members` subcollection and applies the exact same create/patch
semantics. It only reflects **members that have a member doc** — a still-pending
invite has no uid to key on.

**Presence heartbeat:** `DataService.touchActivity(uid)` stamps `last_active_at`
= `serverTimestamp()` on the user's own `internal_users` row. Wired from
`sidebar-loader.js` right after the self-sync — fires once on load, then on real
interaction (`pointerdown`/`keydown`/`scroll`/`focus`/`visibilitychange`) — and is
self-throttled to **≤1 write/60s** (skipped while the tab is hidden), so an
actively-used tab keeps beating while an idle-open tab ages into "last seen". The
console treats activity within 2 minutes as **Online**; otherwise it shows relative
last-seen, escalating to the absolute stamp past 24h. `firestore.rules`
(`isValidInternalUser`) validates `last_active_at` as a timestamp.

**Auth deletion cleanup:** `functions/index.js` exports the 1st-gen Firebase Auth
trigger `cleanupInternalUserOnAuthDelete`. Deleting a single Firebase
Authentication account removes its denormalized `internal_users/{uid}` row via
the Admin SDK, so the user disappears from `/internal` after refresh. The trigger
does not delete owner-scoped `users/{uid}/...` finance data or historical
`internal_audit_logs`. Firebase Admin SDK bulk deletion does not emit per-user
Auth deletion events; delete accounts one at a time when this automatic cleanup
is required. Production activation requires a Blaze-plan Firebase project and:
`firebase deploy --only functions:cleanupInternalUserOnAuthDelete`.

#### `internal_audit_logs/{auditLogId}` (open: read/create; update/delete blocked)

| Field | Type | Notes |
|-------|------|-------|
| `actor_uid` | string \| null | `null` in the credential-gate MVP. |
| `actor_username` | string | `"fluxyos admin"`. |
| `actor_role` | string | `"internal_admin"`. |
| `action` | string | `kyc.approve`, `kyc.request_revision`, `kyc.reject`, `payment.under_review`, `payment.verify`, `payment.reject`, `user.activate`, `user.suspend`, `user.archive`, `user.restore`, `trial.extended`, `internal.note.update`. |
| `target_user_id` | string | Affected `internal_users` doc id. |
| `before` / `after` | map \| null | Primitive status snapshots only. |
| `reason` | string \| null | Required for revision/reject/suspend. |
| `source` | string | Locked to `"internal_dashboard"`. |
| `created_at` | Timestamp | `serverTimestamp()` (must equal `request.time`). |

The console cannot write the owner-scoped `users/{uid}/audit_logs` (validation
requires a real `actor_uid`), so the user-scoped audit mirror is deferred to the
backend phase.

**DataService methods:** `getInternalUsers({ limitCount })`, `getInternalUser`,
`updateInternalUserStatus(userId, statusPayload, auditContext)` (status update +
audit log), `addInternalAuditLog`, `getInternalAuditLogs(limitCount = 100)`,
`syncSelfToInternalIndex`. Status-action rules (allowed-from states, resulting
statuses, audit actions) are specified in `docs/internal_operations_console_plan.md`
§18.

#### `sales_leads/{leadId}` (open read; client writes blocked — Admin SDK only)

Public **Contact Sales** enquiries from `/contact-sales` (Enterprise AI is
sales-led). The page POSTs to the `submit-contact-sales` Netlify function, which
honeypot-filters + validates and writes the lead via the **Admin SDK** (bypasses
rules). `firestore.rules` therefore allows open `read` (the credential-gated
console reads it unauthenticated, same MVP posture as `internal_users`) and
denies client `create`/`delete`. The credential-gated console may `update`
**only** the workflow `status` (rule restricts the diff to `status` +
`status_updated_at`, `status in [new, contacted, closed, spam]`), so core lead
fields stay immutable and the collection can't be spammed or wiped. Fields:
`name`, `email`, `whatsapp`, `company`, `business_type`, `team_size`, `message`,
`status` (`new`→`contacted`/
`closed`/`spam`), `source` (`contact-sales`), `plan_interest` (`enterprise`),
`user_agent`, `created_at`, `status_updated_at`. Surfaced in the console's
**Sales Leads** tab via `DataService.getSalesLeads({ limitCount })` +
`updateSalesLeadStatus(leadId, status)`. The function also fires best-effort
new-lead alerts: Resend email to `SALES_ALERT_EMAIL` and/or a Slack message to
`SLACK_WEBHOOK_URL` (each gated by its own env; missing config = silent skip).

#### `outreach_leads/{leadId}` (open read + field-validated client writes)

Manually-added prospects behind the console's **Sales Leads → Outreach**
sub-view (`internal.html` `panel-leads`, `internal-dashboard.js`). The operator
adds a prospect and the bilingual meeting-reminder email is sent in one step.
CRUD is done by the console directly against Firestore (open read +
field-validated create/update/delete, `isValidOutreachLead`, MVP posture like
`internal_digest_jobs`). The **email send** is the only gated action: it goes
through the **`send-lead-outreach`** Netlify function, which renders the
`lead_outreach` bilingual template (`functions/lib/templates.js`) and sends via
Resend from `hello@fluxyos.com`, authorized by the `INTERNAL_API_TOKEN` env that
the console passes in the `x-internal-token` header (the console has no Firebase
Auth — MVP_INTERNAL_ONLY_TEMPORARY). Fields: `name`, `gender`
(`male`/`female`, drives the honorific Bapak/Ibu · Mr/Mrs), `email`, `role`
(optional), `company` (optional), `meeting_at` (Timestamp, formatted to WIB in
the email), `status` (`new`/`sent`/`meeting_booked`/`closed`), `last_sent_at`
(optional), `created_at`, `updated_at`. **DataService:** `getOutreachLeads`,
`addOutreachLead`, `updateOutreachLead`, `deleteOutreachLead`. Distinct from the
public `sales_leads` (Contact-Sales) collection above.

**Trial mirror (added):** `internal_users/{uid}` also carries `access_status`,
`trial_started_at`, `trial_ends_at`, `trial_days_remaining`, and
`payment_proof_file_name` so the console can show trial/payment status (see §4k).
These are written by `DataService.syncInternalUserAccessIndex`. Internal
`payment_status` has no `not_started`; the trial's `not_started` is simply not
mirrored.

**Extend Trial (console action):** the Users tab shows a per-row **Extend Trial**
button **only for live trials** (`access_status` `trial_active`/`trial_expiring`).
It opens a 1 week / 2 weeks / 1 month dropdown that POSTs to the token-gated
**`extend-trial`** Netlify function (`x-internal-token: INTERNAL_API_TOKEN`, same
MVP posture as `send-lead-outreach`). Because the canonical trial lives in the
owner-scoped `billing_subscription/current` (§4k) — which `firestore.rules` lets
only the signed-in owner write, and the credential-gated console has no Firebase
Auth — the write **must** go through this Admin-SDK function (it bypasses rules).
The function guards `status === 'trialing'` server-side, extends **additively**
(`new_end = max(now, current trial_ends_at) + duration`, calendar month for
`1m`), and commits in one batch: canonical `billing_subscription/current`
(`trial_ends_at`, keeps `trial_started_at`), the `workspaces/{uid}` plan summary,
the `internal_users/{uid}` mirror (`access_status`, `trial_ends_at`,
`trial_days_remaining`), and an `internal_audit_logs` `trial.extended` entry
(admin, before/after end, duration, timestamp). It reuses the existing
`FIREBASE_SERVICE_ACCOUNT` + `INTERNAL_API_TOKEN` envs and the default function
path (no `netlify.toml` route). This is the automated, per-user counterpart to the
one-shot `scripts/extend-grace-trial.js`.

**Row actions & Archive User (console):** each Users-tab row has a primary
**Review** button plus a **⋮ overflow menu** (reuses the voucher-menu shell) —
secondary actions live there so the table stays scannable. The menu holds
**Extend Trial** (the trial-only group above) and **Archive user** / **Restore
user**. Archiving is a **soft, reversible hide that touches only the open
`internal_users` index** — no owner-scoped finance data, so (unlike Extend Trial)
**no server function**: the console writes `archived` + `archived_at` client-side
through `DataService.updateInternalUserStatus` (the `internal_users` update +
`internal_audit_logs` write in one batch, actions `user.archive` / `user.restore`).
Archive prompts a danger-tone `showConfirmDialog`. A per-tab **Active / Archived**
toggle switches the Users view; archived users are excluded from the active Users
list, the KYC and Payment review queues, the Overview KPIs/action list, and the
KYC/Payment tab-count badges. All historical records (transactions, subscriptions,
KYC, payments, audit logs) are preserved — archive never deletes.
