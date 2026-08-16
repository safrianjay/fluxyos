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
    INVALID_NAME: 'INV_007'
};

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
