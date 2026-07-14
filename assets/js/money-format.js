/*
 * Shared multi-currency money helpers for the invoice surfaces (IDR / USD / SGD).
 *
 * STORAGE CONVENTION: every invoice amount is an integer in the currency's MINOR
 * unit — IDR in rupiah (0 decimals, unchanged from before), USD/SGD in cents.
 * So the totals engine stays pure integer math and existing IDR data is
 * byte-identical. formatMoney() / toMinor() / fromMinor() convert for display
 * and input. The rest of the app stays strict-IDR (docs/DESIGN_SYSTEM.md); these
 * helpers are used ONLY on invoice list/detail/editor/preview/PDF/email.
 *
 * UMD: window.FluxyMoney in the browser, module.exports in Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root || (typeof self !== 'undefined' ? self : this)).FluxyMoney = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // minorPerUnit = integer units per 1 currency unit; decimals = display digits.
    // No space after the symbol for any currency (matches the strict "Rp" rule).
    var CURRENCIES = {
        IDR: { symbol: 'Rp', decimals: 0, minorPerUnit: 1, locale: 'id-ID', label: 'Indonesian Rupiah' },
        USD: { symbol: '$', decimals: 2, minorPerUnit: 100, locale: 'en-US', label: 'US Dollar' },
        SGD: { symbol: 'S$', decimals: 2, minorPerUnit: 100, locale: 'en-US', label: 'Singapore Dollar' }
    };
    var SUPPORTED = ['IDR', 'USD', 'SGD'];

    function cfg(currency) { return CURRENCIES[currency] || CURRENCIES.IDR; }

    // Format an integer minor-unit amount for display, e.g. 150000,'USD' -> "$1,500.00".
    function formatMoney(minor, currency) {
        var c = cfg(currency);
        var n = Number(minor);
        if (!isFinite(n)) n = 0;
        var units = Math.abs(n) / c.minorPerUnit;
        var body = units.toLocaleString(c.locale, { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals });
        return c.symbol + body;
    }

    // Parse a user-typed amount into integer minor units.
    //   IDR: digits only -> rupiah.   USD/SGD: decimal dollars -> cents.
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

    return {
        CURRENCIES: CURRENCIES,
        SUPPORTED: SUPPORTED,
        formatMoney: formatMoney,
        toMinor: toMinor,
        fromMinor: fromMinor,
        formatMoneyInput: formatMoneyInput,
        symbol: symbol,
        decimals: decimals,
        isSupported: isSupported
    };
});
