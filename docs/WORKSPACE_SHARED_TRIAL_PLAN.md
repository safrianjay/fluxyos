# FluxyOS — Workspace-Shared Trial / Subscription Plan

> Status: **SHIPPED 2026-06-22.** Firestore rules deployed
> (`firebase deploy --only firestore:rules`) and JS pushed to `main` (Netlify
> auto-deploy). Companion to `docs/TEAM_MANAGEMENT_HANDOFF.md` (see its §9 "Open
> items"). Goal: make trial/subscription access **shared across the workspace** so
> every member sees the same trial banner and is gated together when the trial
> ends. Previously the trial guard was **owner-only** and members failed *open*.
>
> Emulator rules tests green: **38 passed** (was 36) via
> `firebase emulators:exec --only firestore,auth "node tests/team-rbac-rules-emulator-test.mjs"`.
> **Outstanding:** a two-account *browser* visual check (member sees the same
> banner/date; member paywall on expiry) was not automated — do a quick manual
> pass. Existing trialing multi-member workspaces backfill their trial fields on
> the owner's next login (see §6).

---

## 1. Why this is needed (current behavior)

- Trial/billing state is **user-scoped**: `users/{ownerUid}/billing_subscription/current`
  (`trial_started_at`, `trial_ends_at`, `status`). There is no workspace-level trial.
- The guard is **owner-only**: [sidebar-loader.js:545-565](../assets/js/sidebar-loader.js#L545-L565)
  runs `trial-access.applyToPage` only when `!ws || ws.role === 'owner'`.
- Consequence for invited members **today**:
  - They have **no** `billing_subscription` doc (KYC-exempt, never onboard), so
    `trial-access.deriveState(null)` **fails open** → full access, **no banner**.
  - When the owner's trial **expires**, the owner is paywalled but **members keep
    working**. This violates "one trial state per workspace / consistent across all
    users."
- Members already read a denormalized, non-sensitive plan summary on
  `workspaces/{wsId}` (`plan_id/plan_name/subscription_status/billing_frequency`,
  written by [`syncWorkspacePlan`](../assets/js/db-service.js#L1322)) — but **not**
  the trial dates, so they can't render a date / days-remaining and aren't gated.

## 2. Design decision

Keep the owner's `billing_subscription/current` as the **single source of truth**
(do NOT duplicate billing into the workspace). Extend the existing denormalization:
mirror the **non-sensitive trial timing + status** onto `workspaces/{wsId}`
(owner-written, member-read), and have members derive their banner/locks from that
summary through the **same** `trial-access` pipeline. No amounts, no payment IDs
ever leave the owner scope — same privacy posture as the current plan summary.

This means **one trial state per workspace** by construction: members never call
`ensureBillingSubscription` (which would create a separate per-member trial); they
only read the mirror.

## 3. Changes (concrete)

### 3.1 `firestore.rules` — extend `isValidWorkspaceProfile` (rules:2817)
The write is field-locked via `hasOnly([...])`. Add to the allowlist + per-field
type checks (all `timestamp|null`, non-sensitive):
- `trial_started_at`, `trial_ends_at`, `current_period_end`

`subscription_status` is already mirrored and is all the member derive needs for
the verdict. Keep the existing rule that **admins may only change `name`/`updated_at`**
— the new fields stay **owner-only** (they sit outside the admin `hasOnly` branch
at rules:3026-3027, so no change needed there).
**Deploy separately:** `firebase deploy --only firestore:rules` (NOT covered by git
push — handoff gotcha §8).

### 3.2 `db-service.syncWorkspacePlan(ownerUid)` (db-service.js:1322)
Add to the mirrored `setDoc(..., { merge:true })` payload:
```
trial_started_at: s.trial_started_at || null,
trial_ends_at:    s.trial_ends_at    || null,
current_period_end: s.current_period_end || null,
```
Runs on the **owner** path *after* `applyToPage` has ensured/auto-expired the
subscription, so the mirror reflects the current status.

### 3.3 `workspace-service.js` — publish trial timing (workspace-service.js:143-156)
The resolver already reads `workspaces/{state.id}`. Extend `state.plan` (or add a
sibling `state.access`) with `trialStartedAt`, `trialEndsAt`, `periodEndsAt`,
`status`, and `publish()` them on `window.FluxyWorkspace`. Pure read extension —
no new query, no new round-trip.

### 3.4 `trial-access.js` — member adapter (reuse the pipeline)
Add `export async function applyToWorkspaceMember(wsAccess)` that:
1. Builds a `subscription`-shaped object from the mirror:
   `{ status, trial_started_at, trial_ends_at, current_period_end }`.
2. **Stale-safe expiry:** if `status === 'trialing'` and `trial_ends_at < now`,
   synthesize `status = 'expired'` (members get no server-side expiry write, so
   they must expire client-side from the date — `deriveState` day-math already
   handles days-remaining; this just flips the verdict).
3. Runs the **existing** `deriveState` → `renderBanner` / `renderPaywall` /
   `applyPageLocks`. No new banner UI.
4. **Never** calls `ensureBillingSubscription`.

Add a **member paywall variant**: when blocked, a member **cannot pay** (billing is
owner-only RBAC). Show "Your workspace's trial has ended — contact your workspace
owner to continue," with **Sign out**, and **no** "Choose a plan" CTA (that routes
to a checkout they can't complete). This is the only genuinely new copy/logic.

### 3.5 `sidebar-loader.js` — branch members in (sidebar-loader.js:545-565)
Turn the owner-only `if` into an `if/else`:
- Owner / solo (`!ws || ws.role === 'owner'`): unchanged (applyToPage + syncWorkspacePlan).
- Member (`ws.role !== 'owner'`): `applyToWorkspaceMember(window.FluxyWorkspace)`.

## 4. Edge cases

- **Staleness:** the mirror only refreshes when the *owner* loads a page. Members
  flip to expired/blocked **client-side** from `trial_ends_at` (3.4 step 2), so a
  stale `trialing` still gates correctly past the end date — no cron needed.
- **Owner privacy:** only non-sensitive timing/status mirrored; amounts/payment
  request IDs stay owner-scoped.
- **Paid workspaces:** including `current_period_end` lets members also see
  "payment due soon"/"renewal ending soon" so they aren't surprised by a lapse.
  Optional but recommended for parity.
- **Multi-workspace / ex-owner users:** when `ws.role !== 'owner'`, always prefer
  the workspace mirror over any personal billing doc.

## 5. Tests / QA

- **Emulator rules** (`tests/team-rbac-rules-emulator-test.mjs`, currently 36/36):
  add (a) owner CAN write the new trial fields to `workspaces/{id}`, (b) admin
  still limited to `name`/`updated_at`, (c) member CAN read them.
- **Two-account browser:** owner on trial → member (other browser) sees the SAME
  banner + date + days-remaining. Extend the owner trial (run
  `scripts/extend-grace-trial.js`) → member banner updates on reload. Let the owner
  trial expire → member sees the **member paywall** (contact owner), not checkout.
- Confirm no page-level horizontal scroll regression from the banner
  (`document.documentElement.scrollWidth === clientWidth`).

## 6. Deploy sequence

1. Edit rules + the 4 JS files + tests.
2. `firebase deploy --only firestore:rules`.
3. Browser QA (two accounts), then commit task files and push `main` with
   `QA_PASS=1` (Netlify auto-deploys the static JS).
4. **Backfill:** existing workspace docs gain the trial fields lazily on the next
   owner login. To populate immediately, run a one-shot Admin script reusing the
   `syncWorkspacePlan` field set for each active multi-member workspace.

## 7. Files touched

| File | Change |
|---|---|
| `firestore.rules` | `isValidWorkspaceProfile` allowlist + types (3 fields) |
| `assets/js/db-service.js` | `syncWorkspacePlan` mirrors trial timing |
| `assets/js/workspace-service.js` | publish trial fields on `window.FluxyWorkspace` |
| `assets/js/trial-access.js` | `applyToWorkspaceMember` + member paywall variant |
| `assets/js/sidebar-loader.js` | member branch into the guard |
| `tests/team-rbac-rules-emulator-test.mjs` | rules cases for the new fields |
| `docs/TEAM_MANAGEMENT_HANDOFF.md` | tick the §9 open item |

## 8. Effort & risk

**Medium.** ~5 files + one rules deploy. **No data-model migration** (pure
denormalization extension of an existing pattern). Main new surface is the member
paywall UX (can't pay → "contact owner"). **Reversible:** revert JS + rules and
members simply stop seeing the banner (fail-open, today's behavior).
