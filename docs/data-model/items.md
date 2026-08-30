---
status: current
owns: [items]
updated: 2026-08-16
source: docs/INVENTORY_DEMAND_VALIDATION.md §7
---

# Items — the inventory master

> Workspace-scoping rules for this collection live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

Ingredients, finished goods, and menu items. Step 2 of the F&B chain
(`INVENTORY_DEMAND_VALIDATION.md` §7): ~15 blocked F&B prospects need ingredient
stock and usage, recipe/menu COGS, waste, and stock per outlet.

**Status:** steps 2–5 are live — the collection, the DAL, unit conversion,
recipes, stock movements and costing. `inventory.html` is the writing surface:
items are created and edited there, and it shows each item's on-hand quantity
and value alongside the master. The recipe editor is still v2, so the drawer
creates `stock` items and preserves — but does not edit — a `composite`'s
`components`.

## 1. `items/{itemId}`

| Field | Type | Notes |
|---|---|---|
| `name` | string 1–120 | Display name |
| `name_key` | string ≤60 | Deterministic slug, the dedupe key |
| `type` | enum | `stock` \| `composite`. **Composite = a recipe/menu item.** Present from the first write so bills of material attach later without a schema change |
| `base_unit` | string ≤16 | The unit every stored quantity is an integer count of. **Immutable after create** |
| `units` | array | Alternate units: `{ code, factor, role }`. `factor` is a **positive integer** multiple of `base_unit`. `role` ∈ `purchase` \| `sales` \| `stock` \| `null` |
| `sku` | string ≤60 \| null | The join to `commerce_orders.items[].sku`. Enforced unique at create |
| `default_cogs_account_code` | string | Where this item's cost lands when it posts. Defaults to `5100` |
| `components` | array | **Recipe/BOM.** `{ item_id, quantity, yield_percent }` — what ONE BATCH consumes, each `quantity` an integer in that COMPONENT's own base unit. Empty on a stock item. Authored in the item drawer's recipe editor (shipped 2026-08-21); `saveItem` normalizes via `normalizeComponents` and validates the candidate graph with `explodeRecipe`, so a cycle or a missing component is refused on write |
| `batch_size` | integer ≥1 | How much output one batch produces, in this item's own base unit. Default `1` |
| `storage_location` | string ≤60 \| null | Where it physically sits ("Dry store — shelf A"). **Sorts the count sheet**, because a count is done by walking the shelf; an alphabetical sheet sends the counter back and forth across the stockroom |
| `reorder_point` | integer ≥1 \| null | Warn when on-hand drops to this, in BASE units. **`null` means no threshold, and `0` is not a threshold either** — low stock requires `qty > 0 && qty <= point`, which `0` can never satisfy, and stock reaching zero is already reported as Out of stock. Read it through `reorderPointOf(item)` and write it through `normalizeReorderPoint(value)` (`inventory-engine.js`), never with an inline `Number.isInteger` check — see §2a. Never inferred from usage history: with days of data that produces a confident-looking number from noise |
| `notes` | string ≤500 \| null | |
| `status` | enum | `active` \| `archived`. Soft archive only |
| `created_at` / `updated_at` | Timestamp | Server-set |
| `barcode` | string ≤32 \| null | From the import template. Stored for lookup and round-trip; **nothing scans it yet** |
| `categories` | string[] ≤8 | Product categories, semicolon-separated in the file. The first also seeds `pos_category` |
| `track_stock` | boolean | `false` = a service. Never held as stock: `createGoodsReceipt` refuses it, and the importer refuses an opening balance on one. Absent reads as `true` |
| `tracking_type` | enum \| null | `qty` \| `batch` \| `serial`. **Only `qty` is enforced** — see §7 |
| `is_sold` / `is_purchased` | boolean | The template's "I Sell / I Buy This Item". `is_sold` also sets `pos_visible` on import |
| `purchase_price` | integer minor units \| null | Reference buy price. **Not the cost the ledger uses** — that stays the weighted average derived from `stock_movements`, so this can never reach a journal |
| `default_inventory_account_code` | string ≤12 \| null | **Recorded, not acted on** (§7) |
| `default_sales_account_code` | string ≤12 \| null | **Recorded, not acted on** (§7) |
| `default_sales_tax_name` / `default_purchase_tax_name` | string ≤40 \| null | **Recorded, not acted on** (§7) |
| `source_account_codes` | map \| null | The client's own codes, kept **only** where we could not resolve them against this chart |
| `custom_fields` | map ≤20 \| null | `custom_field_*` columns. Flat strings, values ≤200 chars |
| `import_batch_id` | string \| null | Set by a bulk import. Ties the items, their movements and their opening journal to one event |

## 2a. `reorder_point`: absence is not zero

`Number(null)` is `0` and `Number.isInteger(0)` is `true`. `saveItem` normalized
through that pair, so **every item saved with the field left blank was stored as
`0`** — 51 of 172 in the QA workspace before this was found on 2026-08-21.

Nothing warned, because `0` is unreachable as a threshold. What it did instead
was split the catalogue in two, differently, on each screen that counted it:

| Screen | Predicate | Items "with a reorder point" |
|---|---|---|
| Overview low-stock cell | `Number.isInteger(p)` | 78 |
| Restock "not assessed" | `p > 0` | 27 |

So the Overview reported *"26 of 78 with a reorder point"* — implying 52 healthy
items — when only 27 could be assessed at all and 26 of those were low. 33%
versus 96%, from the same data on adjacent tabs.

Both directions now go through one definition in `inventory-engine.js`:

- **`reorderPointOf(item)`** — returns the integer or `null`. Every read.
- **`normalizeReorderPoint(value)`** — `null`/`undefined`/`''`/`0`/negative/
  fractional all become `null`. Every write.

A typed `0` is refused in the item drawer with an explanation rather than
silently normalized, because substituting something for what a person entered is
the same silent failure in the other direction.

The 51 historical zeros are left in place: they read as "not set" through
`reorderPointOf`, which is what they always meant.

## 2. The quantity rule

> **Every quantity is an INTEGER in the item's base unit** — exactly as every
> amount is a raw integer Rupiah.

Buy flour in kilos, hold it in grams, sell it in 150 g portions: only grams are
ever stored. `2 kg → 2000`. `3 porsi → 450`.

**Conversion factors must be positive integers.** This is a deliberate
limitation and the reason is costing, not tidiness: cost flows through
`quantity × unit_cost` into a journal amount, and a float quantity puts binary
rounding error directly into the ledger. An item whose real ratio is fractional
(1 cup = 236.588 ml) is modelled by choosing a **finer base unit**, not by
storing a fraction.

Choose the base unit as the smallest unit the business actually counts in.

Three consequences worth knowing:

1. **`toBase` rejects rather than rounds.** `1.5 g` on a gram-based item throws
   `INV_005`. Silently rounding to `2 g` would be invisible and would land in a
   journal amount. `0.5 porsi` is fine — that is 75 g, a whole number.
2. **`fromBase` is a DISPLAY conversion and may be fractional** (500 g is 0.5
   kg). Nothing derived from it may be persisted as a quantity.
3. **`base_unit` is immutable.** Changing it would silently reinterpret every
   quantity already recorded against the item. `saveItem` refuses.

The base unit is implicit at factor 1, so `units` never has to restate it — and
a single-unit item needs no `units` at all. Restating it at factor 1 is dropped;
*contradicting* it (`1 g = 5 g`) throws `INV_004`, because that would corrupt
every conversion.

## 3. Recipes (bill of materials)

A `composite` item is a recipe — a menu item, a sub-preparation, a sauce.
`components` say what **one batch** consumes; `batch_size` says how much output
that batch produces in the composite's own base unit. A dish making 10 portions
from 1500 g of rice is `batch_size: 10` with a component of `1500`.

**Components are embedded**, not a subcollection. You always want the whole
recipe at once and always change it as a unit, so one read and one atomic write
beat N. Same call the commerce connector made for order lines (`models.js`,
Phase 0 deviation #5); invoices went the other way because their lines are
separately queryable, which recipe lines are not.

### Yield is recorded, not computed

`yield_percent` documents that 1000 g of raw chicken gives 800 g usable.
**`quantity` is always the GROSS amount that leaves stock.** Deriving gross from
net would put a division — and therefore a rounding — into a number that flows
into a journal. Stock relief is gross consumption; yield explains how the recipe
author arrived at it.

### Explosion

`explodeRecipe(itemsById, itemId, quantityBase)` resolves a composite to the
**stock** items it consumes, recursing through nested composites.

Two behaviours that matter:

1. **Shared ingredients merge.** Rice reached directly (150 g) and through a
   sauce (5 g) is one entry of 155 g, not two. Without merging, a nested recipe
   costs wrong.
2. **Quantities may be fractional.** Three portions from a 1000 g batch makes one
   portion 333.33 g. That is deliberate — explosion returns a *requirement*, not
   a stored quantity. **Rounding happens once, when a stock movement is
   recorded**, so per-component rounding cannot accumulate across a recipe.
   `recipeCost` likewise rounds once, at the end.

An ingredient with no unit cost is returned in `missingCost`, never silently
treated as free.

### Cycles

A recipe containing itself — directly, or through a sub-preparation — recurses
forever and is always a data error. `explodeRecipe` throws `INV_008` with the
path (`nasgor → sauce → nasgor`), and `MAX_RECIPE_DEPTH` (12) is the backstop.

`saveItem` validates against the **candidate** graph — the item as it would be
*after* the write — because a cycle is only ever created by the write itself.
Checking the pre-write graph would let it through.

## 4. Engine and errors

Validation and conversion are pure, in `assets/js/inventory-engine.js`
(`toBase`, `fromBase`, `convert`, `itemUnits`, `resolveUnit`,
`validateItemDraft`). No Firestore, no DOM — mirroring `accounting-engine.js`.
It is the intended home for weighted-average costing and recipe explosion, so
the arithmetic behind COGS stays in one testable place.

Structured `INV_*` codes on the `GL_*` contract: callers discriminate on
`err.code`, never on message prose, so translating a string cannot change
control flow.

| Code | Meaning |
|---|---|
| `INV_001` | Unknown unit for this item |
| `INV_002` | Conversion factor is not a positive integer |
| `INV_003` | `base_unit` missing |
| `INV_004` | Duplicate unit, or base unit contradicted |
| `INV_005` | Quantity is not a whole number of base units |
| `INV_006` | Invalid item type |
| `INV_007` | Invalid name |
| `INV_008` | Recipe cycle |
| `INV_009` | Component item missing, or listed twice |
| `INV_010` | Components on a stock item |
| `INV_011` | Invalid `batch_size` |
| `INV_012` | Recipe nested deeper than `MAX_RECIPE_DEPTH` |

Guard: `tests/inventory-engine.spec.js`.

## 5. Rules

Read = all member roles; create/update = owner/admin/finance/accountant;
`delete: if false` — an item will shortly be referenced by stock movements and
journal lines, both immutable. Six inline field checks, no helper calls: `units[]`
and factor validation stay in the engine because rules cannot iterate an array
cheaply and the evaluation budget is real.

`sku` uniqueness and `name_key` dedupe are enforced in the DAL, not in rules —
Firestore has no unique constraint, so this is a convention the writing surface
upholds. A duplicate SKU would make the commerce join ambiguous and relieve the
wrong item's cost on a marketplace sale.

**`components` and `batch_size` needed no rules change** — the `items` validator
uses explicit field checks with no `hasOnly`, so new fields pass. Array contents
are the engine's job either way; rules cannot iterate cheaply.

Emulator coverage: `tests/items-rules-emulator-test.mjs`. Deployed-rules
coverage: `tests/items-live-smoke.spec.js`.

## 6. Naming collision worth knowing

`items` means two different things in this repo: this top-level inventory master
(`workspaces/{ws}/items`), and invoice line items (`workspaces/{ws}/invoices/{id}/items`).
They are disambiguated by path and by nesting depth in `firestore.rules`, and the
structure-drift rules-coverage check only counts top-level matches — but a reader
grepping for `items` will hit both.

## 7. Bulk import — the reference template

`inventory.html` → **New item** → the **Import a list** tab. Engine
`assets/js/inventory-import.js` (pure), surface
`assets/js/inventory-bulk-import.js` (`mountInventoryImport`), writer
`db-service.importInventoryItems`.

### 7-0. It is a TAB, not a second button

The importer shipped first as its own toolbar button opening its own 720px
drawer with a three-step stepper. That was a second answer to a question the
product had already answered: the Add Transaction drawer separates single entry
from CSV bulk with a segmented control, one drawer, one shared footer button
(`PROJECT_BACKGROUND.md` §5). Whoever learned the Ledger never found this.

It now follows that contract exactly, which cost the stepper and 240px of width:

- **One drawer at 480px.** A segmented control on top of a stepper is two levels
  of navigation in a narrow panel.
- **Flat.** File picker, preview and options in one scroll. Column mapping stops
  being a step and becomes a section that appears only when auto-detection could
  not place the required columns.
- **One footer button.** `syncFooter()` in `inventory.html` derives its label and
  disabled state from the active tab; `validateForm()` returns early in bulk mode
  so the single-item form cannot fight it for the same button.
- **The panel mounts lazily** — most opens of this drawer are somebody adding one
  item, and mounting eagerly costs four Firestore reads for a tab never touched.
- **The tabs are hidden entirely when editing.** "Import a list" is not something
  you do to one existing item.

The visual language is the Ledger's, deliberately: the dashed dropzone, the
preview card (eyebrow / filename / summary / status badge), the mapping chips,
the `10px` uppercase table head, and the amber note. The preview shows the
**first five rows**, as the Ledger does — a 300-row table inside a drawer was
never the thing that made the review readable; the counts and the grouped issues
are.

Two things the Ledger has no equivalent for are built from the same parts rather
than inventing a third vocabulary: the column-remapping card and the
opening-balance statement.

**Mapping chips name a header only when it differs from our field name.** The
Ledger prints `Label: HeaderInFile` because its labels and CSV headers genuinely
differ (`Description` ← `vendor_name`). Here they are usually the same word, and
`Product Name: Product Name` pushed the one column we could *not* place into the
sixth row of a wrapping list.

The column set is the Head of Finance's reference sheet ("Contoh Bulk import
Inventory - from Jurnal.id"), reproduced column-for-column so a client exporting
from Jurnal.id can drop that file in unchanged. **It is an input contract, not a
storage schema** — `TEMPLATE_COLUMNS` in the engine holds each column's header,
its requirement label, its original instruction text, and `maps`: where it lands
here.

### 7a. Four columns are recorded but NOT acted on

| Column | Stored as | What actually happens |
|---|---|---|
| Default Inventory Account Code | `default_inventory_account_code` | Stock always posts to **1200 Inventory**, which is closed to direct posting (`chart-of-accounts.md` §4b) and ties to `stock_movements`. A per-item inventory account cannot be honoured without giving up that control-account contract |
| Default Sell Account Code | `default_sales_account_code` | Revenue routes through Accounting → Account Mapping |
| Default Sell / Buy Tax Name | `default_sales_tax_name` / `default_purchase_tax_name` | Tax is applied in the Tax Center, per transaction, not per item |
| Tracking Type `Batch` / `Serial Number` | `tracking_type` | FluxyOS tracks **quantity**. No batch or serial is held |

Keeping them is what makes a migration reversible and a wrong code diagnosable —
the alternative is destroying what the client knew about their own stock. But
storing a value the engine never reads is only defensible while everyone can see
that is what is happening, so it is stated in three places that cannot drift
apart quietly: this table, the `_buildItemFields` comment in `db-service.js`, and
**the import preview itself**, which reports every one of them as a warning
before the user confirms.

If any of these ever becomes real, the field is already populated — and this
section is the thing to delete.

### 7b. Account codes are matched exactly or not at all

Jurnal writes `1-10200`; FluxyOS writes `1200`. No arithmetic turns one into the
other. `resolveAccountCode` matches the live chart exactly or returns nothing,
keeping the original under `source_account_codes` — the same refusal
`matchCashAccounts` makes for bank accounts on a statement import, for the same
reason: an unmatched code is recoverable, a confidently wrong one is not.

The chart it matches against is `getChartForPicker`, not `getChartOfAccounts`.
The latter returns `[]` for a workspace that has never opened the Accounting
Center, which would report *every* code in the file as unresolvable.

### 7c. Amounts: the ambiguity is surfaced, never guessed

`10.000` is ten thousand under Indonesian grouping and ten under Anglo decimals.
It is a **1000x error that stores cleanly and raises nothing** in any currency.

What differs is whether the cell is ambiguous at all. **IDR has no minor unit**,
so a decimal reading of a money cell is never valid and grouping is the only
reading; PHP, SGD and MYR have cents, so the separator genuinely carries meaning
and the cell has two defensible readings. The `ambiguous` flag is raised only for
the second case — *not* because rupiah is safer arithmetic. An earlier draft of
this section claimed both readings "round to the same rupiah" in IDR. They do
not: `10.000` is 10.000 or 10. `parseAmountCell` resolves what it can from evidence (two
separators → the last is the decimal; three trailing digits → grouping, since no
currency here has three decimal places), and flags the rest as `ambiguous`. The
drawer then offers an explicit format choice and re-reads the rows in memory.

Above all, **the preview renders every amount through `FluxyMoney.formatBase`**,
so the number the user approves is the number that gets written.

The importer is **currency-generic**: it reads `minorPerUnit` from the money seam,
so all four base currencies (IDR, PHP, SGD, MYR) parse and render through the
same path, and currency symbols (`Rp`, `₱`, `S$`, `RM`, and the ISO codes) are
stripped as decoration.

**What it does NOT have is a currency column.** The reference template has none,
so every amount in a file is read as the workspace's base currency. A price list
kept in another currency imports cleanly and wrongly. The review step therefore
names the currency it is reading in, next to the figures, because that
assumption is otherwise invisible. Adding a per-file currency would mean an FX
rate and a conversion date, which is `fx-rate.js`'s job and a separate change —
invoices carry a face currency for exactly that reason; the item master does
not, because it is the books' own currency by definition.

### 7d. A bad row costs its row, not the file

`analyzeImport` never throws for a bad row. This is a deliberate departure from
`analyzeBulkCsv` (the transaction importer), which aborts the whole file on the
first bad line — right for six columns, where a bad one usually means the wrong
file; wrong for an inventory master, which is long, hand-maintained, and arrives
with a handful of bad cells in a file that is otherwise entirely good.

Duplicates split by kind: a **name** that already exists is skipped and reported
(re-running an import is not an error), while a **SKU** that already exists is a
hard row error — a duplicate SKU makes the marketplace join ambiguous and would
relieve the wrong item's cost on a sale (§1).

### 7e. Divergence from the item drawer, recorded on purpose

A `Buffer Quantity` of `0` is **refused** in the item drawer (§2a) and
**normalized to `null` with a per-row warning** on import. The principle §2a
protects is that a substitution must never be silent — not that it must never
happen. One `0` in a 300-row migration must not cost the row, and the warning is
counted, grouped and shown before the confirm.

### 7f. Unrecognized headers ask, they do not refuse

Auto-detection covers the template's headers plus the spellings a real export
produces, in English and Bahasa (`HEADER_ALIASES`). When it cannot place the
required columns — or cannot recognise a single header — `analyzeImport` returns
`needsMapping: true` with the file's own header row, and the drawer renders a
**Map columns** step instead of an error.

Refusing was the obvious first behaviour and it was wrong. A shop keeping its
list under *Bahan / Takaran / Harga* has a perfectly good file; telling them it
is unreadable when the only missing piece is which column is which turns a
thirty-second answer into a dead end. A genuinely wrong file still fails — it
just fails with its columns on screen, which is the more useful way to find out.

`columnOverrides` ({ templateKey: columnIndex }) always beats detection, and
`SUPPRESS_COLUMN` (`-1`) removes a mapping. Both directions are needed:
detection can match the *wrong* column, and a control that could only ever add a
mapping would leave the user stuck with it.

## 7g. The drawer's Accounting section

Requested in the Head of Finance's review (Inventory tab of the revision sheet:
*"kalau jadi add tab Accounting, harus bikin 'I track this inventory' dan kasih
options untuk pilih COA"*). Shipped as:

- **"I track this inventory"** → `track_stock`. It sits with the STOCK fields,
  not in the Accounting section, because it is behavioural rather than
  configuration: unticking it hides Purchase unit, Shelf, Reorder point and the
  inventory account, and every field it hides is directly below it. A toggle
  that hides controls above itself is the version that reads as a glitch.
- **Revenue / Cost / Inventory account** → `default_sales_account_code`,
  `default_cogs_account_code`, `default_inventory_account_code`, through the
  shared `FluxyAccountPicker` (searchable and grouped; `FluxySelect` has neither
  and a chart runs to dozens of accounts), each narrowed to **one account type**
  via the picker's `types` option.

  They first shipped filtered by money `direction` — the entry drawer's filter,
  where `in` means revenue **plus liability and equity**, because money in really
  can credit a customer deposit or an owner injection. That breadth is correct
  there and wrong here: a field labelled *Revenue account* was offering `3200
  Owner Drawings` and `2800 Suspense`, which is a control that permits a nonsense
  answer (DESIGN_SYSTEM 3c). Fixed 2026-08-30.

  The allow-list is by **type**, never by `sak_category`. Narrowing Revenue to
  `sak_category: 'revenue'` would hide `7100 Interest Income`, which is a
  perfectly good revenue account — type keeps every user-created account in the
  right family findable while removing the ones that could never be the answer.
  Guard: `tests/inventory-item-accounting.spec.js` → "each account picker offers
  only its own type".

⚠️ **They are still recorded, not acted on** — §7a. The section's own hint says
so on screen. `default_cogs_account_code` in particular has existed since the
collection shipped and is read by nothing; before this section it was not even
sent by the drawer, so every manual save reset it to the `5100` default.

`applyTrackStock()` is the **single owner** of field visibility. `applyItemType`
used to toggle Purchase unit and Reorder point by type while the track switch
toggled them by behaviour, so whichever ran last won — a tracked recipe got its
Reorder point back. Add new conditional fields there, not in a second place.

Guard: `tests/inventory-item-accounting.spec.js`.

## 7h. "What is this?" is answered by the tab

The Head of Finance's review said of the item-type selector: *"What is this? Ga
perlu."* It is gone. What replaced it is a **third tab** — Single item / Recipe /
Import a list — so nobody is asked an abstract question before they can type a
name, and the answer comes from the thing they already clicked.

Deleting the control outright was not an option and this is worth recording,
because the next person to read that feedback will reach for the same delete:
**`#item-type` in this drawer is the only way to create a `composite`**, and
composites are what POS menu items explode through for their COGS
(`docs/data-model/pos.md`). Removing the field without replacing the path would
have quietly removed recipes from the product.

The `<select>` survives as a **hidden value of record**. `applyItemType`,
`collectDraft`, `applyTrackStock` and `validateForm` all read it; replacing the
storage as well as the control would have turned a copy change into a rewrite of
four functions for no gain. `setEntryMode` sets it and lets `applyItemType`
react, so there is still one owner for everything that follows from the type.

On an **edit** the tab row is hidden entirely rather than shown disabled — `type`
is immutable once the item exists, and a visible tab you cannot use says the
choice is still open when it is not. The mode follows the record instead.

Guards: `tests/inventory-item-accounting.spec.js` → "What is this? is answered by
the tab", and `tests/inventory-recipe.spec.js`, which now creates its recipe
through the tab.

## 7i. The purchase unit is defined at Receive stock

The Head of Finance's review called the item drawer's Purchase unit field
redundant. It was not redundant — it is the `units[]` conversion seam, and
deleting it would have meant every goods receipt had to be keyed in base units
(25000 g, not 25 kg). What was wrong was **where it was asked**: in the item
drawer, before anyone had bought the thing, so the answer had to be guessed.

It is now asked on the **receipt line**, with the delivery note in hand. The
unit picker carries an `Other…` option (`NEW_UNIT`); choosing it reveals a name
and a factor, and on commit the unit is written back onto the item so it is only
ever entered once.

Three things worth knowing before touching it:

1. **`lineBase` resolves against a CANDIDATE item.** A unit being defined on
   this line does not exist on the item yet, so `toBase` would throw `INV_001`.
   The line builds `{ ...item, units: [...item.units, newUnit] }` and converts
   against that — the arithmetic stays in the engine instead of growing a second
   conversion in the page that would eventually disagree with it.
2. **The unit is persisted BEFORE the receipt posts**, through `saveItem`, not a
   bespoke write. `saveItem` is where `INV_002` (non-integer factor) and
   `INV_004` (duplicate or contradicted base unit) are enforced. Order matters:
   a receipt that succeeded while its unit was rejected would have converted
   through a factor the item does not carry, and nothing afterwards could
   explain the quantity.
3. **`collectDraft` preserves `editingItem.units` verbatim.** The drawer no
   longer shows the field, so sending `[]` from it would wipe the conversion on
   every save — silently, for a value the user was never shown. This is the one
   change here that could have destroyed data, and it is why the array is
   carried through rather than rebuilt.

Guard: `tests/inventory-purchase-unit.spec.js`, plus the receive tests in
`inventory-ui.spec.js` and `inventory-recipe.spec.js`, which now define their
`kg` inline.

## 8. Composites are not importable

The template has no recipe concept, so every imported item is `type: 'stock'`.
Recipes are authored in the item drawer, where the component picker can validate
against the graph. `importInventoryItems` forces the type rather than trusting
the caller, so there is no candidate graph to validate and no cycle to find.
