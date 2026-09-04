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

    return {
        DEFAULTS: DEFAULTS,
        normalizeSettings: normalizeSettings,
        computeBillTotals: computeBillTotals,
        presetDiscountAmount: presetDiscountAmount
    };
}));
