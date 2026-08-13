---
status: partial — line field shipped, rollup + UI not built
owns: [dimension_id on journal lines, dimensions collection, ledger_balances_by_dim]
updated: 2026-08-14
---

# Dimension Seam — outlets, branches, warehouses

> **What shipped 2026-08-14:** `dimension_id` on every journal line, the
> `stampDimension` helper, and document- and manual-line-level pass-through in
> `assets/js/accounting-engine.js`. Nothing sets a dimension yet, so every line
> carries `null` and all behaviour is unchanged.
>
> **What has not:** the `dimensions` collection, the `ledger_balances_by_dim`
> rollup, its integrity assertion, and any UI. Sections 3–6 are the design for
> those, not a description of them.

## 1. The problem

FluxyOS has no dimension. It looks like it does: `entity_id` is stamped on every
journal, account and balance. But `_resolvedScopeId()` ([db-service.js:3865](../assets/js/db-service.js#L3865))
returns the workspace id and nothing else, so `entity_id` is a constant with a
suggestive name. There is exactly one entity per workspace, by construction.

`PRODUCT_STRATEGY.md` §7 sequences multi-entity first on the grounds that "the
plumbing already exists". The plumbing is a field name. §3 of that document has
been corrected accordingly.

Two live needs converge on the same missing primitive:

- **Per-outlet P&L.** A multi-outlet operator cannot see which outlet earns and
  which loses without asking their team for a manual report.
- **Stock by location.** Inventory is meaningless without somewhere to hold it.
  A workspace with a shop and a warehouse holds different quantities of the same
  item in each, at the same unit cost.

These are the same question — *where* did this posting happen — asked of the P&L
and of the balance sheet. Solving them separately produces two dimensions that
disagree.

## 2. Why the field had to land before inventory

**Posted journals are immutable by rule** ([firestore.rules:3947](../firestore.rules#L3947)
allows only `reversed_by_journal_id` to change). A dimension added after stock
movements and per-outlet postings exist cannot be backfilled onto the journals
that need it — the only remedy would be reversing and reposting real accounting
history, in periods that may already be closed.

The field costs one null per line today. Retrofitting it costs a migration
against immutable data. That asymmetry is the entire argument for cutting the
seam first, and it is why this half shipped ahead of everything else here.

## 3. Placement: the line, not the journal

`dimension_id` lives on the journal **line**.

A journal-level field is smaller and wrong. A bill covering two outlets has to
split across them, and a journal-level dimension forces one journal per outlet —
breaking the one-document-one-journal relationship that the source drill-down
(Trial Balance → General Ledger → Journal Detail → source) depends on, and that
`source: {collection, id}` encodes.

Line placement also means the debit and the credit of a single entry can sit in
different outlets, which is exactly what an inter-outlet stock transfer is.

### The stamping rule

```
document.dimension_id  →  stampDimension(lines, dim)  →  every line without one
```

`stampDimension` ([accounting-engine.js](../assets/js/accounting-engine.js)) is
applied in `buildJournal` after the rule builder returns, not threaded through
`line()`'s positional arguments — that would mean editing all fourteen rule
builders for a value none of them reason about. A line that already carries a
dimension keeps it, so a future line-level picker overrides the document default
without this function changing.

`buildManualJournal` reads it **per line** instead: manual journals are the one
path where a human legitimately splits a single entry across outlets.

**Reversals carry it for free.** `reverseLines` spreads (`{...l}`), so a reversal
inherits each line's dimension. This is load-bearing rather than incidental: a
reversal that dropped the dimension would leave the by-dim rollup permanently
unbalanced against the workspace total, while the workspace total itself netted
to zero correctly — a discrepancy that appears only in the breakdown.

## 4. `dimensions/{dimensionId}` — the master (not built)

Workspace-scoped. Modelled on `vendors`, which is the repo's proven master-data
shape: deterministic `name_key` for dedupe, soft archive, `delete: if false`.

| Field | Type | Notes |
|---|---|---|
| `name` | string ≤80 | Display name ("Outlet Kemang", "Gudang Pusat") |
| `name_key` | string | Deterministic slug; dedupe key |
| `type` | enum | `outlet` \| `branch` \| `warehouse` — one collection, because an F&B outlet is *both* a P&L unit and a stock location, and splitting them would force every such site to exist twice |
| `is_active` | bool | Soft archive; history keeps resolving |
| `created_at` / `updated_at` | Timestamp | |

**One collection for both roles** is the important call. The alternative —
separate `entities` and `locations` — means a café that reports its own P&L *and*
holds its own stock appears in both, and the two can drift apart. Reporting reads
the ones with P&L relevance; inventory reads the ones that hold stock; a single
`type` field distinguishes them without duplicating the site.

Rules: read = all member roles; create/update = owner/admin/finance/accountant;
`delete: if false`. Keep the validator in the `business_categories` class —
inline field checks, no helper calls — per the evaluation-budget rule in §6.

## 5. `ledger_balances_by_dim` — the rollup (not built)

Doc id `{period_key}__{account_code}__{dimension_id}`.

**`ledger_balances` keeps its existing doc id and stays the tie-out source of
truth.** Trial balance, the three statements, period close and the integrity
sweep read it and are untouched by any of this. The by-dim collection is a
*breakdown*, added alongside.

Written by the same `FieldValue.increment` in the same `writeBatch`, through the
existing `balanceAcc` accumulator ([db-service.js:4092](../assets/js/db-service.js#L4092))
— which exists precisely because one batch may touch the same balance document
twice (corrections reverse-and-repost; PPN gross-ups reuse the cash leg). Any
by-dim write must go through it for the same reason, or Firestore rejects the
batch.

### The invariant

> For any `(period_key, account_code)`, the by-dim rows must sum to the
> workspace-level `ledger_balances` row — separately for `debit_total` and
> `credit_total`.

Lines with `dimension_id: null` roll into a reserved `__unassigned__` key rather
than being dropped, so the invariant holds during and after rollout instead of
only once every posting is dimensioned.

This belongs as a sixth reconciliation in
[`netlify/functions/lib/ledger-assert.js`](../netlify/functions/lib/ledger-assert.js),
alongside the five it already runs, and repair belongs in
`scripts/reconcile-ledger-balances.js`, which already recomputes balances from
journal lines. Both are deliberately deferred: with every line currently `null`,
the check would pass vacuously and the repair would have nothing to rebuild.

**The rollup is safe to defer; the line field was not.** Journals are the source
of truth and `ledger_balances` is derived — `reconcile-ledger-balances.js` proves
the derivation can be rerun at will. Any by-dim rollup can therefore be built
from journal lines whenever it is needed. That is the whole reason this document
splits where it does.

## 6. Constraints any implementation must respect

1. **Workspace scoping.** `dimensions` and `ledger_balances_by_dim` are finance
   collections: route through `_scope()`, add both names to
   `PROJECT_BACKGROUND.md` §4 rule 2 **and** `FINANCE_COLLECTIONS` in
   `scripts/qa-run.js`. See §4 rule 7 there for why both.
2. **Rules evaluation budget.** Three production incidents are recorded in
   `firestore.rules` (3367, 3526, 3546) from validators exceeding the
   1000-expression ceiling — and emulator fixtures are lean enough to pass, so it
   only bites in production. Keep these validators inline and short.
3. **Audit-log enum.** Add any new collection to `isValidWorkspaceAuditLog`'s
   `target_collection` list ([firestore.rules:3214](../firestore.rules#L3214)) or
   the first audit write fails with a confusing permission error.
4. **`ledger_balances` doc ids do not change.** Rekeying them is a migration of
   the trial-balance source; the parallel collection exists to avoid exactly that.
5. **Rules and indexes deploy separately** — `firebase deploy --only
   firestore:rules` / `firestore:indexes` are not part of `git push`.

## 7. Entry point

The sidebar already carries a disabled `entity-menu-add` "Soon" stub
([sidebar-loader.js:163](../assets/js/sidebar-loader.js#L163)). That is where
dimension management belongs — it is the affordance users have already been
shown.
