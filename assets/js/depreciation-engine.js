// FluxyOS — Fixed-asset depreciation
//
// Pure. No Firestore, no DOM — the same split as `inventory-engine.js` and
// `accounting-engine.js`, and for the same reason: this decides journal amounts,
// so it has to be testable without a browser.
//
// ── Straight line only, on purpose ───────────────────────────────────────────
// Declining balance and units-of-production exist and are not here. A method is
// not a formula, it is a promise about every future period — switching one after
// posting restates depreciation already taken, and there is no UI for that
// conversation yet. One method, correctly, beats three with a footnote.
//
// ── Every amount is an integer in the workspace's minor units ────────────────
// Cost, salvage and each period's charge. Depreciation lands in a journal, and a
// float in a journal amount is how a ledger stops balancing.

export const FA = {
    BAD_NAME: 'FA_001',
    BAD_COST: 'FA_002',
    BAD_LIFE: 'FA_003',
    BAD_DATE: 'FA_004',
    BAD_SALVAGE: 'FA_005',
    BAD_ACCOUNT: 'FA_006'
};

export function faError(code, message, details) {
    const err = new Error(message);
    err.code = code;
    if (details) err.details = details;
    return err;
}

// The asset accounts depreciation is allowed to run over. `accumulated_
// depreciation` is excluded deliberately — 1590 is the CONTRA account the charge
// credits, and an asset filed there would depreciate the thing that records
// depreciation.
export const DEPRECIABLE_SAK_CATEGORIES = ['fixed_asset'];

const PERIOD_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toInt(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? n : 0;
}

/** 'YYYY-MM-DD' → 'YYYY-MM'. */
export function periodOf(dateKey) {
    return DATE_RE.test(String(dateKey || '')) ? String(dateKey).slice(0, 7) : null;
}

/** Advance a 'YYYY-MM' by n months. */
export function addMonths(periodKey, n) {
    if (!PERIOD_RE.test(String(periodKey || ''))) return null;
    const [y, m] = String(periodKey).split('-').map(Number);
    const total = (y * 12) + (m - 1) + Number(n || 0);
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
}

/** How many months from `from` to `to`, inclusive of neither end. */
export function monthsBetween(from, to) {
    if (!PERIOD_RE.test(String(from || '')) || !PERIOD_RE.test(String(to || ''))) return 0;
    const [fy, fm] = String(from).split('-').map(Number);
    const [ty, tm] = String(to).split('-').map(Number);
    return ((ty * 12) + tm) - ((fy * 12) + fm);
}

export function validateAssetDraft(draft = {}) {
    const errors = [];
    const name = String(draft.name || '').trim();
    if (!name || name.length > 120) errors.push({ code: FA.BAD_NAME, message: 'Give the asset a name, up to 120 characters.' });

    const cost = toInt(draft.cost);
    if (!(cost > 0)) errors.push({ code: FA.BAD_COST, message: 'Cost must be more than zero.' });

    const salvage = toInt(draft.salvage_value);
    if (salvage < 0) errors.push({ code: FA.BAD_SALVAGE, message: 'Residual value cannot be negative.' });
    // Equal is allowed and means "nothing to depreciate" — a legitimate way to
    // register an asset you want on the balance sheet but not in the P&L.
    if (salvage > cost) errors.push({ code: FA.BAD_SALVAGE, message: 'Residual value cannot be more than the cost.' });

    const life = Number(draft.useful_life_months);
    if (!Number.isInteger(life) || life < 1 || life > 600) {
        errors.push({ code: FA.BAD_LIFE, message: 'Useful life is a whole number of months, from 1 to 600 (50 years).' });
    }

    if (!DATE_RE.test(String(draft.in_service_date || ''))) {
        errors.push({ code: FA.BAD_DATE, message: 'Give the date the asset was put into service.' });
    }

    const account = String(draft.asset_account_code || '').trim();
    if (!/^[1-9]\d{3}$/.test(account)) {
        errors.push({ code: FA.BAD_ACCOUNT, message: 'Pick the asset account this sits in.' });
    }

    return { ok: errors.length === 0, errors };
}

/*
 * The full schedule for an asset: one row per period, from the month it was put
 * into service.
 *
 * ── Why the rounding works this way ──────────────────────────────────────────
 * Each period's charge is the DIFFERENCE between two cumulative roundings, not a
 * rounded monthly figure:
 *
 *     amount(n) = round(base × n / life) − round(base × (n−1) / life)
 *
 * Rounding a monthly figure and repeating it leaves a remainder that has to be
 * dumped on the final period — and if anything ever changes mid-life, that
 * remainder is silently wrong. Cumulative rounding makes the schedule sum to the
 * depreciable base EXACTLY by construction, with every period within one minor
 * unit of the true rate and no special case at the end.
 *
 * A Rp10.000.000 asset over 3 years: 35 periods of Rp277.778 and one of
 * Rp277.770, summing to exactly Rp10.000.000.
 */
export function depreciationSchedule(asset = {}) {
    const check = validateAssetDraft(asset);
    if (!check.ok) return [];

    const cost = toInt(asset.cost);
    const salvage = toInt(asset.salvage_value);
    const base = Math.max(0, cost - salvage);
    const life = Number(asset.useful_life_months);
    const start = periodOf(asset.in_service_date);
    if (!start || base === 0) return [];

    const rows = [];
    let prevCumulative = 0;
    for (let n = 1; n <= life; n++) {
        const cumulative = Math.round((base * n) / life);
        rows.push({
            period_key: addMonths(start, n - 1),
            amount: cumulative - prevCumulative,
            accumulated: cumulative
        });
        prevCumulative = cumulative;
    }
    return rows;
}

/*
 * What is owed up to and including `throughPeriod`, given what has already been
 * posted.
 *
 * `postedThrough` is the last period this asset was depreciated for — null when
 * it never has been. Periods are returned individually rather than summed so the
 * caller can post one journal PER PERIOD: a single catch-up journal dated today
 * would put six months of depreciation into one month's P&L, and every monthly
 * comparison after it would be wrong.
 *
 * An asset put into service in a period that is already closed still owes those
 * periods; whether they can be POSTED is the ledger's decision, not this one.
 */
export function depreciationDue(asset = {}, throughPeriod, { postedThrough = null } = {}) {
    if (!PERIOD_RE.test(String(throughPeriod || ''))) return { periods: [], total: 0 };
    const schedule = depreciationSchedule(asset);
    const periods = schedule.filter((row) => {
        if (monthsBetween(row.period_key, throughPeriod) < 0) return false;   // not yet due
        if (postedThrough && monthsBetween(postedThrough, row.period_key) <= 0) return false; // already posted
        return true;
    });
    return { periods, total: periods.reduce((sum, r) => sum + r.amount, 0) };
}

/** Book value at the end of `periodKey` — cost less what the schedule has taken. */
export function bookValueAt(asset = {}, periodKey) {
    const cost = toInt(asset.cost);
    const schedule = depreciationSchedule(asset);
    if (!schedule.length) return cost;
    let accumulated = 0;
    schedule.forEach((row) => {
        if (monthsBetween(row.period_key, periodKey) >= 0) accumulated = row.accumulated;
    });
    return cost - accumulated;
}

/** Is this asset fully depreciated as at `periodKey`? */
export function isFullyDepreciated(asset = {}, periodKey) {
    const schedule = depreciationSchedule(asset);
    if (!schedule.length) return true;
    const last = schedule[schedule.length - 1];
    return monthsBetween(last.period_key, periodKey) >= 0;
}
