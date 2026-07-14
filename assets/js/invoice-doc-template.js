/*
 * Shared invoice-document template — SINGLE SOURCE for the invoice UI rendered
 * both on the invoices page ("Preview / Download PDF") and in the emailed PDF
 * (netlify/functions/lib/invoice-pdf.js via headless Chromium). Keeping one
 * markup builder here means the two can't drift apart structurally.
 *
 * UMD: attaches to window.FluxyInvoiceDoc in the browser and module.exports in
 * Node (the Netlify function requires it). No browser-only APIs at load time.
 *
 * The markup uses the same Tailwind utility classes the page already renders, so
 * on-page output is byte-identical to before. INVOICE_DOC_CSS is a frozen
 * stylesheet reproducing exactly those utilities (+ the print-variant .invoice-doc
 * card) for the server, which has no Tailwind at runtime — so the emailed PDF
 * matches the page's downloaded PDF.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root || (typeof self !== 'undefined' ? self : this)).FluxyInvoiceDoc = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function escDefault(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function moneyDefault(v) {
        var n = Number(v);
        if (!isFinite(n)) return 'Rp0';
        return 'Rp' + Math.round(Math.abs(n)).toLocaleString('id-ID');
    }
    function qtyDefault(v) {
        var n = Number(v) || 0;
        return Number.isInteger(n) ? String(n) : n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
    }
    function dateDefault(v) { return v ? String(v) : '—'; }

    // Build the invoice document markup. Formatters are injected via opts.fmt so
    // the page keeps its locale-aware helpers and the server passes its own —
    // identical structure + CSS either way. opts: { businessName, fmt:{esc, money,
    // qty, date} }.
    function buildInvoiceDocHTML(invoice, items, opts) {
        opts = opts || {};
        var businessName = opts.businessName || 'Your business';
        var fmt = opts.fmt || {};
        var esc = fmt.esc || escDefault;
        var money = fmt.money || moneyDefault;
        var qty = fmt.qty || qtyDefault;
        var date = fmt.date || dateDefault;
        items = items || [];

        var due = date(invoice.due_date);
        var isVoid = invoice.status === 'void';
        var isPaid = invoice.status === 'paid';
        var amountDue = (isVoid || isPaid) ? 0 : invoice.amount_due;

        var itemRows = items.length
            ? items.map(function (item) {
                return '\n                <tr class="border-b border-gray-100">'
                    + '<td class="py-2 text-gray-900">' + esc(item.description) + '</td>'
                    + '<td class="py-2 text-right invoice-doc-money text-gray-700">' + qty(item.quantity) + '</td>'
                    + '<td class="py-2 text-right invoice-doc-money text-gray-700">' + money(item.unit_price) + '</td>'
                    + '<td class="py-2 text-right invoice-doc-money text-gray-900">' + money(item.amount) + '</td>'
                    + '</tr>';
            }).join('')
            : '<tr><td colspan="4" class="py-3 text-center text-gray-400">No line items</td></tr>';

        var taxRow = Number(invoice.tax_amount) > 0
            ? '<tr><td colspan="3" class="py-1.5 text-right text-gray-500">Tax' + (invoice.tax_rate_percent ? ' (' + esc(invoice.tax_rate_percent) + '%)' : '') + '</td><td class="py-1.5 text-right text-gray-900">' + money(invoice.tax_amount) + '</td></tr>'
            : '';

        return ''
            + '<div class="invoice-doc bg-white p-6 sm:p-8">'
            +   '<div class="flex items-start justify-between gap-4">'
            +     '<div>'
            +       '<h3 class="text-[20px] font-semibold text-gray-900">Invoice</h3>'
            +       (isVoid ? '<p class="mt-1 text-[12px] font-bold uppercase tracking-[0.08em] text-red-600">Void</p>' : '')
            +       (isPaid ? '<p class="mt-1 text-[12px] font-bold uppercase tracking-[0.08em] text-[#16A34A]">Paid</p>' : '')
            +     '</div>'
            +     '<p class="max-w-[45%] truncate text-right text-[14px] font-semibold text-gray-500">' + esc(businessName) + '</p>'
            +   '</div>'
            +   '<dl class="mt-5 space-y-1 text-[12px]">'
            +     '<div class="flex gap-3"><dt class="w-28 font-medium text-gray-500">Invoice number</dt><dd class="font-mono text-gray-900">' + esc(invoice.invoice_number || '—') + '</dd></div>'
            +     '<div class="flex gap-3"><dt class="w-28 font-medium text-gray-500">Issue date</dt><dd class="text-gray-900">' + date(invoice.issue_date) + '</dd></div>'
            +     '<div class="flex gap-3"><dt class="w-28 font-medium text-gray-500">Due date</dt><dd class="text-gray-900">' + due + '</dd></div>'
            +   '</dl>'
            +   '<div class="mt-5 grid grid-cols-2 gap-4 text-[12px]">'
            +     '<div>'
            +       '<p class="font-semibold text-gray-900">From</p>'
            +       '<p class="mt-1 text-gray-600">' + esc(businessName) + '</p>'
            +     '</div>'
            +     '<div>'
            +       '<p class="font-semibold text-gray-900">Bill to</p>'
            +       '<p class="mt-1 text-gray-600">' + esc(invoice.customer_name || 'Customer name') + '</p>'
            +       '<p class="text-gray-500">' + esc(invoice.customer_email || '') + '</p>'
            +       (invoice.customer_address ? '<p class="whitespace-pre-line text-gray-500">' + esc(invoice.customer_address) + '</p>' : '')
            +     '</div>'
            +   '</div>'
            +   '<p class="mt-6 text-[16px] font-semibold text-gray-900 invoice-doc-money">' + money(amountDue) + ' due ' + due + '</p>'
            +   (invoice.memo ? '<p class="mt-2 text-[12px] text-gray-600">' + esc(invoice.memo) + '</p>' : '')
            +   '<table class="mt-4 w-full text-[12px]">'
            +     '<thead>'
            +       '<tr class="border-b border-gray-300 text-left text-gray-500">'
            +         '<th class="py-2 font-medium">Description</th>'
            +         '<th class="py-2 text-right font-medium">Qty</th>'
            +         '<th class="py-2 text-right font-medium">Unit price</th>'
            +         '<th class="py-2 text-right font-medium">Amount</th>'
            +       '</tr>'
            +     '</thead>'
            +     '<tbody>' + itemRows + '</tbody>'
            +     '<tfoot class="invoice-doc-money">'
            +       '<tr class="border-t border-gray-200"><td colspan="3" class="py-1.5 text-right text-gray-500">Subtotal</td><td class="py-1.5 text-right text-gray-900">' + money(invoice.subtotal_amount) + '</td></tr>'
            +       taxRow
            +       '<tr class="border-t border-gray-200"><td colspan="3" class="py-1.5 text-right text-gray-500">Total</td><td class="py-1.5 text-right text-gray-900">' + money(invoice.total_amount) + '</td></tr>'
            +       '<tr><td colspan="3" class="py-1.5 text-right font-semibold text-gray-900">Amount due</td><td class="py-1.5 text-right font-semibold text-gray-900">' + money(amountDue) + '</td></tr>'
            +     '</tfoot>'
            +   '</table>'
            +   (invoice.footer ? '<p class="mt-8 border-t border-gray-100 pt-3 text-[12px] text-gray-500">' + esc(invoice.footer) + '</p>' : '')
            +   '<p class="mt-3 text-[10px] uppercase tracking-[0.06em] text-gray-400">' + esc(invoice.invoice_number || '') + ' · ' + money(amountDue) + ' due ' + due + '</p>'
            + '</div>';
    }

    // Frozen stylesheet reproducing the exact Tailwind utilities the markup uses,
    // plus the print-variant .invoice-doc card (navy top rule, no shadow/rounding
    // — matching what "Download PDF" prints). Server-only: the browser page keeps
    // using its own Tailwind, so on-page rendering is unchanged.
    var INVOICE_DOC_CSS = [
        '*{box-sizing:border-box;}',
        'html,body{margin:0;padding:0;}',
        'body{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#111827;font-size:12px;line-height:1.5;-webkit-font-smoothing:antialiased;}',
        'h3,p,dl,dd,dt{margin:0;}',
        '.invoice-doc{background:#fff;border:0;border-top:3px solid #0B0F19;border-radius:0;box-shadow:none;}',
        '.invoice-doc-money{font-family:Inter,sans-serif;font-variant-numeric:tabular-nums;font-feature-settings:"tnum";}',
        'table{border-collapse:collapse;}',
        'th,td{padding:0;}',
        /* layout */
        '.flex{display:flex;}.items-start{align-items:flex-start;}.justify-between{justify-content:space-between;}',
        '.grid{display:grid;}.grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr));}',
        '.gap-4{gap:1rem;}.gap-3{gap:.75rem;}',
        '.w-full{width:100%;}.w-28{width:7rem;}.max-w-\\[45\\%\\]{max-width:45%;}',
        '.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
        '.text-left{text-align:left;}.text-right{text-align:right;}.text-center{text-align:center;}',
        '.whitespace-pre-line{white-space:pre-line;}',
        /* spacing */
        '.p-6{padding:1.5rem;}.sm\\:p-8{padding:2rem;}',
        '.mt-1{margin-top:.25rem;}.mt-2{margin-top:.5rem;}.mt-3{margin-top:.75rem;}.mt-4{margin-top:1rem;}.mt-5{margin-top:1.25rem;}.mt-6{margin-top:1.5rem;}.mt-8{margin-top:2rem;}',
        '.pt-3{padding-top:.75rem;}',
        '.py-2{padding-top:.5rem;padding-bottom:.5rem;}.py-1\\.5{padding-top:.375rem;padding-bottom:.375rem;}.py-3{padding-top:.75rem;padding-bottom:.75rem;}',
        '.space-y-1>*+*{margin-top:.25rem;}',
        /* type */
        '.text-\\[20px\\]{font-size:20px;}.text-\\[16px\\]{font-size:16px;}.text-\\[14px\\]{font-size:14px;}.text-\\[12px\\]{font-size:12px;}.text-\\[10px\\]{font-size:10px;}',
        '.font-semibold{font-weight:600;}.font-medium{font-weight:500;}.font-bold{font-weight:700;}',
        '.font-mono{font-family:"Fira Code",ui-monospace,SFMono-Regular,Menlo,monospace;}',
        '.uppercase{text-transform:uppercase;}',
        '.tracking-\\[0\\.08em\\]{letter-spacing:.08em;}.tracking-\\[0\\.06em\\]{letter-spacing:.06em;}',
        /* color */
        '.text-gray-900{color:#111827;}.text-gray-700{color:#374151;}.text-gray-600{color:#4B5563;}.text-gray-500{color:#6B7280;}.text-gray-400{color:#9CA3AF;}',
        '.text-red-600{color:#DC2626;}.text-\\[\\#16A34A\\]{color:#16A34A;}',
        '.bg-white{background:#fff;}',
        /* borders */
        '.border-b{border-bottom:1px solid;}.border-t{border-top:1px solid;}',
        '.border-gray-100{border-color:#F3F4F6;}.border-gray-200{border-color:#E5E7EB;}.border-gray-300{border-color:#D1D5DB;}'
    ].join('\n');

    return { buildInvoiceDocHTML: buildInvoiceDocHTML, INVOICE_DOC_CSS: INVOICE_DOC_CSS };
});
