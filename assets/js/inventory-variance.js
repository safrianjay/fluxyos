// Inventory variance is a read model over the immutable stock subledger.
// A POS issue is what recipes say left; a later physical count correction is
// what the shelf says was actually there. We never store either total here.

const keyFor = (m) => `${m.item_id || ''}__${m.dimension_id || '__unassigned__'}`;

/**
 * Compare theoretical POS recipe consumption with physical-count corrections.
 * Positive variance means more was physically used than recipes predicted;
 * negative means the count found more than the system expected.
 */
export function buildInventoryVariance(movements = [], { sinceMs = 0 } = {}) {
    const rows = new Map();
    for (const movement of movements) {
        const at = movement.created_at?.toDate?.().getTime?.() || 0;
        if (at && at < sinceMs) continue;
        const key = keyFor(movement);
        if (!movement.item_id) continue;
        const row = rows.get(key) || {
            item_id: movement.item_id,
            item_name: movement.item_name || movement.item_id,
            dimension_id: movement.dimension_id || null,
            base_unit: movement.base_unit || '',
            theoretical_quantity: 0,
            theoretical_cost: 0,
            physical_variance_quantity: 0,
            physical_variance_cost: 0,
            count_events: 0
        };

        const quantity = Number(movement.quantity) || 0;
        const amount = Number(movement.amount) || 0;
        if (movement.movement_type === 'issue' && movement.source?.collection === 'pos_orders') {
            row.theoretical_quantity += Math.max(0, -quantity);
            row.theoretical_cost += Math.max(0, -amount);
        }
        if (movement.movement_type === 'count') {
            // Count movement is actual minus system. Invert it so positive says
            // "more used than the recipe predicted", which is the useful owner view.
            row.physical_variance_quantity -= quantity;
            row.physical_variance_cost -= amount;
            row.count_events += 1;
        }
        rows.set(key, row);
    }
    return [...rows.values()]
        .filter((r) => r.theoretical_quantity || r.physical_variance_quantity || r.physical_variance_cost)
        .sort((a, b) => Math.abs(b.physical_variance_cost) - Math.abs(a.physical_variance_cost)
            || a.item_name.localeCompare(b.item_name));
}

export function inventoryVarianceSummary(rows = []) {
    return rows.reduce((out, row) => {
        out.theoretical_cost += row.theoretical_cost;
        out.unexplained_cost += row.physical_variance_cost;
        out.counted_items += row.count_events ? 1 : 0;
        return out;
    }, { theoretical_cost: 0, unexplained_cost: 0, counted_items: 0 });
}
