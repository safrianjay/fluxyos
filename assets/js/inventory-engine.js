// =============================================================================
// FluxyOS — inventory engine (pure)
//
// No Firestore, no DOM. Unit-tested in tests/inventory-engine.spec.js, mirroring
// accounting-engine.js and statements-engine.js. Firestore I/O lives in
// db-service.js.
//
// Today this owns the item master and unit-of-measure conversion. It is the
// intended home for weighted-average costing and recipe explosion when those
// land, so that the arithmetic behind COGS stays in one testable place rather
// than spreading through page controllers.
//
// Schema: docs/data-model/items.md
// Why an item master at all: docs/INVENTORY_DEMAND_VALIDATION.md §7 — ~15 F&B
// prospects need ingredient stock and usage, recipe/menu COGS, waste, and stock
// per outlet.
// =============================================================================

// --- structured errors -------------------------------------------------------
// Same contract as the kernel's GL_* codes: callers discriminate on `err.code`,
// never on message prose, so translating a string cannot change control flow.
export const INV = {
    UNKNOWN_UNIT: 'INV_001',
    NON_INTEGER_FACTOR: 'INV_002',
    MISSING_BASE_UNIT: 'INV_003',
    DUPLICATE_UNIT: 'INV_004',
    NON_INTEGER_QUANTITY: 'INV_005',
    INVALID_TYPE: 'INV_006',
    INVALID_NAME: 'INV_007',
    RECIPE_CYCLE: 'INV_008',
    COMPONENT_NOT_FOUND: 'INV_009',
    COMPONENTS_ON_STOCK_ITEM: 'INV_010',
    INVALID_BATCH_SIZE: 'INV_011',
    RECIPE_TOO_DEEP: 'INV_012'
};

// A recipe nested this deep is a data error, not a menu. Cycles are caught
// separately; this is the belt to that braces, so a pathological DAG cannot
// blow the stack.
export const MAX_RECIPE_DEPTH = 12;

export function invError(code, message, details) {
    const err = new Error(message);
    err.code = code;
    err.domain = 'inventory';
    err.details = details || {};
    return err;
}

export const ITEM_TYPES = ['stock', 'composite'];

// --- quantity model ----------------------------------------------------------
//
// EVERY quantity is stored as an INTEGER in the item's base unit, exactly as
// every amount is stored as a raw integer Rupiah. Buy in kilos, hold in grams,
// sell in portions: the ledger only ever sees grams.
//
// Conversion factors must therefore be positive INTEGERS. That is a deliberate
// limitation, and the reason is costing rather than tidiness: cost flows through
// `quantity × unit_cost`, and a float quantity puts binary rounding error
// directly into a journal amount. An item whose real conversion is fractional
// (1 cup = 236.588 ml) is modelled by choosing a finer base unit, not by storing
// a fraction.
//
// Choose the base unit as the smallest unit the business actually counts in.

const isPosInt = (n) => Number.isInteger(n) && n > 0;

export function normalizeUnitCode(code) {
    return String(code || '').trim().toLowerCase().slice(0, 16);
}

// Every item has an implicit base unit at factor 1, so `units` never has to
// repeat it and a single-unit item needs no `units` array at all.
export function itemUnits(item) {
    const base = normalizeUnitCode(item && item.base_unit);
    if (!base) throw invError(INV.MISSING_BASE_UNIT, 'inventory: item has no base_unit', { item: (item && item.name) || '' });
    const out = [{ code: base, factor: 1, role: 'base' }];
    (Array.isArray(item.units) ? item.units : []).forEach((u) => {
        const code = normalizeUnitCode(u && u.code);
        if (!code || code === base) return;
        out.push({ code, factor: Number(u.factor), role: u.role || null });
    });
    return out;
}

export function resolveUnit(item, unitCode) {
    const code = normalizeUnitCode(unitCode);
    const found = itemUnits(item).find((u) => u.code === code);
    if (!found) {
        throw invError(INV.UNKNOWN_UNIT,
            `inventory: unit "${code}" is not defined on item "${(item && item.name) || ''}"`,
            { unit: code, item: (item && item.name) || '' });
    }
    return found;
}

// qty expressed in `unitCode` → integer quantity in the item's base unit.
export function toBase(item, qty, unitCode) {
    const unit = resolveUnit(item, unitCode);
    if (!isPosInt(unit.factor)) {
        throw invError(INV.NON_INTEGER_FACTOR,
            `inventory: unit "${unit.code}" has a non-integer factor (${unit.factor})`,
            { unit: unit.code, factor: String(unit.factor) });
    }
    const n = Number(qty);
    if (!Number.isFinite(n)) {
        throw invError(INV.NON_INTEGER_QUANTITY, `inventory: quantity is not a number (${qty})`, { quantity: String(qty) });
    }
    const base = n * unit.factor;
    if (!Number.isInteger(base)) {
        // Reject rather than round. Rounding here would be invisible and would
        // land in a journal amount downstream; the fix is a finer base unit.
        throw invError(INV.NON_INTEGER_QUANTITY,
            `inventory: ${n} ${unit.code} is ${base} ${item.base_unit} — not a whole number. Use a finer base unit.`,
            { quantity: String(n), unit: unit.code, base: String(base), base_unit: item.base_unit });
    }
    return base;
}

// Integer base quantity → the same quantity expressed in `unitCode`. May be
// fractional (500 g is 0.5 kg) — this is a DISPLAY conversion, and nothing
// derived from it may be persisted as a quantity.
export function fromBase(item, baseQty, unitCode) {
    const unit = resolveUnit(item, unitCode);
    if (!isPosInt(unit.factor)) {
        throw invError(INV.NON_INTEGER_FACTOR,
            `inventory: unit "${unit.code}" has a non-integer factor (${unit.factor})`,
            { unit: unit.code, factor: String(unit.factor) });
    }
    return (Number(baseQty) || 0) / unit.factor;
}

// Convert between two non-base units by routing through base, so there is one
// conversion table per item rather than a matrix.
export function convert(item, qty, fromUnit, toUnit) {
    return fromBase(item, toBase(item, qty, fromUnit), toUnit);
}

// --- validation --------------------------------------------------------------

export function validateItemDraft(data = {}) {
    const name = String(data.name || '').trim();
    if (!name || name.length > 120) {
        throw invError(INV.INVALID_NAME, 'inventory: item name is required (max 120 chars)', { name });
    }
    const type = ITEM_TYPES.includes(data.type) ? data.type : null;
    if (!type) {
        throw invError(INV.INVALID_TYPE,
            `inventory: item type must be one of ${ITEM_TYPES.join(', ')}`, { type: String(data.type || '') });
    }
    const base = normalizeUnitCode(data.base_unit);
    if (!base) throw invError(INV.MISSING_BASE_UNIT, 'inventory: base_unit is required', { name });

    const seen = new Set([base]);
    const units = (Array.isArray(data.units) ? data.units : []).map((u) => {
        const code = normalizeUnitCode(u && u.code);
        if (!code) throw invError(INV.UNKNOWN_UNIT, 'inventory: a unit is missing its code', { name });
        // The base unit is implicit at factor 1, and a UI that lists every unit
        // will naturally restate it. Restating it harmlessly is dropped (matching
        // itemUnits, which skips it on read); CONTRADICTING it is an error worth
        // surfacing, because `1 g = 5 g` would corrupt every conversion.
        if (code === base) {
            const f = u.factor === undefined || u.factor === null ? 1 : Number(u.factor);
            if (f === 1) return null;
            throw invError(INV.DUPLICATE_UNIT,
                `inventory: "${code}" is the base unit, so its factor must be 1 (got ${u.factor})`,
                { unit: code, factor: String(u.factor), name });
        }
        if (seen.has(code)) {
            throw invError(INV.DUPLICATE_UNIT, `inventory: unit "${code}" is defined twice`, { unit: code, name });
        }
        seen.add(code);
        const factor = Number(u.factor);
        if (!isPosInt(factor)) {
            throw invError(INV.NON_INTEGER_FACTOR,
                `inventory: unit "${code}" needs a positive whole-number factor (got ${u.factor}). Pick a finer base unit if the real ratio is fractional.`,
                { unit: code, factor: String(u.factor) });
        }
        return { code, factor, role: ['purchase', 'sales', 'stock'].includes(u.role) ? u.role : null };
    }).filter(Boolean);

    return { name, type, base_unit: base, units };
}


// --- recipes / bill of materials ---------------------------------------------
//
// A `composite` item is a recipe: a menu item, a sub-preparation, a sauce. Its
// `components` say what ONE BATCH consumes, and `batch_size` says how much
// output that batch produces, in the composite's own base unit. A dish that
// makes 10 portions from 1500 g of rice is batch_size 10, component 1500.
//
// Components are EMBEDDED on the item rather than living in a subcollection.
// You always want the whole recipe at once and you always change it as a unit,
// so one read and one atomic write beat N. Same call the commerce connector made
// for order lines (`models.js`, Phase 0 deviation #5); invoices went the other
// way because their lines are separately queryable, which recipe lines are not.
//
// YIELD IS RECORDED, NOT COMPUTED. `yield_percent` on a component documents that
// 1000 g of raw chicken gives 800 g usable — but `quantity` is always the GROSS
// amount that actually leaves stock. Deriving gross from net would reintroduce
// division, and therefore rounding, into a number that flows to a journal.
// Stock relief is gross consumption; yield explains how the author got there.

export function normalizeComponents(data = {}) {
    const type = data.type;
    const raw = Array.isArray(data.components) ? data.components : [];

    if (type === 'stock' && raw.length) {
        throw invError(INV.COMPONENTS_ON_STOCK_ITEM,
            'inventory: a stock item cannot have components — make it a composite item',
            { name: String(data.name || '') });
    }

    const batchRaw = data.batch_size === undefined || data.batch_size === null ? 1 : Number(data.batch_size);
    if (!Number.isInteger(batchRaw) || batchRaw <= 0) {
        throw invError(INV.INVALID_BATCH_SIZE,
            `inventory: batch_size must be a positive whole number (got ${data.batch_size})`,
            { batch_size: String(data.batch_size) });
    }

    const seen = new Set();
    const components = raw.map((c) => {
        const itemId = String((c && c.item_id) || '').trim();
        if (!itemId) throw invError(INV.COMPONENT_NOT_FOUND, 'inventory: a component is missing item_id', {});
        if (seen.has(itemId)) {
            // Two lines for the same ingredient hide a typo and make the recipe
            // read as if it uses less than it does. Merge upstream, in the UI.
            throw invError(INV.COMPONENT_NOT_FOUND,
                `inventory: component "${itemId}" is listed twice — combine the quantities`, { item_id: itemId });
        }
        seen.add(itemId);
        const quantity = Number(c.quantity);
        if (!Number.isInteger(quantity) || quantity <= 0) {
            throw invError(INV.NON_INTEGER_QUANTITY,
                `inventory: component quantity must be a positive whole number of the component's base unit (got ${c.quantity})`,
                { item_id: itemId, quantity: String(c.quantity) });
        }
        const yieldPct = c.yield_percent === undefined || c.yield_percent === null ? null : Number(c.yield_percent);
        if (yieldPct !== null && (!(yieldPct > 0) || yieldPct > 100)) {
            throw invError(INV.NON_INTEGER_FACTOR,
                `inventory: yield_percent must be between 0 and 100 (got ${c.yield_percent})`,
                { item_id: itemId, yield_percent: String(c.yield_percent) });
        }
        return { item_id: itemId, quantity, yield_percent: yieldPct };
    });

    return { components, batch_size: batchRaw };
}

// Resolve a composite down to the STOCK items it actually consumes.
//
// Returns `{ itemId: quantity }` in each stock item's own base unit. Quantities
// here may be FRACTIONAL — a batch of 3 portions from 1000 g of rice makes one
// portion 333.33 g — and that is deliberate: this is a requirement, not a stored
// quantity. Rounding happens once, at the point a stock movement is recorded,
// so per-component rounding cannot accumulate across a recipe.
export function explodeRecipe(itemsById, itemId, quantityBase, _seen = []) {
    if (_seen.length > MAX_RECIPE_DEPTH) {
        throw invError(INV.RECIPE_TOO_DEEP,
            `inventory: recipe nesting exceeded ${MAX_RECIPE_DEPTH} levels`, { path: _seen.join(' → ') });
    }
    const item = itemsById[itemId];
    if (!item) {
        throw invError(INV.COMPONENT_NOT_FOUND,
            `inventory: component item "${itemId}" does not exist`, { item_id: itemId });
    }
    if (item.type !== 'composite') return { [itemId]: Number(quantityBase) || 0 };

    if (_seen.includes(itemId)) {
        // A recipe that contains itself, directly or through a sub-preparation,
        // would recurse forever and is always a data error.
        throw invError(INV.RECIPE_CYCLE,
            `inventory: recipe cycle — ${[..._seen, itemId].join(' → ')}`,
            { path: [..._seen, itemId].join(' → '), item_id: itemId });
    }

    const batch = Number(item.batch_size) || 1;
    const scale = (Number(quantityBase) || 0) / batch;
    const out = {};
    (Array.isArray(item.components) ? item.components : []).forEach((c) => {
        const sub = explodeRecipe(itemsById, c.item_id, (Number(c.quantity) || 0) * scale, [..._seen, itemId]);
        // Merge, so one ingredient reached through two sub-recipes is counted once.
        Object.entries(sub).forEach(([id, qty]) => { out[id] = (out[id] || 0) + qty; });
    });
    return out;
}

// Cost of producing `quantityBase` of a composite, given unit costs per base unit.
//
// Rounds ONCE, at the end. Rounding each component would compound the error
// across a recipe, and this figure becomes a journal amount.
export function recipeCost(itemsById, unitCostByItemId, itemId, quantityBase) {
    const exploded = explodeRecipe(itemsById, itemId, quantityBase);
    let total = 0;
    const missing = [];
    Object.entries(exploded).forEach(([id, qty]) => {
        const unitCost = unitCostByItemId[id];
        if (unitCost === undefined || unitCost === null) { missing.push(id); return; }
        total += qty * Number(unitCost);
    });
    return { cost: Math.round(total), components: exploded, missingCost: missing };
}


// --- costing: weighted average from the subledger --------------------------
//
// Unit cost is DERIVED, never stored: value on hand / quantity on hand, both of
// which are sums over stock_movements. There is no cached cost to drift from the
// movements that produce it — the same reason getStockOnHand sums rather than
// caching a running total.
//
// The rate is fractional on purpose (Rp0,012 per gram is real). Only the money
// that reaches a journal is rounded, and it is rounded once per line, because
// each line becomes its own stock_movement whose integer amounts must sum to the
// journal total.

export function unitCostOf(systemQuantity, systemValue) {
    const q = Number(systemQuantity) || 0;
    if (q === 0) return 0;
    return (Number(systemValue) || 0) / q;
}

// A physical count against what the subledger believes.
//
// varianceQty is counted − system, so it is NEGATIVE when stock has left without
// a recorded movement — which for F&B is overwhelmingly consumption, i.e. COGS.
// Waste recorded as it happens has already reduced `system`, so it is not
// double-counted here; whatever remains is what the kitchen actually used.
export function countVariance(systemQuantity, systemValue, countedQuantity) {
    const counted = Number(countedQuantity);
    if (!Number.isInteger(counted) || counted < 0) {
        throw invError(INV.NON_INTEGER_QUANTITY,
            `inventory: counted quantity must be a whole number of base units (got ${countedQuantity})`,
            { counted: String(countedQuantity) });
    }
    const unitCost = unitCostOf(systemQuantity, systemValue);
    const varianceQty = counted - (Number(systemQuantity) || 0);
    return { unitCost, varianceQty, amount: Math.round(varianceQty * unitCost) };
}

// Explicit spoilage/breakage. Always a reduction, so quantity is given positive
// and the movement it produces is negative.
export function wasteValue(systemQuantity, systemValue, quantity) {
    const q = Number(quantity);
    if (!Number.isInteger(q) || q <= 0) {
        throw invError(INV.NON_INTEGER_QUANTITY,
            `inventory: waste quantity must be a positive whole number of base units (got ${quantity})`,
            { quantity: String(quantity) });
    }
    const unitCost = unitCostOf(systemQuantity, systemValue);
    return { unitCost, quantity: q, amount: Math.round(q * unitCost) };
}
