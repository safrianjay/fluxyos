'use strict';

// =============================================================================
// Invoice PDF renderer (server-side, headless Chromium)
//
// Renders a finalized invoice to a print-quality A4 PDF using puppeteer-core +
// @sparticuz/chromium. This is the ONLY place Chromium is loaded, so it must
// only ever be required by the background function (invoice-email-background.js).
//
// The invoice markup comes from the SHARED template
// (assets/js/invoice-doc-template.js) — the exact same builder the invoices page
// uses for "Preview / Download PDF" — wrapped with its frozen stylesheet
// (INVOICE_DOC_CSS) so the emailed PDF matches the page's PDF, with no Tailwind
// needed at runtime. Amounts are IDR (Rupiah, dot separators, no space after Rp)
// per docs/DESIGN_SYSTEM.md; the customer's language drives date formatting.
// =============================================================================

const { formatRupiah, escapeHtml } = require('../../../functions/lib/format');
const { buildInvoiceDocHTML, INVOICE_DOC_CSS } = require('../../../assets/js/invoice-doc-template');

function toMillis(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    if (v._seconds != null) return v._seconds * 1000;
    if (v.seconds != null) return v.seconds * 1000;
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
}

function makeFormatters(locale) {
    return {
        esc: escapeHtml,
        money: formatRupiah,
        qty(v) {
            const n = Number(v);
            if (!Number.isFinite(n)) return '0';
            return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
        },
        date(v) {
            const ms = toMillis(v);
            if (ms == null) return '—';
            return new Date(ms).toLocaleDateString(locale === 'id' ? 'id-ID' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' });
        },
    };
}

// Full standalone HTML document (shared markup + frozen CSS). A modest page
// margin gives print whitespace; the .invoice-doc card supplies the rest.
function buildInvoiceHtml({ invoice, items, businessName, locale = 'en' }) {
    const doc = buildInvoiceDocHTML(invoice, items, { businessName, fmt: makeFormatters(locale) });
    return `<!DOCTYPE html>
<html lang="${locale === 'id' ? 'id' : 'en'}">
<head>
<meta charset="utf-8">
<style>
${INVOICE_DOC_CSS}
@page { margin: 24px; }
body { padding: 0; }
</style>
</head>
<body>${doc}</body>
</html>`;
}

// Render the invoice to a PDF Buffer via headless Chromium.
async function renderInvoicePdf({ invoice, items, businessName, locale = 'en' }) {
    // Required lazily so the heavy Chromium modules only load in the background
    // function bundle that actually calls this.
    const chromium = require('@sparticuz/chromium');
    const puppeteer = require('puppeteer-core');

    const html = buildInvoiceHtml({ invoice, items, businessName, locale });

    let browser = null;
    try {
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '24px', right: '24px', bottom: '24px', left: '24px' },
        });
        return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

module.exports = { renderInvoicePdf, buildInvoiceHtml };
