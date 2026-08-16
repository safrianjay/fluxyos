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
