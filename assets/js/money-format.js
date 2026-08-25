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
        IDR: { symbol: 'Rp', decimals: 0, minorPerUnit: 1,   locale: 'id-ID', label: 'Indonesian Rupiah', compact: 'id', shortName: 'Rupiah', unit: 'rupiah' },
        PHP: { symbol: '₱',  decimals: 2, minorPerUnit: 100, locale: 'en-PH', label: 'Philippine Peso',   compact: 'en', shortName: 'Peso', unit: 'peso' },
        SGD: { symbol: 'S$', decimals: 2, minorPerUnit: 100, locale: 'en-SG', label: 'Singapore Dollar',  compact: 'en', shortName: 'Singapore Dollar', unit: 'dollar' },
        MYR: { symbol: 'RM', decimals: 2, minorPerUnit: 100, locale: 'ms-MY', label: 'Malaysian Ringgit', compact: 'en', shortName: 'Ringgit', unit: 'ringgit' },
        USD: { symbol: '$',  decimals: 2, minorPerUnit: 100, locale: 'en-US', label: 'US Dollar',         compact: 'en', shortName: 'US Dollar', unit: 'dollar' }
    };

    // Invoice/bill FACE currencies. Mirrored by firestore.rules — widening this
    // without widening the rules produces permission-denied on save.
    var SUPPORTED = ['IDR', 'USD', 'SGD', 'PHP', 'MYR'];

    // Workspace BASE currencies. Mirrored by isValidWorkspaceProfile in
    // firestore.rules and by the onboarding country->currency map.
    var BASE_SUPPORTED = ['IDR', 'PHP', 'SGD', 'MYR'];

    // Country -> default base currency. The country PRE-SELECTS the currency at
    // onboarding; it does not constrain it (a Singapore entity may legitimately
    // have a USD-style functional currency — IAS 21 follows the economic
    // environment, not the place of incorporation).
    var COUNTRY_CURRENCY = { ID: 'IDR', PH: 'PHP', SG: 'SGD', MY: 'MYR' };
    var COUNTRY_LABELS = { ID: 'Indonesia', PH: 'Philippines', SG: 'Singapore', MY: 'Malaysia' };

    /*
     * Country profile — the single source for country-shaped UX.
     *
     * Placeholders and examples are the quiet part of feeling local. A Manila
     * owner reading "e.g. Jl. Sudirman No. 1, Jakarta 10210" learns, correctly,
     * that this product was not built for them. Centralised here so a page never
     * decides its own examples, and so a new market is one entry rather than a
     * hunt through every form.
     *
     * These are ILLUSTRATIVE addresses and business names — recognisable streets,
     * invented businesses. Never real customer data.
     */
    var COUNTRY_PROFILES = {
        ID: { dial: '+62', city: 'Jakarta', postal: '10210',
              address: 'Jl. Sudirman No. 1, Jakarta 10210',
              business: 'Kopi Senja Digital', vendor: 'Toko Sinar Jaya',
              taxId: 'NPWP', taxIdSample: '00.000.000.0-000.000',
              name: 'Indonesia', timezone: 'Asia/Jakarta' },
        PH: { dial: '+63', city: 'Makati', postal: '1200',
              address: '123 Ayala Avenue, Makati 1200',
              business: 'Manila Coffee House', vendor: 'Santos Trading',
              taxId: 'TIN', taxIdSample: '000-000-000-000',
              name: 'Philippines', timezone: 'Asia/Manila' },
        SG: { dial: '+65', city: 'Singapore', postal: '238823',
              address: '10 Orchard Road, Singapore 238823',
              business: 'Orchard Coffee', vendor: 'Tan Supplies',
              taxId: 'UEN', taxIdSample: '200912345A',
              name: 'Singapore', timezone: 'Asia/Singapore' },
        MY: { dial: '+60', city: 'Kuala Lumpur', postal: '55100',
              address: 'Jalan Bukit Bintang 10, Kuala Lumpur 55100',
              business: 'Kuala Lumpur Coffee Co.', vendor: 'Lim Trading',
              taxId: 'Tax Identification No.', taxIdSample: 'C1234567890',
              name: 'Malaysia', timezone: 'Asia/Kuala_Lumpur' }
    };

    /** Country profile for the active workspace. Unknown country = Indonesia. */
    function countryProfile(code) {
        var c = code || (typeof window !== 'undefined' && window.FluxyWorkspace && window.FluxyWorkspace.country) || 'ID';
        return COUNTRY_PROFILES[c] || COUNTRY_PROFILES.ID;
    }

    /**
     * Fill every element marked `data-country-example="<key>"` with the active
     * country's example. Works on placeholders and on text. Idempotent, so it is
     * safe to call after any DOM injection.
     */
    function paintCountryExamples(root, country) {
        if (typeof document === 'undefined') return;
        var prof = countryProfile(country);
        var nodes = (root || document).querySelectorAll('[data-country-example]');
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            var val = prof[el.getAttribute('data-country-example')];
            if (!val) continue;
            if ('placeholder' in el) el.placeholder = (el.getAttribute('data-country-prefix') || '') + val;
            else el.textContent = val;
        }
    }

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

    /*
     * Fill every element marked `data-money-symbol` with the base currency's
     * symbol. Static HTML prefix chips (the "Rp" glued to the left of an amount
     * input) cannot interpolate, and hardcoding them is how "Amount (Rp)" reached
     * a peso workspace. Idempotent and safe to call after any DOM injection.
     */
    function paintSymbols(root) {
        if (typeof document === 'undefined') return;
        var scope = root || document;
        var nodes = scope.querySelectorAll ? scope.querySelectorAll('[data-money-symbol]') : [];
        for (var i = 0; i < nodes.length; i++) nodes[i].textContent = cfg(BASE).symbol;
    }

    function symbol(currency) { return cfg(currency).symbol; }
    function decimals(currency) { return cfg(currency).decimals; }
    function isSupported(currency) { return SUPPORTED.indexOf(currency) !== -1; }
    function isSupportedBase(currency) { return BASE_SUPPORTED.indexOf(currency) !== -1; }
    function currencyForCountry(code) { return COUNTRY_CURRENCY[String(code || '').toUpperCase()] || null; }


    // ---- Input round-trip helpers -------------------------------------------
    //
    // Money inputs have TWO distinct jobs and conflating them corrupts amounts.
    // Both bugs shipped and both were silent:
    //
    //   seedMoneyInput  — render a STORED minor value into an empty field.
    //     Grouping the minor value directly is only right for a 0-decimal
    //     currency; on PHP the field shrank 100x per keystroke.
    //
    //   liveMoneyInput  — reformat what the user has TYPED, as they type.
    //     Must format the typed string, NOT a value re-derived from minor:
    //     round-tripping through minor discards an in-progress decimal, so
    //     "1250.75" collapsed to "125,075" — a 100x overstatement, accepted
    //     without complaint.
    //
    // Anything editable uses these two. Nothing formats money for an input by hand.
    function seedMoneyInput(minor) {
        var b = baseCurrency();
        return formatMoneyInput(String(fromMinor(Math.max(0, Number(minor) || 0), b)), b);
    }
    function liveMoneyInput(typed) {
        return formatMoneyInput(typed, baseCurrency());
    }
    // A 2-decimal currency needs a keypad that has a decimal point at all.
    function moneyInputMode() {
        return isZeroDecimal(baseCurrency()) ? 'numeric' : 'decimal';
    }

    // ---- Locale-aware non-money formatting -----------------------------------
    //
    // Counts, quantities and timestamps were hardcoded to id-ID across the app,
    // so a Manila workspace read "1.200 units" and "22 Agu" — Indonesian
    // conventions on a Philippine company's books. These follow the base locale.
    function baseNumber(value, opts) {
        return (Number(value) || 0).toLocaleString(baseLocale(), opts || undefined);
    }
    function baseDateTime(date, opts) {
        var d = (date instanceof Date) ? date : new Date(date);
        if (!d || isNaN(d.getTime())) return '';
        return d.toLocaleString(baseLocale(), opts || undefined);
    }


    // The currency's NAME, for prose. "Rupiah amount paid" is a hardcoded country
    // as surely as a hardcoded symbol is — it just survives a symbol sweep.
    // shortName is title-case for labels ("Peso amount paid"); unit is the
    // lowercase singular for mid-sentence use ("of every peso of revenue").
    function baseCurrencyName() { return cfg(BASE).shortName || cfg(BASE).label; }
    function baseCurrencyUnit() { return cfg(BASE).unit || cfg(BASE).shortName; }
    function currencyName(currency) { var c = cfg(currency); return c.shortName || c.label; }
    // Static markup counterpart to paintSymbols, for copy the page ships before
    // the workspace currency is known.
    function paintCurrencyNames(root) {
        if (typeof document === 'undefined') return;
        var scope = root || document;
        var nodes = scope.querySelectorAll ? scope.querySelectorAll('[data-money-name]') : [];
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].textContent = nodes[i].getAttribute('data-money-name') === 'unit'
                ? baseCurrencyUnit() : baseCurrencyName();
        }
    }

    return {
        CURRENCIES: CURRENCIES,
        SUPPORTED: SUPPORTED,
        BASE_SUPPORTED: BASE_SUPPORTED,
        COUNTRY_CURRENCY: COUNTRY_CURRENCY,
        COUNTRY_LABELS: COUNTRY_LABELS,
        COUNTRY_PROFILES: COUNTRY_PROFILES,
        countryProfile: countryProfile,
        paintCountryExamples: paintCountryExamples,
        DEFAULT_BASE: DEFAULT_BASE,

        setBaseCurrency: setBaseCurrency,
        baseCurrency: baseCurrency,
        baseConfig: baseConfig,
        baseSymbol: baseSymbol,
        baseDecimals: baseDecimals,
        baseLocale: baseLocale,
        baseCompact: baseCompact,
        paintSymbols: paintSymbols,
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
        currencyForCountry: currencyForCountry,
        baseCurrencyName: baseCurrencyName,
        baseCurrencyUnit: baseCurrencyUnit,
        currencyName: currencyName,
        paintCurrencyNames: paintCurrencyNames,
        seedMoneyInput: seedMoneyInput,
        liveMoneyInput: liveMoneyInput,
        moneyInputMode: moneyInputMode,
        baseNumber: baseNumber,
        baseDateTime: baseDateTime
    };
});
