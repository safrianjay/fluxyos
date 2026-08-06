---
status: current
owns: [budgets, budget_allocations]
updated: 2026-08-07
source: docs/PROJECT_BACKGROUND.md §4 (sharded 2026-08-07)
---

# Budgets & Allocations

> Workspace-scoping rules for these collections live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

### 4e.3. Budgets — `users/{userId}/budgets/{budgetId}`

Operating budgets that drive (a) `OpEx vs Budget` on Overview and `Budget Used`
on the Performance Trend chart, and (b) the Budget hierarchy. `/budget` is the
Main Budget page for annual envelopes and child period budgets.
`/budget-period` is the Period Budget Detail page where allocations/sub-budgets
are managed. `settings-budget.html` still uses the budget collection for
settings/history compatibility.

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | User-chosen label. |
| `budget_type` | string | Optional Phase B field: `"annual"` or `"period"`. Legacy docs omit it and are normalized at read time. |
| `parent_budget_id` | string \| null | Optional annual envelope document ID for period budgets. |
| `period_type` | string | `"monthly"`, `"quarterly"`, `"custom"`, or `"yearly"` for annual envelope docs. |
| `period_label` | string \| null | Optional display label such as `"June 2026"` or `"Q3 2026"`. |
| `period_start` | Timestamp | Start of the budget period. |
| `period_end` | Timestamp | End of the period (inclusive). |
| `currency` | string | Locked to `"IDR"`. |
| `total_budget` | number | Raw integer Rupiah. |
| `category_budgets` | map | Optional per-category split. The Period Budget Detail allocation flow dual-writes a denormalized `{category → allocated_amount}` summary derived from `budget_allocations`, so the legacy OpEx-vs-Budget tracker stays in sync. |
| `notes` | string \| null | Optional, ≤500 chars. Written by the Budget page's Create Budget modal and Period Budget Detail allocation flow; absent on legacy docs. |
| `created_from_budget_id` | string \| null | Optional source period budget ID when a period is duplicated. |
| `status` | string | `"active"` or `"archived"`. |
| `created_at` / `updated_at` | Timestamp | Server-set. |

**Budget hierarchy rule:** `/budget` selects an explicit annual/main budget and
lists only active period budgets whose `parent_budget_id` points to that main
budget. Its Create Budget wizard is main/annual-only and can create quarterly
period budget children under the new annual budget; allocation categories are
still managed later from `/budget-period`. `/budget-period/{periodBudgetId}`
selects an explicit period budget for allocation work. Legacy
`/budget-period.html?budgetId={mainBudgetId}&periodId={periodBudgetId}` links
remain readable and canonicalize in-browser to the clean route. `getActiveBudget`
remains for compatibility and returns the latest active period budget first,
then falls back to any active budget.

**Audit:** `budget.created`, `budget.updated`, `budget.archived`,
`budget.allocations_updated`.

### 4e.4. Budget Allocations — `users/{userId}/budget_allocations/{allocationId}`

Category-scoped sub-budgets that detail how a selected period `budgets` doc is
split into operational areas (e.g. Marketing, Infrastructure, Operations, SaaS).
Created from the Period Budget Detail page, not from the `/budget` Main Budget
page. `parent_budget_id` must point to the period budget document.
`/budget-allocation/{allocationId}` opens allocation detail by reading the
allocation first, then deriving the period budget from `parent_budget_id`.
Legacy `/budget-allocation.html?budgetId={mainBudgetId}&periodId={periodBudgetId}&allocationId={allocationId}`
links remain readable and canonicalize in-browser to the clean route.

| Field | Type | Notes |
|-------|------|-------|
| `parent_budget_id` | string | Document ID in `budgets/`. |
| `name` | string | Allocation label (1–120 chars). |
| `allocated_amount` | number | Raw integer Rupiah (≤ 999,999,999,999). |
| `scope_type` | string | Locked to `"category"` in Phase 1. |
| `scope_values` | string[] | 1–10 category names. Phase 1 picker exposes `Marketing`, `Infrastructure`, `Operations`, `SaaS`. |
| `alert_threshold_percent` | number \| null | Optional, 0–100. Defaults to 80. |
| `hard_limit_enabled` | bool | Defaults to false. Phase 1 does not enforce hard limits. |
| `created_from_allocation_id` | string \| null | Optional source allocation ID when duplicating a period budget. |
| `status` | string | `"active"` or `"archived"`. Re-saving the budget archives the previous set in place and writes a fresh set. |
| `created_at` / `updated_at` | Timestamp | Server-set. |

**Mutation rule:** owner read/create/update only; delete is blocked.

**Atomic write:** `DataService.addBudgetWithAllocations(uid, budgetData, allocations)`
commits the explicit budget doc in `budgetData.budget_id` when editing, or a
new budget doc when creating. Passing an empty allocation array is valid for
annual/main budgets and newly created period budgets before allocations are
added. It only archives allocations that belong to that same period budget, so
editing July does not change June. The budget doc, allocation archive, and new
allocation set commit in a **single Firestore
`writeBatch`**. If any row is rejected (rules, validation, network), nothing
is written — the existing budget doc stays intact. Audit logs are written
post-commit and are best-effort (failures are non-fatal). `setActiveBudget`
remains the simpler path used by `settings-budget.html` and does not write
allocations.

**Usage calculation:** `DataService.getBudgetUsage(uid, budgetId)` returns
allocations with `actual_used` (transactions where `type ∈ {expense, fee,
tax}` and category matches), `committed_amount` (pending-payable transactions
+ unpaid bills with `payment_status !== 'paid'` and
`budget_impact_status !== 'converted_to_actual'`), `remaining_amount`,
`usage_percent`, and `status` (`healthy < 70 < watch < 85 < at_risk < 100 ≤
exceeded`). `usage_percent` is always finite (never `NaN`/`Infinity`).
Bill inclusion uses `due_date`, then `date`, then `timestamp`, then
`created_at`, so committed spend follows the selected budget period.

**Duplicate period:** `DataService.duplicateBudgetPeriod(uid, sourceBudgetId,
targetBudgetData)` creates a new period budget and new allocation docs only.
It copies allocation structure, not transactions, bills, actual usage,
committed usage, or activity.

**Audit:** `budget.allocations_updated` is logged on each batch write; the
log's `target_collection` is `"budget_allocations"`.
