import assert from 'node:assert/strict';
import { buildMenuEngineering } from '../assets/js/menu-engineering.js';

const items = [
    { id: 'latte', name: 'Latte', type: 'composite', batch_size: 1,
        components: [{ item_id: 'coffee', quantity: 18 }, { item_id: 'milk', quantity: 200 }] },
    { id: 'coffee', name: 'Coffee', type: 'stock' },
    { id: 'milk', name: 'Milk', type: 'stock' }
];
const orders = [{
    id: 'paid-1', dimension_id: 'kemang', total_amount: 50000, paid_amount: 50000,
    discount_amount: 10000,
    lines: [
        { item_id: 'latte', item_name: 'Latte', quantity: 2, gross_amount: 60000, discount_amount: 0,
            modifiers: [{ consumes: [{ item_id: 'coffee', quantity: 2 }] }] },
        { item_id: 'ignored', quantity: 1, gross_amount: 0, discount_amount: 0 }
    ]
}, {
    id: 'refunded', dimension_id: 'kemang', total_amount: 30000, paid_amount: 30000,
    refunded_at: { toDate: () => new Date() }, lines: [{ item_id: 'latte', quantity: 1, gross_amount: 30000 }]
}];

const rows = buildMenuEngineering(orders, items, { coffee: 100, milk: 20 });
assert.equal(rows.length, 1, 'refunded sales and zero-value orphan lines are excluded');
assert.equal(rows[0].quantity, 2);
assert.equal(rows[0].orders, 1);
assert.equal(rows[0].revenue, 50000, 'order discount is allocated to the sold line');
assert.equal(rows[0].recipe_cost, 12000, 'recipe and modifier consumption use current ingredient costs');
assert.equal(rows[0].gross_profit, 38000);
assert.equal(rows[0].performance, 'star');
console.log('menu engineering: clean');
