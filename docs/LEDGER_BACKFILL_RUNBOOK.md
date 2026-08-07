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

**Use the admin census — it is the authoritative measurement:**

```bash
GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/ledger-coverage-report.js
```

It reads *every* journal, per workspace, and warns if any transaction is flagged
posted but has no journal (the backfill skips those, so it could not close their gap).

**For the full integrity picture — not just coverage — run the assertion report:**

```bash
GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/ledger-assert-report.js
GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/ledger-assert-report.js --workspace <wsId>
```

Read-only (no `--commit` exists). Exits 1 if any workspace has a finding, so it can
gate a cutover step. It runs the **same** `assertWorkspaceLedger()` the nightly
sweep runs (`netlify/functions/lib/ledger-assert.js`), so its output is exactly
what the cron will report — run it **before** setting `LEDGER_ASSERT_ENABLED=true`,
or the first night's report will be your first look at the findings.

It adds four checks coverage alone cannot see, each printed with its remedy:
A/R ties to open invoices · A/P ties to unpaid bills · Σdebit == Σcredit across
journal **lines** (the check Firestore rules structurally cannot perform) ·
`ledger_balances` vs the journal lines they were incremented from. A
`ledger_balances_drift` finding points at §4; a `journal_coverage` finding points
back here. `--json` emits the raw reports.

Do **not** measure this through `DataService.listJournals` — it defaults to
`max: 200` and filters `periodKey` **client-side**, so on a busy workspace it sees a
fraction of the journals and reports a false gap. That mistake once reported 16.2%
coverage where the truth was 80.7%.

The in-app spec is a convenience check, not the census:

```bash
npx playwright test tests/accounting-ledger-coverage.spec.js
```

It requests `max: 5000`, asserts the journal fetch is non-empty, and asserts the one
invariant that must hold no matter what: Income Statement net income == Trial Balance
implied net income. If that invariant fails, stop — it is an engine/data-integrity
bug, not a coverage gap.

### Recorded run — QA workspace `CPGVkWil8bV6HAWMHkgqwKLKY663`, 2026-07-29

| | before | after |
|---|---:|---:|
| coverage (postable txns) | 85.7% | **100%** |
| July coverage | 80.7% | **100%** |
| Balance Sheet tie-out | −Rp110 | **Rp0, balanced** |
| July ledger revenue | Rp850.298.952 | **Rp2.280.298.952** |
| July ledger net income | −Rp378.604.268 | **+Rp1.046.417.182** |

193 journals posted, 193 numbers assigned, 2 drifted balance docs corrected.
**Zero unposted sources remain.** The 23 that earlier tooling reported as a residual
gap carry `accounting_status: 'excluded'` — foreign-currency invoice settlements
deliberately kept outside the IDR kernel. `'excluded'` is a **terminal** state, not a
gap; the coverage tools and the Close gate all treat it that way now.

### Recorded run — Beila `4Zk00FWh7ZRP2TneRljbggZbUQi2`, 2026-07-31

The owner **reopened `2026-05` and `2026-06`** first (both `CLOSE` journals carried
matching reversals; Retained Earnings netted to Rp0, so the closings unwound
cleanly). That took `closed-period` skips from 747 to **0** and made the whole gap
reachable.

| | before | after |
|---|---:|---:|
| coverage | 5.4% | **100%** (796 postable, 0 unposted) |
| journals posted | — | **746** (714 in 2026-05, 32 in 2026-06) |
| ledger drift after backfill | — | **0** — reconcile found nothing to fix |

Statements verified against the pure engines:

| | 2026-05 | 2026-06 |
|---|---:|---:|
| Trial balance | foots | foots |
| Revenue | Rp3.614.060.830 | Rp114.701.876 |
| Net income | Rp3.130.381.085 | −Rp52.483.084 |
| Cash flow tie-out | ties | ties |

Balance Sheet as of 2026-06: assets Rp3.083.298.681 == liabilities + equity,
**tie-out Rp0**.

Note `2026-05` had **no** `CLOSE` journal before the reopen — `buildClosingJournal`
returns null when there is nothing to roll, i.e. the month was closed over an
essentially empty ledger. That is the close-gate defect's fingerprint.

**Both periods are left OPEN.** Re-closing is the owner's call; the Close gate will
now allow it (0 unposted), which it would not have done before.

### Status 2026-07-31 — all workspaces clean

`ledger-coverage-report.js` across production: **1640 postable, 0 unposted, every
workspace at 100%**, zero drift. Get-Pipeline (0%→100%) and Dika Finance
(46.2%→100%) were fixed via the in-product **"Post N unposted entries"** action
rather than these scripts — their journals carry `journal_number`s, which the admin
backfill does not assign, so the in-product path is confirmed working end to end.

Keep the scripts for gaps spanning many periods or workspaces, and for anything a
closed period blocks.

### Known `ledger-assert-report.js` findings — baseline 2026-08-07

Re-measured live: coverage **1692 postable, 0 unposted, 100% on all 5 workspaces
holding transactions** (up from 1640 with the gap still zero — new records post as
they arrive). `ledger_balances` drift, trial balance and A/R tie everywhere.

The assert report **exits 1** on two `ap_subledger` findings. Both are on
non-customer workspaces and neither is a coverage gap. Expect them the first
night `LEDGER_ASSERT_ENABLED` is on:

| Workspace | Δ | Cause |
|---|---:|---|
| QA Company | Rp22.550 | 11 USD test bills (`amount: 2050` = $20.50 in cents) each posted a `BILL-ACCRUE` crediting A/P **Rp2.050** — the minor-unit value treated as rupiah. They predate the foreign-currency guard. |
| Tes | −Rp193.000 | One bill's `BILL-ACCRUE` was reversed (`REVERSAL:BILL-ACCRUE`), so GL A/P nets to Rp0, but the bill document is still open/unpaid so the subledger still counts it. |

**Neither is a live code defect, but they are different kinds of not-a-defect:**

- The QA one **cannot recur**: `_postSourceJournal` (`db-service.js`) now returns
  early for `currency !== 'IDR'`, marking the source `accounting_status:
  'excluded'` and posting nothing — exactly to stop minor units entering the IDR
  ledger. The 11 rows are residue from before that guard. Cleanup is a data fix
  on a QA workspace, not a code change.
- The Tes one **was** a product gap and is **fixed as of 2026-08-08**:
  `reverseJournal` now stamps the source document `accounting_status: 'reversed'`
  in the same batch as the reversal, and the subledger honours that state for
  bills and invoices the way it already did for accrual transactions and
  subscriptions. `'reversed'` also counts as terminal for *coverage* — the source
  did reach the ledger and was undone on purpose, so it is not a backfill gap.

  ⚠️ **Not retroactive.** The existing Tes bill still carries
  `accounting_status: 'posted'` from before the fix, so that finding persists
  until the document is re-stamped. Any pre-fix reversal is in the same position.
  The fix prevents recurrence; it does not repair history.

**A latent A/R bug was found in the same pass and fixed with it.**
`expectedReceivables` matched `status === 'open'` and added the invoice's full
`total_amount`. Cash application (2026-07-29) added `open → partial → paid`, and
each payment posts `INV-PAY` (Dr Cash / Cr A/R) drawing the receivable *down*
rather than settling it — so a partial invoice still carries A/R in the GL while
the subledger dropped it entirely. It now matches `open` **and** `partial` and
counts `outstanding_amount`. This had never fired only because no checked
workspace had taken a partial payment yet; it would have been wrong every night
from the first one.

Diagnosis method, if either recurs: attribute the delta per source — compare each
bill's A/P journal net against `expectedPayables()`'s value for it, then group the
mismatches by pattern (foreign currency / withholding / `linked_transaction_id` /
reversed / partially paid). A raw list of mismatched ids is not legible; the
pattern grouping is what makes the cause obvious. Note `BILL-PAY` journals carry
`source.collection: 'transactions'` (the payment), not `'bills'`, so a naive
per-bill attribution shows every paid bill as a false mismatch.

### Historical — the workspaces that needed this

Measured 2026-07-29, **not backfilled** (restating a real customer's books is a
business decision, not an engineering one):

| workspace | name | coverage | unposted | value |
|---|---|---:|---:|---:|
| `dMlPHFcUWWNxTJgqBVF33UyZo5x1` | Get-Pipeline | **0%** | 27 | Rp796.860.000 |
| `vCbKe11c9fU6HxBizO4iwkg9YQf1` | Dika Finance | 46.2% | 7 | Rp2.131.850 |

Neither has a closed period, so both are fixable either by the in-product
"Post N unposted entries" action (§0b) or by the script. Beila — the one that needed
a reopen decision — is done (above).

**Dry-run 2026-07-29 — only two of the three are fixable by the backfill:**

| workspace | postable now | blocked by closed period | verdict |
|---|---:|---:|---|
| Get-Pipeline | 27 | 0 | **safe to backfill** |
| Dika Finance | 8 | 0 | **safe to backfill** |
| Beila | 28 | **747** | **needs a decision — see below** |

**Beila closed its books on incomplete data.** `2026-05` and `2026-06` are both
`closed`, and they contain **724 unposted transactions worth Rp4.40bn**
(2026-05: 692 / Rp4.117bn; 2026-06: 32 / Rp285m). The backfill skips closed periods,
so it can only post 28 — Beila would go from 5.4% to roughly 8.9% coverage and the
statements would still be missing Rp4.4bn.

Closing that gap requires **reopening two closed periods**, which reverses their
closing journals and restates retained earnings for two months the customer may
already have reported on. That is a finance decision, not an engineering one.

### Root cause — a close-gate defect (not just bad data)

The Close checklist's "All entries posted to the ledger" gate reads
`countPendingPostings` (`db-service.js:3664`), which counts only documents with
`accounting_status == 'pending'`. **Transactions that were never queued carry no such
flag and are invisible to it**, so the gate reads "Up to date" while any number of
sources sit unposted. That is how Beila closed two periods on incomplete books.

Until that gate also counts *unposted* sources (no journal and no posted flag — the
check `scripts/ledger-coverage-report.js` performs), closing a period does not
guarantee the ledger is complete, and this situation can recur.

---

## 0b. Try the in-product remedy first

Since 2026-07-31 the Accounting Center can post never-queued sources itself, for the
**selected period**, without admin credentials:

**Close tab → "Post N unposted entries"** (appears only when the Close gate is
blocking), or the Journals tab banner, which now counts queued *and* never-queued
sources. Both call `DataService.postUnpostedSources`, which shares one enumeration
(`_collectUnpostedSources`) with the Close gate, so the button can never disagree
with the check that blocked you. It skips closed periods and invoice-linked
settlements exactly like the script.

Use the scripts below when the gap spans **many periods or many workspaces** (the
in-product action is one period at a time), or when periods are closed and the
in-product path cannot reach them.

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
