# FluxyOS Dashboard Security System

Security model for the authenticated FluxyOS dashboard. Read this with
`PROJECT_BACKGROUND.md`, `SYSTEM_DESIGN.md`, and `QA_CHECKLIST.md` before
adding dashboard pages, Firestore collections, data exports, edit/delete flows,
approval flows, AI actions, or integrations.

---

## 1. Security Goal

FluxyOS handles financial records for Indonesian businesses. The dashboard must
protect three things:

- User and business financial data
- Money-related workflows such as bills, approvals, and subscriptions
- Trust signals such as audit trails, exports, and AI-generated suggestions

The current app uses Firebase Auth and user-scoped Firestore collections. That
is a good starting point, but future dashboard work should move toward a
workspace security model with explicit roles, permissions, and audit logs.

---

## 2. Current Security Baseline

Current implementation:

- Firebase Authentication protects dashboard pages.
- App data lives under `users/{userId}/...`.
- Dashboard pages redirect unauthenticated visitors to `/login`.
- Firestore reads and writes should go through `assets/js/db-service.js`.
- Financial amounts are stored as raw numbers, not formatted strings.
- App pages do not load the public marketing footer.

Current risks to keep in mind:

- The UI currently assumes one user owns one data scope.
- Team roles and approvals do not exist yet.
- Audit logging does not exist yet.
- Edit/delete and payment-like flows are listed as planned and must not ship
  without permissions, confirmations, and audit records.
- Client-side hiding is not security. Firestore rules must enforce the same
  boundaries as the dashboard UI.

---

## 3. Target Security Model

FluxyOS should evolve from `users/{uid}` into this model when team features are
introduced:

```text
workspaces/{workspaceId}
  members/{userId}
  transactions/{transactionId}
  bills/{billId}
  subscriptions/{subscriptionId}
  vendors/{vendorId}
  budgets/{budgetId}
  audit_logs/{auditLogId}
  approvals/{approvalId}
```

Until workspaces are implemented, keep all production data under:

```text
users/{userId}
  transactions/{transactionId}
  bills/{billId}
  subscriptions/{subscriptionId}
```

Do not mix user-scoped and workspace-scoped records in one feature. If a feature
needs workspace ownership, create the migration plan first.

---

## 4. Roles

These are the target dashboard roles. New team or approval features should map
to these roles instead of inventing page-specific access names.

| Role | Purpose | Typical Access |
|---|---|---|
| `owner` | Business owner or workspace creator | Full access, billing/security settings, delete workspace |
| `admin` | Finance/admin operator | Manage users, records, settings, integrations |
| `finance` | Finance team member | Create and edit finance records, export data, reconcile |
| `accountant` | Bookkeeper / accountant | Everything `finance` can do, plus the accounting toolkit: post and reverse manual journals, close periods |
| `approver` | Department or budget approver | Review and approve assigned bills, budgets, and exceptions |
| `employee` | Regular submitter | Submit claims, receipts, card/budget requests |
| `viewer` | Auditor, investor, or read-only stakeholder | Read-only dashboard and exports where allowed |

Role rules:

- Every user must have exactly one primary role per workspace.
- `owner` is the only role that can transfer ownership or delete a workspace.
- `viewer` must never write financial data.
- `accountant` has the same finance-collection access as `finance` plus
  `journals.manual` (create/edit/post/reverse manual journals); period **lock**
  stays owner/admin only. Shipped roles today: `owner`, `admin`, `finance`,
  `accountant`, `viewer` (`approver`/`employee` remain reserved).
- `employee` must never approve their own money-moving request.
- `approver` can approve only records assigned to them or their scope.
- Sensitive permissions should be additive and explicit; do not infer them from
  page access alone.

---

## 5. Permissions

Use capability names for code and Firestore rules. A role can have many
capabilities.

| Capability | Meaning |
|---|---|
| `transactions.read` | View ledger transactions |
| `transactions.create` | Add revenue or expense records |
| `transactions.update` | Edit transaction metadata |
| `transactions.delete` | Delete or void a transaction |
| `bills.read` | View bills |
| `bills.create` | Add vendor bills |
| `bills.update` | Edit bill metadata |
| `bills.approve` | Approve bills for payment workflow |
| `bills.mark_paid` | Mark bills as paid |
| `subscriptions.read` | View subscriptions |
| `subscriptions.create` | Add subscriptions |
| `subscriptions.update` | Edit subscriptions |
| `subscriptions.cancel` | Mark subscriptions canceled |
| `vendors.manage` | Create/edit vendor profile or payment details |
| `budgets.manage` | Create/edit budget rules and limits |
| `invoices.manage` | Create/edit/finalize customer invoices |
| `accounting.read` | View Accounting Center: journals, general ledger, trial balance, chart of accounts |
| `accounting.post` | Post/manage journals + chart of accounts (finance/accountant+) |
| `journals.manual` | Create, edit, post, and reverse manual journals (finance/accountant+) |
| `period.close` | Close an accounting period (finance/accountant+) |
| `period.lock` | Lock a closed accounting period (owner/admin only) |
| `exports.create` | Export CSV/PDF/accounting files |
| `integrations.manage` | Connect or disconnect third-party integrations |
| `users.manage` | Invite, remove, or change roles |
| `security.manage` | Manage roles, sessions, and security settings |
| `audit.read` | View audit history |
| `ai.execute` | Let Fluxy AI perform approved write actions |

Default recommendation:

| Role | Capabilities |
|---|---|
| `owner` | All capabilities |
| `admin` | All except ownership transfer and workspace deletion |
| `finance` | Finance records, exports, reconciliation, audit read, accounting read/post, manual journals, period close |
| `accountant` | Same as `finance` (finance records + accounting read/post + `journals.manual` + `period.close`); no period lock |
| `approver` | Read relevant records, approve assigned bills/budgets |
| `employee` | Create own requests/receipts, read own submitted records |
| `viewer` | Read-only dashboard and audit where allowed |

---

## 6. Firestore Access Rules

Current user-scoped rule intent:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null
        && request.auth.uid == userId;
    }
  }
}
```

Target workspace rule intent:

```javascript
function isSignedIn() {
  return request.auth != null;
}

function memberDoc(workspaceId) {
  return get(/databases/$(database)/documents/workspaces/$(workspaceId)/members/$(request.auth.uid));
}

function isMember(workspaceId) {
  return isSignedIn() && memberDoc(workspaceId).data.status == "active";
}

function hasRole(workspaceId, roles) {
  return isMember(workspaceId) && memberDoc(workspaceId).data.role in roles;
}

match /workspaces/{workspaceId}/transactions/{transactionId} {
  allow read: if hasRole(workspaceId, ["owner", "admin", "finance", "accountant", "viewer"]);
  allow create: if hasRole(workspaceId, ["owner", "admin", "finance", "accountant"]);
  allow update: if hasRole(workspaceId, ["owner", "admin", "finance", "accountant"]);
  allow delete: if hasRole(workspaceId, ["owner", "admin"]);
}
```

Firestore rule requirements:

- Rules must check ownership or active workspace membership.
- Rules must reject unauthenticated reads and writes.
- Rules must enforce role/capability boundaries for write actions.
- Billing usage counters must be owner-scoped and monotonic. The current trial
  Fluxy AI counter lives at `users/{uid}/usage_limits/ai_chat_trial`; rules allow
  only increment-by-one writes up to the trial limit of 3 and never allow delete or
  reset from the browser.
- Trial storage uses the shared billing entitlement source. Upload helpers must
  preflight aggregate storage before creating document/import records, while
  Firebase rules enforce owner scope and single-write file limits.
- Rules must validate critical fields where possible:
  - `amount` is a number.
  - `type` is `"revenue"` or `"expense"`.
  - `vendor_name` is a string.
  - `timestamp` is server-owned or immutable after create.
- The UI and `DataService` should still validate input, but Firestore rules are
  the source of truth for authorization.

---

## 7. Audit Logging

Every sensitive write should create an audit log. This is mandatory before
shipping edit/delete, approvals, vendor changes, exports, integrations, or AI
write actions.

Audit path:

```text
users/{userId}/audit_logs/{auditLogId}
```

Target workspace path:

```text
workspaces/{workspaceId}/audit_logs/{auditLogId}
```

Required fields:

| Field | Type | Notes |
|---|---|---|
| `actor_uid` | string | Firebase Auth UID of the acting user |
| `actor_role` | string | Role at the time of action, if available |
| `action` | string | Example: `transaction.create`, `bill.approve` |
| `target_collection` | string | Example: `transactions`, `bills` |
| `target_id` | string | Document ID affected |
| `before` | map/null | Snapshot of sensitive fields before change |
| `after` | map/null | Snapshot of sensitive fields after change |
| `reason` | string/null | Required for reject/delete/override actions |
| `source` | string | `dashboard`, `ai`, `integration`, or `system` |
| `created_at` | timestamp | Server timestamp |

Audit logging rules:

- Audit logs are append-only.
- Users must not be able to edit or delete audit logs from the dashboard.
- Delete actions should be soft-delete or void where financial integrity matters.
- AI actions must include the prompt/action context and user confirmation record.

---

## 8. Sensitive Actions

These actions require extra protection:

- Delete or void a transaction
- Edit amount, type, vendor, due date, or payment status
- Approve a bill
- Mark a bill as paid
- Change vendor payment details
- Export financial data
- Connect or disconnect an integration
- Let AI create, edit, approve, or delete records
- Change user roles or invite/remove users

Required controls:

- Confirm destructive or irreversible actions.
- Show a plain-language summary before commit.
- Require a reason for delete, reject, override, and vendor payment changes.
- Write an audit log.
- Show a success or failure toast.
- Handle Firebase permission errors with friendly messages.

---

## 9. Dashboard UI Security Rules

The dashboard should make secure behavior obvious:

- Hide unavailable actions based on role, but never rely on hiding alone.
- Disable risky buttons until required fields are valid.
- Label dangerous actions clearly with red/destructive styling.
- Use orange only for primary/positive action emphasis, never destructive flows.
- Prefer "Void" or "Archive" over permanent delete for finance records.
- Never show raw Firebase errors to end users.
- Never expose full secrets, tokens, API keys, card numbers, or bank credentials.
- Export buttons must tell the user what data range and file type will be
  exported before the export starts.

---

## 10. AI Agent Security

Fluxy AI must be read-first by default.

Allowed without extra confirmation:

- Summarize dashboard trends
- Explain margin or spend changes
- Suggest categories
- Flag missing receipts
- Draft next steps

Requires explicit confirmation:

- Create a transaction, bill, subscription, vendor, or budget
- Edit any existing record
- Approve or reject a workflow
- Export financial data
- Trigger an integration sync

Never allowed without a future hardened workflow:

- Move money directly
- Change vendor bank details
- Delete audit logs
- Change user roles
- Disable security controls

Every AI write action must include:

- User who approved it
- Exact action payload
- Reason/context
- Timestamp
- Audit log entry

---

## 11. Data Protection

Data handling rules:

- Store only the data required for the workflow.
- Keep amounts as raw numbers and format only in the UI.
- Do not store passwords, OTPs, card PANs, bank login credentials, or API
  secrets in Firestore.
- Store integration secrets only in a server-side secret manager or provider
  vault, never in client-visible JavaScript.
- Avoid logging sensitive financial details to the browser console.
- Public landing pages must not read or write dashboard Firestore data.

**Commerce Integration Platform (shipped, Phase 3).** Marketplace OAuth
tokens are AES-256-GCM-encrypted (`COMMERCE_TOKEN_KEY` env, rotation via
`COMMERCE_TOKEN_KEY_PREVIOUS`) in the top-level `commerce_credentials`
collection with `allow read, write: if false` — only Netlify functions (Admin
SDK) touch it, and no endpoint ever returns token material. Webhook payloads
are HMAC-verified against exact raw bytes before parsing; OAuth callbacks are
authorized by an HMAC-signed single-use state nonce (15-min TTL). Connect /
disconnect / manual sync require `integrations.manage` (owner/admin, verified
server-side) and audit-log as `integration.connect` / `integration.disconnect`
/ `integration.sync` with `source: 'integration'`. Kill switches (all default
off, app site only): `COMMERCE_ENABLED`, `COMMERCE_SYNC_ENABLED`,
`COMMERCE_WEBHOOKS_ENABLED`, `COMMERCE_MOCK_ENABLED` (never in production).
Full design: `docs/COMMERCE_INTEGRATION_PHASE0_REVIEW.md`.

Recommended future controls:

- Session/device review panel
- Recent login alerts
- Export history
- Integration connection history
- Backup and restore policy
- Data retention policy for receipts and audit logs

---

## 11b. Attachment Access (files)

Financial attachments — receipts, supplier invoices, bank statements, payment
proofs — are the most sensitive objects in the product. This section is the
authority on how they are served.

### The rule: never mint a public URL

`getDownloadURL()` is **banned**. It stamps a token into the object's metadata
and returns a link that Firebase serves over public HTTPS with **Storage
Security Rules bypassed**. That is documented Firebase behaviour, not a
misconfiguration — rules govern SDK access, not tokenised media URLs.

This was live in FluxyOS and was verified against production: a plain HTTP GET
with no browser, no cookies and no auth returned `200` and the whole file.
Storage rules were correct the entire time; nothing consulted them on the path
users actually fetched through.

### How files are served now

`DataService.getDocumentBlob()` → `getBlob()`, which sends the caller's Firebase
ID token. **`storage.rules` is therefore the enforcement point on every read** —
auth, plus uid ownership or active workspace membership, checked server-side by
Firebase. `getDocumentObjectURL()` wraps it in a `blob:` URL: origin-bound,
unguessable, and dead when the tab closes. Pasting one elsewhere does nothing.

Consequences to keep in mind:

- **Bucket CORS is load-bearing.** `getBlob()` is an authenticated XHR, so every
  serving origin must be in `cors.json` — and the file does nothing until
  `gsutil cors set cors.json gs://fluxyos.firebasestorage.app` runs. A missing
  origin shows up as attachments that never load.
- `receipt_url` is **never written**. It persisted a public URL into Firestore,
  so the leak outlived the page and travelled with the record. Legacy values are
  resolved back to a storage path and fetched through the SDK.
- `uploadReceipt()` is removed (it minted a URL and wrote outside `_scope()`),
  and `users/{uid}/receipts/` is read-only in `storage.rules`.

### Access logging, and what it is not

`document.viewed` / `document.downloaded` are written to `audit_logs` by the
**client**. They are a usage trail, **not a tamper-proof access log** — an
authorised member can read bytes without the entry being written. The security
guarantee does not depend on them; that is `storage.rules`, enforced
server-side. A provable who-saw-what record requires a backend proxy that
streams bytes after verifying the ID token. Not built; scope it only if
compliance demands it.

### Deletion is deliberate

`allow delete: if false` on every storage prefix. Files are retained even when
the owning record is voided, because an attachment is audit evidence for a
financial entry. This is a decision, not an oversight — revisit it only
alongside a data-retention policy.

### Revoking exposure

Fixing the code stops **new** links. Tokens already issued never expire, so
`scripts/revoke-storage-tokens.js` clears
`firebaseStorageDownloadTokens` on every object, killing every link previously
handed out. Run `--dry-run` first. It is irreversible for anyone holding an old
link, which is the point.

Order matters: **deploy the app code → `firebase deploy --only storage` →
revoke tokens → `scripts/clear-receipt-urls.js`.** Revoking before the code is
live breaks previews for users mid-session.

**Executed 2026-08-07.** Of 191 objects in the production bucket, **151 were
publicly reachable** — every legacy receipt (25/25), 116 documents and 10 bank
statements. All 151 tokens revoked; a re-scan reports 0. Verified independently
by unauthenticated HTTP GET against a sample of each group and against the URL
captured before the fix: all now **403** (that URL returned 200 and the full
file beforehand). 59 transactions carrying a `receipt_url` were cleared; re-scan
reports 0.

Note when auditing: revocation leaves the `firebaseStorageDownloadTokens`
metadata KEY present with an empty value. Grepping for the key name therefore
looks like a live token and is misleading — check the value, or just make an
unauthenticated request, which is the only test that means anything.

### Tokens come back on every new upload — and that is expected

Firebase stamps `firebaseStorageDownloadTokens` **server-side at upload**, not
when `getDownloadURL()` is called. Removing the `getDownloadURL()` calls stops
the app LEARNING the token; it does not stop the token existing. Verified: a
file uploaded after that change still answered an unauthenticated GET with 200.

The client cannot remove it. Passing the reserved key in `customMetadata` fails
the upload outright; a follow-up `updateMetadata()` is rejected with
`storage/unknown`. Do not reintroduce either — the first breaks uploads for
users, the second is a silent no-op that reads like protection.

What makes this acceptable: **the client cannot READ the token either.**
`getMetadata()` hides the reserved key, so no ordinary member can extract one
and publish a permanent link. Reading it requires Admin SDK or GCS-level access,
which is already full access to everything.

So the boundary is: nothing in the app ever asks for or surfaces a token, and
every read goes through `getDocumentBlob()` under `storage.rules`. Clearing the
tokens themselves is a **periodic Admin-SDK sweep**
(`scripts/revoke-storage-tokens.js`), not something the upload path can do.
Run it on a schedule — after any bulk upload, and at minimum before an audit.

---

## 12. Implementation Order

Recommended rollout:

1. Keep current user-scoped Firestore security rules strict.
2. Add `audit_logs` support before edit/delete and approvals.
3. Add a permission map in a shared dashboard security helper.
4. Gate UI actions by permissions.
5. Update Firestore rules to enforce the same permissions.
6. Add roles and workspace membership when multi-user teams ship.
7. Move from `users/{uid}` collections to `workspaces/{workspaceId}` with a
   documented migration.
8. Add AI action approval records before AI writes any financial data.

Do not ship payment-like actions before audit logs, permissions, confirmation,
and Firestore rule enforcement exist.

---

## 13. QA Requirements

Run the normal `QA_CHECKLIST.md` flow for every security-related change.

Security-specific checks:

- Unauthenticated users cannot open dashboard pages.
- User A cannot read or write User B data.
- Restricted roles cannot perform blocked actions.
- Firestore permission errors are handled with friendly UI.
- Sensitive writes create audit logs.
- Delete/void/reject/override flows require a reason.
- Exports include only the authorized user's or workspace's data.
- AI write actions require explicit confirmation and create audit logs.
- Browser console does not print secrets or sensitive payloads.

If a check requires Firebase Console, production credentials, or a second user
account, mark it as manual verification in the final notes.
