'use strict';

// =============================================================================
// A priced modifier moves COGS, not just revenue.
//
// THE DEFECT. `items.pos_modifier_groups` options carry a `price_delta` and,
// until now, nothing else. "Extra shot +Rp5.000" billed the customer and
// relieved no coffee — the revenue moved and the stock did not — so every
// modified sale reported a gross margin flattered by exactly the cost of the
// extras. It is the same defect `CM-ORDER-COGS` was built to close for
// marketplace sales, arriving by a second route, and it was documented as a
// known gap rather than found: `pos.md` said "a priced modifier moves revenue
// but NOT COGS".
//
// An option now declares `consumes: [{ item_id, quantity }]`, snapshotted onto
// the order line, and `_resolveSaleConsumption` relieves it.
//
// WHY A PURE CHECK. The arithmetic is the whole feature and it is invisible at
// runtime: relieving too little inflates margin, relieving too much invents
// cost, and neither raises anything. `_resolveSaleConsumption` is pure — items
// in, movements out — so every case below runs with no Firestore and no browser.
//
// Run: node tests/modifier-cogs.check.js
// =============================================================================

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
const is = (actual, expected, label) => {
    if (actual === expected) ok(label);
    else fail(`${label}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

// `_resolveSaleConsumption` is a method on DataService, which imports Firebase.
// Rather than load the whole module in Node, the check drives it through a bare
// object carrying the two things the method actually closes over. If that stops
// working the method has grown a dependency worth knowing about.
async function resolver() {
    const engine = await import(pathToFileURL(path.join(ROOT, 'assets/js/inventory-engine.js')).href);
    const src = fs.readFileSync(path.join(ROOT, 'assets/js/db-service.js'), 'utf8');
    const start = src.indexOf('    _resolveSaleConsumption(');
    if (start === -1) throw new Error('could not find _resolveSaleConsumption in db-service.js');
    // Up to the closing brace of the method, found by the next line that is
    // exactly four spaces and a brace.
    const end = src.indexOf('\n    }\n', start);
    const body = src.slice(start, end + 6);
    // eslint-disable-next-line no-new-func
    const make = new Function('explodeRecipe', 'unitCostOf',
        `return ({ ${body} });`);
    return make(engine.explodeRecipe, (q, v) => (q > 0 ? v / q : 0));
}

(async () => {
    console.log('\nmodifier cogs\n');
    const ds = await resolver();

    // A latte made of one shot of coffee and 200ml of milk, plus a shot item
    // that an "extra shot" option consumes.
    const byId = {
        shot: { id: 'shot', name: 'Espresso shot', type: 'stock', base_unit: 'shot' },
        milk: { id: 'milk', name: 'Milk', type: 'stock', base_unit: 'ml' },
        syrup: { id: 'syrup', name: 'Vanilla syrup', type: 'stock', base_unit: 'ml' },
        latte: {
            id: 'latte', name: 'Latte', type: 'composite', base_unit: 'cup', batch_size: 1,
            components: [{ item_id: 'shot', quantity: 1 }, { item_id: 'milk', quantity: 200 }]
        }
    };
    // Cost basis: a shot costs 2.000, milk 10/ml, syrup 50/ml.
    const stock = () => ({
        shot: { quantity: 100, value: 200000 },
        milk: { quantity: 10000, value: 100000 },
        syrup: { quantity: 1000, value: 50000 }
    });
    // SUM, not find. An item reached twice must merge into one movement, and a
    // helper that read only the first entry would report -1 for a correct -2 —
    // which is exactly what it did on the first run, hiding that the code was
    // right and the test was wrong.
    const qtyOf = (lines, id) => lines.filter((l) => l.item_id === id)
        .reduce((s, l) => s + l.quantity, 0);
    const amountOf = (lines, id) => lines.filter((l) => l.item_id === id)
        .reduce((s, l) => s + l.amount, 0);
    const entriesFor = (lines, id) => lines.filter((l) => l.item_id === id).length;

    // ── The baseline: no modifiers, unchanged behaviour ─────────────────────
    const plain = ds._resolveSaleConsumption({
        soldLines: [{ item_id: 'latte', quantity: 1 }], byId, bySku: {}, onHand: stock()
    });
    is(qtyOf(plain.lines, 'shot'), -1, 'one latte relieves one shot');
    is(qtyOf(plain.lines, 'milk'), -200, '…and 200ml of milk');
    is(amountOf(plain.lines, 'shot'), -2000, 'costed at the weighted average');

    // ── THE FIX: an extra shot relieves a shot ──────────────────────────────
    const extra = ds._resolveSaleConsumption({
        soldLines: [{
            item_id: 'latte', quantity: 1,
            modifiers: [{ option_id: 'x', option_name: 'Extra shot', price_delta: 5000,
                consumes: [{ item_id: 'shot', quantity: 1 }] }]
        }],
        byId, bySku: {}, onHand: stock()
    });
    is(qtyOf(extra.lines, 'shot'), -2,
        'a latte with an extra shot relieves TWO shots, not one');
    is(entriesFor(extra.lines, 'shot'), 1,
        '…as ONE merged movement, not two of one each');
    is(qtyOf(extra.lines, 'milk'), -200, '…and the milk is unchanged');

    // The whole point, stated as money: the extra shot costs 2.000, so COGS has
    // to rise by 2.000. Before this it rose by nothing while revenue rose 5.000.
    const cogs = (r) => r.lines.reduce((s, l) => s + Math.abs(l.amount), 0);
    is(cogs(extra) - cogs(plain), 2000,
        'COGS rises by the cost of the extra, not by zero');

    // ── Per unit of the line, not per line ──────────────────────────────────
    // Two lattes with an extra shot each take two extra shots. Multiplying by
    // the line quantity is the difference between relieving 4 shots and 3.
    const twoLattes = ds._resolveSaleConsumption({
        soldLines: [{
            item_id: 'latte', quantity: 2,
            modifiers: [{ option_id: 'x', consumes: [{ item_id: 'shot', quantity: 1 }] }]
        }],
        byId, bySku: {}, onHand: stock()
    });
    is(qtyOf(twoLattes.lines, 'shot'), -4, 'two lattes with an extra shot each take FOUR shots');

    // ── Several options, several components ────────────────────────────────
    const loaded = ds._resolveSaleConsumption({
        soldLines: [{
            item_id: 'latte', quantity: 1,
            modifiers: [
                { option_id: 'x', consumes: [{ item_id: 'shot', quantity: 1 }] },
                { option_id: 'v', consumes: [{ item_id: 'syrup', quantity: 15 }] }
            ]
        }],
        byId, bySku: {}, onHand: stock()
    });
    is(qtyOf(loaded.lines, 'shot'), -2, 'two options both apply');
    is(qtyOf(loaded.lines, 'syrup'), -15, '…including one the recipe never mentions');

    // ── An option consuming a COMPOSITE explodes it ─────────────────────────
    // "Extra sauce" where the sauce is itself a recipe must relieve the sauce's
    // ingredients, never the sauce as a thing on a shelf.
    const withSauce = {
        ...byId,
        sauce: {
            id: 'sauce', name: 'House sauce', type: 'composite', base_unit: 'ml', batch_size: 100,
            components: [{ item_id: 'syrup', quantity: 100 }]
        }
    };
    const sauced = ds._resolveSaleConsumption({
        soldLines: [{
            item_id: 'latte', quantity: 1,
            modifiers: [{ option_id: 's', consumes: [{ item_id: 'sauce', quantity: 100 }] }]
        }],
        byId: withSauce, bySku: {}, onHand: stock()
    });
    is(qtyOf(sauced.lines, 'sauce'), 0, 'a composite modifier is never relieved as itself');
    is(qtyOf(sauced.lines, 'syrup'), -100, '…it relieves the ingredients it explodes to');

    // ── An option that consumes nothing is the COMMON case ─────────────────
    // A sugar level or a spice preference has no measurable ingredient. It must
    // cost nothing and change nothing.
    const free = ds._resolveSaleConsumption({
        soldLines: [{
            item_id: 'latte', quantity: 1,
            modifiers: [{ option_id: 'sugar', option_name: 'Less sugar', price_delta: 0 }]
        }],
        byId, bySku: {}, onHand: stock()
    });
    is(cogs(free), cogs(plain), 'an option with no consumes changes nothing');

    // ── Garbage never becomes a movement ───────────────────────────────────
    const junk = ds._resolveSaleConsumption({
        soldLines: [{
            item_id: 'latte', quantity: 1,
            modifiers: [
                { option_id: 'a', consumes: [{ item_id: 'ghost', quantity: 5 }] },
                { option_id: 'b', consumes: [{ item_id: 'shot', quantity: 0 }] },
                { option_id: 'c', consumes: [{ item_id: 'shot', quantity: -3 }] },
                { option_id: 'd', consumes: 'not an array' },
                { option_id: 'e' }
            ]
        }],
        byId, bySku: {}, onHand: stock()
    });
    is(qtyOf(junk.lines, 'shot'), -1,
        'an unknown item, a zero, a negative and a malformed list all relieve nothing');
    is(cogs(junk), cogs(plain), '…and COGS is the plain latte');

    // ── A modifier on a NON-recipe item still works ────────────────────────
    // Sell a shot on its own with an extra shot on it: 2 shots.
    const bare = ds._resolveSaleConsumption({
        soldLines: [{
            item_id: 'shot', quantity: 1,
            modifiers: [{ option_id: 'x', consumes: [{ item_id: 'shot', quantity: 1 }] }]
        }],
        byId, bySku: {}, onHand: stock()
    });
    is(qtyOf(bare.lines, 'shot'), -2, 'a stock item with a modifier relieves both');

    console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\nmodifier cogs: clean\n');
    process.exit(failures ? 1 : 0);
})().catch((err) => {
    console.error('\n✗ modifier-cogs check threw:', err);
    process.exit(1);
});
