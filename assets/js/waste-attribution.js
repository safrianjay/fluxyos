// Waste attribution is a read model over immutable stock movements. It explains
// recorded operational loss; it does not alter recipe COGS or count variance.

const keyFor = (m) => [
    m.item_id || '', m.dimension_id || '__unassigned__',
    m.waste_reason || 'unclassified', m.service_period || 'unspecified'
].join('__');

export function buildWasteAttribution(movements = [], { sinceMs = 0 } = {}) {
    const rows = new Map();
    movements.forEach((movement) => {
        if (movement.movement_type !== 'waste' || !movement.item_id) return;
        const at = movement.created_at?.toDate?.().getTime?.() || 0;
        if (at && at < sinceMs) return;
        const key = keyFor(movement);
        const row = rows.get(key) || {
            item_id: movement.item_id,
            item_name: movement.item_name || movement.item_id,
            dimension_id: movement.dimension_id || null,
            base_unit: movement.base_unit || '',
            waste_reason: movement.waste_reason || 'unclassified',
            service_period: movement.service_period || 'unspecified',
            quantity: 0,
            cost: 0,
            events: 0
        };
        row.quantity += Math.abs(Number(movement.quantity) || 0);
        row.cost += Math.abs(Number(movement.amount) || 0);
        row.events += 1;
        rows.set(key, row);
    });
    return [...rows.values()].sort((a, b) => b.cost - a.cost || a.item_name.localeCompare(b.item_name));
}

export function wasteAttributionSummary(rows = []) {
    return rows.reduce((out, row) => {
        out.cost += row.cost;
        out.events += row.events;
        out.reasons.add(row.waste_reason);
        return out;
    }, { cost: 0, events: 0, reasons: new Set() });
}
