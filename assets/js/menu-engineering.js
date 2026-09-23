// Menu engineering is a read model. Sales prices are snapshotted on POS lines;
// recipe cost is calculated from the current canonical recipe and current
// weighted-average ingredient costs, so it is explicitly a current margin view,
// not a rewrite of historical COGS.

import { recipeCost } from './inventory-engine.js';

const keyFor = (outletId, itemId) => `${outletId || '__unassigned__'}__${itemId || ''}`;

const isSettled = (order) => {
    const total = Math.round(Number(order && order.total_amount) || 0);
    const paid = Math.round(Number(order && order.paid_amount) || 0);
    return total > 0 && paid >= total && !order.voided_at && !order.refunded_at;
};

const currentUnitCost = (unitCosts, itemId) => {
    const cost = unitCosts && unitCosts[itemId];
    return Number.isFinite(Number(cost)) && Number(cost) >= 0 ? Number(cost) : null;
};

function lineRecipeCost(line, item, itemsById, unitCosts) {
    const quantity = Math.max(0, Math.round(Number(line.quantity) || 0));
    if (!item || !quantity) return { cost: 0, missing: true };

    let cost = 0;
    let missing = false;
    if (item.type === 'composite') {
        try {
            const quoted = recipeCost(itemsById, unitCosts, item.id, quantity);
            cost += quoted.cost;
            missing = quoted.missingCost.length > 0;
        } catch (_) {
            // A malformed or cyclic recipe is a setup problem, not a reason to
            // take the whole Inventory overview down. Surface it as no cost.
            missing = true;
        }
    } else {
        const unitCost = currentUnitCost(unitCosts, item.id);
        if (unitCost === null) missing = true;
        else cost += quantity * unitCost;
    }

    // Modifier consumption is a snapshot on the sale line. Price changes and
    // later menu edits must not change what this report says was ordered.
    (Array.isArray(line.modifiers) ? line.modifiers : []).forEach((modifier) => {
        (Array.isArray(modifier.consumes) ? modifier.consumes : []).forEach((consumption) => {
            const unitCost = currentUnitCost(unitCosts, consumption.item_id);
            if (unitCost === null) { missing = true; return; }
            cost += quantity * (Number(consumption.quantity) || 0) * unitCost;
        });
    });
    return { cost: Math.round(cost), missing };
}

/** Build per-outlet menu performance for settled, non-refunded POS sales. */
export function buildMenuEngineering(orders = [], items = [], unitCosts = {}) {
    const itemsById = Object.fromEntries(items.map((item) => [item.id, item]));
    const rows = new Map();

    orders.filter(isSettled).forEach((order) => {
        const lines = Array.isArray(order.lines) ? order.lines : [];
        const afterLineDiscount = lines.map((line) => Math.max(0,
            (Number(line.gross_amount) || 0) - (Number(line.discount_amount) || 0)));
        const eligibleTotal = afterLineDiscount.reduce((sum, amount) => sum + amount, 0);
        const orderDiscount = Math.min(Math.max(0, Number(order.discount_amount) || 0), eligibleTotal);
        let allocated = 0;

        lines.forEach((line, index) => {
            if (!line.item_id || !afterLineDiscount[index]) return;
            const proportional = index === lines.length - 1
                ? orderDiscount - allocated
                : Math.round(orderDiscount * (afterLineDiscount[index] / (eligibleTotal || 1)));
            allocated += proportional;
            const revenue = Math.max(0, afterLineDiscount[index] - proportional);
            const outletId = order.dimension_id || null;
            const key = keyFor(outletId, line.item_id);
            const row = rows.get(key) || {
                item_id: line.item_id,
                item_name: line.item_name || itemsById[line.item_id]?.name || line.item_id,
                dimension_id: outletId,
                quantity: 0,
                orders: new Set(),
                revenue: 0,
                recipe_cost: 0,
                missing_cost: false
            };
            const cost = lineRecipeCost(line, itemsById[line.item_id], itemsById, unitCosts);
            row.quantity += Math.max(0, Math.round(Number(line.quantity) || 0));
            row.orders.add(order.id || `${order.order_number || ''}:${index}`);
            row.revenue += revenue;
            row.recipe_cost += cost.cost;
            row.missing_cost = row.missing_cost || cost.missing;
            rows.set(key, row);
        });
    });

    const out = [...rows.values()].map((row) => ({
        ...row,
        orders: row.orders.size,
        gross_profit: row.missing_cost ? null : row.revenue - row.recipe_cost,
        margin_pct: row.missing_cost || !row.revenue ? null
            : ((row.revenue - row.recipe_cost) / row.revenue) * 100
    }));
    const averageQuantity = out.length ? out.reduce((sum, row) => sum + row.quantity, 0) / out.length : 0;
    const knownMargins = out.map((row) => row.margin_pct).filter((value) => value !== null);
    const averageMargin = knownMargins.length
        ? knownMargins.reduce((sum, value) => sum + value, 0) / knownMargins.length : null;

    return out.map((row) => ({
        ...row,
        performance: row.missing_cost ? 'cost_missing'
            : row.quantity >= averageQuantity && row.margin_pct >= averageMargin ? 'star'
                : row.quantity >= averageQuantity ? 'workhorse'
                    : row.margin_pct >= averageMargin ? 'hidden_gem' : 'review'
    })).sort((a, b) => b.revenue - a.revenue || a.item_name.localeCompare(b.item_name));
}
