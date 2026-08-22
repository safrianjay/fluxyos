'use strict';

// Indonesian Rupiah. DEPRECATED for workspace money — it hardcodes the currency,
// so it renders "Rp" in a Philippine business's own emails. Use formatBase(value,
// currency) and pass the workspace's base currency. Retained for FluxyOS's OWN
// billing, which is genuinely IDR.
function formatRupiah(value) {
    return formatBase(value, 'IDR');
}

/**
 * Money in a workspace's base currency, from integer MINOR units.
 *
 * The currency is a REQUIRED argument by design. This module runs inside Netlify
 * functions that process many tenants per invocation — the weekly-digest sweep
 * iterates every subscribed user — so a module-level "current currency" would be
 * a cross-tenant leak, sending one business's numbers with another's symbol.
 * Defaults to IDR only when nothing is supplied, matching the client seam.
 */
function formatBase(minor, currency) {
    const c = CURRENCY_CFG[currency] || CURRENCY_CFG.IDR;
    const n = Number(minor);
    if (!Number.isFinite(n)) return c.symbol + '0';
    const neg = n < 0;
    const units = Math.abs(n) / c.minorPerUnit;
    const body = units.toLocaleString(c.locale, { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals });
    return (neg ? '-' : '') + c.symbol + body;
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
    SGD: { symbol: 'S$', decimals: 2, minorPerUnit: 100, locale: 'en-SG' },
    PHP: { symbol: '₱', decimals: 2, minorPerUnit: 100, locale: 'en-PH' },
    MYR: { symbol: 'RM', decimals: 2, minorPerUnit: 100, locale: 'ms-MY' },
};
function formatMoney(minor, currency) {
    const c = CURRENCY_CFG[currency] || CURRENCY_CFG.IDR;
    const n = Number(minor);
    const units = (Number.isFinite(n) ? Math.abs(n) : 0) / c.minorPerUnit;
    return c.symbol + units.toLocaleString(c.locale, { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals });
}

module.exports = { formatRupiah, formatBase, formatDate, escapeHtml, firstName, formatMoney, CURRENCY_CFG };
