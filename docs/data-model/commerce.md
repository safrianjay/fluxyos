---
status: current
owns: [commerce_orders, commerce_accounts, commerce_settlements]
updated: 2026-08-07
source: docs/PROJECT_BACKGROUND.md §4 (sharded 2026-08-07)
---

# Commerce Integration

> Workspace-scoping rules for these collections live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

### 4p. Commerce Integration Platform — marketplace sync (Phases 1–3 SHIPPED, workspace-scoped)

Binding design doc: **`docs/COMMERCE_INTEGRATION_PHASE0_REVIEW.md`** (decisions
D1–D6 override the older `COMMERCE_INTEGRATION_PLATFORM.md`/`_ARCHITECTURE.md`
specs where they conflict). Marketplace connections (TikTok Shop, Shopee,
Tokopedia; Phase 4+) sync orders/revenue/refunds/fees/settlements into the
ledger via a server-side pipeline: Connector → Normalization → Finance Mapping
→ Ledger. Backend is Netlify Functions (Admin SDK), NOT the legacy FastAPI.

**Collections** (all workspace-scoped like §4o; rules in the `workspaces/`
block only; server-written via Admin SDK unless noted):

| Collection | Client access | Notes |
|---|---|---|
| `commerce_accounts/{platform}_{shopId}` | member read; owner/admin update **`auto_post` + `updated_at` ONLY** | Connection status card data. **No token material — ever.** |
| `commerce_orders/{platform}_{shop}_{order}` | member read | Normalized order; items embedded as an array (no `commerce_order_items`). |
| `commerce_transactions` | member read | Universal Commerce Transaction Model (camelCase money fields per spec: `grossRevenue`, `netRevenue`, …, raw int IDR) + `ledger_status`, `ledger_refs`. |
| `commerce_refunds` / `commerce_settlements` / `commerce_payouts` | member read | Per-spec schemas + `platform`/`shop_id`/`account_id`. |
| `commerce_sync_jobs` | member read | Queue: `type initial\|incremental\|manual\|webhook\|reconcile`, `status pending\|processing\|done\|failed\|dead`, backoff fields. |
| `commerce_sync_errors` | member read | `account_id, job_id, code, message (≤500), created_at`. |
| `commerce_webhook_logs` | **owner/admin read only** | Delivery summaries — never raw payloads. |
| **top-level** `commerce_credentials/{ws}__{platform}_{shopId}` | **deny-all** | AES-256-GCM-encrypted OAuth tokens. Admin SDK only. Never move under `workspaces/`. |
| **top-level** `commerce_shop_directory/{platform}_{shopId}` | **deny-all** | Webhook shop→workspace lookup. Admin SDK only. |

**Ledger link fields** (additive, on `transactions`, allowed by
`isValidCommerceLink` in all four tx validators): `commerce_order_id`,
`commerce_account_id`. Server-written commerce ledger entries use deterministic
ids (`cm_{platform}_{shop}_{order}_rev|_fee|_rf`, `…_stl_{settlementId}`),
`source: 'commerce'`, `created_via: 'integration'`, and
`accounting_status: 'pending'` so the existing client `postPendingJournals`
sweep posts the double-entry journals (bulk-import precedent).

**Shared backend modules:** `netlify/functions/lib/commerce/` —
`constants.js`, `models.js` (Universal model validators), `registry.js`
(connector registry, `isConfigured()` env gating), `crypto.js` (AES-256-GCM +
OAuth state HMAC), `token-manager.js` (refresh serialized behind a Firestore
transaction lock — Shopee-safe), `normalize.js`, `finance-map.js` (pure
commerce→ledger mapping), `jobs.js` (queue + backoff), `store.js` (Admin-SDK
writes, `create()` idempotency), `pipeline.js` (syncWindow engine),
`connectors/mock.js` (fixture connector behind `COMMERCE_MOCK_ENABLED`).
**Functions:** `commerce.js` (`/api/v1/commerce/*`: connect / callback /
disconnect / sync-now), `commerce-webhook.js` (public,
`/api/v1/commerce/webhooks/{platform}`), `commerce-sync-worker.js` (cron */5:
schedule + refresh + drain), `commerce-sync-background.js` (15-min budget,
chunked initial import with resumable cursor), `commerce-reconcile.js`
(nightly 02:00 WIB). Both crons are in `SCHEDULED_FUNCTIONS`
(prepare-deploy.js). Adding a marketplace = one connector file in
`connectors/` + a registry loader line + its env vars — nothing else changes.
DataService accessors (all through `_scope()`): `watchCommerceAccounts`,
`getCommerceSyncJobs`, `getCommerceSyncErrors`, `setCommerceAutoPost`.
Pipeline test: `node tests/commerce-pipeline.check.js` (pure) /
`firebase emulators:exec --only firestore "node tests/commerce-pipeline.check.js"`
(full e2e with the mock connector).

**Kill switches** (env, default off, app site only): `COMMERCE_ENABLED`,
`COMMERCE_SYNC_ENABLED`, `COMMERCE_WEBHOOKS_ENABLED`, `COMMERCE_MOCK_ENABLED`.
Emulator rules test: `tests/commerce-rules-emulator-test.mjs`. Composite
indexes in `firestore.indexes.json` (deploy with
`firebase deploy --only firestore:indexes`).

---
