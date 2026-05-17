# Feature: Revenue Sync (Dashboard App Page)

> Defined using the [Product & UX Feature Intake Framework](../product_ux_feature_intake_framework.md).
> Status: ✅ Shipped at `/revenue-sync`.
> Read this alongside [PROJECT_BACKGROUND.md](../PROJECT_BACKGROUND.md) before changing the page.

---

## 1. Feature Type

**Page-level feature.** Owns its route, navigation entry, data model (read-only view over `transactions`), and user workflow (review + reconcile + manual revenue entry).

---

## 2. Context

Revenue lives today inside the unified ledger at `/ledger`. Finance teams running multi-channel businesses (Stripe + Shopify + Tokopedia + POS) cannot tell at a glance:

- Which sales channels delivered revenue this period.
- Whether anything is duplicated, refunded, or missing a receipt.
- How healthy reconciliation is across the period.

The marketing page at [`/revenuesync`](../../revenuesync.html) already promises "every transaction lands in your unified ledger in under 30 seconds." The dashboard sidebar reserves a `Revenue Sync` slot under **Money Movement**, but until now it has been disabled with a `Soon` badge ([sidebar-loader.js](../../assets/js/sidebar-loader.js)). This feature delivers the operational surface that proves the marketing claim.

---

## 3. Main Objective

Give finance teams one page where they can see every revenue transaction by channel, spot what needs review, and trust the revenue number on their dashboard — without manually cross-checking Stripe, Shopify, Tokopedia, or a spreadsheet.

---

## 4. Job To Be Done

When I close out the week across multiple sales channels,
I want to see every revenue transaction is captured, deduplicated, and reconciled,
so I can trust the revenue number on my dashboard without manually cross-checking Stripe, Shopify, and Tokopedia.

---

## 5. Target User

- **Primary**: Finance admin or business owner running multi-channel revenue (e-commerce brands, marketing agencies on retainer, retail franchises, dropshippers).
- **Secondary**: Accountants and operations managers reviewing the books for a closing period.

Matches the audiences already represented by the use-case landing pages under [`use-cases/`](../../use-cases/).

---

## 6. User Problem

Today, revenue rows are interleaved with expenses, transfers, and fees inside the ledger. The user cannot:

- Filter "just revenue" without manual column scanning.
- See which `vendor_name` (channel) produced this period's volume.
- Tell whether two near-identical rows are duplicates from a connector replay.
- Know which revenue rows are missing receipts before a tax filing.

Result: they re-check Stripe / Shopify / Tokopedia dashboards manually, defeating the FluxyOS value prop.

---

## 7. Business Value

- **Activates the live-revenue promise** from the marketing landing page — the disabled `Soon` entry becomes a working surface.
- **Raises trust in dashboard KPIs**: the `kpi-revenue` value on `/dashboard` becomes auditable in one click.
- **Operational hook for premium connectors**: once OAuth connectors land (roadmap item 10), this page is where they appear.
- **Reduces support burden**: users self-serve revenue-quality questions instead of asking "why is my revenue number wrong?".

---

## 8. Product Logic — Where it belongs

**Money Movement** group in the sidebar, between Transactions and Bills. The slot is already reserved at [sidebar-loader.js:93](../../assets/js/sidebar-loader.js#L93).

**Distinct from `/ledger`**: Ledger is the unified view of *all* money movement (income + expense + transfers). Revenue Sync is the **income-side lens** with channel grouping and reconciliation health — a different question, a different page.

**Distinct from `/integration`**: Integrations is the *connection setup* surface (add/remove sources). Revenue Sync is the *operational read view* of what those connections produced.

**Distinct from `/dashboard`**: Dashboard is "how is the business doing" (KPIs, action items). Revenue Sync is "is every sale captured correctly" (transaction-level trust).

---

## 9. Scope

### In Scope (MVP)

- Revenue KPI strip (5 cards): total revenue, channels connected, synced today, needs review, reconciliation health.
- Connected channels strip — derived from distinct `vendor_name` values for now.
- Two compact activity charts: volume over time and channel breakdown.
- Revenue-only transaction table filtered to `type ∈ {income, refund, pending_receivable, legacy "revenue"}`.
- Needs Review queue (duplicate suspects + missing receipts + refunds).
- Shared `FluxyDateRangePicker` for period filtering.
- CSV export scoped to the selected period.
- Manual revenue entry via existing `window.showAddTransactionModal` (no new modal).
- Sidebar entry enabled and routed to `/revenue-sync`.

### Out of Scope

- Building new OAuth connectors (Stripe, Shopify, Tokopedia). Belongs to `/integration` and is roadmap item 10.
- New Firestore collections (no `connections`, no `sync_jobs`).
- New backend API endpoints.
- Refund / dispute workflows.
- Editing or deleting individual transactions (still not implemented anywhere; see [PROJECT_BACKGROUND.md §12](../PROJECT_BACKGROUND.md#L378)).
- Indonesian translation (`/id/revenue-sync.html`) — dashboard localization is not yet in the [LOCALIZATION_PLAN](../LOCALIZATION_PLAN.md) tranche.

---

## 10. Functional Requirements

- Subscribe to `users/{uid}/transactions` filtered by revenue-side `type` values, ordered `timestamp DESC`.
- KPI strip, charts, table, CSV export must all respect the same selected period (single source of truth, matching the ledger pattern in [PROJECT_BACKGROUND.md §5](../PROJECT_BACKGROUND.md#L196)).
- Group rows by `vendor_name` to derive channel cards and the breakdown chart.
- Duplicate detection (MVP heuristic): same `vendor_name` + same `amount` + same calendar day → mark as suspect in Needs Review.
- "Add Revenue" CTA opens the existing transaction drawer with `defaultType: 'income'`, `defaultCategory: 'Revenue'`, `context: 'transaction'`.
- "Connect Channel" CTA navigates to `/integration`.
- CSV columns: Date, Channel (vendor_name), Description, Category, Amount, Status.

---

## 11. UX Requirements

- Mirror the IA of [bill.html](../../bill.html) so the page feels like a sibling of Bills and Subscriptions.
- Sidebar (220px), sticky topbar, page title with date-range picker + CSV + primary CTA on the right.
- 5-card KPI strip stacks 2-col on mobile, 3-col on tablet, 5-col on desktop.
- Charts and table support the table; do not let charts dominate the page.
- Every state (default, loading, empty, error, partial) renders without layout shift.
- No new colors, fonts, or component primitives — use the FluxyOS design system tokens already in `shared-dashboard.css`.

---

## 12. Data Requirements

Reuses existing fields only (see [PROJECT_BACKGROUND.md §4a](../PROJECT_BACKGROUND.md#L65)):

- `transaction.amount` (raw integer)
- `transaction.vendor_name` (channel inference for MVP)
- `transaction.category` (`Revenue` is the canonical revenue category)
- `transaction.type` (filter set: `income`, `refund`, `pending_receivable`, plus legacy `revenue`)
- `transaction.status` (`Completed` | `Missing Receipt`)
- `transaction.timestamp` (period filter, sort, daily bucketing)

**No schema changes.** A future `channel` field is noted as a forward path when real connectors land, but the MVP does not require it.

**Fallback behavior:**
- Missing `vendor_name` → "Unknown channel".
- Missing `status` → treated as `Completed`.
- Zero revenue rows in the period → empty state, not an error.

---

## 13. States

- **Default** — KPIs filled, channels strip populated, charts rendered, table paginated.
- **Loading** — shimmer rows in the table, "—" placeholders in KPI cards.
- **Empty** (no revenue rows in the period) — empty state with two CTAs: "Add Manual Revenue" and "Connect a Channel".
- **Partial** — channel name unknown for some rows; bucketed under "Unknown channel".
- **Error** (Firestore read fails) — toast via `window.showToast(msg, 'error')`; KPI cards stay at "—".
- **Unauthenticated** — redirect to `/login` (matches the pattern in [bill.html](../../bill.html)).

---

## 14. Success Metrics

- Users discover and act on missing-receipt / duplicate revenue rows faster than they could in `/ledger`.
- Distinct channel count climbs as integrations land.
- Time-on-task for "is my revenue right this week?" drops.
- Manual revenue entries from this page increase (proxy for engagement).

---

## 15. Risks and Tradeoffs

- **Looks like another Overview** if KPIs and charts dominate. Mitigation: charts are compact and the transaction table is the page's center of gravity.
- **Channel inference from `vendor_name` is imperfect** until connectors land. Mitigation: explicit "Unknown channel" bucket; copy on the channels strip frames this as MVP behavior.
- **Duplicate heuristic can false-positive** on legitimate same-day repeat sales. Mitigation: flag only, never auto-delete; show the suspect rows in Needs Review where the user decides.
- **Could duplicate `/ledger`** if users see this as a "filtered ledger." Mitigation: keep the channel + reconciliation framing front and center; do not replicate ledger-style search.

---

## 16. Acceptance Criteria

- `/revenue-sync` loads in under 2s on broadband; sidebar highlights the Revenue Sync entry.
- Sidebar entry no longer shows the `Soon` badge.
- KPI strip, channels strip, charts, table, and CSV export all reflect the period chosen in the date range picker.
- Adding a transaction with `type: income`, `category: Revenue` makes it appear here within one refresh.
- Empty-state CTAs work: "Add Manual Revenue" opens the modal pre-filled; "Connect a Channel" navigates to `/integration`.
- CSV export filename includes the selected period range.
- Mobile (375px): KPI strip stacks, table scrolls horizontally, sidebar collapses.
- No new console errors, no CSP violations, no Firestore permission warnings.
- Existing pages (`/dashboard`, `/ledger`, `/bill`, `/subscription`, `/integration`) are unchanged in behavior.

---

## 17. Implementation Guardrails

- **Do not** change the Firestore schema or add new collections.
- **Do not** change backend `/api/v1/*` endpoints.
- **Do not** edit `/ledger`, `/bill`, `/subscription`, or `/integration` behavior.
- **Do not** create page-local date pickers — reuse `FluxyDateRangePicker`.
- **Do not** rebuild the entry modal — reuse `window.showAddTransactionModal`.
- **Do not** edit the marketing page [`revenuesync.html`](../../revenuesync.html) in this feature; landing-page work is a separate scope.
- **Do not** add Indonesian translation in this scope; dashboard localization is a future tranche.
- **Do** write any sensitive actions through the audit-log path described in [SECURITY_SYSTEM.md](../SECURITY_SYSTEM.md) — the existing modal already does this for `context: 'transaction'`.
