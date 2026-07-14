'use strict';

// Indonesian Rupiah, dot thousands separators, NO space after "Rp" (e.g. Rp1.234.567).
// Mirrors the strict currency rule in docs/DESIGN_SYSTEM.md.
function formatRupiah(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'Rp0';
    return 'Rp' + Math.round(n).toLocaleString('id-ID');
}

// Human date for emails, localized. Node 20 ships full ICU.
function formatDate(millis, locale) {
    const d = new Date(millis);
    if (Number.isNaN(d.getTime())) return '';
    const loc = locale === 'id' ? 'id-ID' : 'en-US';
    return d.toLocaleDateString(loc, { day: 'numeric', month: 'long', year: 'numeric' });
}

// Minimal HTML escaping for any value interpolated into an email body.
function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// First name only, for greetings ("Hi Andi,").
function firstName(full) {
    if (!full) return null;
    const part = String(full).trim().split(/\s+/)[0];
    return part || null;
}

// Multi-currency money formatting for invoice surfaces (mirror of the client
// assets/js/money-format.js). Amounts are integer minor units — IDR in rupiah
// (0 decimals), USD/SGD in cents. No space after the symbol.
const CURRENCY_CFG = {
    IDR: { symbol: 'Rp', decimals: 0, minorPerUnit: 1, locale: 'id-ID' },
    USD: { symbol: '$', decimals: 2, minorPerUnit: 100, locale: 'en-US' },
    SGD: { symbol: 'S$', decimals: 2, minorPerUnit: 100, locale: 'en-US' },
};
function formatMoney(minor, currency) {
    const c = CURRENCY_CFG[currency] || CURRENCY_CFG.IDR;
    const n = Number(minor);
    const units = (Number.isFinite(n) ? Math.abs(n) : 0) / c.minorPerUnit;
    return c.symbol + units.toLocaleString(c.locale, { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals });
}

module.exports = { formatRupiah, formatDate, escapeHtml, firstName, formatMoney, CURRENCY_CFG };
