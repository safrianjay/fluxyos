# Commerce Integration Platform — Phase 0 Architecture Review

Date: 2026-07-13
Status: Awaiting sign-off (gates Phase 1)
Scope of this review: reconcile `COMMERCE_INTEGRATION_PLATFORM.md` /
`COMMERCE_INTEGRATION_ARCHITECTURE.md` against the actual FluxyOS codebase,
record binding design decisions (D1–D6), and define the Phase 1–3 execution
plan. Where this review and the spec docs conflict, **this review wins**.

---

## 1. Spec-vs-reality deviations

| # | Spec says | Reality / decision | Why |
|---|---|---|---|
| 1 | Backend is FastAPI | **Netlify Functions.** The FastAPI app in `api/` is a legacy mirror that is not deployed; production API traffic runs through `netlify/functions/api.js`, and all privileged work (admin SDK, crons, background jobs, kill switches) already lives in Netlify Functions. | No new deploy target, reuse proven patterns (`notify-core.js` `initAdmin()`, `schedule()` crons, `digest-broadcast-worker.js` queue, `-background` functions). |
| 2 | Collections at `users/{userId}/commerce_*` | **Workspace-scoped** under `workspaces/{wsId}/` via the `DataService._scope()` seam, mirrored in the `users/` rules block for non-workspace mode. | PROJECT_BACKGROUND §4 is mandatory: hardcoded `users/` finance paths silently show invited members 0 data (Beila/Pitto incident class). Commerce data is finance/operational data shared by the team. |
| 3 | OAuth tokens stored on `commerce_accounts` | **Split (D1).** `commerce_accounts` is client-readable status only; encrypted tokens live in a top-level deny-all `commerce_credentials` collection reachable only by the Admin SDK. | `commerce_accounts` must be readable by the UI; anything client-readable must never contain token material. |
| 4 | Ledger updates are fully automatic | **Per-account `auto_post` flag, default `true` (D2).** `auto_post:false` stops the pipeline at normalized `commerce_transactions` (`ledger_status:'pending_review'`). | Keeps the spec's automatic behavior as default while giving owners the same review escape hatch the bank-statement import flow proved out. |
| 5 | Separate `commerce_order_items` collection | **Items embedded as an array on the `commerce_orders` doc.** | Marketplace orders are small; embedding gives one read instead of N. Revisit only if item-level analytics demand it. |
| 6 | "Every marketplace uses OAuth" (implied) | **Three distinct auth models** (§2). Connector contract carries `authType`; connectors own all marketplace HTTP including request signing. | Shopee is not OAuth2 (HMAC-signed URLs, rotating single-use refresh tokens); Tokopedia is client-credentials with no seller redirect. |
| 7 | Docs named `COMMERCE_INTEGRATION_*.md` | Files existed as `docs/# FluxyOS Commerce Integration *.md` (a markdown heading leaked into the filename). **Renamed to canonical names** in this phase. | Referenced by name from multiple prompts; malformed names break tooling and links. |

## 2. Connector-reality findings (drive the abstraction)

**TikTok Shop Open Platform** (`app_key`/`app_secret`)
- Seller authorization via redirect; token exchange at `auth.tiktok-shops.com`
  (`/api/v2/token/get`, `grant_type=authorized_code`) → ~7-day access token +
  long-lived refresh token.
- Every API request is HMAC-SHA256 signed (`sign` param from app_secret + path
  + sorted params + body) with the token in `x-tts-access-token` and a per-shop
  `shop_cipher` param.
- Webhook signature: HMAC-SHA256(app_secret, app_key + raw body) in the
  `Authorization` header.

**Shopee Open Platform v2** (`partner_id`/`partner_key`) — *not OAuth2*
- The auth link itself is HMAC-signed; Shopee appends `code` + `shop_id` to the
  registered redirect URL. Codes expire in ~10 minutes.
- **Access token lives 4 hours; refresh token is single-use (~30 days) and both
  rotate on refresh** — concurrent refreshes corrupt the chain, so the token
  manager serializes refresh behind a Firestore-transaction lock.
- Every call is URL-signed (`partner_id, timestamp, access_token, shop_id, sign`).
- **Order list API caps request windows at 15 days** — the 90-day initial sync
  must chunk, with a persisted cursor.
- Webhook signature: HMAC-SHA256(partner_key, callback_url + `|` + raw body) —
  verification needs the request URL, not just headers + body.

**Tokopedia Seller API** (`client_id`/`client_secret`/`fs_id`)
- OAuth2 **client-credentials**: no seller redirect at all. Shops are bound to
  the app during Tokopedia partner onboarding, so the "connect" UX is a shop
  picker form, not a consent redirect. Tokens are short-lived with no refresh
  token (re-mint on expiry).
- Webhook payloads have weak/no HMAC → compensate with a per-account secret in
  the webhook path and re-fetch the referenced order before trusting anything.
- ⚠️ **Platform risk:** post TikTok–Tokopedia merger, sellers are migrating to
  "Shop | Tokopedia" on TikTok Shop's platform and the legacy Seller API's
  future is uncertain. **Mandate:** smoke-test the Tokopedia credentials
  against the live API before committing its connector slot in Phase 5+.

**Consequences baked into the design**
1. Per-connector `authType`: `oauth_redirect` (TikTok) | `signed_redirect`
   (Shopee) | `credentials_form` (Tokopedia).
2. Connectors own ALL marketplace HTTP (signing differs per platform); the
   framework never calls a marketplace directly.
3. `verifyWebhook({ headers, rawBody, url })` — `url` is required (Shopee).
4. Token manager supports rotate-on-refresh + single-use refresh (Shopee),
   long-lived refresh (TikTok), and re-mint-no-refresh (Tokopedia), with a
   per-credential refresh lock.
5. Sync jobs carry `window_start` / `window_end` / `cursor` checkpoints.

## 3. Binding design decisions

### D1 — Token storage split
- `workspaces/{ws}/commerce_accounts/{platform}_{shopId}` — client-READABLE
  status doc: `platform, shop_id, shop_name, region, currency, status
  ('connecting'|'connected'|'expired'|'error'|'disconnected'), last_sync_at,
  last_sync_status, sync_health ('healthy'|'degraded'|'failing'|null),
  initial_sync {status, progress_pct, window_done}, token_expires_at
  (informational timestamp only), auto_post (bool, default true), connected_by,
  connected_at, updated_at`. **No token material, ever.** Clients may update
  only `auto_post` + `updated_at` (owner/admin); everything else is
  server-written (Admin SDK bypasses rules).
- `commerce_credentials/{wsId}__{platform}_{shopId}` — **top-level** collection,
  `allow read, write: if false`. Only the Admin SDK touches it. Top-level (not
  a workspace subcollection) so no future workspace-rules edit can accidentally
  expose it, and the token-refresh sweep is a single-collection query. Fields:
  `workspace_id, account_id, platform, shop_id, access_token_enc,
  refresh_token_enc, access_expires_at, refresh_expires_at, platform_meta
  {shop_cipher|fs_id|region…}, refresh_lock_at, key_version, created_at,
  updated_at`.
- `commerce_shop_directory/{platform}_{shopId}` — top-level, deny-all, written
  at connect time: `{workspace_id, account_id, status}`. Gives the public
  webhook receiver an O(1), index-free shop → workspace lookup.
- Encryption: `netlify/functions/lib/commerce/crypto.js` — AES-256-GCM (node
  `crypto`), key from `COMMERCE_TOKEN_KEY` (base64, must decode to 32 bytes;
  throw at init otherwise). Ciphertext format
  `v1:{key_version}:{iv_b64}:{tag_b64}:{ct_b64}`. Rotation: encrypt always uses
  the active key; decrypt falls back to `COMMERCE_TOKEN_KEY_PREVIOUS` on
  version mismatch and lazily re-encrypts on the next write.

### D2 — Ledger writes (first server-side writer)
- The finance mapping engine runs server-side (Admin SDK) inside the sync
  worker.
- **Deterministic ledger doc IDs**: `cm_{platform}_{shopId}_{orderId}_rev` /
  `_fee` / `_rf`, and `cm_{platform}_{shopId}_stl_{settlementId}` — written
  with `create()` fail-if-exists semantics, so retries and webhook/poll overlap
  can never duplicate a ledger entry (same idempotency model as
  `functions/lib/email.js` `mail_log`).
- Fields: existing `transactions` shape (`amount` raw integer IDR, lowercase
  `type` `income`/`fee`/`refund`, `status:'Completed'`, `timestamp` = order or
  settlement time, `vendor_name` = `"{Platform} — {shop_name}"`) plus
  `source:'commerce'`, `created_via:'integration'`, new link fields
  `commerce_order_id` + `commerce_account_id`, and
  `accounting_status:'pending'` so the **existing client sweep
  (`postPendingJournals`)** posts double-entry journals later — identical to
  the bulk-import precedent. The server never writes journals.
- `commerce_order_id` / `commerce_account_id` must be added to
  `wsValidTxCreate` AND `wsValidTxUpdate` (and the user-scoped twin
  validators) — they are full-doc `hasOnly` allowlists, so without this any
  later client edit/void/journal-sweep on a commerce transaction is rejected.
- Settlements map to cash movements using the existing `cash_*` fields
  (`cash_effective:true, cash_status:'actual', cash_direction:'in'`).

### D3 — API routing: new `netlify/functions/commerce.js`
Not `api.js`: it is ~3,600 lines, deliberately admin-free (Firestore REST with
the caller's token), and auth-everything — while commerce needs the Admin SDK,
an unauthenticated OAuth callback GET, its own kill switch, and cold-start
isolation for `firebase-admin`.

Routes under `/api/v1/commerce/*` (netlify.toml redirect placed **before** the
`/api/v1/*` catch-all):
- `POST /connect/{platform}` — Firebase auth + server-side workspace role check
  (owner/admin ⇔ `integrations.manage`; membership read via Admin SDK, `wsId`
  from the body validated against membership, never trusted blindly). Redirect
  platforms return `{auth_url}` with a signed state; Tokopedia
  (`credentials_form`) accepts `{shop_id}` and completes inline.
- `GET /callback/{platform}` — no Firebase auth; validated by an HMAC-signed
  state (`{uid, wsId, platform, nonce, iat}` with `COMMERCE_STATE_SECRET`,
  15-min TTL, single-use nonce via a `create()` tombstone). Exchanges the code,
  encrypts + stores credentials, writes `commerce_accounts` +
  `commerce_shop_directory`, enqueues the initial sync job, audit-logs
  `integration.connect`, then 302 →
  `{COMMERCE_REDIRECT_BASE_URL}/integration?connected={platform}` (or
  `?error=…`).
- `POST /disconnect` — auth + role; connector `revoke()` best-effort, deletes
  the credentials doc, marks the account `disconnected`, tombstones the
  directory entry, audits `integration.disconnect`.
- `POST /sync-now` — auth + role; enqueues a `manual` job, throttled (rejected
  while a pending/processing job exists for the account); audits
  `integration.sync`.
- Every route returns 503 unless `COMMERCE_ENABLED === 'true'`.

### D4 — Webhook receiver: `netlify/functions/commerce-webhook.js`
Public (no Firebase auth), at `/api/v1/commerce/webhooks/{platform}`. Thin
receiver, fat worker:
1. Kill switch `COMMERCE_WEBHOOKS_ENABLED`.
2. Raw body via `Buffer.from(event.body, event.isBase64Encoded ? 'base64' :
   'utf8')` — **never `JSON.parse` before signature verification**. The
   callback URL for Shopee's `url|body` signature is reconstructed from
   `COMMERCE_REDIRECT_BASE_URL` + path, not proxy headers.
3. `registry[platform].verifyWebhook({headers, rawBody, url})` → 401 on
   failure.
4. `parseWebhookEvent` → shop lookup in `commerce_shop_directory`; unknown shop
   → log + 200 (don't leak which shops exist).
5. Write `commerce_webhook_logs` with a deterministic ID (platform event id, or
   body hash) — dedupes redeliveries — then enqueue/coalesce a `webhook` sync
   job (merge `order_ids` into an existing pending webhook job).
6. Return 200 fast; no marketplace fetches in the receiver.

### D5 — Sync engine
- Job docs `workspaces/{ws}/commerce_sync_jobs/{jobId}`: `{account_id,
  platform, type ('initial'|'incremental'|'manual'|'webhook'|'reconcile'),
  status ('pending'|'processing'|'done'|'failed'|'dead'), window_start,
  window_end, cursor, order_ids, attempts, max_attempts (5), next_attempt_at,
  last_error, stats {orders, refunds, settlements, ledger_writes}, created_at,
  started_at, finished_at, created_by}`. Client-readable, never client-writable.
- `commerce-sync-worker.js` — `schedule('*/5 * * * *')`, exits unless
  `COMMERCE_SYNC_ENABLED === 'true'`. Passes: (a) enqueue incrementals for
  accounts stale >10 min using deterministic job IDs
  `inc_{accountId}_{floor(now/10min)}` via `create()` (structurally cannot
  double-enqueue); (b) refresh credentials expiring within 30 min; (c) drain:
  collection-group query for pending jobs due now, transaction-claim
  `pending→processing`, run small jobs inline (limit 5), delegate
  `initial`/`reconcile` by POSTing `{wsId, jobId}` to the background function
  with the existing `INTERNAL_API_TOKEN` header.
- `commerce-sync-background.js` — ~15-min budget; 90-day initial import in
  15-day chunks (Shopee cap), persisting `cursor`/`window_done` after each
  chunk (timeout resumes instead of restarting); updates
  `commerce_accounts.initial_sync.progress_pct`.
- `commerce-reconcile.js` — `schedule('0 19 * * *')` (02:00 WIB): re-fetch the
  last 24–48 h per connected account, diff against stored orders, upsert
  misses, log discrepancies to `commerce_sync_errors`.
- Failure path: `attempts+1`, `next_attempt_at = now + 2^attempts · 60 s ±
  jitter`, back to `pending`; after `max_attempts` → `dead` +
  `commerce_sync_errors` doc + `sync_health:'failing'`. Auth failures (invalid
  refresh token) short-circuit the account to `expired` and do not retry.
- Pipeline per job: connector fetch → `normalize.js` (Universal Commerce
  Transaction Model, integer-IDR coercion, invariant `netRevenue ≈
  grossRevenue − discount − fees − refund + shippingIncome − tax` ± 1) →
  upsert `commerce_orders`/`commerce_refunds`/`commerce_settlements`/
  `commerce_transactions` with deterministic IDs (duplicate detection is
  structural) → `finance-map.js` → ledger per D2 → audit log
  (`source:'integration'`).
- Both crons registered in `SCHEDULED_FUNCTIONS` in
  `scripts/prepare-deploy.js` (pruned from the marketing deploy); the
  background function is request-driven and not listed.

### D6 — Connector module contract
`netlify/functions/lib/commerce/connectors/<platform>.js`:

```js
module.exports = {
  id: 'tiktok_shop',                 // registry key; == commerce_accounts.platform
  displayName: 'TikTok Shop',
  category: 'commerce',
  authType: 'oauth_redirect',        // 'oauth_redirect' | 'signed_redirect' | 'credentials_form'
  requiredEnv: ['TIKTOK_SHOP_APP_KEY', 'TIKTOK_SHOP_APP_SECRET'],
  buildAuthUrl({ state, redirectUri }) {},        // redirect types only
  completeAuth({ query, body, redirectUri }) {},  // -> { tokens, shop, platformMeta }
  refreshTokens({ credentials }) {},              // -> tokens (rotated where platform rotates)
  revoke({ credentials }) {},                     // best-effort
  fetchOrders({ credentials, since, until, cursor }) {},   // -> { items, nextCursor|null }
  fetchRefunds({ credentials, since, until, cursor }) {},
  fetchSettlements({ credentials, since, until, cursor }) {},
  verifyWebhook({ headers, rawBody, url }) {},    // -> { ok, shopId?, eventType? }
  parseWebhookEvent(rawBody) {},                  // -> { shopId, eventType, occurredAt, orderIds }
  normalizeOrder(raw) {}, normalizeRefund(raw) {}, normalizeSettlement(raw) {},
};
```

`lib/commerce/registry.js` exports `{ get(platform), list(),
isConfigured(platform) }` — `isConfigured` = all `requiredEnv` present, which
is how Phase 4 wires real keys without refactoring. Phase 3 ships
`connectors/mock.js` (deterministic fixture connector, registered only when
`COMMERCE_MOCK_ENABLED === 'true'`) to exercise the entire pipeline end-to-end
before any real connector exists.

## 4. Collection & schema inventory

All workspace-scoped (mirrored in the `users/` rules block for non-workspace
mode) unless marked top-level. "Server-only" = clients denied all writes;
Admin SDK bypasses rules.

| Collection | Client read | Client write | Notes |
|---|---|---|---|
| `commerce_accounts/{platform}_{shopId}` | any member | owner/admin: `auto_post` + `updated_at` only | D1; status enum validated; no token-shaped fields exist |
| `commerce_orders/{platform}_{shop}_{order}` | any member | none | normalized order; items embedded (deviation #5) |
| `commerce_transactions/{…}` | any member | none | Universal model + `ledger_status`, `ledger_refs` |
| `commerce_refunds` / `commerce_settlements` / `commerce_payouts` | any member | none | per spec schemas + platform/shop/account ids |
| `commerce_sync_jobs/{jobId}` | any member | none | D5 |
| `commerce_sync_errors/{id}` | any member | none | `account_id, job_id, code, message (≤500), created_at` |
| `commerce_webhook_logs/{id}` | owner/admin only | none | summary only — never full raw payloads |
| top-level `commerce_credentials` | **denied** | **denied** | D1; encrypted tokens |
| top-level `commerce_shop_directory` | **denied** | **denied** | D1; webhook shop→workspace lookup |
| existing `transactions` | (existing) | (existing) | + `commerce_order_id`, `commerce_account_id` in both validators |

`firestore.indexes.json` additions:
- COLLECTION_GROUP: `commerce_sync_jobs (status ASC, next_attempt_at ASC)` —
  worker drain query.
- COLLECTION: `commerce_sync_jobs (account_id ASC, created_at DESC)` — drawer
  history; `commerce_orders (account_id ASC, order_created_at DESC)`;
  `commerce_transactions (account_id ASC, createdAt DESC)`.
- `commerce_credentials.access_expires_at` is a single-field range scan
  (automatic); directory lookups are by doc ID.

**Deploy note:** rules and indexes deploy manually —
`firebase deploy --only firestore:rules` and
`firebase deploy --only firestore:indexes` — and must be live before Phase 2/3
QA. Composite indexes take minutes to build.

## 5. Environment variable register

All flags default **off**; nothing activates on deploy alone.

| Variable | Purpose |
|---|---|
| `TIKTOK_SHOP_APP_KEY` / `TIKTOK_SHOP_APP_SECRET` | TikTok Shop partner app |
| `SHOPEE_PARTNER_ID` / `SHOPEE_PARTNER_KEY` | Shopee Open Platform |
| `TOKOPEDIA_CLIENT_ID` / `TOKOPEDIA_CLIENT_SECRET` / `TOKOPEDIA_FS_ID` | Tokopedia Seller API |
| `COMMERCE_TOKEN_KEY` (+ `COMMERCE_TOKEN_KEY_PREVIOUS`) | base64 32-byte AES-256-GCM key (+ rotation fallback) |
| `COMMERCE_STATE_SECRET` | HMAC key for OAuth state nonces |
| `COMMERCE_ENABLED` | kill switch: `commerce.js` API routes |
| `COMMERCE_SYNC_ENABLED` | kill switch: all crons/workers |
| `COMMERCE_WEBHOOKS_ENABLED` | kill switch: webhook receiver |
| `COMMERCE_MOCK_ENABLED` | registers the mock connector (never in production) |
| `COMMERCE_REDIRECT_BASE_URL` | e.g. `https://dashboard.fluxyos.com`; callback URL construction + Shopee webhook URL signing |

Per the two-site split: commerce env vars are set only on the **app** site
(dashboard.fluxyos.com), mirroring the `NOTIFY_ENABLED`/`DIGEST_ENABLED`
convention. The new crons are pruned from the marketing deploy via
`SCHEDULED_FUNCTIONS`.

## 6. Phase gating

| Phase | Deliverable | Gate |
|---|---|---|
| 0 (this) | Architecture review + doc renames | User sign-off on D1–D6 |
| 1 | Foundation: `lib/commerce/` models/constants/registry, firestore.rules + indexes, db-service accessors, emulator rules test, PROJECT_BACKGROUND §4p | Emulator suites green; §4 grep guard clean |
| 2 | Integration Center UI: rebuilt `integration.html` + `assets/js/integration.js`, i18n keys, Playwright spec | i18n audit near-zero; QA §D/D6/D7/D8; owner + viewer smoke |
| 3 | Connector framework: crypto, token manager, normalize, finance-map, jobs, store, mock connector, `commerce.js`, webhook receiver, sync worker/background/reconcile, netlify.toml + prepare-deploy wiring, pipeline test | Mock end-to-end loop green incl. idempotent re-run; kill-switch behavior verified |
| 4+ (next sessions) | TikTok Shop connector, then Shopee, then Tokopedia (pending live-API smoke test), dashboard widgets, AI exposure | Per master prompt |

Each phase ends with the master-prompt report (Completed / Files Created /
Files Modified / Firestore Changes / API Changes / Remaining Work / Risks /
Recommendations) and stops for approval.

## 7. Risk register

1. **Token/secret leakage to the client.** Structural mitigation: secrets only
   in top-level deny-all `commerce_credentials`, AES-256-GCM at rest, never in
   any response body or log; `commerce_accounts` schema has no token-shaped
   fields; emulator test asserts client denial; pre-ship grep of functions for
   `access_token` in responses/logs.
2. **Duplicate or wrong ledger entries** (first server-side ledger writer).
   Deterministic doc IDs + `create()` fail-if-exists; normalization invariants
   before mapping; journals stay client-posted via the proven
   `accounting_status:'pending'` sweep; reconcile diffs instead of blind
   re-inserts; per-account `auto_post:false` escape hatch; every write
   audit-logged.
3. **Netlify raw-body/signature mismatch breaks webhook HMAC** (especially
   Shopee's `url|body` scheme behind redirects). Verify against exact raw
   bytes with `isBase64Encoded` handling; canonical URL from
   `COMMERCE_REDIRECT_BASE_URL`; the nightly reconcile is the correctness
   backstop — webhook loss degrades latency, not data.
4. **10-second scheduled-function budget vs sync volume; Shopee refresh-token
   races.** Worker claims ≤5 small jobs transactionally and delegates heavy
   jobs to the 15-min background function with resumable cursors; refresh
   serialized behind `refresh_lock_at`; exponential backoff + `dead` state;
   kill switches allow instant shutdown.
5. **Tokopedia legacy API sunset** (TikTok migration). The mock connector
   proves the framework platform-independent; a live credential smoke test is
   required before committing the Tokopedia connector slot.

## 8. Existing components reused (dependency map)

- `netlify/functions/lib/notify-core.js` — `initAdmin()` Admin SDK bootstrap.
- `netlify/functions/digest-broadcast-worker.js` — job-queue claim/drain
  pattern with status transitions.
- `netlify/functions/bank-statement-extract-background.js` — background
  function template for long syncs.
- `functions/lib/email.js` — `create()`-on-deterministic-ID idempotency model.
- `assets/js/db-service.js` — `_scope()` seam, `watchCollection`, audit
  helpers; new thin accessors only.
- `assets/js/onboarding-gate.js` `applyToPage()` + `workspace-service.js` —
  workspace resolution and page gating (pageKey `integrations` already wired).
- `sidebar-loader.js` — `nav-integrations` entry already exists;
  `integration.html` already classified in `APP_PAGES`.
- Client journal sweep `postPendingJournals` — posts double-entry journals for
  server-written commerce transactions (bulk-import precedent).
- `INTERNAL_API_TOKEN` shared-secret pattern — worker → background delegation.
- SECURITY_SYSTEM.md — `integrations.manage` permission, audit source
  `integration`, audited actions connect/disconnect/sync (names reused as-is).

## 9. Regression risks

- `wsValidTxCreate`/`wsValidTxUpdate` (and user-scoped twins) are full-doc
  allowlists shared with every existing transaction write path — the two new
  link fields must be additive only; re-run the team-RBAC and
  accounting-kernel emulator suites after editing.
- `netlify.toml` redirect ordering: the two commerce rules must sit above the
  `/api/v1/*` catch-all without disturbing the bank-statement rule above them.
- `scripts/prepare-deploy.js` `SCHEDULED_FUNCTIONS` edits are covered by
  `node tests/prepare-deploy.check.js`.
- `dashboard-i18n.js` dictionary additions are additive; run
  `node scripts/i18n-audit.js` and the dashboard-i18n Playwright spec.
