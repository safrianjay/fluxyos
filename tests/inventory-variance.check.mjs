import assert from 'node:assert/strict';
import { buildInventoryVariance, inventoryVarianceSummary } from '../assets/js/inventory-variance.js';

const ts = (ms) => ({ toDate: () => new Date(ms) });
const start = Date.UTC(2026, 8, 1);
const rows = buildInventoryVariance([
    // Recipe says 300 g of chicken left through POS.
    { item_id: 'chicken', item_name: 'Chicken', dimension_id: 'kemang', base_unit: 'g',
        movement_type: 'issue', quantity: -300, amount: -18000,
        source: { collection: 'pos_orders', id: 'o1' }, created_at: ts(start + 1000) },
    // Physical count was another 50 g short: unexplained use, Rp3.000 cost.
    { item_id: 'chicken', item_name: 'Chicken', dimension_id: 'kemang', base_unit: 'g',
        movement_type: 'count', quantity: -50, amount: -3000, created_at: ts(start + 2000) },
    // Waste is operationally distinct and must not become recipe variance.
    { item_id: 'chicken', item_name: 'Chicken', dimension_id: 'kemang', base_unit: 'g',
        movement_type: 'waste', quantity: -25, amount: -1500, created_at: ts(start + 3000) },
    // A non-POS issue cannot be attributed to recipes.
    { item_id: 'rice', item_name: 'Rice', dimension_id: 'kemang', base_unit: 'g',
        movement_type: 'issue', quantity: -100, amount: -1000,
        source: { collection: 'stock_adjustments', id: 'manual' }, created_at: ts(start + 4000) }
], { sinceMs: start });

assert.equal(rows.length, 1, 'only POS recipe use and physical count corrections enter the report');
assert.equal(rows[0].theoretical_quantity, 300);
assert.equal(rows[0].theoretical_cost, 18000);
assert.equal(rows[0].physical_variance_quantity, 50, 'short physical count is positive unexplained use');
assert.equal(rows[0].physical_variance_cost, 3000);
assert.deepEqual(inventoryVarianceSummary(rows), {
    theoretical_cost: 18000, unexplained_cost: 3000, counted_items: 1
});
console.log('inventory variance: clean');
