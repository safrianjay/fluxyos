/*
 * Shared multi-currency money helpers.
 *
 * TWO DISTINCT ROLES — do not confuse them (docs/PROJECT_BACKGROUND.md §4):
 *
 *   1. BASE CURRENCY — the workspace's accounting/reporting currency, set once
 *      at onboarding and immutable afterwards. Every workspace finance surface
 *      (KPIs, ledger, bills, budgets, statements, POS, inventory) renders in it.
 *      Read it with baseCurrency(); format with formatBase().
 *      Resolved from workspaces/{id}.base_currency by workspace-service.js and
 *      pushed in via setBaseCurrency(). Absent means IDR — a missing field can
 *      never render the wrong symbol, whereas a half-finished backfill can.
 *
 *   2. TRANSACTION CURRENCY — the face currency of one invoice or bill, which
 *      may differ from the base. Format with formatMoney(minor, currency).
 *      SUPPORTED is the invoice/bill allowlist and is mirrored in
 *      firestore.rules — do NOT widen it here without widening the rules too.
 *
 * FluxyOS's OWN billing (plan prices, checkout, internal ops, investor figures)
 * is locked to IDR and must NOT follow the workspace base currency — a Philippine
 * workspace still pays in rupiah. Those callers pass 'IDR' explicitly.
 *
 * STORAGE CONVENTION: every amount is an integer in the currency's MINOR unit.
 * IDR in rupiah (0 decimals, minorPerUnit 1 — so rupiah ARE minor units and all
 * existing IDR data is byte-identical), every other currency in cents/centavos.
 * That is why formatBase() takes minor units: for IDR it is a no-op, for PHP it
 * divides by 100. Rendering a PHP amount without this shows 100x the real money.
 *
 * UMD: window.FluxyMoney in the browser, module.exports in Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root || (typeof self !== 'undefined' ? self : this)).FluxyMoney = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // minorPerUnit = integer units per 1 currency unit; decimals = display digits.
    // No space after the symbol for ANY currency — matches the strict "Rp" rule in
    // docs/DESIGN_SYSTEM.md. Do not "correct" RM450.000,00 to RM 450.000,00.
    //
    // compact = which abbreviation set the short forms use. Indonesian uses
    // ribu/juta/miliar; everything else uses K/M/B. Keeping IDR on 'id' is what
    // makes the compact formatters byte-identical to the inline ones they replaced.
    var CURRENCIES = {
        IDR: { symbol: 'Rp', decimals: 0, minorPerUnit: 1,   locale: 'id-ID', label: 'Indonesian Rupiah', compact: 'id' },
        PHP: { symbol: '₱',  decimals: 2, minorPerUnit: 100, locale: 'en-PH', label: 'Philippine Peso',   compact: 'en' },
        SGD: { symbol: 'S$', decimals: 2, minorPerUnit: 100, locale: 'en-SG', label: 'Singapore Dollar',  compact: 'en' },
        MYR: { symbol: 'RM', decimals: 2, minorPerUnit: 100, locale: 'ms-MY', label: 'Malaysian Ringgit', compact: 'en' },
        USD: { symbol: '$',  decimals: 2, minorPerUnit: 100, locale: 'en-US', label: 'US Dollar',         compact: 'en' }
    };

    // Invoice/bill FACE currencies. Mirrored by firestore.rules — widening this
    // without widening the rules produces permission-denied on save.
    var SUPPORTED = ['IDR', 'USD', 'SGD'];

    // Workspace BASE currencies. Mirrored by isValidWorkspaceProfile in
    // firestore.rules and by the onboarding country->currency map.
    var BASE_SUPPORTED = ['IDR', 'PHP', 'SGD', 'MYR'];

    // Country -> default base currency. The country PRE-SELECTS the currency at
    // onboarding; it does not constrain it (a Singapore entity may legitimately
    // have a USD-style functional currency — IAS 21 follows the economic
    // environment, not the place of incorporation).
    var COUNTRY_CURRENCY = { ID: 'IDR', PH: 'PHP', SG: 'SGD', MY: 'MYR' };
    var COUNTRY_LABELS = { ID: 'Indonesia', PH: 'Philippines', SG: 'Singapore', MY: 'Malaysia' };

    var COMPACT_SUFFIXES = {
        id: { b: 'M',  m: 'jt', k: 'rb' },   // miliar / juta / ribu
        en: { b: 'B',  m: 'M',  k: 'K'  }
    };

    var DEFAULT_BASE = 'IDR';
    var BASE = DEFAULT_BASE;

    function cfg(currency) { return CURRENCIES[currency] || CURRENCIES[DEFAULT_BASE]; }

    // ---- Base currency (the workspace's accounting currency) -----------------

    /**
     * Set the active workspace base currency. Called once per page load by
     * workspace-service.js after the workspace profile resolves. Unknown or
     * absent codes fall back to IDR rather than throwing — a formatter must
     * never be the thing that breaks a page.
     */
    function setBaseCurrency(code) {
        var next = String(code || '').toUpperCase();
        BASE = CURRENCIES[next] ? next : DEFAULT_BASE;
        return BASE;
    }
    function baseCurrency() { return BASE; }
    function baseConfig() { return cfg(BASE); }
    function baseSymbol() { return cfg(BASE).symbol; }
    function baseDecimals() { return cfg(BASE).decimals; }
    function baseLocale() { return cfg(BASE).locale; }
    function baseCompact() { return COMPACT_SUFFIXES[cfg(BASE).compact] || COMPACT_SUFFIXES.en; }

    /**
     * True when a document's FACE currency differs from the workspace's
     * accounting currency — i.e. it needs an exchange rate to reach the ledger.
     *
     * Never write `currency !== 'IDR'`. That test is correct only in an Indonesian
     * workspace; in an SGD workspace it marks SGD as foreign and IDR as domestic,
     * which is exactly backwards. Singapore is where it bites first, because SGD
     * already appears throughout the invoice code as a TRANSACTION currency and
     * so the groundwork looks finished.
     *
     * An absent/empty currency means "same as base" — legacy rows predate the
     * field and were always in the accounting currency.
     */
    function isForeignCurrency(currency) {
        var c = String(currency == null ? '' : currency).toUpperCase();
        return !!c && c !== BASE;
    }

    /**
     * True when a currency has no minor unit in normal use (IDR). Drives input
     * placeholders and label shapes — "1.250.000" vs "1,250.00". Key formatting
     * decisions off THIS, not off `=== 'IDR'`, so PHP/SGD/MYR behave correctly.
     */
    function isZeroDecimal(currency) {
        return cfg(currency || BASE).decimals === 0;
    }

    /** Minor units -> whole currency units, in the base currency. IDR: identity. */
    function toBaseUnits(minor) {
        var n = Number(minor);
        if (!isFinite(n)) n = 0;
        return n / cfg(BASE).minorPerUnit;
    }

    /**
     * Format an integer minor-unit amount in the workspace base currency.
     * Sign-preserving and placed BEFORE the symbol (-Rp1.000, never Rp-1.000),
     * matching the negative-money convention in docs/DESIGN_SYSTEM.md.
     * Callers that previously wrapped the value in Math.abs() must keep doing so
     * to stay byte-identical.
     */
    function formatBase(minor) {
        var c = cfg(BASE);
        var n = Number(minor);
        if (!isFinite(n)) n = 0;
        var neg = n < 0;
        var units = Math.abs(n) / c.minorPerUnit;
        var body = units.toLocaleString(c.locale, { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals });
        return (neg ? '-' : '') + c.symbol + body;
    }

    /**
     * Format with an explicit fraction-digit cap, in the base currency. For the
     * few surfaces that show a derived RATE rather than a money amount (e.g. an
     * inventory unit cost), where trailing precision is meaningful.
     */
    function formatBasePrecise(minor, maxFractionDigits) {
        var c = cfg(BASE);
        var n = Number(minor);
        if (!isFinite(n)) n = 0;
        var neg = n < 0;
        var units = Math.abs(n) / c.minorPerUnit;
        var max = typeof maxFractionDigits === 'number' ? maxFractionDigits : c.decimals;
        var body = units.toLocaleString(c.locale, { maximumFractionDigits: max });
        return (neg ? '-' : '') + c.symbol + body;
    }

    // ---- Transaction currency (invoice/bill face value) ----------------------

    // Format an integer minor-unit amount for display, e.g. 150000,'USD' -> "$1,500.00".
    // Always renders the magnitude — callers handle sign.
    function formatMoney(minor, currency) {
        var c = cfg(currency);
        var n = Number(minor);
        if (!isFinite(n)) n = 0;
        var units = Math.abs(n) / c.minorPerUnit;
        var body = units.toLocaleString(c.locale, { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals });
        return c.symbol + body;
    }

    // Parse a user-typed amount into integer minor units.
    //   IDR: digits only -> rupiah.   Others: decimal units -> cents.
    function toMinor(input, currency) {
        var c = cfg(currency);
        if (c.decimals === 0) {
            return Math.round(Number(String(input == null ? '' : input).replace(/[^\d]/g, '')) || 0);
        }
        // Commas are thousands separators (drop them); the dot is the decimal.
        var raw = String(input == null ? '' : input).replace(/,/g, '').replace(/[^\d.]/g, '');
        var firstDot = raw.indexOf('.');
        if (firstDot !== -1) raw = raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, '');
        var val = Number(raw) || 0;
        return Math.round(val * c.minorPerUnit);
    }

    // Integer minor units -> a Number in whole currency units (for math/display prep).
    function fromMinor(minor, currency) {
        var c = cfg(currency);
        return (Number(minor) || 0) / c.minorPerUnit;
    }

    // As-you-type input formatting (thousands grouping, currency-aware decimals).
    function formatMoneyInput(value, currency) {
        var c = cfg(currency);
        if (c.decimals === 0) {
            var digits = String(value == null ? '' : value).replace(/\D/g, '');
            return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        }
        // Commas are display-only thousands separators — strip them; the dot is
        // the decimal. Re-group the integer part with commas as the user types.
        var raw = String(value == null ? '' : value).replace(/,/g, '').replace(/[^\d.]/g, '');
        var dot = raw.indexOf('.');
        var intPart = (dot === -1 ? raw : raw.slice(0, dot)).replace(/\D/g, '');
        var decPart = dot === -1 ? '' : raw.slice(dot + 1).replace(/\D/g, '').slice(0, c.decimals);
        var grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return dot === -1 ? grouped : grouped + '.' + decPart;
    }

    function symbol(currency) { return cfg(currency).symbol; }
    function decimals(currency) { return cfg(currency).decimals; }
    function isSupported(currency) { return SUPPORTED.indexOf(currency) !== -1; }
    function isSupportedBase(currency) { return BASE_SUPPORTED.indexOf(currency) !== -1; }
    function currencyForCountry(code) { return COUNTRY_CURRENCY[String(code || '').toUpperCase()] || null; }

    return {
        CURRENCIES: CURRENCIES,
        SUPPORTED: SUPPORTED,
        BASE_SUPPORTED: BASE_SUPPORTED,
        COUNTRY_CURRENCY: COUNTRY_CURRENCY,
        COUNTRY_LABELS: COUNTRY_LABELS,
        DEFAULT_BASE: DEFAULT_BASE,

        setBaseCurrency: setBaseCurrency,
        baseCurrency: baseCurrency,
        baseConfig: baseConfig,
        baseSymbol: baseSymbol,
        baseDecimals: baseDecimals,
        baseLocale: baseLocale,
        baseCompact: baseCompact,
        toBaseUnits: toBaseUnits,
        isForeignCurrency: isForeignCurrency,
        isZeroDecimal: isZeroDecimal,
        formatBase: formatBase,
        formatBasePrecise: formatBasePrecise,

        formatMoney: formatMoney,
        toMinor: toMinor,
        fromMinor: fromMinor,
        formatMoneyInput: formatMoneyInput,
        symbol: symbol,
        decimals: decimals,
        isSupported: isSupported,
        isSupportedBase: isSupportedBase,
        currencyForCountry: currencyForCountry
    };
});
