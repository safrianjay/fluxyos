# Duplicate Prevention & Resolution

Status: **Phases 1–3 shipped.** Prevention before save, historical cleanup
review in the Accounting Center, file-identity hashing, and read-only Fluxy AI
context are all live.

Sibling document to `BANK_RECONCILIATION_PLAN.md`; the two systems share their
text-matching vocabulary on purpose.

---

## 1. Why this exists

FluxyOS accepts financial records from ten entry points. Before this work, one
of them checked for duplicates, and it checked badly: an exact vendor + amount +
day comparison over a 1,000-record fetch, resolved by a banner the user cleared
by pressing Save twice.

The cost of a duplicate is not cosmetic:

| Duplicate | Consequence |
|---|---|
| Bill | Accounts Payable overstated; the vendor gets paid twice |
| Revenue transaction / invoice | Revenue **and PPN output tax** overstated — a filed-return problem |
| Expense | Bank reconciliation stops tying out (`computeTieOut` delta ≠ 0) |
| Manual journal | Trial balance carries an adjustment twice |

And because `firestore.rules` sets `delete: if false` on every finance
collection, a duplicate that gets saved is **permanent**. It can be voided, which
reverses its journal and leaves both records visible forever, but it cannot be
removed. That asymmetry is the whole argument for spending effort at the point
of entry rather than on cleanup.

---

## 2. Architecture

Three files, deliberately layered so the hard part is testable without a browser.

| File | Role | Depends on |
|---|---|---|
| `assets/js/duplicate-engine.js` | **Pure.** Scores record pairs, emits evidence. No Firestore, no DOM, no `window`. | `recon-engine.js` (text helpers only) |
| `assets/js/duplicate-guard.js` | Orchestration: fetch candidates → score → ask → log the decision. | engine, db-service, the dialog |
| `showDuplicateDialog()` in `shared-dashboard.js` | Presentation only. | the canonical dialog shell |

Data layer lives in `db-service.js`: `findDuplicateCandidates`,
`getDuplicateDecisions`, `getDuplicateReviews`, `recordDuplicateDecision`,
`updateDuplicateDecision`.

### Three invariants

1. **A duplicate check never costs a user their save.** Every failure path —
   offline, undeployed rules, a failed module import — resolves to
   `proceed: true`. The feature can degrade to not existing.
2. **Nothing here writes a financial record.** The guard returns a verdict. Void
   and reverse go through the existing `voidTransaction` / `voidInvoice` /
   `reverseJournal`, which already correct the journal and write the audit log.
3. **Every decision that lets a record through is logged before the save.** The
   user's intent survives even if the write then fails.

---

## 3. The rules

Highest tier wins. Tiers, thresholds, and weights are tuned **in
`duplicate-engine.js` only** — both the pre-save guard and the cleanup
scan read from there, so the product stays consistent.

| Rule | Fires when | Score |
|---|---|---|
| **D0** | An identity key collides: same `source_file_hash`, `bank_statement_row_id`, `commerce_order_id` + `commerce_account_id`, or a collision in one of **our own** generated number series (`BILL-…`, `INV-…`, `JV-…`) | 100 |
| **D1** | Same counterparty **and** same counterparty document number (`invoice_number`, `payment_reference`) — see the instalment rule below | 95 |
| **D2** | Same amount + same counterparty + same calendar day | 90 |
| **D3** | Same amount + same counterparty, ≤ 3 days apart | 75 |
| **D4** | Same amount + same day, counterparty names ≥ 50% similar | 60 |
| **D5** | Same amount, ≤ 7 days apart, description tokens ≥ 50% similar | 45 |
| **D6** | Same amount + same account + same category, ≤ 7 days apart | 30 |

Additive (capped at 99 unless D0): `+4` same account, `+3` same category,
`−15` the existing record is voided.

**Two kinds of document number, and the distinction matters.** Our own series is
unique by construction, so a collision is an integrity failure → D0. The
*counterparty's* reference repeating is the classic A/P duplicate → D1.

**Instalments are not duplicates.** A shared document number with *differing*
amounts means one of two very different things, and the record type tells them
apart:

- On an **accrual document** (a bill, an invoice) it is a keying error or a real
  duplicate — a vendor does not issue two invoices under one number for two
  different amounts. D1 fires.
- On a **ledger transaction** it is almost always two partial payments, each
  carrying the invoice number as provenance. That is supported behaviour
  (`_payBillOnce`, `isValidInvoicePartialTransition`), not a duplicate. D1 stays
  silent unless the amounts also match.

*(Found against real data: before this split, a partially-paid invoice reported
its own two payments as a 98% duplicate pair.)* Two transactions carrying the
same `linked_bill_id` are suppressed outright for the same reason.

### Bands

| Band | Score | Behaviour |
|---|---|---|
| `high` | ≥ 85 | Dialog. Keeping both requires a **written reason**. |
| `medium` | 55–84 | Dialog with "Save anyway". |
| `low` | 30–54 | Silent. Recorded, never interrupts. |

`low` is deliberately silent. Interrupting on a 30% hunch is how users learn to
dismiss the dialog without reading it, which costs more than the duplicates it
would catch.

### Suppression — checked first

The rules above find similar records. These stop the similar-but-legitimate ones
from ever reaching a user:

- **Already linked** (`linked_bill_id`, `linked_transaction_id`, `recon_row_id`).
  A bill and the payment that settled it share vendor and amount *by
  construction*.
- **Transfers and adjustments.** Own-account movement repeats by design.
- **Voided existing records, on the pre-save path.** A voided record is one the
  user already cancelled; re-entering a corrected version is the normal next
  step. The cleanup scan opts back in via `includeVoided`.
- **A decision already recorded** for that pair (`kept_both` / `valid` /
  `ignored`).
- **Recurring gaps on D1** — a monthly-or-longer cadence is a renewal, not a
  re-entry.

Note that D2–D6 all require the records to be within 7 days. That window, not
the cadence list, is what keeps monthly rent, payroll, and subscriptions from
flagging forever.

### Counterparty names get their own tokenizer

`recon-engine.tokenize` drops pure-digit and short tokens — right for bank
statement prose (`TRSF 0812 …`), badly wrong for identity. It collapses
"Client 1" and "Client 2" into one name.

`partyTokens()` keeps every alphanumeric token and drops only legal-form noise
(`PT`, `CV`, `Tbk`, `Ltd`, …). On top of that, `partyDigitsConflict()` treats
digits inside a counterparty name as an **identifier**: when both names carry
digits and they differ, they are different counterparties however much wording
they share. "Toko 88" is not "Toko 99".

*(This was found by `invoices-qa.spec.js`, which creates customers named
`QA Customer <stamp>`. Before the fix they all collapsed to one party key and
scored as near-certain duplicates of each other.)*

---

## 4. Candidate fetching — why this scales

`findDuplicateCandidates` issues at most two **equality** queries:

- `where(amount, '==', n)` limit 25 — the anchor; every rule above D1 needs it.
- `where(invoice_number, '==', s)` limit 10 — only when a document number exists.

Both are served by Firestore's automatic single-field indexes. **No composite
index, no schema change, and the cost does not grow with the size of the
ledger.** Date filtering happens in the engine, on the ≤ 35 documents returned.

Batch imports probe once per *distinct amount* (capped at 40), so a 200-row CSV
of repeated amounts costs a handful of reads rather than 200.

---

## 5. Storage

### `duplicate_reviews` (workspace-scoped)

Routed through `${ds._scope(userId)}/duplicate_reviews` — **never** `users/`.
This is finance data; hardcoding `users/` is the exact bug that showed invited
members zero data twice before (see PROJECT_BACKGROUND §4).

```
kind          'transactions'|'bills'|'invoices'|'subscriptions'|'journals'
primary_id    string    the record kept
duplicate_id  string    the record judged a copy ('' when both were kept)
score         number    0..100
rules         string[]  ['D2']
decision      'pending'|'kept_both'|'ignored'|'valid'|'voided'|'reversed'|'merged'|'attached'
reason        string    ≤500
source        'manual'|'scan'|'csv'|'bank_sync'|'revenue_sync'|'api'|'cleanup'
notes         string    ≤500
decided_by    string    uid, pinned by rules to request.auth.uid
decided_at    timestamp
created_at    timestamp
```

`band` is derived from `score`, not stored. The pair a decision describes is
**immutable** — only `decision`, `reason`, and `notes` can change — and
**delete is denied in both scopes**. "We looked at this and kept both" is audit
evidence; it has to outlive the records it describes.

**No fields were added to `transactions`, `bills`, or `invoices`.** Their create
validators are 50+-key `hasOnly()` allowlists duplicated across two scopes, and
the rules evaluation budget has already tripped in production once. The only
field this feature adds to an existing collection is `documents.file_hash`
(optional string, ≤64 chars) — see §10.

Rules coverage: `tests/duplicate-reviews-rules-emulator-test.mjs` (22 assertions,
both scopes).

### Audit

Every decision writes an `audit_logs` entry in the same batch:
`duplicate.kept_both`, `duplicate.ignored`, `duplicate.valid`,
`duplicate.attached`, `duplicate.voided`, `duplicate.pending`. Surfaces in the
Activity Log with no extra work. `'duplicate_reviews'` was added to the
`target_collection` enum in **both** audit validators.

---

## 6. Entry points

| Entry point | Hook | Behaviour |
|---|---|---|
| Manual transaction / bill / subscription | `global-tx-form.onsubmit`, `shared-dashboard.js` | Runs **before** the attachment upload, so cancelling costs no storage quota |
| AI bill / receipt / invoice scan | `saveScannedDocument()`, `document-capture.js` | Adds **Attach to existing** |
| CSV import | preview + submit, `shared-dashboard.js` | Pre-flight; flagged rows deselected by default |
| Invoices | `finalize()`, `invoices.js` | At finalize, not at draft — a draft is inert, finalizing books the receivable |
| Manual journal | `onPost()`, `accounting-journal-new.js` | Compared against **other manual journals only** |
| Bank statement import | server-side `match_status` | Already flags `possible_duplicate` with its own "Skip N" affordance |
| Scanned file (bytes) | `startScan()`, `document-capture.js` | `file_hash` identity check, before the AI extraction is paid for |
| Vendor payment | `_payBillOnce()`, `db-service.js` | Already structurally prevented: payments cannot exceed `outstanding_amount`, and a settled bill throws |

---

## 7. Accounting treatment

**Manual transaction entered twice.** D2 at save. Block before the write —
nothing is posted yet, so there is no journal to unwind. If it already saved,
void the *later* record with reason "Duplicate transaction" (already the default
first option in `showReasonDialog`). `voidTransaction` reverses the journal so
the trial balance self-corrects. Never delete: the audit trail must stay intact.

**Manual transaction + bank sync.** *Not* a duplicate to void — the bank row is
evidence of the same economic event. Route to
`recon-engine.matchStatementRows`; the row becomes `matched_existing` and no
second transaction is created. Creating both double-counts cash and breaks the
statement tie-out.

**AI bill scan + manual bill.** D1, high. Cancel the incoming scan and **attach
the scanned document to the existing bill**. The bill already accrued A/P; a
second one overstates payables and invites a double payment. The scan's only
unique contribution is the paperwork, and the existing record is usually a manual
entry that has none — so this outcome keeps everything of value and writes no new
financial record. It is the highest-value interaction in the feature.

**CSV import duplicate.** Pre-flight before any write; flagged rows deselected,
opting in is deliberate. `addTransactions` writes a 500-row batch marked
`accounting_status: 'pending'` for a later sweep — unwinding 200 mistaken rows
means 200 voids.

**Duplicate vendor invoice number.** D1, high **regardless of amount**. The
vendor's document number is the control key for A/P: duplicates break three-way
matching and vendor statement reconciliation.

**Duplicate revenue.** The most damaging case — overstates revenue *and* PPN
output tax, which reaches a filed SPT. `commerce_order_id` (D0) prevents it
outright for synced revenue. Manual and scanned revenue at `high` require a
written reason to keep both; that sentence becomes the tax-audit evidence for why
two identical sales on one day are genuine.

---

## 8. Testing

| Layer | File |
|---|---|
| Engine (pure, browser ESM) + the Cleanup surface | `tests/duplicate-engine.spec.js` |
| Rules, both scopes, incl. `documents.file_hash` | `tests/duplicate-reviews-rules-emulator-test.mjs` |
| Shared spec helper | `dismissDuplicateDialogIfPresent()` in `tests/qa-helpers.js` |

```bash
npx playwright test tests/duplicate-engine.spec.js
firebase emulators:exec --only firestore,auth \
  "node tests/duplicate-reviews-rules-emulator-test.mjs"
```

**Specs that create fixtures must make them unique per run** (`QA Bill
${Date.now()}`), or answer the dialog with `dismissDuplicateDialogIfPresent`.
The shared QA account accumulates records, so a fixed vendor + amount + today is
now a genuine duplicate — correctly flagged.

**Deploy order matters**: `firebase deploy --only firestore:rules` **before**
pushing, or every duplicate decision fails with permission-denied. (The record
itself still saves — the guard's failure path is `proceed` — but the provenance
is lost.)

---

## 9. Historical review (Phase 2)

`scanForDuplicates()` runs pairwise over the records already in a period and
returns groups with the **older** record as `primary_id`. It surfaces in the
Accounting Center's Cleanup view (`accounting.html`,
`data-acct-panel="cleanup"`), above the readiness queue — a duplicate distorts
every figure below it, so it is resolved first.

- **Lazy and period-scoped.** The scan runs only when someone opens Cleanup, and
  only once per date range (`state.dupScannedRange`). Changing the period or
  pressing "Scan this period" re-runs it. Past `DUP_SCAN_CAP` (2,000 records) the
  user is told to narrow the range rather than left with a frozen tab.
- **Counted with the cleanup backlog.** `updateCleanupBadge()` adds unresolved
  duplicates to the readiness items on both the Cleanup tab and the Close group
  badge — both are things that must be settled before a period closes honestly.
- **Actions**: Open · Not a duplicate · Ignore · Add note · Void the duplicate ·
  Reverse the duplicate (journals). Void and reverse ask for a reason through
  `showReasonDialog`, then call `voidTransaction` / `voidInvoice` /
  `reverseJournal` — the existing paths that reverse the journal and write the
  audit log. Nothing in the review writes a financial record itself.
- **A note is not a resolution.** Adding one records `pending` and leaves the
  pair open, because that is what "I looked into this and it is not settled yet"
  means.

**Delete is deliberately absent for posted records.** Firestore denies it
outright, so offering one would be a lie. Only unposted drafts
(`deleteManualJournalDraft`, unimported bank rows) can be deleted.

**Merge is not offered.** For posted records it would collapse two source
documents into one. The supported alternative — *void the duplicate and attach
its document to the survivor* — is exactly what the scan path already does.

---

## 10. File identity and AI (Phase 3)

**`file_hash` on `documents`.** SHA-256 of the file bytes, computed in
`document-attachment.js` (`hashFile`) before upload and stamped by both upload
paths. `findDocumentByHash` probes it on a single indexed equality query.

The scan flow checks it in `startScan()` **before extraction** — first because
identical bytes are the one signal that needs no judgement, and second because
catching it there skips an AI extraction the user would pay for and then throw
away. `crypto.subtle` needs a secure context, so `hashFile` returns null rather
than throwing; a document simply goes un-hashed and the other rules still apply.

**Fluxy AI** gets the duplicate count, the cleanup count, and the strongest
match's evidence through `window.FluxyAIContext.register` in `accounting.js`, so
"why is this flagged?" can be answered in either language. Read-only — the
assistant never resolves a pair.

**Commerce sync needed no work.** `writeLedgerEntries` in
`netlify/functions/lib/commerce/store.js` already uses deterministic document ids
(`platform_shop_orderid`) with `ref.create()` semantics, so a retry or a
webhook/poll overlap can never duplicate a ledger transaction. The engine's D0
`commerce_order_id` rule is a second net beneath an already-correct one.
