# Ledger Backfill Runbook

**Purpose:** post double-entry journals for transactions/bills/subscriptions that
predate the accounting kernel, so the ledger-derived statements report complete
numbers.

**Why now:** `docs/ACCOUNTING_CENTER_IA.md` Phase 2 makes the ledger-derived Income
Statement the only Income Statement. That statement is only as complete as the
ledger, and on the QA workspace the ledger is currently missing most of the
transaction population. **This runbook is the gate on shipping Phase 2.**

All three scripts are **dry-run by default**, **idempotent**, and safe to re-run.

> ⚠️ **`--dry-run` is a label, not a safety switch.** None of these scripts parse it
> — they check `args.includes('--commit')`, so dry-run is simply the *absence* of
> `--commit`. `--dry-run --commit` **writes**; the `--commit` wins and `--dry-run` is
> silently ignored. Safety comes from omitting `--commit`, nothing else.

---

## 0. Baseline — measure before you change anything

```bash
npx playwright test tests/accounting-ledger-coverage.spec.js
```

Prints a `LEDGER COVERAGE` block. Record it. QA workspace baseline on 2026-07-29:

```
period=2026-07  transactions=414  postable=414  journals=170
posted to ledger: 67/414  (16.2%)
UNPOSTED: 347 txns worth Rp5.754.083.495
journals missing journal_number: 0
trial balance balanced=true
balance sheet balanced=false tieOut=Rp-110
```

The spec also **asserts** the one invariant that must hold no matter what: Income
Statement net income == Trial Balance implied net income. If that fails, stop — it
is an engine/data-integrity bug, not a coverage gap.

---

## 1. Prerequisites

- A **fresh service-account key** (`GOOGLE_APPLICATION_CREDENTIALS=./sa.json`).
  None of these scripts run from the app's client credentials.
- The **workspace id**. For an owner it equals their Firebase uid.
- Confirm no period you intend to backfill is `closed`/`locked` — the backfill
  **skips closed periods by design** (never posts into a closed book). If a closed
  period needs correcting, reopen it first (owner/admin; `reopenPeriod` reverses the
  closing journal), backfill, then re-close.

---

## 2. Step 1 — post the missing journals

```bash
GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
  node scripts/backfill-journals.js --workspace <wsId> --dry-run
```

Read the output before committing:

- **Planned journals by period** — sanity-check the periods and totals. A period you
  did not expect to change is a red flag.
- **Skipped — already posted** — the idempotency guard working (source flag,
  `journal_ref`, or an existing journal for that source id).
- **Skipped — no-post** — transfers, adjustments, and custom types that correctly
  never post. Expect a non-zero number.
- **Skipped — invoice-linked** — `INV-PAY` settlements are deliberately skipped
  because invoice issuance (`INV-ISSUE`) posts separately; posting a settlement
  alone would drive Accounts Receivable negative. **These stay unposted and will
  still show as uncovered in step 5.** That is expected, not a failure.
- **Skipped — closed-period** — see the prerequisite above.

Then commit:

```bash
GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
  node scripts/backfill-journals.js --workspace <wsId> --commit
```

Scope it narrower if you want to stage the change:
`--collections transactions` (default is `transactions,bills,subscriptions`).
Note that bills/subscriptions posting will move **operating expenses**, not just
revenue.

---

## 3. Step 2 — assign journal numbers *(easy to miss)*

`backfill-journals.js` does **not** assign `journal_number` — the kernel normally
reserves those in a transaction at post time, which a batched migration cannot do.
Backfilled journals therefore land without `JE-YYYY-NNNNNN` until you run:

```bash
GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
  node scripts/backfill-journal-numbers.js --workspace <wsId> --dry-run
GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
  node scripts/backfill-journal-numbers.js --workspace <wsId> --commit
```

Skip this and the Journal Register shows numberless entries. The coverage spec
reports `journals missing journal_number` so you can verify it reached zero.

---

## 4. Step 3 — reconcile ledger balances

The backfill writes `ledger_balances` with `FieldValue.increment`. Recompute from
the journal **lines** (the source of truth) and repair any drift:

```bash
GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
  node scripts/reconcile-ledger-balances.js --workspace <wsId> --dry-run
GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
  node scripts/reconcile-ledger-balances.js --workspace <wsId> --commit
```

This is also what clears the standing **Rp110** Balance Sheet tie-out drift on QA.

Scope to one period with `--period YYYY-MM` if you want to limit the blast radius.

**Supported flags, verified against the source** (not the usage comments):

| Script | Flags |
|---|---|
| `backfill-journals.js` | `--workspace` (required) · `--collections` (default `transactions,bills,subscriptions`) · `--commit` |
| `backfill-journal-numbers.js` | `--workspace` (required) · `--commit` |
| `reconcile-ledger-balances.js` | `--workspace` (required) · `--period` · `--commit` |

---

## 5. Step 4 — verify

```bash
npx playwright test tests/accounting-ledger-coverage.spec.js
```

Expect:
- **posted to ledger** climbs sharply (100% minus the invoice-linked skips).
- **journals missing journal_number** = 0.
- **balance sheet balanced** = true, tieOut = Rp0.
- The net-income assertion still passes.

Then open `/accounting` and confirm the KPI strip, Income Statement, and Trial
Balance all agree, and that the Balance Sheet tie-out badge reads "Balanced ✓".

---

## 6. Before running this in production

The QA workspace is not evidence about production. Required first:

1. **Measure per workspace.** Run step 0's logic against production workspaces to
   find how widespread the unposted population is. Do not assume it matches QA.
2. **Expect a restatement.** On QA the ledger reports a Rp379m loss where the
   retired preview reported a Rp4.2bn profit. Any workspace with a similar gap will
   see its reported revenue change materially the moment Phase 2 ships. Decide
   whether that needs customer communication **before** enabling, not after.
3. **Backfill before cutover, not after.** Shipping Phase 2 first means users see
   collapsed revenue until the backfill runs.
4. **Closed periods are a policy decision.** Backfilling into a previously closed
   period means reopening a closed book. If a period was closed and reported on,
   restating it may not be acceptable — leaving it under-reported may not be either.
   That is a finance decision, not an engineering one.

---

## Related

- `docs/ACCOUNTING_CENTER_IA.md` — Phase 2 measurement and the cutover gate
- `docs/PROJECT_BACKGROUND.md` §4m.3 — accounting kernel, posting rules, periods
- `scripts/backfill-journals.js` · `scripts/backfill-journal-numbers.js` ·
  `scripts/reconcile-ledger-balances.js`
- `tests/accounting-ledger-coverage.spec.js` — the before/after measurement
