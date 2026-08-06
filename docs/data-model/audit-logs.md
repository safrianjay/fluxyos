---
status: current
owns: [audit_logs]
updated: 2026-08-07
source: docs/PROJECT_BACKGROUND.md §4 (sharded 2026-08-07)
---

# Audit Logs

> Workspace-scoping rules for these collections live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

### 4d. Audit Logs — `users/{userId}/audit_logs`

Append-only records for sensitive dashboard actions. Add audit logs before
shipping edit/delete, approvals, exports, integrations, or AI write actions.

| Field | Type | Notes |
|-------|------|-------|
| `actor_uid` | string | Firebase Auth UID of the user who performed the action |
| `actor_role` | string \| null | Future role at time of action; currently nullable |
| `action` | string | Example: `"transaction.create"` or `"bill.approve"` |
| `target_collection` | string | Collection affected, e.g. `"transactions"` |
| `target_id` | string | Document ID affected; empty string allowed before target exists |
| `before` | map \| null | Sensitive snapshot before change |
| `after` | map \| null | Sensitive snapshot after change |
| `reason` | string \| null | Required by future UI for delete/reject/override flows |
| `source` | string | `"dashboard"` \| `"ai"` \| `"integration"` \| `"system"` |
| `created_at` | Firestore Timestamp | `serverTimestamp()` — always server-side |

**Ordering:** `created_at DESC`. Default limit: 100.
**Mutation rule:** create/read only for the owning user; never update/delete.
