# Multi-Market Architecture

How FluxyOS serves a business outside Indonesia: its currency, its number and
date conventions, its tax vocabulary, its chart of accounts, and what FluxyOS
charges it.

Written after the Philippines build (2026-08-21 → 08-23). Read this before
touching money, locale, tax labels, or billing. `PROJECT_BACKGROUND.md` §4 holds
the workspace-scoping invariant and the canonical `base_currency` block; this
document covers everything built on top of it.

**The organising idea:** *multi-market single-currency*, not multi-currency. A
peso workspace where every transaction is in pesos needs **zero FX** — `fx_rate`
stays 1 and nothing converts. Almost all the difficulty in this area comes from
code that assumed Indonesia, not from currency conversion.

---

## 1. Three currency roles — do not conflate them

| Role | Where it lives | Mutable? |
|---|---|---|
| **Base / functional** | `workspaces/{id}.base_currency` | **No** — set once at onboarding, enforced in `firestore.rules` |
| **Transaction / face** | per document (`invoices`, `bills`) | Yes, per document |
| **Display** | not built | — |

Base currency is **canonical on the workspace, never on `settings/`** — that is
user-scoped, so two members would disagree about the company's own currency.
`settings/finance.currency` is a read-only mirror.

Absent means IDR. Fail-safe on read beats a backfill.

Immutability is a **set-once clause in the rules**, not a disabled input. A
workspace seeded with the wrong currency is not repairable through the app at
all — only the Admin SDK can fix it (`scripts/seed-qa-account.js` does this, and
reads the value back from the server afterwards to prove it landed).

### Storage is integer MINOR units

`IDR minorPerUnit: 1` — rupiah **are** minor units. `PHP/SGD/MYR/USD: 100`.

Rendering minor units without the seam shows **100× the money** on any
2-decimal currency. This is the single most common way to get it wrong.

---

## 2. The seam: `assets/js/money-format.js`

Every money render, parse, number, and date goes through it. It is a UMD module,
so Node checks can `require()` it directly.

| Function | Use for |
|---|---|
| `formatBase(minor)` | display an amount in the workspace currency |
| `toMinor(input, ccy)` | parse typed text → integer minor units |
| `fromMinor(minor, ccy)` | minor units → whole units |
| `seedMoneyInput(minor)` | **fill** an input from a stored value |
| `liveMoneyInput(typed)` | **reformat while typing** |
| `moneyInputMode()` | `numeric` vs `decimal` keypad |
| `baseLocale()` / `baseNumber()` / `baseDateTime()` | counts, quantities, timestamps |
| `baseCurrencyName()` / `baseCurrencyUnit()` | the currency's name in prose |
| `paintSymbols()` / `paintCurrencyNames()` / `paintCountryExamples()` | static markup, repainted at boot |

### 2a. Money inputs have TWO jobs — this is the recurring bug

Three shapes of the same mistake shipped, and **every one was silent** — the
field accepted the entry and stored a wrong number with no error:

1. **Seeding by grouping the MINOR value.** Correct only for a 0-decimal
   currency. On PHP the field shrank 100× per keystroke, so a million could
   never be typed.
2. **Reformatting typed text through `toMinor()`.** The round trip discards an
   in-progress decimal, so `1250.75` became `125,075` — a 100×
   **overstatement**, silently accepted.
3. **Stripping non-digits before formatting.** The decimal point becomes
   untypeable on a 2-decimal currency.

**`window.FluxyAmountInput` (shared-dashboard.js) is the one way to wire an
editable amount**: `.seed(el, minor)` to fill, `.attach(el)` / `.format(el)`
while typing. It also preserves caret position, counted in digits. Never
hand-roll; never `\D`-strip.

### 2d. Banknotes are a currency fact, so they live in the seam

The till's quick-cash buttons ("the customer handed me Rp50.000") need to know
what notes exist. That is a property of the currency, not of the POS, so
`CURRENCIES[x].notes` carries the circulating banknotes in major units and
`cashSuggestions(dueMinor, currency, count)` derives the offers.

The suggestions are computed from the bill's own magnitude on a 1-2-5 ladder,
never from a fixed list — a hardcoded `[25000, 50000, 100000]` is right in
Jakarta, absurd in Singapore, and **invisible on an Indonesian account**, which
is the failure mode this whole document exists for. The same input shape
produces Rp25.000 / Rp50.000 / Rp100.000 on a Rp22.500 bill and $25 / $50 / $100
on a $22.50 one, because the shapes are a property of how people carry money
rather than of a country.

A bill already on a round figure yields FEWER suggestions, deliberately: for a
$5.00 bill the plausible tenders are $10 and $20, and manufacturing a third chip
would offer $6 — an amount nobody hands over.

### 2b. Locale is not language

`toLocaleString('id-ID')` was hardcoded in **73 places across 22 files**, so a
Manila workspace read `1.200 units` and `22 Agu`. Counts, quantities and dates
follow `baseLocale()`.

Deliberately exempt and allowlisted in the guard: the marketing site, the `/id/`
mirror, the investor deck, and FluxyOS's own billing internals.

### 2c. A hardcoded currency NAME is a hardcoded country

"Rupiah amount paid", "of every rupiah of revenue" — these survive a symbol
sweep. Use `baseCurrencyName()` / `baseCurrencyUnit()`, or a
`<span data-money-name>` that `paintCurrencyNames()` repaints at boot behind the
boot mask.

Currency **pickers** legitimately name IDR and are exempt.

---

## 3. Per-market chart of accounts and tax vocabulary

Only 6 of 38 seeded accounts are Indonesian (the PPN/PPh accounts: 1130, 1140,
1150, 2100, 2110, 2200). The 12 `sak_category` values are jurisdiction-neutral
IFRS. `chartForCountry(country)` in `accounting-engine.js` keeps the same 38
codes and varies only the tax account **names**.

Indonesia-only features are gated by `allowCountries` in `feature-access.js`:

```js
tax_center:      { allowCountries: ['ID'] },
transaction_tax: { allowCountries: ['ID'] },
```

Non-Indonesian workspaces see Tax Center as "coming soon" in the sidebar.

`tax-engine.js` is **table-driven** (`TAX_CODES`, `TAX_RATES`, `TAX_ROUNDING`;
`TAX_DIRECTIONS` already includes `withheld_by_us` / `withheld_by_other`), so
adding another jurisdiction's calculation is a config addition, not a rewrite.
The expensive part of a new tax regime is the **filing surface** — forms,
certificates, and accredited receipt numbering — not the arithmetic.

---

## 4. What FluxyOS charges (its own billing)

Distinct from the customer's ledger. Superseded the old "billing is always IDR"
rule on 2026-08-23.

**Prices are PINNED per currency, never converted at runtime.** A converted
price moves with the daily FX fix, cannot go on an invoice or a bank-transfer
instruction, and the customer cannot check it.

`PLAN_PRICES` in `billing-config.js` is the book, in integer minor units. Tax
follows the billing currency — Indonesia PPN 11%, Philippines VAT 12% on digital
services — and the **label** is currency-driven, so a Manila client never reads
"PPN".

Payment rails are per currency: **QRIS is Indonesian and a PH customer cannot
scan it.** `PAYMENT_INSTRUCTIONS` keys the method list by currency.

### The book lives in two files that cannot import each other

`billing-config.js` and `firestore.rules`. Drift is silent and asymmetric:

- rules keep a **lower** price → every checkout is rejected with a bare
  `permission-denied` that names no price
- rules keep a **higher** price → the customer is charged more than the page
  quoted

`npm run check:price-book` is **unconditional** in the BE lane, because a rules
deploy alone can desync them without either file appearing in a diff.

The rules encode the book as a **keyed map** (`'PHP|growth|monthly': 2449000`),
not an OR-chain. A second currency would have doubled a 6-clause chain, and the
ruleset is at ~97% of its expression-complexity ceiling.

**The danger the emulator cases actually guard** is not a rejected payment but
an **accepted one at the wrong scale**: `2449000` is a valid growth-monthly
subtotal in *both* currencies, ~8.5× apart in real value. The rules bind amount
to currency in both directions.

---

## 5. Boot ordering

Money cannot render before the workspace resolves, or every formatter uses the
IDR default.

- `workspace-service.js` owns resolution; `whenWorkspaceReady()` is the single
  thing to await.
- Currency only ever moves **forward** for a given uid — it never resets to the
  default mid-session. An early implementation reset the seam at the start of
  every run, so a second resolver discarded the first one's answer.
- Decision reads use `getDocFromServer()`. `getDoc()` serves from IndexedDB when
  the realtime channel is degraded, which pinned some browsers to a
  pre-approval, pre-currency copy **permanently**.
- The `.fluxy-booting` mask covers first paint so static IDR defaults never
  flash.

**A page that renders money must load the seam AND resolve the workspace.**
Checkout resolved the workspace but its re-render was aborted by an unrelated
`ReferenceError` inside a shared `try`, and the `catch` swallowed it — so a peso
workspace was quoted the rupiah ladder with QA green. Keep resolution and
re-render in separate `try` blocks.

---

## 6. Guards, and the bug each one exists for

`npm run check:money-seam` — 16 checks. Every one was verified to **fail** when
its bug is reintroduced; a guard that cannot fail is worse than none.

| Guard | Catches |
|---|---|
| `registry` / `byte-identity` | IDR output drifting from the pre-seam formatter |
| `no-literals` | a finance surface formatting money without the seam |
| `no-idr-tests` | `currency !== 'IDR'` — inverts outside Indonesia |
| `no-hardcoded-ccy-arg` | `money(x, 'IDR')` on a workspace surface |
| `no-static-money` | `>Rp0<` painted in markup before JS runs |
| `seam-loaded` | a page whose module graph reaches the seam without loading it |
| `input-round-trip` | typed decimals not surviving to storage (§2a) |
| `no-id-locale` | hardcoded Indonesian number/date conventions (§2b) |
| `money-input-seam` | an amount field seeded from `toLocaleString` |
| `no-currency-name` | "Rupiah" in copy every workspace reads (§2c) |
| `check:price-book` | client and rules prices disagreeing (§4) |

### The gap that remains

A **call to a function that no longer exists**, swallowed by a `catch`, is
invisible to all of the above: `node --check` sees valid syntax, the console
sweep sees no error because it was caught, and the static guards read source
rather than rendered output. Closing it needs a real JS parser (`acorn`) doing
scope analysis. Not built.

---

## 7. QA accounts per market

The original QA account is Indonesian, which makes a class of bug **invisible by
construction**: rupiah is both the correct answer and the fallback, so a page
that fails to resolve the workspace looks identical to one that succeeds.

`scripts/seed-qa-account.js --country PH` provisions an account. It needs the
Admin SDK to clear three gates the app will not let a client script clear — KYC
review (no auto-approve, by design), onboarding completion, and the immutable
`base_currency`. It refuses any address that is not `qa+<cc>@fluxyos.com`.

`tests/workspace-currency.spec.js` runs in the `chromium-ph` project and asserts
what only a non-IDR session can see. **One extra account, one small spec** —
`workers: 1`, so a second full sweep would cost minutes per push, and what the
second account uniquely buys is the currency assertion, not more page coverage.

Everything skips cleanly without the fixture. Full runbook:
`docs/QA_TEST_ACCOUNT.md`.

---

## 8. Deliberately NOT built

- **Display currency.** No presentation-currency translation, which would need a
  CTA in equity under IAS 21 / PSAK 10.
- **Retiring `accounting_status: 'excluded'`.** Foreign-currency invoices and
  bills post **no journal**. Confirmed acceptable 2026-08-23: the PH partner's
  customers are **domestic SMBs**, so foreign currency is incidental. This would
  have been wrong for a BPO, where USD is core revenue.
- **Bahasa money `PATTERNS`** in `dashboard-i18n.js` are `Rp[\d.]+` regexes, so
  money-bearing Indonesian strings will not match a non-IDR symbol. Rewriting
  ~15 regexes risks breaking Indonesian for current customers.
- **SG / MY price books.** Both fall back to IDR billing. No customers yet.
- **Renaming `amount_paid_idr`** and the `formatRupiah` / `signedRupiah`
  identifiers. They route through the seam and are only cosmetically misnamed;
  renaming across ten files is churn with real breakage risk.

---

## 9. Open

1. **`PAYMENT_INSTRUCTIONS.PHP` bank fields are empty.** Until `bankName` and
   `accountNumber` are filled, checkout shows a "contact us" state and a PH
   customer **cannot self-serve pay**.
2. **BIR registration.** The 12% VAT line assumes FluxyOS is registered as a
   non-resident digital service provider under RA 11967.
3. **BIR in the Tax Center.** The partner expects it (confirmed 2026-08-23).
   Scope undecided: *calculate and report* (weeks — the engine is already shaped
   for it) versus *file with BIR* (months, plus accreditation).
4. **`firestore.rules` at ~97% of its complexity ceiling.** A trim is overdue.
   When it is hit, Firestore batch writes are atomic — a missing rules block
   fails *every* posting, not just the new feature.
