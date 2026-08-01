# FluxyOS Accounting Expert Interview Guide

**Purpose:** the working tool for discovery sessions with our founding finance/accounting expert. Designed to be handed over directly — the primer below is all the product context a session needs.
**Companions:** [ACCOUNTING_DISCOVERY_STRATEGY.md](ACCOUNTING_DISCOVERY_STRATEGY.md) (why we're asking) and [CHART_OF_ACCOUNTS_STRATEGY.md](CHART_OF_ACCOUNTS_STRATEGY.md) (CoA deep-dive).

---

## One-Page Primer: What FluxyOS Does Today

FluxyOS is a Bahasa-first financial operations platform for Indonesian SMBs (static web app on Firebase; team workspaces with roles including a dedicated `accountant` role). What exists now:

- **Recording:** transactions (income/expense/fee/tax/transfer/refund/accruals), bills with due dates and a vendor master, subscriptions, invoices (draft → finalized → partial → paid/void; USD/SGD supported, converted to IDR at payment). Partial and combined invoice payments are supported — one customer payment applied across several invoices.
- **A real double-entry kernel underneath:** every transaction/bill/invoice generates a balanced journal automatically against a seeded **32-account SAK-aligned chart** (Cash 1000, A/R 1100, A/P 2000, Retained Earnings 3000, Owner Capital 3100, Prive 3200, Revenue 4000, COGS 5100, expense accounts 61xx–6999, PPN/PPh tax accounts). Journals are immutable once posted (corrections by reversal), numbered `JE-YYYY-NNNNNN`. A trial balance accumulates per account per month. Manual journal entries exist (draft → post → reverse). Fiscal periods close (net income rolls to Retained Earnings) and lock; edits into closed periods are blocked; reopening reverses the closing entry.
- **Users never see debits/credits by default.** They pick a direction and an account (or a category, which a mapping table bridges to the GL). Suggestion order: vendor-master default → learned vendor memory → keyword rule → category chain. The **Accounting Center** is where the double-entry surface lives, organised as Overview / Reports / Ledger / Setup / Close.
- **Statements are derived from the ledger, not from transactions.** Income Statement (with a period-over-period comparison column), Balance Sheet (full equity section — owner capital, retained earnings, prive, opening equity, current-period earnings — plus an automatic tie-out badge), and Cash Flow (indirect method, ties to actual cash movement by construction). Trial Balance and General Ledger sit alongside them, and every statement line drills account → GL → journal → source document.
- **Close process:** a checklist gating on what actually blocks a close — every source posted to the ledger, trial balance in balance — plus cleanup signals. `closePeriod` refuses server-side if any source never reached the ledger, and offers a one-click "post them" remedy.
- **A/R + A/P aging:** standard 30/60/90 as-of-today, composed to tie to the Balance Sheet's A/R and A/P lines.
- **Bank reconciliation:** statement import (PDF/CSV/XLSX) with statement-line ↔ ledger matching, an unmatched queue, reconcile/un-reconcile, and a certify step that writes a balance snapshot.
- **Tax:** an Indonesian Tax Center — PPN output/input, PPh withholding, UMKM 0.5% vs ordinary 22% regimes, monthly tax periods (compute → file → lock), SPT PPN and Bukti Potong CSV exports. Tax lines are derived onto the business document's journal (no parallel tax ledger).
- **AI:** receipt/bill scanning and bank-statement extraction — always extract-to-review, never auto-saved. An AI analyst chat where a deterministic engine computes every number and the AI only narrates.
- **Commerce:** marketplace/store connectors normalize orders and write revenue, fees, and refunds to the ledger separately (not net payouts), with settlements tracked. (Flags currently off in production.)
- **Reporting & export:** dashboard KPIs; report packs with PDF/CSV export; and an **accounting export package** — Income Statement, Balance Sheet, Cash Flow, Trial Balance, and General Ledger as CSVs, each stamped with its period, basis, and all three tie-out results.

**Known gaps (so sessions don't rediscover them):**

- **Posting authority is client-side.** Journals are written by the browser; Firestore rules verify that a journal's *totals* balance but cannot sum its lines. The compensating control is `scripts/reconcile-ledger-balances.js`, which recomputes every balance from the journal lines. **This is the most likely sign-off blocker — Session 4 Q7 probes it directly.**
- No inventory. COGS exists as an account and fills only when a category/account is mapped to it; there is no periodic or perpetual costing.
- No fixed-asset register or depreciation; no payroll (import is planned, not built); no loan amortization.
- Deferred revenue exists as an account, but there are no amortization schedules and no recurring or auto-reversing journal entries.
- Bank reconciliation matches one-to-one. Many-to-one (a payout covering several invoices), gateway/e-wallet settlement, and learned matching rules are not built.
- Foreign-currency invoice settlements are deliberately excluded from the IDR kernel rather than translated.
- Statutory filing beyond CSV export (Coretax) is blocked on DJP access.

---

## How to Run These Sessions

- **6 sessions, 90 minutes each**, roughly weekly. Sessions 1–3 are about how the expert works (no product on screen until the end). Sessions 4–6 are hands-on with FluxyOS.
- **Record and transcribe.** After each session, fill the findings template (end of this doc) within 24 hours.
- **Ask "walk me through the last time you…"** rather than "how do you usually…" — recency beats generalization.
- **Chase artifacts.** Whenever a spreadsheet, checklist, or template is mentioned: "could you show me / share a redacted copy?" Their Excel files are the product spec.
- **Never defend the product.** When the expert criticizes a design, the follow-up is "what would you need instead?" — not an explanation of why we built it that way.
- No yes/no questions below by design; if one sneaks in live, follow with "…and how does that play out in practice?"

---

## Session 1 — How You Actually Work (Tool Landscape & Division of Labor)

*Goal: the as-is picture — tools, people, time. Validates the "operational layer above accounting software" positioning.*

**Discovery**
1. Walk me through your client portfolio (or employers) — what kinds of businesses, what size, who does what financially inside each?
2. Take one typical SMB client: list every tool and artifact that touches their finances in a month — accounting software, Excel files, WhatsApp threads, email folders, marketplace dashboards, bank portals. What lives where, and why there?
3. Where does data get re-typed from one place into another? Which of those re-typings have caused real errors?
4. What share of your month goes to collecting information versus actually doing accounting with it?
5. When a founder asks you "how is the business doing?", what do you actually assemble to answer, and how long does it take?

**Decision-making**
6. What makes you recommend one accounting software over another to a client? What has made you rip one out?
7. Describe the division of labor between the owner, any internal admin, and you. Which tasks would you *never* trust the owner to do, and which do you wish they'd do themselves?

**Pain points**
8. What's the most tedious recurring task in your month? If it vanished, what would you do with the time?
9. Tell me about the last time a client's books were a disaster when you received them. What specifically was wrong, and what caused it?

**AI opportunity**
10. Where in your work do you already use any automation or AI (even ChatGPT for drafting)? What happened the last time it was wrong?

---

## Session 2 — Transaction Lifecycle & Classification

*Goal: stress-test capture → validation → classification → posting. Feeds the CoA strategy directly.*

**Workflow**
1. Walk me through the life of one purchase — from the moment a client pays a vendor to the moment it's correctly in the books. Every touchpoint, every document.
2. Same for a sale — cash sale, invoiced sale, and a marketplace sale. Where do the three paths differ in effort and error rate?
3. How do documents physically reach you today (WhatsApp photos, email, folders)? What fraction never arrives, and what do you do about the holes?
4. When you classify a transaction, what's your actual mental sequence? What do you look at first — vendor, amount, description, history?

**Decision-making**
5. Show me (or describe) the chart of accounts you'd set up for a new services SMB versus a new commerce SMB. What accounts do you always create day one, and which do you add only when needed? *(Bring the FluxyOS 32-account SAK seed printed; ask them to mark it up — what's missing, what's mislabeled, what would they rename in Indonesian practice. Feeds [CHART_OF_ACCOUNTS_STRATEGY.md](CHART_OF_ACCOUNTS_STRATEGY.md) §C.)*
6. How granular is too granular? Tell me about a client whose category/account structure was so detailed it became useless — and one that was too coarse.
7. When a transaction could plausibly go to two accounts, how do you decide? How do you keep that decision consistent three months later, or across two staff members?

**Validation (of our design)**
8. FluxyOS users pick from six categories and a mapping table converts to GL accounts behind the scenes. Where does that abstraction break for you — which real transactions have no correct home in {Revenue, Marketing, Infrastructure, Operations, SaaS, Others}?
9. Our system posts everything unmatched to "6999 Other Expense." In your experience, what happens to accounts like that over time, and what discipline prevents it?

**Edge cases**
10. Walk me through the messiest transaction types you see: owner pays business expense from a personal account; business pays an owner's personal cost; transfers between own bank accounts; refunds; e-wallet top-ups; foreign-currency payments. How should each hit the books?

**AI**
11. If software suggested the account for every captured document, what evidence displayed next to the suggestion would let you accept it in under two seconds? What would make you stop trusting the suggestions entirely?

---

## Session 3 — Month-End Close, Reconciliation & Statements

*Goal: the complete as-is close, in order, with timings. This session's output becomes the close-checklist spec.*

**Workflow**
1. Walk me through your last month-end close for one client, step by step, in the order you actually did it. For each step: what you check, what tool you're in, how long it takes, what can go wrong. *(Capture as a numbered list live — this artifact is the session's deliverable.)*
2. How do you reconcile a bank account today, concretely? Statement format (BCA/Mandiri/BNI export? PDF?), matching method, what you do with unmatched lines, how you record timing differences versus errors.
3. How do e-wallets (OVO/GoPay) and payment gateways (Midtrans/Xendit) complicate reconciliation? How do you handle a settlement that bundles many orders minus fees?
4. Which adjusting entries do you book every single month (accruals, prepaid amortization, depreciation, payroll summary)? Which do you keep templates for, and where do the templates live?
5. After statements are drafted, what review do you do before releasing them? Which tie-outs do you verify by hand (net income → equity movement, cash → bank rec, A/R subledger → GL)?

**Decision-making**
6. What has to be true before you'd tell a client "this month is closed"? What would make you reopen a closed month, and how do you record that you did?
7. When P&L and cash tell opposite stories, how do you explain it to the owner? What visual or format finally makes it click for them?

**Pain points**
8. What's the longest a close has dragged on, and what caused it? What single change would compress your close the most?

**Edge cases**
9. How do you handle a document that surfaces two months late — an October invoice appearing in December, with October filed and reported?
10. Year-end versus month-end: what's different in Indonesia (SPT Tahunan prep, fiscal reconciliation, audit interface)?

**AI**
11. Imagine a "close assistant" that continuously lists what's blocking the close (unreconciled lines, missing documents, unposted recurring entries) and drafts the standard adjustments for review. Which parts would you actually use, and which would you never let it touch?

---

## Session 4 — Kernel Audit (Hands-On With FluxyOS)

*Goal: the expert uses the real product and marks every gap between what we post and what they'd sign. Prepare a seeded demo workspace with a month of realistic data beforehand.*

**Exercises — think aloud throughout:**
1. **Posting-rule review.** Enter a cash expense, a cash sale, a bill and its payment, an invoice (finalize, then mark paid). After each, open the generated journal in the Accounting Center. Ask: *Is this the entry you would have made? What's wrong or missing — accounts, timing, memo quality, anything?*
2. **Trial balance & drill-down.** Open the trial balance. Pick any balance and try to trace it to journals to source documents. *Where does the chain break for you? What would an auditor ask for that you can't produce from here?*
3. **Manual journal.** Book a real month-end adjustment you'd typically make (e.g., an accrual). *What's awkward? What's missing from the editor (recurring, auto-reverse, attachments)?*
4. **Period close.** Open the Close tab and read our checklist *before* pressing anything. *Does this match what you would verify? What is on your list that is missing from ours — and what on ours would you not bother with?* Then close the month. *Does the closing entry do what you expect? Reaction to edit-blocking on closed periods, and to reopening reversing the closing entry?*
5. **Statement review.** Open Income Statement, Balance Sheet, and Cash Flow. *Would you hand these to a bank as they are? Mark every line you would change — grouping, ordering, labels, missing subtotals, basis disclosure.* Then press **Export package** and read the five CSVs as if they had arrived from a client. *Is this the hand-off you want? What is missing from it?*
5b. **Aging & reconciliation.** Open A/R and A/P aging, then run a bank statement import. *Do the buckets and the matching behave as you expect? At what point would you stop trusting a suggested match?*
6. **The sign-off question** (the session's core deliverable): *Suppose this workspace's owner asked you to formally sign off on this month. List everything — in priority order — that prevents you from signing today.*

**Validation questions woven in:**
7. Journals here are generated client-side and rules check that debits equal credits in total; a nightly-style script verifies balances tie. As an accountant, what integrity evidence do you need from a system — and at what business size does "the server must be the only thing that can post" become non-negotiable?
8. Users see categories, not debits and credits. For the businesses you serve, who actually needs to see the double-entry layer, and when?

---

## Session 5 — Tax & Compliance Stress Test

*Goal: validate the Tax Center against real practice; surface PPN/PPh edge cases before customers do.*

1. Walk me through preparing a monthly SPT Masa PPN for a PKP client, end to end — from books to e-Faktur/Coretax to filing. Where do books and e-Faktur disagree, and how do you reconcile them?
2. How has Coretax changed your workflow this year, concretely? What broke, what improved, what do you now do manually that you didn't before?
3. **Hands-on:** review the FluxyOS Tax Center on the demo workspace — tax profile, computed PPN period, the tax lines on a sales journal, the SPT export. *What would DJP or a tax reviewer flag? What's missing before you'd file from this?*
4. Edge cases, one at a time — how should the books and the tax records handle: a credit note against a filed-period invoice; a customer's bukti potong arriving 3 months late; PPN on a USD invoice *(currently FluxyOS excludes FX invoices from tax entirely — is that survivable, for whom, for how long?)*; crossing the Rp4,8 miliar UMKM threshold mid-year; input VAT on mixed business/personal purchases.
5. For SAK: which of your SMB clients report under SAK EMKM versus SAK EP, who actually consumes those statements, and what presentation differences matter? What does a bank's credit analyst actually look at?
6. What tax mistakes create real penalties for SMBs most often, and which of them could software have prevented at entry time rather than at filing time?

---

## Session 6 — AI Boundaries, Trust & Synthesis

*Goal: place every workflow on the autonomy ladder; define the trust checklist; converge on priorities.*

**The autonomy ladder exercise.** For each workflow below, place it on: (a) *AI must not touch*, (b) *AI suggests, I confirm each*, (c) *AI acts, I review a digest*, (d) *AI acts silently*. Then: *what evidence would move it one level up?*
- Extracting fields from a receipt
- Choosing the account/category for a captured document
- Matching bank-statement lines to ledger entries
- Creating recurring monthly journals (rent accrual, depreciation)
- Drafting the P&L commentary for the owner
- Computing PPN for the month
- Filing the SPT

**Trust**
2. Recall a time software silently did something wrong with a client's books. What was the blast radius, and what did it change about how you use automation?
3. What would a software vendor have to show you — features, guarantees, artifacts — for you to tell clients "I trust this system's books"? *(Capture verbatim; this becomes the trust checklist in the strategy doc.)*
4. QuickBooks-style auto-categorization is famous for confidently wrong books. What did they get wrong, mechanically, and what's the version of it you'd actually accept?

**Synthesis**
5. Of everything we've discussed across six sessions, rank the top five things FluxyOS should build or fix first, from the perspective of: (a) you as the accountant, (b) the business owner, (c) the tax office. Where do the three rankings conflict?
6. If FluxyOS became your primary tool for one client next month, what would break in your workflow on day one?
7. What did we not ask about that we should have?

---

## Findings Capture Template (fill within 24h per session)

```
Session #: ___   Date: ___   Recording link: ___

TOP 5 INSIGHTS (one sentence each, with verbatim quote if strong)
1.
...

ASSUMPTIONS TOUCHED (cross-reference §1.3 of ACCOUNTING_DISCOVERY_STRATEGY.md)
- Assumption #: Confirmed / Amended / Rejected — evidence:

SIGN-OFF BLOCKERS SURFACED (things preventing accountant sign-off)
- Blocker — severity (blocks-signoff / degrades-trust / cosmetic) — affected area

ARTIFACTS COLLECTED (spreadsheets, checklists, templates — where stored)
-

NEW EDGE CASES FOR THE BACKLOG
-

AUTONOMY LADDER UPDATES (workflow → level → evidence needed to move up)
-

QUESTIONS FOR NEXT SESSION
-
```

## After Session 6: Synthesis Checklist

- [ ] Every §1.3 assumption in the strategy doc marked Confirmed / Amended / Rejected with evidence.
- [ ] The as-is close workflow written up for at least two archetypes (services, commerce) with timings.
- [ ] Sign-off blocker list consolidated and ranked; Roadmap Phase 1 re-ordered against it.
- [ ] Trust checklist written from Session 6 Q3 verbatims.
- [ ] Autonomy ladder table finalized per workflow.
- [ ] CoA markup from Session 2 merged into [CHART_OF_ACCOUNTS_STRATEGY.md](CHART_OF_ACCOUNTS_STRATEGY.md) §C.
- [ ] Strategy doc §8 roadmap updated; changes summarized for the founding team.
