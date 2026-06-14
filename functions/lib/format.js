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

module.exports = { formatRupiah, formatDate, escapeHtml, firstName };
