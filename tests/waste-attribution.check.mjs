import assert from 'node:assert/strict';
import { buildWasteAttribution, wasteAttributionSummary } from '../assets/js/waste-attribution.js';

const ts = (ms) => ({ toDate: () => new Date(ms) });
const start = Date.UTC(2026, 8, 1);
const rows = buildWasteAttribution([
    { item_id: 'milk', item_name: 'Milk', dimension_id: 'kemang', base_unit: 'ml', movement_type: 'waste', quantity: -500, amount: -9000, waste_reason: 'spoilage', service_period: 'close', created_at: ts(start + 100) },
    { item_id: 'milk', item_name: 'Milk', dimension_id: 'kemang', base_unit: 'ml', movement_type: 'waste', quantity: -100, amount: -1800, waste_reason: 'spoilage', service_period: 'close', created_at: ts(start + 200) },
    { item_id: 'milk', item_name: 'Milk', dimension_id: 'kemang', base_unit: 'ml', movement_type: 'issue', quantity: -100, amount: -1800, created_at: ts(start + 300) },
    { item_id: 'old', item_name: 'Old', movement_type: 'waste', quantity: -1, amount: -1, created_at: ts(start - 1) }
], { sinceMs: start });

assert.equal(rows.length, 1, 'only current-period waste is attributed');
assert.deepEqual(rows[0], {
    item_id: 'milk', item_name: 'Milk', dimension_id: 'kemang', base_unit: 'ml',
    waste_reason: 'spoilage', service_period: 'close', quantity: 600, cost: 10800, events: 2
});
const summary = wasteAttributionSummary(rows);
assert.equal(summary.cost, 10800);
assert.equal(summary.events, 2);
assert.deepEqual([...summary.reasons], ['spoilage']);
console.log('waste attribution: clean');
