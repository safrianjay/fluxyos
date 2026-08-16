const { test, expect } = require('@playwright/test');

// Pure-logic tests for assets/js/inventory-engine.js — same pattern as
// accounting-engine.spec.js and statements-engine.spec.js.
//
// The invariant under test: every quantity is an INTEGER in the item's base
// unit, the way every amount is a raw integer Rupiah. Cost flows through
// `quantity × unit_cost` into a journal, so a float quantity puts binary
// rounding error into the ledger. The engine refuses rather than rounds.

test('unit conversion routes through an integer base unit', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const e = await import('/assets/js/inventory-engine.js');
        // The F&B case that motivates the whole model: buy flour in kilos, hold
        // it in grams, sell it in 150 g portions.
        const flour = {
            name: 'Tepung', base_unit: 'g',
            units: [{ code: 'kg', factor: 1000, role: 'purchase' }, { code: 'porsi', factor: 150, role: 'sales' }]
        };
        const err = (fn) => { try { fn(); return null; } catch (x) { return x.code; } };
        return {
            twoKg: e.toBase(flour, 2, 'kg'),
            threePortions: e.toBase(flour, 3, 'porsi'),
            baseItself: e.toBase(flour, 250, 'g'),
            // 0.5 porsi is 75 g — a whole number of base units, so it is legal.
            halfPortion: e.toBase(flour, 0.5, 'porsi'),
            backToKg: e.fromBase(flour, 2000, 'kg'),
            crossUnit: Number(e.convert(flour, 1, 'kg', 'porsi').toFixed(4)),
            roundTrip: e.toBase(flour, e.fromBase(flour, 4500, 'kg'), 'kg'),
            unknownUnit: err(() => e.toBase(flour, 1, 'liter')),
            fractionalBase: err(() => e.toBase(flour, 1.5, 'g')),
            notANumber: err(() => e.toBase(flour, 'x', 'kg'))
        };
    });

    expect(r.twoKg).toBe(2000);
    expect(r.threePortions).toBe(450);
    expect(r.baseItself).toBe(250);
    expect(r.halfPortion, '0.5 porsi is 75 g — whole, so allowed').toBe(75);
    expect(r.backToKg).toBe(2);
    expect(r.crossUnit).toBe(6.6667);
    expect(r.roundTrip, 'base → display → base must not drift').toBe(4500);

    expect(r.unknownUnit).toBe('INV_001');
    // Rejected, never rounded: silently turning 1.5 g into 2 g would be
    // invisible and would land in a journal amount downstream.
    expect(r.fractionalBase).toBe('INV_005');
    expect(r.notANumber).toBe('INV_005');
});

test('item drafts are validated and normalized', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const e = await import('/assets/js/inventory-engine.js');
        const err = (fn) => { try { fn(); return null; } catch (x) { return x.code; } };
        return {
            // Unit codes normalize (case, whitespace) so "KG" and "kg" cannot
            // both exist and silently diverge.
            normalized: e.validateItemDraft({
                name: '  Tepung Terigu ', type: 'stock', base_unit: 'G ',
                units: [{ code: ' KG', factor: 1000, role: 'purchase' }]
            }),
            // A composite item is a recipe/menu item. The field exists from the
            // first write so recipes attach later without a schema change.
            composite: e.validateItemDraft({ name: 'Nasi Goreng', type: 'composite', base_unit: 'porsi' }).type,
            noUnits: e.validateItemDraft({ name: 'Telur', type: 'stock', base_unit: 'pcs' }).units.length,

            fractionalFactor: err(() => e.validateItemDraft({
                name: 'Susu', type: 'stock', base_unit: 'ml', units: [{ code: 'cup', factor: 236.588 }]
            })),
            duplicateUnit: err(() => e.validateItemDraft({
                name: 'x', type: 'stock', base_unit: 'g', units: [{ code: 'kg', factor: 1000 }, { code: 'kg', factor: 1000 }]
            })),
            // The base unit is implicit at factor 1, so redefining it is a no-op
            // rather than a duplicate.
            baseRedefined: e.validateItemDraft({
                name: 'x', type: 'stock', base_unit: 'g', units: [{ code: 'g', factor: 1 }]
            }).units.length,
            baseContradicted: err(() => e.validateItemDraft({
                name: 'x', type: 'stock', base_unit: 'g', units: [{ code: 'g', factor: 5 }]
            })),
            badType: err(() => e.validateItemDraft({ name: 'x', type: 'widget', base_unit: 'g' })),
            noName: err(() => e.validateItemDraft({ name: '', type: 'stock', base_unit: 'g' })),
            noBase: err(() => e.validateItemDraft({ name: 'x', type: 'stock' })),
            badRole: e.validateItemDraft({
                name: 'x', type: 'stock', base_unit: 'g', units: [{ code: 'kg', factor: 1000, role: 'nonsense' }]
            }).units[0].role
        };
    });

    expect(r.normalized.name).toBe('Tepung Terigu');
    expect(r.normalized.base_unit).toBe('g');
    expect(r.normalized.units).toEqual([{ code: 'kg', factor: 1000, role: 'purchase' }]);
    expect(r.composite).toBe('composite');
    expect(r.noUnits).toBe(0);

    // A fractional factor is refused with a message pointing at the real fix —
    // choose a finer base unit — rather than being silently rounded.
    expect(r.fractionalFactor).toBe('INV_002');
    expect(r.duplicateUnit).toBe('INV_004');
    expect(r.baseRedefined, 'restating the base unit at factor 1 is dropped').toBe(0);
    expect(r.baseContradicted, 'but 1 g = 5 g is an error, not a no-op').toBe('INV_004');
    expect(r.badType).toBe('INV_006');
    expect(r.noName).toBe('INV_007');
    expect(r.noBase).toBe('INV_003');
    expect(r.badRole, 'an unrecognised role degrades to null rather than failing').toBeNull();
});


// A recipe is the whole point of the composite type: menu COGS requires
// exploding ingredients at sale time, not decrementing one SKU. This is what
// PRODUCT_STRATEGY §7 means when it says a generic warehouse model produces
// "confidently wrong COGS" for F&B.
test('recipes explode through nesting, merge shared ingredients, and cost once', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const e = await import('/assets/js/inventory-engine.js');
        const items = {
            rice: { id: 'rice', name: 'Beras', type: 'stock', base_unit: 'g' },
            oil: { id: 'oil', name: 'Minyak', type: 'stock', base_unit: 'ml' },
            egg: { id: 'egg', name: 'Telur', type: 'stock', base_unit: 'pcs' },
            // Sub-preparation: one batch makes 500 g of sauce.
            sauce: {
                id: 'sauce', name: 'Bumbu', type: 'composite', base_unit: 'g', batch_size: 500,
                components: [{ item_id: 'oil', quantity: 400 }, { item_id: 'rice', quantity: 100 }]
            },
            // Menu item: one batch makes 10 portions and uses the sauce.
            nasgor: {
                id: 'nasgor', name: 'Nasi Goreng', type: 'composite', base_unit: 'porsi', batch_size: 10,
                components: [
                    { item_id: 'rice', quantity: 1500 },
                    { item_id: 'egg', quantity: 20 },
                    { item_id: 'sauce', quantity: 250 }
                ]
            }
        };
        const err = (fn) => { try { fn(); return null; } catch (x) { return x.code; } };
        const cycle = { ...items, sauce: { ...items.sauce, components: [{ item_id: 'nasgor', quantity: 1 }] } };
        return {
            batch: e.explodeRecipe(items, 'nasgor', 10),
            one: e.explodeRecipe(items, 'nasgor', 1),
            costOne: e.recipeCost(items, { rice: 12, oil: 25, egg: 2500 }, 'nasgor', 1),
            missingCost: e.recipeCost(items, { rice: 12 }, 'nasgor', 1).missingCost.sort(),
            stockPassthrough: e.explodeRecipe(items, 'rice', 250),
            emptyRecipe: e.explodeRecipe({ x: { id: 'x', type: 'composite', base_unit: 'porsi', components: [] } }, 'x', 5),
            cycle: err(() => e.explodeRecipe(cycle, 'nasgor', 1)),
            selfCycle: err(() => e.explodeRecipe(
                { a: { id: 'a', type: 'composite', base_unit: 'g', batch_size: 1, components: [{ item_id: 'a', quantity: 1 }] } }, 'a', 1)),
            missingItem: err(() => e.explodeRecipe(items, 'ghost', 1)),
            componentsOnStock: err(() => e.normalizeComponents({ name: 'x', type: 'stock', components: [{ item_id: 'a', quantity: 1 }] })),
            zeroBatch: err(() => e.normalizeComponents({ name: 'x', type: 'composite', batch_size: 0 })),
            dupComponent: err(() => e.normalizeComponents({ name: 'x', type: 'composite', components: [{ item_id: 'a', quantity: 1 }, { item_id: 'a', quantity: 2 }] })),
            fractionalComponent: err(() => e.normalizeComponents({ name: 'x', type: 'composite', components: [{ item_id: 'a', quantity: 1.5 }] })),
            badYield: err(() => e.normalizeComponents({ name: 'x', type: 'composite', components: [{ item_id: 'a', quantity: 1, yield_percent: 140 }] })),
            yieldKept: e.normalizeComponents({ name: 'x', type: 'composite', components: [{ item_id: 'a', quantity: 1000, yield_percent: 80 }] }).components[0]
        };
    });

    // One batch is the recipe as written, plus the sauce resolved to its own inputs.
    expect(r.batch).toEqual({ rice: 1550, egg: 20, oil: 200 });
    // Per portion: rice arrives BOTH directly (150) and through the sauce (5).
    // Merging is the behaviour that makes nested recipes cost correctly.
    expect(r.one).toEqual({ rice: 155, egg: 2, oil: 20 });
    // 155×12 + 2×2500 + 20×25 = 1860 + 5000 + 500
    expect(r.costOne.cost).toBe(7360);
    expect(r.costOne.missingCost).toEqual([]);
    // An uncosted ingredient is reported, never silently treated as free.
    expect(r.missingCost).toEqual(['egg', 'oil']);
    expect(r.stockPassthrough).toEqual({ rice: 250 });
    expect(r.emptyRecipe, 'a composite with no recipe yet resolves to nothing').toEqual({});

    expect(r.cycle).toBe('INV_008');
    expect(r.selfCycle).toBe('INV_008');
    expect(r.missingItem).toBe('INV_009');
    expect(r.componentsOnStock).toBe('INV_010');
    expect(r.zeroBatch).toBe('INV_011');
    expect(r.dupComponent, 'two lines for one ingredient hide a typo').toBe('INV_009');
    expect(r.fractionalComponent).toBe('INV_005');
    expect(r.badYield).toBe('INV_002');
    // Yield is RECORDED, not applied: quantity stays the gross amount that
    // leaves stock, so no division — and no rounding — enters the cost path.
    expect(r.yieldKept).toEqual({ item_id: 'a', quantity: 1000, yield_percent: 80 });
});
