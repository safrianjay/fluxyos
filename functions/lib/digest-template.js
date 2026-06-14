'use strict';

// Weekly Financial Digest email builder — benchmark KPI style (big value +
// colored ▲/▼ change pill + "vs last week" + table cards). Renders on the SAME
// shared shell (logo header, dividers, footer) by reusing `layout` + brand
// tokens from templates.js. Every number comes from the deterministic finance
// engine (api.js); this file only formats.

const { layout, BRAND } = require('./templates');
const { formatRupiah, escapeHtml } = require('./format');

const { NAVY, ORANGE, INK, MUTED } = BRAND;
const SUCCESS = '#16A34A';
const SUCCESS_BG = '#E7F6EC';
const DANGER = '#DC2626';
const DANGER_BG = '#FDECEC';
const AMBER = '#B45309';
const AMBER_BG = '#FEF3E2';
const CARD_BG = '#F9FAFB';
const CARD_BORDER = '#EEF0F3';
const ROW_BORDER = '#F1F3F5';

function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
function fpct(v, dp) { return `${num(v).toFixed(dp == null ? (Math.abs(num(v)) < 10 ? 1 : 0) : dp)}%`; }

// Colored ▲/▼ change pill. `goodWhenUp` flips the semantics (OpEx up = bad).
function pctBadge(pct, goodWhenUp) {
    if (pct == null || !Number.isFinite(Number(pct))) return '';
    const v = Number(pct);
    const up = v >= 0;
    const good = up === !!goodWhenUp;
    const color = good ? SUCCESS : DANGER;
    const bg = good ? SUCCESS_BG : DANGER_BG;
    return `<span style="display:inline-block;background:${bg};color:${color};font-size:12px;font-weight:700;padding:3px 9px;border-radius:6px;line-height:1.3;">${up ? '▲' : '▼'} ${fpct(Math.abs(v))}</span>`;
}

// Percentage-point change pill (gross margin).
function ppBadge(deltaPp) {
    if (deltaPp == null || !Number.isFinite(Number(deltaPp))) return '';
    const v = Number(deltaPp);
    const good = v >= 0;
    return `<span style="display:inline-block;background:${good ? SUCCESS_BG : DANGER_BG};color:${good ? SUCCESS : DANGER};font-size:12px;font-weight:700;padding:3px 9px;border-radius:6px;line-height:1.3;">${good ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}pp</span>`;
}

function tonePill(text, tone) {
    const map = { good: [SUCCESS, SUCCESS_BG], bad: [DANGER, DANGER_BG], warn: [AMBER, AMBER_BG] };
    const [c, bg] = map[tone] || [MUTED, '#F1F3F5'];
    return `<span style="display:inline-block;background:${bg};color:${c};font-size:12px;font-weight:700;padding:3px 9px;border-radius:6px;line-height:1.3;">${escapeHtml(text)}</span>`;
}

// Centered KPI card (benchmark style).
function metricCard({ icon, eyebrow, title, value, valueColor, badgeHtml, sub }) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:12px;"><tr><td style="padding:18px;text-align:center;">`
        + `<div style="font-size:11px;font-weight:600;letter-spacing:0.04em;color:${MUTED};margin:0 0 6px;">${icon ? icon + '&nbsp;' : ''}${escapeHtml(eyebrow || '')}</div>`
        + (title ? `<div style="font-size:13px;font-weight:600;color:#6B7280;margin:0 0 6px;">${escapeHtml(title)}</div>` : '')
        + `<div style="font-size:28px;font-weight:800;letter-spacing:-0.02em;color:${valueColor || NAVY};line-height:1.1;margin:0 0 8px;font-variant-numeric:tabular-nums;">${value}</div>`
        + (badgeHtml ? `<div style="margin:0 0 8px;">${badgeHtml}</div>` : '')
        + (sub ? `<div style="font-size:12px;color:${MUTED};">${escapeHtml(sub)}</div>` : '')
        + `</td></tr></table>`;
}

// Hero metric (largest, orange) — the headline number.
function heroCard({ icon, eyebrow, value, badgeHtml, sub }) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#FFFFFF;border:1px solid ${CARD_BORDER};border-radius:12px;"><tr><td style="padding:22px 18px;text-align:center;">`
        + `<div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};margin:0 0 8px;">${icon ? icon + '&nbsp;' : ''}${escapeHtml(eyebrow || '')}</div>`
        + `<div style="margin:0 0 8px;"><span style="font-size:34px;font-weight:800;letter-spacing:-0.025em;color:${ORANGE};line-height:1;font-variant-numeric:tabular-nums;">${value}</span>`
        + (badgeHtml ? `&nbsp;&nbsp;${badgeHtml}` : '') + `</div>`
        + (sub ? `<div style="font-size:12px;color:${MUTED};">${escapeHtml(sub)}</div>` : '')
        + `</td></tr></table>`;
}

// Table card (e.g. revenue by category, top vendors).
function tableCard(title, icon, headers, rows) {
    if (!rows || !rows.length) return '';
    const head = `<tr>${headers.map((h, i) => `<th align="${i === 0 ? 'left' : 'right'}" style="font-size:11px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.04em;padding:0 0 8px;border-bottom:1px solid ${CARD_BORDER};">${escapeHtml(h)}</th>`).join('')}</tr>`;
    const body = rows.map((r) => `<tr>${r.map((c, i) => `<td align="${i === 0 ? 'left' : 'right'}" style="font-size:13px;color:${i === 0 ? INK : NAVY};font-weight:${i === 0 ? 500 : 600};padding:9px 0;border-bottom:1px solid ${ROW_BORDER};font-variant-numeric:tabular-nums;">${c}</td>`).join('')}</tr>`).join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:12px;"><tr><td style="padding:16px 18px;">`
        + `<div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};margin:0 0 10px;">${icon ? icon + '&nbsp;' : ''}${escapeHtml(title)}</div>`
        + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${head}${body}</table>`
        + `</td></tr></table>`;
}

function bullets(items, locale, emptyText) {
    if (!items || !items.length) return `<div style="font-size:14px;color:${MUTED};">${escapeHtml(emptyText)}</div>`;
    return items.slice(0, 5).map((it) => {
        const title = escapeHtml(it.title || '');
        const desc = escapeHtml(it.description || '');
        return `<div style="margin:0 0 12px;"><div style="font-size:14px;font-weight:600;color:${NAVY};">${title}</div>`
            + (desc ? `<div style="font-size:14px;color:#374151;line-height:1.5;">${desc}</div>` : '') + `</div>`;
    }).join('');
}

function card(title, icon, innerHtml) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:12px;"><tr><td style="padding:16px 18px;">`
        + `<div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};margin:0 0 10px;">${icon ? icon + '&nbsp;' : ''}${escapeHtml(title)}</div>`
        + innerHtml + `</td></tr></table>`;
}

// % of total helper for table rows.
function shareRows(items, total, dp) {
    const t = num(total);
    return (items || []).slice(0, 5).map((c) => [escapeHtml(c.label || 'Uncategorized'), formatRupiah(c.value || 0), t > 0 ? `${((num(c.value) / t) * 100).toFixed(0)}%` : '—']);
}

const L = {
    en: {
        heading: 'Your weekly financial digest',
        intro: (name) => (name ? `Hi ${escapeHtml(name)},` : 'Hi there,') + ' here is how your business performed this week.',
        summary: 'Executive summary', vsLast: 'vs last week',
        revenue: 'Revenue', opex: 'Operating expenses', margin: 'Gross margin', profitability: 'Profitability', spend: 'Spend',
        cash: 'Cash', payables: 'Upcoming payables', receivables: 'pending receivables',
        bills: 'Bills', unpaidBills: 'Unpaid bills', billsSub: (n, overdue, due) => `${n} unpaid · ${overdue} overdue · ${due} due soon`,
        budget: 'Budget', budgetUsed: 'Budget used', budgetSub: (used, total) => `${used} of ${total}`,
        subs: 'Subscriptions', monthly: 'Monthly subscriptions', subsSub: (n, r) => `${n} active · ${r} renewing soon`,
        revByCat: 'Revenue by category', topSpend: 'Top spending categories', vendors: 'Top vendors',
        category: 'Category', vendor: 'Vendor', amount: 'Amount', share: 'Share',
        insights: 'AI insights', actions: 'Recommended actions', cta: 'Open finance dashboard',
        none: 'No activity recorded.', riskWord: { low: 'Low risk', medium: 'Medium risk', high: 'High risk', unknown: 'Unknown' },
        footnote: 'You are receiving this weekly digest because it is enabled in your FluxyOS email preferences. Manage it in Settings → Notifications & email.',
    },
    id: {
        heading: 'Ringkasan keuangan mingguan Anda',
        intro: (name) => (name ? `Halo ${escapeHtml(name)},` : 'Halo,') + ' berikut performa bisnis Anda minggu ini.',
        summary: 'Ringkasan eksekutif', vsLast: 'vs minggu lalu',
        revenue: 'Pendapatan', opex: 'Beban operasional', margin: 'Margin kotor', profitability: 'Profitabilitas', spend: 'Pengeluaran',
        cash: 'Kas', payables: 'Utang akan datang', receivables: 'piutang tertunda',
        bills: 'Tagihan', unpaidBills: 'Tagihan belum dibayar', billsSub: (n, overdue, due) => `${n} belum dibayar · ${overdue} terlambat · ${due} segera jatuh tempo`,
        budget: 'Anggaran', budgetUsed: 'Anggaran terpakai', budgetSub: (used, total) => `${used} dari ${total}`,
        subs: 'Langganan', monthly: 'Langganan bulanan', subsSub: (n, r) => `${n} aktif · ${r} segera perpanjang`,
        revByCat: 'Pendapatan per kategori', topSpend: 'Kategori pengeluaran teratas', vendors: 'Vendor teratas',
        category: 'Kategori', vendor: 'Vendor', amount: 'Jumlah', share: 'Porsi',
        insights: 'Insight AI', actions: 'Tindakan yang disarankan', cta: 'Buka dashboard keuangan',
        none: 'Tidak ada aktivitas tercatat.', riskWord: { low: 'Risiko rendah', medium: 'Risiko sedang', high: 'Risiko tinggi', unknown: 'Tidak diketahui' },
        footnote: 'Anda menerima ringkasan mingguan ini karena diaktifkan di preferensi email FluxyOS. Atur di Settings → Notifications & email.',
    },
};

function buildWeeklyDigest({ locale, data }) {
    const loc = locale === 'id' ? 'id' : 'en';
    const t = L[loc];
    const d = data || {};
    const tools = d.tools || {};
    const m = d.metrics || {};
    const baseUrl = d.baseUrl || 'https://fluxyos.com';
    const cmp = tools.comparison;
    const sections = [];

    sections.push({ html: `<div style="font-size:15px;color:${INK};line-height:1.6;">${t.intro(d.name)}</div>`, text: t.intro(d.name) });

    // Hero — total revenue with WoW change (skip in summary-only / when disabled).
    if (!d.summaryOnly && m.financial_health && cmp) {
        const cur = cmp.current_period; const prev = cmp.comparison_period; const dl = cmp.deltas;
        sections.push({ html: heroCard({ icon: '📈', eyebrow: t.revenue, value: formatRupiah(cur.revenue), badgeHtml: pctBadge(dl.revenue_percentage, true), sub: `${t.vsLast}: ${formatRupiah(prev.revenue)}` }), text: `${t.revenue}: ${formatRupiah(cur.revenue)}` });
    }

    const summaryText = (d.answer && d.answer.direct_answer) || '';
    if (summaryText) sections.push({ html: card(t.summary, '🧭', `<div style="font-size:15px;color:${INK};line-height:1.6;">${escapeHtml(summaryText)}</div>`), text: `${t.summary}: ${summaryText}` });

    if (!d.summaryOnly) {
        if (m.financial_health && cmp) {
            const cur = cmp.current_period; const prev = cmp.comparison_period; const dl = cmp.deltas;
            sections.push({ html: metricCard({ icon: '💸', eyebrow: t.spend, title: t.opex, value: formatRupiah(cur.opex), badgeHtml: pctBadge(dl.opex_percentage, false), sub: `${t.vsLast}: ${formatRupiah(prev.opex)}` }), text: `${t.opex}: ${formatRupiah(cur.opex)}` });
            sections.push({ html: metricCard({ icon: '📊', eyebrow: t.profitability, title: t.margin, value: fpct(cur.gross_margin), badgeHtml: ppBadge(dl.gross_margin), sub: `${t.vsLast}: ${fpct(prev.gross_margin)}` }), text: `${t.margin}: ${fpct(cur.gross_margin)}` });
        }
        if (m.cash_position && tools.cashPressure) {
            const cp = tools.cashPressure;
            const tone = cp.risk_level === 'high' ? 'bad' : cp.risk_level === 'low' ? 'good' : 'warn';
            sections.push({ html: metricCard({ icon: '💵', eyebrow: t.cash, title: t.payables, value: formatRupiah(cp.upcoming_payables), badgeHtml: tonePill(t.riskWord[cp.risk_level] || t.riskWord.unknown, tone), sub: `${formatRupiah(cp.pending_receivables)} ${t.receivables}` }), text: `${t.cash}: ${t.riskWord[cp.risk_level] || ''}` });
        }
        if (m.bills && tools.billsAnalysis) {
            const b = tools.billsAnalysis;
            const overdue = (b.overdue_bills || []).length; const due = (b.due_soon_bills || []).length;
            sections.push({ html: metricCard({ icon: '🧾', eyebrow: t.bills, title: t.unpaidBills, value: formatRupiah(b.total_unpaid_amount), badgeHtml: overdue ? tonePill(`${overdue} overdue`, 'bad') : '', sub: t.billsSub(b.total_unpaid_bills || 0, overdue, due) }), text: `${t.unpaidBills}: ${formatRupiah(b.total_unpaid_amount)}` });
        }
        if (m.budgets && d.budget) {
            const bd = d.budget; const over = num(bd.percent) > 100;
            sections.push({ html: metricCard({ icon: '🎯', eyebrow: t.budget, title: bd.label ? `${t.budgetUsed} — ${bd.label}` : t.budgetUsed, value: fpct(bd.percent, 0), badgeHtml: tonePill(over ? 'Over budget' : 'On track', over ? 'bad' : 'good'), sub: t.budgetSub(formatRupiah(bd.used), formatRupiah(bd.total)) }), text: `${t.budgetUsed}: ${fpct(bd.percent, 0)}` });
        }
        if (m.subscriptions && tools.subscriptionAnalysis) {
            const s = tools.subscriptionAnalysis;
            sections.push({ html: metricCard({ icon: '🔁', eyebrow: t.subs, title: t.monthly, value: formatRupiah(s.total_monthly_subscriptions), badgeHtml: '', sub: t.subsSub(s.subscription_count || 0, (s.upcoming_renewals || []).length) }), text: `${t.monthly}: ${formatRupiah(s.total_monthly_subscriptions)}` });
        }
        if (m.revenue && tools.revenueAnalysis && (tools.revenueAnalysis.revenue_by_category || []).length) {
            sections.push({ html: tableCard(t.revByCat, '📈', [t.category, t.amount, t.share], shareRows(tools.revenueAnalysis.revenue_by_category, tools.revenueAnalysis.total_revenue)), text: t.revByCat });
        }
        if (m.expenses && tools.expenseAnalysis && (tools.expenseAnalysis.expense_by_category || []).length) {
            sections.push({ html: tableCard(t.topSpend, '💸', [t.category, t.amount, t.share], shareRows(tools.expenseAnalysis.expense_by_category, tools.expenseAnalysis.total_expense)), text: t.topSpend });
        }
        if (m.vendors && tools.expenseAnalysis && (tools.expenseAnalysis.top_vendors || []).length) {
            sections.push({ html: tableCard(t.vendors, '🏢', [t.vendor, t.amount, t.share], shareRows(tools.expenseAnalysis.top_vendors, tools.expenseAnalysis.total_expense)), text: t.vendors });
        }
    }

    sections.push({ html: card(t.insights, '💡', bullets((d.answer || {}).insights, loc, t.none)), text: t.insights });
    sections.push({ html: card(t.actions, '✅', bullets((d.answer || {}).recommended_actions, loc, t.none)), text: t.actions });

    const subject = (loc === 'id' ? 'Ringkasan keuangan mingguan FluxyOS' : 'Your FluxyOS weekly digest') + (d.periodLabel ? ` — ${d.periodLabel}` : '');
    const heading = `${t.heading}${d.periodLabel ? ` · ${d.periodLabel}` : ''}`;
    const html = layout({
        previewText: (summaryText || heading).slice(0, 140),
        heading,
        paragraphsHtml: sections.map((s) => s.html),
        cta: { label: t.cta, url: `${baseUrl}/dashboard` },
        footnote: t.footnote,
        logoUrl: `${baseUrl}/assets/images/email-logo.png`,
    });
    const text = [heading, '', ...sections.map((s) => s.text), '', `${t.cta}: ${baseUrl}/dashboard`].join('\n');
    return { subject, html, text, template: 'weekly_digest' };
}

module.exports = { buildWeeklyDigest };
