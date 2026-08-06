---
status: current
owns: [subscriptions]
updated: 2026-08-07
source: docs/PROJECT_BACKGROUND.md §4 (sharded 2026-08-07)
---

# Subscriptions

> Workspace-scoping rules for these collections live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

### 4c. Subscriptions — `users/{userId}/subscriptions`

Same fields as transactions plus:

| Field | Type | Notes |
|-------|------|-------|
| `renewal_date` | Firestore Timestamp | Optional. Falls back to `"Next month"` if missing |
| `category` | string | Defaults to `"SaaS"` when created via modal |

**Ordering:** `timestamp DESC`.
