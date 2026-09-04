---
status: current
owns: [fixed_assets]
updated: 2026-09-04
---

# Fixed assets & depreciation

> Workspace-scoping rules for this collection live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

The register depreciation runs over. Asked for in the Flow-tab review as
*"Depreciation 1 click — refer to Accurate"*.

The accounts existed a week before this did: `1500`/`1510`/`1520` `fixed_asset`,
`1590` `accumulated_depreciation` and `6470` were seeded on 2026-08-29, and were
inert until something generated entries for them. **A register is what makes
one-click depreciation mean anything** — Xero and Accurate both run it over one.

## 1. `fixed_assets/{assetId}`

| Field | Type | Notes |
|---|---|---|
| `name` | string 1–120 | |
| `asset_account_code` | string | Where the asset sits. `fixed_asset` accounts only — **never `1590`**, which is the contra account the charge credits |
| `cost` | integer | Raw minor units, like every amount |
| `salvage_value` | integer | Residual. `0` default; **equal to cost is legal** and means "on the balance sheet, out of the P&L" |
| `useful_life_months` | integer 1–600 | |
| `in_service_date` | `YYYY-MM-DD` | The schedule starts in this month |
| `method` | enum | `straight_line`. One method, see §3 |
| `status` | enum | `active` \| `disposed` \| `fully_depreciated`. Soft only |
| `accumulated_depreciation` | integer | What has **posted**, never what is owed |
| `last_depreciated_period` | `YYYY-MM` \| null | Same — the ledger's record, not the schedule's |
| `dimension_id` | string \| null | Outlet the asset belongs to |

**`accumulated_depreciation` and `last_depreciated_period` record what reached
the ledger, and the schedule records what is owed. The gap between them is the
whole reason both exist** — deriving either from the schedule would make a
failed post invisible and double-charge on the next run.

## 2. The schedule sums exactly, by construction

`depreciation-engine.js` is pure. Each period's charge is the **difference
between two cumulative roundings**, not a rounded monthly figure:

```
amount(n) = round(base × n / life) − round(base × (n−1) / life)
```

Rounding a monthly figure and repeating it leaves a remainder someone has to
dump on the final period — and if anything changes mid-life, that remainder is
silently wrong. This way the schedule sums to the depreciable base **exactly**,
every period is within one minor unit of the true rate, and there is no special
case at the end. Rp1.000.000 over 7 months distributes its remainder in the
middle, not at the end; Rp1 over 12 months gives eleven zeros and a one rather
than twelve zeros and an asset that never retires.

## 3. Straight line only

Declining balance and units-of-production are not here. **A method is not a
formula, it is a promise about every future period** — switching one after
posting restates depreciation already taken, and there is no UI for that
conversation. Cost, life and in-service date are locked once anything has
posted; `saveFixedAsset` refuses the edit and says to dispose and re-register.

## 4. Posting

```
Dr 6470 Depreciation & Amortisation   one line per asset, named
Cr 1590 Accumulated Depreciation      one pooled line
```

`buildDepreciationJournal` is a dedicated builder, not a posting rule, for the
same reason `buildOpeningJournal` and `buildClosingJournal` are: this is a
period-end entry somebody runs, not something a document triggers on create.

**One journal PER PERIOD, never a catch-up lump.** Six months of arrears posted
as one entry dated today puts half a year of cost into one month's P&L and
breaks every month-on-month comparison after it. `runDepreciation` loops the
periods, each in its own batch — two journals in one batch would write the same
`ledger_balances` doc twice, which Firestore forbids. A mid-run failure leaves
earlier periods posted, which is correct: they are real and independently valid.

Each asset is stamped in the **same batch** as the journal that moved it. A
stamp without its journal double-charges next run; a journal without its stamp
never stops.

**The credit is one pooled line.** `1590` is a contra-asset with no per-asset
balance on the balance sheet, so splitting it would imply one that does not
exist. The debit side is per-asset because *"depreciation was Rp4,2 juta"* is
not an answer anybody can check.

## 5. Run through the month just **ended**

Not the current month. Running mid-month would post a full month's charge for a
month that is not over. A closed period refuses in `runDepreciation` rather than
surfacing as an opaque permission error from the journals rule.

## 6. Never deleted

`allow delete: if false`. The asset is referenced by every depreciation journal
it generated, and journals are immutable — deleting one would leave `1590`
carrying a balance nothing explains. **Disposal is a status.**

Guards: `tests/depreciation-engine.spec.js` (schedule arithmetic, 8 cases
including costs smaller than their life), `tests/stock-rules-emulator-test.mjs`
(rules), `tests/fixed-assets-live-smoke.spec.js` (rules are DEPLOYED).

## 7. Not built

**No disposal journal.** Disposing an asset flips its status; it does not yet
write off the remaining book value against a gain/loss on disposal. An asset
disposed mid-life therefore stops depreciating but leaves its net book value on
the balance sheet. Deliberate — the posting rule needs a gain/loss account and a
proceeds figure, which is its own change.

**Not wired into the close checklist.** The register is under Setup, where
master data lives; the Close checklist does not yet ask whether depreciation has
been run for the period.
