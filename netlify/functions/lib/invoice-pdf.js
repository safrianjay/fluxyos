'use strict';

// =============================================================================
// Invoice PDF renderer (server-side, headless Chromium)
//
// Renders a finalized invoice to a print-quality A4 PDF using puppeteer-core +
// @sparticuz/chromium. This is the ONLY place Chromium is loaded, so it must
// only ever be required by the background function (invoice-email-background.js)
// — never a standard/scheduled function, to keep those bundles small.
//
// The invoice document markup is a self-contained HTML string with an inlined
// stylesheet (there is no frontend build step to run Tailwind server-side, so
// buildInvoiceDocHTML's utility classes are NOT reused — this is a frozen,
// parallel layout driven by the same invoice/items fields). Amounts use a
// tabular-nums system sans stack per docs/DESIGN_SYSTEM.md (no monospace zero),
// Rupiah with dot separators and no space after "Rp".
// =============================================================================

const { formatRupiah, escapeHtml } = require('../../../functions/lib/format');

const NAVY = '#0B0F19';
const ORANGE = '#EA580C';
const INK = '#111827';
const MUTED = '#6B7280';
const BORDER = '#E5E7EB';

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

function formatDate(v, locale) {
    const ms = toMillis(v);
    if (ms == null) return '—';
    const loc = locale === 'id' ? 'id-ID' : 'en-US';
    return new Date(ms).toLocaleDateString(loc, { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatQty(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// Build the standalone invoice document HTML (inlined CSS, no external assets
// unless a data-URI logo is supplied).
function buildInvoiceHtml({ invoice, items, businessName, locale, logoUrl }) {
    const id = locale === 'id';
    const rp = formatRupiah;
    const isVoid = invoice.status === 'void';
    const isPaid = invoice.status === 'paid';
    const amountDue = (isVoid || isPaid) ? 0 : invoice.amount_due;
    const t = (en, idn) => (id ? idn : en);

    const rows = (items && items.length)
        ? items.map((it) => `
            <tr>
                <td class="desc">${escapeHtml(it.description)}</td>
                <td class="num">${formatQty(it.quantity)}</td>
                <td class="num">${rp(it.unit_price)}</td>
                <td class="num">${rp(it.amount)}</td>
            </tr>`).join('')
        : `<tr><td colspan="4" class="empty">${t('No line items', 'Tidak ada item')}</td></tr>`;

    const taxRow = Number(invoice.tax_amount) > 0
        ? `<tr><td colspan="3" class="tot-label">${t('Tax', 'Pajak')}${invoice.tax_rate_percent ? ` (${escapeHtml(invoice.tax_rate_percent)}%)` : ''}</td><td class="num">${rp(invoice.tax_amount)}</td></tr>`
        : '';

    const statusTag = isVoid
        ? `<span class="tag tag-void">${t('VOID', 'BATAL')}</span>`
        : (isPaid ? `<span class="tag tag-paid">${t('PAID', 'LUNAS')}</span>` : '');

    const logo = logoUrl
        ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="">`
        : '';

    return `<!DOCTYPE html>
<html lang="${id ? 'id' : 'en'}">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: ${INK};
    font-size: 12px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .num, .money { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
  .page { padding: 44px 48px; }
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
  .logo { height: 32px; width: auto; display: block; margin-bottom: 8px; }
  .title { font-size: 22px; font-weight: 700; color: ${NAVY}; letter-spacing: -0.01em; margin: 0; }
  .biz { text-align: right; font-size: 14px; font-weight: 600; color: ${MUTED}; max-width: 45%; }
  .tag { display: inline-block; margin-top: 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; }
  .tag-void { color: #DC2626; }
  .tag-paid { color: #16A34A; }
  .meta { margin-top: 22px; display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
  .meta h4 { margin: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${MUTED}; }
  .meta .val { color: ${INK}; }
  .meta .muted { color: ${MUTED}; }
  .due-banner { margin-top: 22px; padding: 14px 18px; background: #F9FAFB; border: 1px solid ${BORDER}; border-radius: 12px; }
  .due-banner .amt { font-size: 20px; font-weight: 700; color: ${NAVY}; letter-spacing: -0.01em; }
  .due-banner .lbl { font-size: 12px; color: ${MUTED}; margin-top: 2px; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 26px; }
  table.items thead th { text-align: left; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: ${MUTED}; border-bottom: 2px solid ${NAVY}; padding: 0 0 8px; }
  table.items thead th.num, table.items td.num { text-align: right; }
  table.items td { padding: 9px 0; border-bottom: 1px solid #F1F2F4; vertical-align: top; }
  table.items td.desc { color: ${INK}; padding-right: 16px; }
  table.items td.empty { text-align: center; color: #9AA1AC; padding: 18px 0; }
  .totals { margin-top: 4px; width: 100%; border-collapse: collapse; }
  .totals td { padding: 6px 0; }
  .totals .tot-label { text-align: right; color: ${MUTED}; padding-right: 16px; }
  .totals td.num { text-align: right; color: ${INK}; }
  .totals tr.grand td { border-top: 2px solid ${NAVY}; font-weight: 700; color: ${NAVY}; font-size: 14px; padding-top: 10px; }
  .totals tr.grand .tot-label { color: ${NAVY}; }
  .note { margin-top: 18px; padding-top: 12px; border-top: 1px solid #F1F2F4; color: ${MUTED}; font-size: 12px; }
  .foot { margin-top: 28px; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: #9AA1AC; }
  .accent { color: ${ORANGE}; }
</style>
</head>
<body>
  <div class="page">
    <div class="head">
      <div>
        ${logo}
        <h1 class="title">Invoice</h1>
        ${statusTag}
      </div>
      <div class="biz">${escapeHtml(businessName || 'FluxyOS')}</div>
    </div>

    <div class="meta">
      <div>
        <h4>${t('From', 'Dari')}</h4>
        <div class="val">${escapeHtml(businessName || 'FluxyOS')}</div>
      </div>
      <div>
        <h4>${t('Bill to', 'Ditagihkan ke')}</h4>
        <div class="val">${escapeHtml(invoice.customer_name || t('Customer', 'Pelanggan'))}</div>
        ${invoice.customer_email ? `<div class="muted">${escapeHtml(invoice.customer_email)}</div>` : ''}
      </div>
      <div>
        <h4>${t('Invoice number', 'Nomor invoice')}</h4>
        <div class="val num">${escapeHtml(invoice.invoice_number || '—')}</div>
      </div>
      <div>
        <h4>${t('Issue / Due date', 'Tanggal terbit / jatuh tempo')}</h4>
        <div class="val">${formatDate(invoice.issue_date, locale)} → ${formatDate(invoice.due_date, locale)}</div>
      </div>
    </div>

    <div class="due-banner">
      <div class="amt money">${rp(amountDue)}</div>
      <div class="lbl">${t('Amount due', 'Jumlah tagihan')} · ${t('due', 'jatuh tempo')} ${formatDate(invoice.due_date, locale)}</div>
    </div>

    ${invoice.memo ? `<div class="note">${escapeHtml(invoice.memo)}</div>` : ''}

    <table class="items">
      <thead>
        <tr>
          <th>${t('Description', 'Deskripsi')}</th>
          <th class="num">${t('Qty', 'Qty')}</th>
          <th class="num">${t('Unit price', 'Harga satuan')}</th>
          <th class="num">${t('Amount', 'Jumlah')}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <table class="totals money">
      <tr><td class="tot-label">${t('Subtotal', 'Subtotal')}</td><td class="num">${rp(invoice.subtotal_amount)}</td></tr>
      ${taxRow}
      <tr><td class="tot-label">${t('Total', 'Total')}</td><td class="num">${rp(invoice.total_amount)}</td></tr>
      <tr class="grand"><td class="tot-label">${t('Amount due', 'Jumlah tagihan')}</td><td class="num">${rp(amountDue)}</td></tr>
    </table>

    ${invoice.footer ? `<div class="note">${escapeHtml(invoice.footer)}</div>` : ''}
    <div class="foot">${escapeHtml(invoice.invoice_number || '')} · ${rp(amountDue)} ${t('due', 'jatuh tempo')} ${formatDate(invoice.due_date, locale)}</div>
  </div>
</body>
</html>`;
}

// Render the invoice to a PDF Buffer via headless Chromium.
async function renderInvoicePdf({ invoice, items, businessName, locale = 'en', logoUrl = null }) {
    // Required lazily so the heavy Chromium modules only load in the background
    // function bundle that actually calls this.
    const chromium = require('@sparticuz/chromium');
    const puppeteer = require('puppeteer-core');

    const html = buildInvoiceHtml({ invoice, items, businessName, locale, logoUrl });

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
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
        });
        return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

module.exports = { renderInvoicePdf, buildInvoiceHtml };
