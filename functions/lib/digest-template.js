'use strict';

// Weekly Financial Digest email builder. Renders on the SAME shared shell
// (logo header, dividers, footer) as the rest of the email system by reusing
// `layout` + brand tokens from templates.js. Every number it shows comes from
// the deterministic finance engine (api.js) — this file only formats.

const { layout, BRAND } = require('./templates');
const { formatRupiah, escapeHtml } = require('./format');

const { NAVY, ORANGE, INK, MUTED } = BRAND;
const SUCCESS = '#16A34A';
const DANGER = '#DC2626';
const CARD_BG = '#F9FAFB';
const CARD_BORDER = '#EEF0F3';

function pct(n) {
    if (n == null || !Number.isFinite(Number(n))) return null;
    const v = Number(n);
    const sign = v > 0 ? '+' : '';
    return `${sign}${v.toFixed(1)}%`;
}

const L = {
    en: {
        heading: 'Your weekly financial digest',
        intro: (name) => (name ? `Hi ${escapeHtml(name)},` : 'Hi there,') + ' here is how your business did this week.',
        summary: 'Executive summary', health: 'Financial health', cash: 'Cash position',
        bills: 'Bills & obligations', budget: 'Budget performance', revenue: 'Revenue',
        expenses: 'Expenses', subs: 'Subscriptions', vendors: 'Top vendors',
        insights: 'AI insights', actions: 'Recommended actions',
        revenueL: 'Revenue', opexL: 'OpEx', marginL: 'Gross margin', vsLast: 'vs last week',
        unpaid: 'Unpaid bills', overdue: 'Overdue', dueSoon: 'Due soon',
        payables: 'Upcoming payables', receivables: 'Pending receivables', risk: 'Cash risk',
        monthly: 'Monthly subscriptions', count: 'Active', renewals: 'Upcoming renewals',
        used: 'Used', of: 'of', cta: 'Open finance dashboard',
        none: 'No activity recorded.', notEnough: 'Not enough financial activity was recorded this week to generate a full briefing.',
        riskWords: { low: 'Low', medium: 'Medium', high: 'High', unknown: 'Unknown' },
        footnote: 'You are receiving this weekly digest because it is enabled in your FluxyOS email preferences. Manage it in Settings → Notifications & email.',
    },
    id: {
        heading: 'Ringkasan keuangan mingguan Anda',
        intro: (name) => (name ? `Halo ${escapeHtml(name)},` : 'Halo,') + ' berikut performa bisnis Anda minggu ini.',
        summary: 'Ringkasan eksekutif', health: 'Kesehatan keuangan', cash: 'Posisi kas',
        bills: 'Tagihan & kewajiban', budget: 'Performa anggaran', revenue: 'Pendapatan',
        expenses: 'Pengeluaran', subs: 'Langganan', vendors: 'Vendor teratas',
        insights: 'Insight AI', actions: 'Tindakan yang disarankan',
        revenueL: 'Pendapatan', opexL: 'OpEx', marginL: 'Margin kotor', vsLast: 'vs minggu lalu',
        unpaid: 'Tagihan belum dibayar', overdue: 'Terlambat', dueSoon: 'Jatuh tempo',
        payables: 'Utang akan datang', receivables: 'Piutang tertunda', risk: 'Risiko kas',
        monthly: 'Langganan bulanan', count: 'Aktif', renewals: 'Perpanjangan mendatang',
        used: 'Terpakai', of: 'dari', cta: 'Buka dashboard keuangan',
        none: 'Tidak ada aktivitas tercatat.', notEnough: 'Aktivitas keuangan minggu ini belum cukup untuk membuat ringkasan lengkap.',
        riskWords: { low: 'Rendah', medium: 'Sedang', high: 'Tinggi', unknown: 'Tidak diketahui' },
        footnote: 'Anda menerima ringkasan mingguan ini karena diaktifkan di preferensi email FluxyOS. Atur di Settings → Notifications & email.',
    },
};

// One presentational card.
function card(title, innerHtml) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:12px;"><tr><td style="padding:16px 18px;">`
        + `<div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};margin:0 0 10px;">${escapeHtml(title)}</div>`
        + innerHtml
        + `</td></tr></table>`;
}

// label : value row.
function stat(label, value, valueColor) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px;"><tr>`
        + `<td style="font-size:14px;color:${INK};line-height:1.5;">${escapeHtml(label)}</td>`
        + `<td align="right" style="font-size:14px;font-weight:600;color:${valueColor || NAVY};line-height:1.5;font-variant-numeric:tabular-nums;">${value}</td>`
        + `</tr></table>`;
}

function deltaText(d, locale) {
    if (!d) return '';
    const amt = d.revenue;
    if (amt == null || !Number.isFinite(amt)) return '';
    const sign = amt > 0 ? '+' : amt < 0 ? '−' : '';
    const p = pct(d.revenue_percentage);
    const body = `${L[locale].vsLast}: ${sign}${formatRupiah(Math.abs(amt))}${p ? ` (${p})` : ''}`;
    return `<div style="font-size:12px;color:${MUTED};margin:2px 0 0;">${escapeHtml(body)}</div>`;
}

function bullets(items, locale) {
    if (!items || !items.length) return `<div style="font-size:14px;color:${MUTED};">${escapeHtml(L[locale].none)}</div>`;
    return items.slice(0, 5).map((it) => {
        const title = escapeHtml(it.title || '');
        const desc = escapeHtml(it.description || '');
        return `<div style="margin:0 0 12px;"><div style="font-size:14px;font-weight:600;color:${NAVY};">${title}</div>`
            + (desc ? `<div style="font-size:14px;color:#374151;line-height:1.5;">${desc}</div>` : '') + `</div>`;
    }).join('');
}

function categoryList(items) {
    if (!items || !items.length) return '';
    return items.slice(0, 4).map((c) => stat(c.label || 'Uncategorized', formatRupiah(c.value || 0))).join('');
}

function buildWeeklyDigest({ locale, data }) {
    const t = L[locale === 'id' ? 'id' : 'en'];
    const loc = locale === 'id' ? 'id' : 'en';
    const d = data || {};
    const tools = d.tools || {};
    const answer = d.answer || {};
    const m = d.metrics || {};
    const baseUrl = d.baseUrl || 'https://fluxyos.com';
    const sections = [];

    // Intro + AI executive summary (always).
    sections.push({ html: `<div style="font-size:15px;color:${INK};line-height:1.6;">${t.intro(d.name)}</div>`, text: t.intro(d.name) });
    const summaryText = answer.direct_answer || t.notEnough;
    sections.push({ html: card(t.summary, `<div style="font-size:15px;color:${INK};line-height:1.6;">${escapeHtml(summaryText)}</div>`), text: `${t.summary}: ${summaryText}` });

    if (!d.summaryOnly) {
        // Financial Health Snapshot
        if (m.financial_health && tools.financeSummary) {
            const fs = tools.financeSummary;
            const cmp = tools.comparison && tools.comparison.deltas;
            const inner = stat(t.revenueL, formatRupiah(fs.revenue || 0), SUCCESS) + deltaText(cmp, loc)
                + stat(t.opexL, formatRupiah(fs.opex || 0))
                + stat(t.marginL, `${Number(fs.gross_margin || 0).toFixed(1)}%`);
            sections.push({ html: card(t.health, inner), text: `${t.health}: rev ${formatRupiah(fs.revenue || 0)}, opex ${formatRupiah(fs.opex || 0)}, margin ${Number(fs.gross_margin || 0).toFixed(1)}%` });
        }
        // Cash Position
        if (m.cash_position && tools.cashPressure) {
            const cp = tools.cashPressure;
            const riskWord = t.riskWords[cp.risk_level] || t.riskWords.unknown;
            const riskColor = cp.risk_level === 'high' ? DANGER : cp.risk_level === 'low' ? SUCCESS : ORANGE;
            const inner = stat(t.payables, formatRupiah(cp.upcoming_payables || 0))
                + stat(t.receivables, formatRupiah(cp.pending_receivables || 0))
                + stat(t.risk, riskWord, riskColor);
            sections.push({ html: card(t.cash, inner), text: `${t.cash}: ${t.risk} ${riskWord}` });
        }
        // Bills & Obligations
        if (m.bills && tools.billsAnalysis) {
            const b = tools.billsAnalysis;
            const inner = stat(t.unpaid, `${formatRupiah(b.total_unpaid_amount || 0)} (${b.total_unpaid_bills || 0})`)
                + stat(t.overdue, String((b.overdue_bills || []).length), (b.overdue_bills || []).length ? DANGER : NAVY)
                + stat(t.dueSoon, String((b.due_soon_bills || []).length));
            sections.push({ html: card(t.bills, inner), text: `${t.bills}: ${formatRupiah(b.total_unpaid_amount || 0)} unpaid` });
        }
        // Budget Performance (only when budget data exists)
        if (m.budgets && d.budget) {
            const bd = d.budget;
            const inner = stat(`${t.used} ${bd.label ? '— ' + escapeHtml(bd.label) : ''}`.trim(), `${formatRupiah(bd.used || 0)} ${t.of} ${formatRupiah(bd.total || 0)}`)
                + stat('%', `${Number(bd.percent || 0).toFixed(0)}%`, Number(bd.percent || 0) > 100 ? DANGER : NAVY);
            sections.push({ html: card(t.budget, inner), text: `${t.budget}: ${Number(bd.percent || 0).toFixed(0)}%` });
        }
        // Revenue
        if (m.revenue && tools.revenueAnalysis) {
            const r = tools.revenueAnalysis;
            const inner = stat(t.revenueL, formatRupiah(r.total_revenue || 0), SUCCESS) + categoryList(r.revenue_by_category);
            sections.push({ html: card(t.revenue, inner), text: `${t.revenue}: ${formatRupiah(r.total_revenue || 0)}` });
        }
        // Expenses
        if (m.expenses && tools.expenseAnalysis) {
            const e = tools.expenseAnalysis;
            const inner = stat(t.expenses, formatRupiah(e.total_expense || 0)) + categoryList(e.expense_by_category);
            sections.push({ html: card(t.expenses, inner), text: `${t.expenses}: ${formatRupiah(e.total_expense || 0)}` });
        }
        // Subscriptions
        if (m.subscriptions && tools.subscriptionAnalysis) {
            const s = tools.subscriptionAnalysis;
            const inner = stat(t.monthly, formatRupiah(s.total_monthly_subscriptions || 0))
                + stat(t.count, String(s.subscription_count || 0))
                + stat(t.renewals, String((s.upcoming_renewals || []).length));
            sections.push({ html: card(t.subs, inner), text: `${t.subs}: ${formatRupiah(s.total_monthly_subscriptions || 0)}/mo` });
        }
        // Top Vendors
        if (m.vendors && tools.expenseAnalysis && (tools.expenseAnalysis.top_vendors || []).length) {
            sections.push({ html: card(t.vendors, categoryList(tools.expenseAnalysis.top_vendors)), text: `${t.vendors}` });
        }
    }

    // AI Insights + Recommended Actions (always).
    sections.push({ html: card(t.insights, bullets(answer.insights, loc)), text: t.insights });
    sections.push({ html: card(t.actions, bullets(answer.recommended_actions, loc)), text: t.actions });

    const subject = (loc === 'id' ? 'Ringkasan keuangan mingguan FluxyOS' : 'Your FluxyOS weekly digest')
        + (d.periodLabel ? ` — ${d.periodLabel}` : '');
    const heading = `${t.heading}${d.periodLabel ? ` · ${d.periodLabel}` : ''}`;

    const html = layout({
        previewText: summaryText.slice(0, 140),
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
