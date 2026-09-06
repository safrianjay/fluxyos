// =============================================================================
// FluxyOS — what a till bill adds up to
//
// ONE MODULE, THREE CALLERS, and that is the whole point:
//
//   `_posTotals`            (pos-service.js)      the staff till
//   `qr-order` / `qr-menu`  (netlify/functions)   the diner's own phone
//   the settings preview    (settings-pos.html)   what the owner is shown
//
// Two copies of "what does this bill come to" is how a customer is charged one
// number and the books record another. The same reasoning that made
// `pos-availability.js` a single pure module with four callers.
//
// ⚠️ DUAL FORMAT ON PURPOSE. The client is ES modules and Netlify Functions are
// CommonJS, and this is the seam between them, so it is written as UMD and the
// function requires it by relative path. `money-format.js` and
// `netlify/functions/lib/format.js` are the same split kept as TWO files synced
// by a comment — which is exactly what this avoids.
//
// PURE: no Firestore, no DOM, no `window`, no clock. That is what lets
// `tests/pos-pricing.check.js` exercise every boundary in milliseconds rather
// than during service.
//
// Everything here is INTEGER MINOR UNITS in and out. Rates are percentages
// (11 means 11%), which is the one place a fraction is allowed — a rate is not
// an amount, and it is rounded into one exactly once, here.
// =============================================================================

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FluxyPosPricing = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var int = function (v) { return Math.round(Number(v) || 0); };
    var rate = function (v) {
        var n = Number(v);
        if (!isFinite(n) || n <= 0) return 0;
        return Math.min(100, n);
    };

    // What an outlet with no settings doc gets. Every flag off, which reproduces
    // the pre-settings behaviour exactly: `tax_amount` and `service_charge_amount`
    // stay 0 and the journal is byte-identical to what shipped before.
    var DEFAULTS = {
        tax_enabled: false,
        tax_label: 'PPN',
        tax_rate_percent: 0,
        tax_inclusive: false,
        service_enabled: false,
        service_rate_percent: 0,
        service_taxable: true
    };

    function normalizeSettings(s) {
        var v = s || {};
        return {
            tax_enabled: v.tax_enabled === true,
            tax_label: typeof v.tax_label === 'string' && v.tax_label ? v.tax_label : DEFAULTS.tax_label,
            tax_rate_percent: rate(v.tax_rate_percent),
            tax_inclusive: v.tax_inclusive === true,
            service_enabled: v.service_enabled === true,
            service_rate_percent: rate(v.service_rate_percent),
            // Whether the service charge is itself taxed. Defaults TRUE because
            // that is the common treatment: the charge is part of what the
            // customer pays for the meal.
            service_taxable: v.service_taxable !== false
        };
    }

    /**
     * @param {{subtotal:number, discountTotal:number, settings:object}} input
     * @returns {{base:number, service:number, tax:number, total:number,
     *            revenue:number, taxLabel:string, taxInclusive:boolean}}
     *
     * `base`    goods after discount — what the menu earned before anything is added
     * `service` the service charge, computed on `base`
     * `tax`     tax on (base + service, if service is taxable)
     * `total`   what the customer owes
     * `revenue` total − service − tax. The figure that reaches 4000.
     *
     * ⚠️ INCLUSIVE PRICING DOES NOT ADD, IT EXTRACTS. When menu prices already
     * contain the tax, adding it again charges the customer twice; the tax is
     * carved OUT of what they were already going to pay. `total` is therefore
     * unchanged by the tax rate in inclusive mode, and `revenue` drops instead —
     * which is correct, because in that mode part of the menu price was never
     * this workspace's money.
     */
    function computeBillTotals(input) {
        var i = input || {};
        var s = normalizeSettings(i.settings);
        var subtotal = Math.max(0, int(i.subtotal));
        var discountTotal = Math.max(0, Math.min(subtotal, int(i.discountTotal)));
        var base = subtotal - discountTotal;

        var service = s.service_enabled && s.service_rate_percent > 0
            ? int(base * s.service_rate_percent / 100)
            : 0;

        var taxBase = base + (s.service_taxable ? service : 0);
        var tax = 0;
        var total;

        if (!s.tax_enabled || s.tax_rate_percent <= 0) {
            total = base + service;
        } else if (s.tax_inclusive) {
            // Carve it out of a price that already contains it.
            //   gross = net × (1 + r)   ⇒   tax = gross − gross / (1 + r)
            var divisor = 1 + (s.tax_rate_percent / 100);
            tax = taxBase - int(taxBase / divisor);
            total = base + service;
        } else {
            tax = int(taxBase * s.tax_rate_percent / 100);
            total = base + service + tax;
        }

        return {
            base: base,
            service: service,
            tax: tax,
            total: total,
            // Never derived a second way. `_emitPosSale` computes net as
            // total − service − tax, and the two must not be able to disagree.
            revenue: total - service - tax,
            taxLabel: s.tax_label,
            taxInclusive: s.tax_inclusive
        };
    }

    /**
     * What a discount preset is worth against a given base.
     *
     * Lives here rather than in the till because the diner's phone will need the
     * same answer the moment presets reach the QR surface, and a percentage
     * rounded one way in one place is a bill that does not foot.
     */
    function presetDiscountAmount(preset, base) {
        var p = preset || {};
        var b = Math.max(0, int(base));
        if (!b) return 0;
        var value = Math.max(0, int(p.value));
        if (p.kind === 'percent') return Math.min(b, int(b * Math.min(100, value) / 100));
        return Math.min(b, value);
    }

    // ── SPLITTING A TICKET BY ITEM ──────────────────────────────────────────
    //
    // "I'll pay for my dish." The customer picks lines; this says what they owe,
    // INCLUDING their share of the ticket's service charge, tax and any
    // order-level discount — a split that charges the menu price and drops the
    // rest is a bill that does not foot and a restaurant that under-collects.
    //
    // ⚠️ THE INVARIANT IS EXACTNESS, NOT FAIRNESS. Split a 319.000 ticket three
    // ways and the three amounts must total 319.000 to the rupiah — otherwise
    // the last payer either cannot close the ticket (short by one) or is charged
    // for a rupiah nobody owes, and the order sits unsettled with the table
    // looking occupied. Proportional rounding does not give you that: three
    // shares of a third each round to 106.333 and sum to 319.999.
    //
    // So it allocates on the RUNNING TOTAL rather than per share:
    //
    //     amount = round(total × coveredAfter / all) − round(total × covered / all)
    //
    // Each payment is the difference between two rounded cumulative figures, so
    // the errors cancel and the final selection — whose `coveredAfter` is the
    // whole ticket — takes exactly whatever is left. True in any order, for any
    // partition, at any rounding.
    //
    // The WEIGHT is the line's net of its own discount: a half-price dish should
    // carry half the service charge with it. An order-level discount is not a
    // line's, so it spreads across everyone, which is what dividing into
    // `total` already does.
    function lineWeight(l) {
        var gross = int(l && l.gross_amount);
        var disc = int(l && l.discount_amount);
        return Math.max(0, gross - disc);
    }

    /**
     * @param {{lines:array, total:number, coveredIds:array, selectedIds:array}} input
     * @returns {{amount:number, weightAll:number, weightCovered:number,
     *            weightSelected:number, coversRest:boolean}}
     */
    function splitLineShare(input) {
        var i = input || {};
        var lines = Array.isArray(i.lines) ? i.lines : [];
        var total = int(i.total);
        var covered = {};
        (Array.isArray(i.coveredIds) ? i.coveredIds : []).forEach(function (id) { covered[id] = true; });
        var selected = {};
        (Array.isArray(i.selectedIds) ? i.selectedIds : []).forEach(function (id) { selected[id] = true; });

        // A ticket discounted to nothing has no gross to weigh, and dividing by
        // it would produce NaN on every share. Each line then counts as one, so
        // the partition still adds up exactly — which is the property that
        // matters when there is no money to apportion.
        var flat = lines.reduce(function (t, l) { return t + lineWeight(l); }, 0) <= 0;
        var w = function (l) { return flat ? 1 : lineWeight(l); };

        var all = 0; var wCovered = 0; var wSelected = 0;
        lines.forEach(function (l) {
            var id = l && l.line_id;
            var weight = w(l);
            all += weight;
            if (covered[id]) wCovered += weight;
            else if (selected[id]) wSelected += weight;
        });
        if (all <= 0) {
            return { amount: 0, weightAll: 0, weightCovered: 0, weightSelected: 0, coversRest: true };
        }

        var after = wCovered + wSelected;
        var amount = Math.round(total * after / all) - Math.round(total * wCovered / all);
        return {
            amount: Math.max(0, amount),
            weightAll: all,
            weightCovered: wCovered,
            weightSelected: wSelected,
            // The selection finishes the ticket, so it takes the exact remainder.
            coversRest: after >= all
        };
    }

    return {
        DEFAULTS: DEFAULTS,
        splitLineShare: splitLineShare,
        normalizeSettings: normalizeSettings,
        computeBillTotals: computeBillTotals,
        presetDiscountAmount: presetDiscountAmount
    };
}));
