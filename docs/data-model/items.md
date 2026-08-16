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
| `components` | array | **Recipe/BOM.** `{ item_id, quantity, yield_percent }` — what ONE BATCH consumes. Empty on a stock item |
| `batch_size` | integer ≥1 | How much output one batch produces, in this item's own base unit. Default `1` |
| `storage_location` | string ≤60 \| null | Where it physically sits ("Dry store — shelf A"). **Sorts the count sheet**, because a count is done by walking the shelf; an alphabetical sheet sends the counter back and forth across the stockroom |
| `notes` | string ≤500 \| null | |
| `status` | enum | `active` \| `archived`. Soft archive only |
| `created_at` / `updated_at` | Timestamp | Server-set |

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
