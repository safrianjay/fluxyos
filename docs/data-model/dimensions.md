---
status: current
owns: [dimensions, ledger_balances_by_dim]
updated: 2026-08-16
source: docs/DIMENSION_SEAM_DESIGN.md
---

# Dimensions & the per-dimension balance rollup

> Workspace-scoping rules for these collections live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

A **dimension** is the *where* of a posting — an outlet, branch, or warehouse —
as opposed to the *what* the account already answers. Design rationale and the
reason the line-level field shipped ahead of everything else:
[`DIMENSION_SEAM_DESIGN.md`](../DIMENSION_SEAM_DESIGN.md).

**Status:** live end to end. The collections, the rollup, the document-level
pickers and `/outlet-pnl` all ship. Outlets are created from the receive-stock
drawer; goods receipts, stock adjustments and transactions carry a dimension (see
the table below), and the per-outlet income statement reads the rollup.

Still open: **invoices** carry no dimension, so invoiced revenue sits in
"Unassigned"; and there is no dedicated outlet-management screen — renaming or
archiving an outlet is DAL-only.


## Which documents carry a dimension

`buildJournal` stamps the **source document's** `dimension_id` onto every line it
produces (`accounting-engine.js` → `stampDimension`), so a document only has to
carry the field — the posting path needs no change per collection.

| Carries `dimension_id` | Set where |
|---|---|
| `goods_receipts` | Receive-stock drawer (`inventory.html`) |
| `stock_adjustments` | Count sheet and waste drawer (`inventory-count.html`) |
| `transactions` | **Outlet** field on the entry drawer |
| `bills` | Same field — the drawer is shared across all three contexts |
| `subscriptions` | Same field |

**Invoices do not yet.** Their revenue therefore lands in "Unassigned" on
`/outlet-pnl`, which the page states in words rather than leaving the reader to
infer it from a suspiciously healthy margin.

The two directions are not symmetrical, and the page says which is which:
stranded **revenue** makes an outlet look worse than it is; stranded **cost**
makes it look better. The second is the dangerous one — it is what keeps a losing
outlet open — and bills carry the biggest outlet costs (rent, utilities, staff),
which is why they were the first gap closed after transactions.

`firestore.rules` has to allow the field explicitly. `wsValidTxCreate/Update`,
`wsValidBillCreate/Update` and `wsValidSubCreate/Update` all use `hasOnly`, so an
unlisted key is **rejected outright** — `permission-denied` for the whole write,
not a silently dropped field. All six list `dimension_id`. Adding invoices means
editing theirs the same way, and re-checking the rules size (92% of the usable
ceiling as of 2026-08-16).

## 1. `dimensions/{dimensionId}`

| Field | Type | Notes |
|---|---|---|
| `name` | string 1–80 | Display name ("Outlet Kemang", "Gudang Pusat") |
| `name_key` | string ≤60 | Deterministic slug (`normalizeVendorKey`), the dedupe key. **Immutable after create** — journal history posted against this id must keep resolving to the same site |
| `type` | enum | `outlet` \| `branch` \| `warehouse` |
| `status` | enum | `active` \| `archived`. Soft archive only |
| `created_at` / `updated_at` | Timestamp | Server-set |

**One collection for both roles.** An F&B outlet is simultaneously a P&L unit and
a stock location. Separate `entities` and `locations` collections would make every
such site exist twice and drift apart; `type` distinguishes them instead.

**Rules:** read = all member roles; create/update = owner/admin/finance/accountant;
`delete: if false`. Deleting one would orphan journal lines that are immutable by
rule. Validator is five inline checks with no helper calls — the
`business_categories` class, per the evaluation-budget rule.

**DAL** (`db-service.js`): `getDimensions`, `saveDimension` (`{create}` /
`{dimensionId}`), `archiveDimension` (`{restore}`). Modelled on `vendors`, the
proven master-data shape here. All mutations audit-logged
(`dimension.created|updated|archived|reactivated`).

## 2. `ledger_balances_by_dim/{period_key}__{account_code}__{dimension_id}`

| Field | Type | Notes |
|---|---|---|
| `period_key` | string | `YYYY-MM` |
| `account_code` | string | |
| `account_type` | string | |
| `dimension_id` | string | A `dimensions` doc id, or the reserved `__unassigned__` |
| `entity_id` | string | = workspaceId |
| `currency` | string | `IDR` |
| `debit_total` / `credit_total` | number | Written via `FieldValue.increment` |
| `updated_at` | Timestamp | |

### The invariant

> For any `(period_key, account_code)`, the by-dim rows **sum exactly** to the
> workspace-level `ledger_balances` row — `debit_total` and `credit_total`
> separately.

**`ledger_balances` keeps its existing doc id and remains the tie-out source of
truth.** Trial balance, the three statements, period close and the existing
integrity sweep read it and were not touched. This collection is a *breakdown*
added alongside — never a second source of truth.

Lines with no dimension roll into `__unassigned__` rather than being dropped, so
the invariant holds during rollout instead of only after it.

### Three things the implementation encodes

1. **Both collections are written from one accumulator, in one batch.**
   `_flushBalanceAcc` (`db-service.js`) keys the accumulator by dimension, writes
   one by-dim row per entry, then **re-aggregates** to produce the workspace row.
   That re-aggregation is not tidiness: Firestore rejects a batch that writes one
   document twice, and two dimensions posting to the same account in one batch
   would do exactly that.
2. **`_attachJournalToBatch` now always accumulates**, using a local accumulator
   and flushing immediately when the caller passes none. The direct-write path
   this replaced would write the same balance document twice whenever two lines
   shared an account — a latent same-doc-twice bug on the `closePeriod` and
   `reverseJournal` paths, which happened to be safe only because their journals
   use distinct accounts.
3. **Reversals carry the dimension.** `reverseLines` spreads each line, so a
   reversal inherits `dimension_id`. Load-bearing: a reversal that dropped it
   would leave the breakdown permanently unbalanced against a workspace total
   that nets to zero correctly — visible from neither side alone.

### Integrity

Check `#6 ledger_balances_by_dim` in
`netlify/functions/lib/ledger-assert.js` reconciles the sum against the journal
lines per `(period, account)`, reporting `error` severity on any mismatch. It
skips cleanly when no by-dim rows exist yet, so an untouched workspace does not
report a phantom failure. Unit-tested without credentials via
`npm run check:ledger-assert`.

Repair, if it ever drifts, belongs with `scripts/reconcile-ledger-balances.js` —
both collections are derived from journal lines, so both are rebuildable.

### Cost

Every posting now writes roughly twice the balance documents it used to. The
accumulator aggregates across all journals in a batch before flushing, so this is
a handful of extra writes per batch rather than one per journal line — the bulk
sweep chunks at ≤120 journals and still lands far inside the 500-write batch
ceiling.
