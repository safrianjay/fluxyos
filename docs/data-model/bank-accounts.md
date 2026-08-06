---
status: current
owns: [bank_accounts, bank_balance_snapshots]
updated: 2026-08-07
source: docs/PROJECT_BACKGROUND.md §4 (sharded 2026-08-07)
---

# Bank Accounts & Balance Snapshots

> Workspace-scoping rules for these collections live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

### 4e.1. Bank Accounts — `users/{userId}/bank_accounts/{bankAccountId}`

Manual (and future synced) bank accounts that power Bank Cash Balance and
Cash Pressure. User-scoped. Soft-archive only — `delete` is blocked.

| Field | Type | Notes |
|-------|------|-------|
| `account_name` | string | User-chosen nickname (≤120 chars). |
| `bank_name` | string | Free text (e.g., `"BCA"`). |
| `bank_code` | string \| null | Optional bank identifier. |
| `currency` | string | Locked to `"IDR"`. |
| `last_four` | string \| null | Last four digits of account number. |
| `source_type` | string | `"manual"`, `"statement_upload"`, or `"auto_sync"` (Phase 1 only writes `"manual"`). |
| `provider` | string \| null | Reserved for future auto-sync. |
| `provider_account_id` | string \| null | Reserved for future auto-sync. |
| `status` | string | `"active"` or `"archived"`. |
| `latest_balance` | number | Raw integer Rupiah. |
| `latest_balance_at` | Timestamp | When the balance was reported by the user. |
| `sync_status` | string | `"manual"`, `"pending"`, `"connected"`, or `"failed"`. |
| `last_sync_at` | Timestamp \| null | Reserved for auto-sync. |
| `confidence` | string \| null | `"user_entered"`, `"extracted"`, or `"synced"`. |
| `notes` | string \| null | ≤500 chars. |
| `created_at` | Timestamp | `serverTimestamp()`. |
| `updated_at` | Timestamp | `serverTimestamp()` on every write. |

**Audit:** `bank_account.created`, `bank_account.balance_updated`,
`bank_account.archived`. All target_collection: `"bank_accounts"`.

### 4e.2. Bank Balance Snapshots — `users/{userId}/bank_balance_snapshots/{snapshotId}`

Append-only balance history. One snapshot per balance write
(`addManualBankAccount` and `updateBankAccountBalance` both emit one).

| Field | Type | Notes |
|-------|------|-------|
| `bank_account_id` | string | Document ID in `bank_accounts/`. |
| `balance` | number | Raw integer Rupiah at the time of snapshot. |
| `currency` | string | Locked to `"IDR"`. |
| `source_type` | string | Matches the originating account's source type. |
| `snapshot_at` | Timestamp | User-supplied "as of" timestamp. |
| `confidence` | string \| null | Same enum as bank_accounts. |
| `notes` | string \| null | ≤500 chars. |
| `created_at` | Timestamp | `serverTimestamp()`. |

**Mutation rule:** create + read only — update and delete are blocked.

The Overview Bank Cash Balance KPI reads these user-scoped snapshots to render
an aggregate active-account sparkline using the same green area-line treatment
as Revenue. A single real snapshot renders as a flat baseline, not a fabricated
trend. Every real snapshot remains a chart point in timestamp order, including
multiple balance updates on the same day. Its card order is balance, update
source and timestamp, 30-day outlook and coverage, then the snapshot trend
graphic.
