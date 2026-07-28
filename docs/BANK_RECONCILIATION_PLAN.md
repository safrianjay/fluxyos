# Bank Reconciliation — Implementation Plan (Import Phases 3–4)

**Status:** Phases A **and B shipped 2026-07-26**.
Phase A — account picker + create-from-detected-identity in the review panel,
cash-impact stamp (`cash_account_id`) on imported rows, certify step writing
`latest_balance` + snapshot + `reconciliation_status: 'certified'`.
Phase B — pure matching engine `assets/js/recon-engine.js` (tiers R1–R4,
greedy one-to-one, evidence strings; windows/thresholds are exported constants
**pending expert Session 3 tuning**), reconcile-instead-of-create in the review
table (three-way action: Reconcile / Create new / Ignore; suggestions are
in-memory until the user confirms), `recon_*` fields on transactions (created
rows born reconciled; matched rows stamped via update),
`unreconcileStatementRow` (blocked once certified; **UI shipped 2026-07-28** —
a "Reconciled lines" undo list with a per-row **Un-reconcile** button on the
imported step, above the certify card, hidden once certified),
`created_count`/`matched_count` on the import, and
the opening+movement-vs-closing tie-out line on the certify card.
Rules deployed; tests: `tests/recon-engine.spec.js`,
`tests/bank-recon-unreconcile.spec.js` (reconcile→un-reconcile→certify-block
DAL round-trip), `tests/bank-recon-phase-a-rules-emulator-test.mjs` (19 cases).
Phase C (many-to-one settlements, learned rules) remains planned.
Originally written 2026-07-26 in parallel with the accounting-expert discovery
sessions. Decision points the expert must
validate are marked **[EXPERT]** and map to Session 3 of
`ACCOUNTING_EXPERT_INTERVIEW_GUIDE.md`.
**Supersedes** the Phase 3–5 sketches in
`BANK_STATEMENT_IMPORT_AUTOMATION_PLAN.md` (Phases 1–2 there are shipped and
unchanged; this doc merges its Phase 3 "balance update" and Phase 4
"reconciliation" into one coherent design).
**Why now:** per `ACCOUNTING_DISCOVERY_STRATEGY.md` §3 step 8, reconciliation
is the broken link in the data lifecycle — until statement lines are matched to
ledger entries and an ending balance is certified, every downstream number is
"what we recorded," not "what we verified." This is Roadmap Phase 1 item 1.

---

## 1. Current state (what this builds on)

Shipped (import Phases 1–2):
- Upload → AI/deterministic extraction → `bank_statement_imports` +`rows`
  drafts, balance-equation + running-balance checks, duplicate flags against
  existing `transactions` (`match_status: 'possible_duplicate'`).
- Confirm-to-ledger: batch-creates transactions (`source:
  'bank_statement_import'`, row/import link fields, `accounting_status:
  'pending'` → journals via `postPendingJournals` sweep). Idempotent.
- `bank_accounts` (manual balances, `latest_balance`/`latest_balance_at`,
  `source_type` enum already includes `"statement_upload"`) + append-only
  `bank_balance_snapshots`. Overview Bank Cash Balance card reads snapshots;
  its secondary entry point was explicitly reserved for this phase.

Dormant seams this plan activates (no schema invention needed):
- `bank_statement_imports.bank_account_id` — always null today.
- `transactions.cash_account_id` — reserved "future bank account linkage".
- `rows.match_status` / `suggested_*` / `confidence` — extraction already
  populates suggestions; matching extends the same row model.

## 2. Design principles

1. **Statement-anchored reconciliation.** The reconciliation unit is the
   imported statement (SMB reality: reconcile when the statement arrives), not
   a standalone "reconciliation session" object. The `bank_statement_imports`
   doc *is* the session; certification stamps it. No new top-level collection.
2. **Deterministic first.** Phase A/B matching is pure rule tiers with visible
   evidence. AI-assisted fuzzy matching is a later rung of the autonomy ladder
   (`ACCOUNTING_DISCOVERY_STRATEGY.md` §7.1) and is out of scope here.
3. **Reconcile-instead-of-create.** Today a statement line that matches an
   existing ledger entry can only be skipped (as "duplicate") or imported (as a
   double). The core new behavior: a matched line *links and reconciles* the
   existing transaction instead of creating one.
4. **Certification is a detective control, not a posting event.** Certifying a
   statement writes a balance snapshot and marks rows/transactions reconciled;
   it never mutates journals. Adjustments (bank fees, interest) go through the
   normal transaction flow and post normally.
5. **Pure engine + thin I/O**, mirroring `accounting-engine.js`: matching logic
   lives in a new pure module `assets/js/recon-engine.js` (unit-testable, no
   Firestore); `db-service.js` does the reads/writes.

## 3. Data model changes (all workspace-scoped via `_scope`)

### 3.1 `transactions` — reconciliation fields (additive, optional)

| Field | Type | Notes |
|---|---|---|
| `recon_status` | string \| null | `null`/absent = unreconciled (default; no backfill needed) \| `'reconciled'` |
| `recon_import_id` / `recon_row_id` | string \| null | Which statement line verified this transaction |
| `recon_at` | Timestamp \| null | Server-set |
| `cash_account_id` | string \| null | **Activated**: set on reconcile + on rows imported from a statement (the import's account) |

Un-reconcile (mistake recovery) clears the four fields; both directions are
audit-logged (`transaction.reconciled` / `transaction.unreconciled`). Rules:
extend the transaction update validator's allowed-keys with these four; lean
checks only (`recon_status in [null,'reconciled']`). Mind the rules eval
budget — no cross-doc `get()`s in this validator.

### 3.2 `bank_statement_imports` — account link + certification

| Field | Change |
|---|---|
| `bank_account_id` | Now **required at confirm time** (nullable at draft creation): the review panel gains an account picker (existing accounts + "create new from detected identity" using `bank_name`/`account_number_masked`) |
| `reconciliation_status` | New: `null` \| `'in_progress'` \| `'certified'` |
| `certified_at` / `certified_by` | New: Timestamp \| null, uid \| null |
| `certified_closing_balance` | New: integer \| null — the statement closing balance the user certified |
| `matched_count` / `created_count` / `unmatched_count` | New counters for the review summary |

### 3.3 `rows` subcollection — match outcome

`match_status` enum extends from `possible_duplicate` to:
`unmatched` \| `auto_matched` \| `user_matched` \| `possible_duplicate` \|
`create_new` \| `ignored`. New fields: `matched_transaction_id`,
`match_rule` (tier id, §4), `match_evidence` (short string array shown in UI),
`match_confidence` (`exact` \| `strong` \| `review`).

### 3.4 `bank_accounts` — certified balance updates

On certification: `latest_balance = certified_closing_balance`,
`latest_balance_at = statement_end_date`, `confidence: 'extracted'`,
`source_type` stays per account; emit one `bank_balance_snapshots` doc
(`source_type: 'statement_upload'`) exactly like the manual-update path, so the
Overview sparkline picks it up with zero KPI changes. Audit:
`bank_account.balance_certified`.

## 4. Matching engine (`assets/js/recon-engine.js`, pure)

Input: statement rows + candidate transactions (fetched once for the statement
period ± a window, cash-effective, same direction). Output per row: ranked
candidates with `{ transaction_id, rule, confidence, evidence[] }`.

Deterministic tiers, cheapest sufficient wins:

| Tier | Rule | Confidence |
|---|---|---|
| R1 | Transaction already links this exact row (`bank_statement_row_id`) — re-import/idempotency case | exact |
| R2 | Same amount, same direction, same date, and (if both set) same `cash_account_id` | exact |
| R3 | Same amount + direction, date within ±3 days | strong |
| R4 | Same amount + direction, date within ±7 days, vendor/description token overlap ≥ threshold | review |
| R5 | *(Phase C, deferred)* many-to-one: N transactions summing to one settlement line (payment gateways) | review |

Guards: a transaction already `recon_status: 'reconciled'` is never a
candidate; one transaction matches at most one row per confirm (engine returns
conflicts for the UI to resolve); `exact` matches pre-select "reconcile",
`strong` pre-selects but highlights, `review` requires an explicit tap —
same acceptance ladder as the CoA mapping system, no silent auto anywhere.
The existing duplicate detection is subsumed: what Phase 2 called
`possible_duplicate` becomes an R2/R3 match whose default action is
**reconcile** rather than **skip** — strictly better (the ledger entry gets
verified instead of the statement line being discarded). **[EXPERT]** validate
the tier thresholds (±3/±7 days) against real BCA/Mandiri/BNI behavior and
gateway settlement timing.

## 5. Workflow

**Entry points:** existing Ledger → Scan/Import → Bank Statement panel
(extended), plus the reserved secondary entry on the Overview Bank Cash
Balance card.

1. **Pick account** (new step, before or during review): choose an existing
   `bank_accounts` doc or create one from the statement's detected masked
   identity. Stamps `bank_account_id` on the draft.
2. **Extract** — unchanged.
3. **Review** — each row now resolves to one of three actions instead of two:
   - **Reconcile** (matched existing transaction — shows the match evidence,
     links on confirm, creates nothing),
   - **Create** (unmatched → becomes a transaction exactly as Phase 2 does,
     now also stamped `cash_account_id` + auto-reconciled to its own row),
   - **Ignore**.
4. **Confirm** — one batch: creates + links + reconciles; counters update;
   `reconciliation_status: 'in_progress'`.
5. **Certify** (new closing step): shows the tie-out — statement closing
   balance vs. (opening balance + reconciled movement) and vs. the account's
   ledger-side cash view; lists whatever blocks a clean tie (unresolved rows,
   unexplained delta). Quick-add for standard adjustments (bank fee → type
   `fee`, interest → `7100 Interest Income` via its seeded mapping) creates
   normal transactions that auto-reconcile against their statement rows.
   Certify button (gated `accounting.post`) writes §3.4 + stamps the import
   `certified`. **[EXPERT]** what must be true before you'd certify — exact
   tie required, or tolerance? What does "certified" need to *block* afterwards
   (we propose: nothing in v1 — certification is evidence, not a lock; period
   close remains the lock).
6. **Un-reconcile / re-open** — per-row and per-import undo while the period
   is open; blocked once the period containing `statement_end_date` is closed
   (`_assertEditablePeriod` pattern).

## 6. What this does NOT touch

- **No journal changes.** Reconciling never posts; created rows post via the
  existing pending sweep; kernel `1000 Cash & Bank` remains one account
  (per-bank child accounts are CoA strategy §B Tier-2 — a later, independent
  step; `cash_account_id` carries the per-account dimension until then).
- No bank APIs / auto-sync; no AI matching; no learned description rules
  (import plan Phase 5); no e-wallet/gateway settlement recon (needs R5 —
  Phase C, informed by **[EXPERT]** Session 3 Q3 and commerce settlements).
- No changes to manual balance updates — both paths coexist; snapshots record
  provenance via `source_type`/`confidence`.

## 7. Delivery phases

- **Phase A — account wiring + certification without matching.** Account
  picker, `bank_account_id` stamped, `cash_account_id` on imported rows,
  certify step with balance write + snapshot. Small, ships value alone
  (finally closes import-plan Phase 3).
- **Phase B — matching engine + reconcile-instead-of-create.** recon-engine
  tiers R1–R4, three-action review, recon fields on transactions, un-reconcile,
  tie-out view in certify. The heart of the milestone.
- **Phase C — many-to-one + settlements + learned rules.** R5, gateway/e-wallet
  flows, per-workspace learned matching rules; sequenced after expert input and
  the AI-ladder groundwork.

## 8. Rules & indexes

- `transactions` update validator: allow the four recon keys (lean enum checks;
  keep the per-transition validator pattern — production has tripped the eval
  budget before).
- `bank_statement_imports` validator: allow the new certification keys;
  `certified_*` only writable with `reconciliation_status: 'certified'`.
- `rows`: extended `match_status` enum + new match fields.
- `bank_accounts`/`bank_balance_snapshots`: no rule-shape changes (same write
  paths as manual updates).
- Candidate query (`transactions` where `cash_effective == true`, timestamp
  range) — verify against existing composite indexes; add to
  `firestore.indexes.json` if needed. Rules + indexes deploy is manual, first.

## 9. Tests

- `tests/recon-engine.spec.js` — pure tier tests: each rule fires and ranks
  correctly, reconciled transactions excluded, one-to-one conflict handling,
  threshold boundaries (±3/±7 days), R2-vs-R3 precedence.
- Rules emulator test — recon-field writes by role, certified-key gating,
  snapshot append-only intact.
- Live QA spec (coa-phase1-qa pattern) — import a fixture CSV into the QA
  workspace: match + create + ignore mix, certify, Overview card reflects the
  snapshot, un-reconcile round-trip, console clean.
- Regression: existing `bank-statement-import.spec.js` and accounting suites
  stay green; Phase 2 confirm path byte-compatible for drafts with no
  `bank_account_id` (older in-flight drafts).

## 10. Open questions for the expert (Session 3 hand-off)

1. Match thresholds & real statement formats (§4). 
2. Certification semantics — tolerance, and what it should block (§5.5).
3. Timing differences: how should an end-of-month in-transit item (recorded in
   ledger, not yet on statement) be represented so next month's statement can
   claim it? (Our model: it simply stays unreconciled until a later statement
   matches it — confirm this is sufficient for SMB practice.)
4. Adjustment taxonomy: beyond fees/interest, what does an Indonesian SMB
   statement routinely surface (admin fees, PPh on interest, materai)?
5. Gateway/e-wallet settlement patterns to design R5 around.
