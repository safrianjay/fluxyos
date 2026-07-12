// Cash Pressure — KPI drill-down page (forward liquidity runway).
// Distinct from Cash Position (which is realized cash): this projects the next
// 30/60/90 days = bank cash + receivables due − payables due, and lists the
// specific obligations driving it so the owner can act (chase AR, plan AP).
// All reads route through DataService (workspace-scoped).
import {
    escapeHtml, formatRp, formatSignedRp, formatDate, recordDate, toDate,
    renderKpiStrip, bucketSeries, toCumulative, renderTrendChart,
    renderBreakdownList, createSupportingTable, ledgerRecordUrl
} from '/assets/js/kpi-detail-shared.js';

const state = {
    ds: null,
    user: null,
    horizon: 30,
    bankCash: 0,
    accountCount: 0,
    obligations: [],   // normalized {id, name, dueDate, amount(signed), kind, status, href}
    dim: 'payables',
    table: null
};

const el = (id) => document.getElementById(id);
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

export function initCashPressurePage({ ds, user }) {
    state.ds = ds;
    state.user = user;
    ds.setActor?.(user.uid);

    state.table = createSupportingTable({
        tbodyId: 'pressure-table-body',
        searchInputId: 'pressure-search',
        exportBtnId: 'pressure-export',
        csvFilename: 'cash-obligations',
        label: 'records',
        pageSize: 10,
        paginationId: 'pressure-pagination',
        summaryId: 'pressure-page-summary',
        indicatorId: 'pressure-page-indicator',
        prevBtnId: 'pressure-prev-page',
        nextBtnId: 'pressure-next-page',
        defaultSortKey: 'date',
        defaultSortDir: 'asc',
        searchText: (r) => `${r.name || ''} ${r.kind} ${r.status || ''}`,
        rowLink: (r) => r.href || null,
        emptyTitle: 'Nothing due in this window',
        emptyDesc: 'No receivables or payables fall inside the selected horizon.',
        columns: [
            { key: 'date', label: 'Due date', sortValue: (r) => (r.dueDate?.getTime() || 0), csv: (r) => formatDate(r.dueDate), render: (r) => `<span class="text-gray-600">${escapeHtml(dueLabel(r))}</span>` },
            { key: 'desc', label: 'Description', csv: (r) => r.name || '', render: (r) => `<span class="fluxy-table-cell-primary">${escapeHtml(r.name || '—')}</span>` },
            { key: 'type', label: 'Type', csv: (r) => (r.kind === 'receivable' ? 'Receivable' : 'Payable'), render: (r) => r.kind === 'receivable'
                ? `<span class="fluxy-table-status fluxy-status-success">Receivable</span>`
                : `<span class="fluxy-table-status fluxy-status-danger">Payable</span>` },
            { key: 'amount', label: 'Amount', align: 'right', sortValue: (r) => r.amount, csv: (r) => r.amount, render: (r) => `<span class="tabular-nums font-semibold ${r.amount < 0 ? 'text-red-600' : 'text-emerald-600'}">${r.amount < 0 ? '−' : '+'}${escapeHtml(formatRp(Math.abs(r.amount)))}</span>` },
            { key: 'status', label: 'Status', csv: (r) => r.status || '', render: (r) => `<span class="fluxy-table-status ${overdue(r) ? 'fluxy-status-warning' : 'fluxy-status-neutral'}">${escapeHtml(overdue(r) ? 'Overdue' : (r.status || '—'))}</span>` }
        ]
    });

    document.querySelectorAll('[data-kpi-horizon]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.horizon = Number(btn.dataset.kpiHorizon) || 30;
            document.querySelectorAll('[data-kpi-horizon]').forEach(b => b.classList.toggle('is-active', b === btn));
            render();
        });
    });

    document.querySelectorAll('[data-breakdown-dim]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.dim = btn.dataset.breakdownDim;
            document.querySelectorAll('[data-breakdown-dim]').forEach(b => b.classList.toggle('is-active', b === btn));
            renderBreakdown();
        });
    });

    loadAndRender();
}

function overdue(r) { return r.dueDate && r.dueDate < startOfToday(); }
function dueLabel(r) {
    if (!r.dueDate) return 'No date';
    return overdue(r) ? `${formatDate(r.dueDate)} · overdue` : formatDate(r.dueDate);
}

async function loadAndRender() {
    try {
        const [accounts, invoices, bills, subscriptions, transactions] = await Promise.all([
            state.ds.getBankAccounts(state.user.uid).catch(() => []),
            state.ds.getInvoices(state.user.uid).catch(() => []),
            state.ds.getBills(state.user.uid).catch(() => []),
            state.ds.getSubscriptions(state.user.uid).catch(() => []),
            state.ds.getTransactions(state.user.uid, 2000).catch(() => [])
        ]);

        const active = (accounts || []).filter(a => a.status !== 'archived');
        state.bankCash = active.reduce((s, a) => s + (Number(a.latest_balance) || 0), 0);
        state.accountCount = active.length;

        const obligations = [];
        // Receivables — open invoices (AR) + pending_receivable transactions.
        (invoices || [])
            .filter(inv => ['open', 'sent', 'overdue'].includes(String(inv.status || '').toLowerCase()))
            .forEach(inv => obligations.push({
                id: inv.id,
                name: inv.customer_name || inv.invoice_number || 'Invoice',
                dueDate: toDate(inv.due_date) || toDate(inv.issue_date),
                amount: Math.abs(Number(inv.amount_due ?? inv.total_amount) || 0),
                kind: 'receivable', status: inv.status || 'open', href: `/invoices?record=${encodeURIComponent(inv.id)}`
            }));
        (transactions || [])
            .filter(t => String(t.type || '').toLowerCase() === 'pending_receivable' && !t.is_voided)
            .forEach(t => obligations.push({
                id: t.id, name: t.vendor_name || 'Expected income',
                dueDate: recordDate(t, ['due_date', 'timestamp', 'date']),
                amount: Math.abs(Number(t.amount) || 0),
                kind: 'receivable', status: t.status || 'Pending', href: ledgerRecordUrl(t.id)
            }));

        // Payables — unpaid bills (AP) + subscription renewals + pending_payable.
        (bills || [])
            .filter(b => String(b.payment_status || '').toLowerCase() !== 'paid' && !b.is_voided)
            .forEach(b => obligations.push({
                id: b.id, name: b.vendor_name || 'Bill',
                dueDate: recordDate(b, ['due_date', 'date', 'timestamp']),
                amount: -Math.abs(Number(b.amount) || 0),
                kind: 'payable', status: b.payment_status || 'Unpaid', href: `/bill?record=${encodeURIComponent(b.id)}`
            }));
        (subscriptions || [])
            .filter(s => !s.is_voided)
            .forEach(s => obligations.push({
                id: s.id, name: s.vendor_name || 'Subscription',
                dueDate: recordDate(s, ['renewal_date', 'timestamp', 'date']),
                amount: -Math.abs(Number(s.amount) || 0),
                kind: 'payable', status: 'Renewal', href: '/subscription'
            }));
        (transactions || [])
            .filter(t => String(t.type || '').toLowerCase() === 'pending_payable' && !t.is_voided)
            .forEach(t => obligations.push({
                id: t.id, name: t.vendor_name || 'Expected payment',
                dueDate: recordDate(t, ['due_date', 'timestamp', 'date']),
                amount: -Math.abs(Number(t.amount) || 0),
                kind: 'payable', status: t.status || 'Pending', href: ledgerRecordUrl(t.id)
            }));

        state.obligations = obligations;
        render();
    } catch (error) {
        console.error('Cash pressure failed:', error);
        renderError();
    }
}

// Obligations inside the current horizon window (overdue items are included —
// they're still owed and pressure cash now).
function inWindow() {
    const end = new Date(startOfToday().getTime());
    end.setDate(end.getDate() + state.horizon);
    return state.obligations.filter(o => {
        if (!o.dueDate) return true; // undated obligations still count as due
        return o.dueDate <= end;
    });
}

function render() {
    el('kpi-loading')?.classList.add('hidden');
    el('kpi-error')?.classList.add('hidden');
    el('kpi-content')?.classList.remove('hidden');

    const items = inWindow();
    const receivablesDue = items.filter(o => o.kind === 'receivable').reduce((s, o) => s + o.amount, 0);
    const payablesDue = -items.filter(o => o.kind === 'payable').reduce((s, o) => s + o.amount, 0); // positive magnitude
    const projected = state.bankCash + receivablesDue - payablesDue;

    // Pressure band.
    let band, bandClass;
    if (projected < 0) { band = 'At risk — projected shortfall'; bandClass = 'text-red-600'; }
    else if (projected < payablesDue) { band = 'Watch — thin cushion'; bandClass = 'text-amber-600'; }
    else { band = 'Healthy — comfortable runway'; bandClass = 'text-emerald-600'; }

    el('pressure-horizon-label').textContent = `Next ${state.horizon} days`;
    el('pressure-headline').textContent = formatSignedRp(projected);
    el('pressure-headline').className = `text-2xl font-bold tracking-tight tabular-nums ${projected < 0 ? 'text-red-600' : 'text-gray-900'}`;
    el('pressure-compare').textContent = band;
    el('pressure-compare').className = `mt-0.5 text-[12px] font-semibold ${bandClass}`;

    renderKpiStrip('pressure-kpis', [
        { label: 'Bank cash (now)', value: formatRp(state.bankCash), sub: state.accountCount ? `${state.accountCount} account(s)` : 'No bank accounts linked', info: 'Latest reported balance across your active bank accounts — the starting point of the runway.' },
        { label: `Receivables due (${state.horizon}d)`, value: formatRp(receivablesDue), sub: `${items.filter(o => o.kind === 'receivable').length} expected inflow(s)`, tone: 'positive', info: 'Money expected to come in within the horizon — open invoices and pending receivables.' },
        { label: `Payables due (${state.horizon}d)`, value: formatRp(payablesDue), sub: `${items.filter(o => o.kind === 'payable').length} obligation(s)`, negative: payablesDue > 0, info: 'Money expected to go out within the horizon — unpaid bills, renewals, and pending payables (overdue included).' },
        { label: 'Projected balance', value: formatSignedRp(projected), sub: band.split('—')[0].trim(), negative: projected < 0, info: 'Bank cash plus receivables due minus payables due. Negative means a projected cash shortfall.' }
    ]);

    // Runway trend — start at bank cash today, apply each obligation on its due
    // date (overdue clamped to today), cumulative over the horizon.
    const today = startOfToday();
    const end = new Date(today.getTime()); end.setDate(end.getDate() + state.horizon);
    const startKey = dayKeyOf(today);
    const endKey = dayKeyOf(end);
    const flow = bucketSeries(items, startKey, endKey, {
        dateOf: (o) => { const d = o.dueDate && o.dueDate > today ? o.dueDate : today; return d; },
        valueOf: (o) => o.amount
    });
    const runway = toCumulative(flow.points, state.bankCash);
    renderTrendChart('pressure-trend', {
        points: runway.map(p => ({ label: p.label, value: p.value, sub: `Net ${formatSignedRp(p.flow)}` })),
        todayIndex: 0,
        allowNegative: true,
        color: '#3B82F6',
        negColor: '#EF4444',
        valueName: 'Projected balance',
        formatValue: formatSignedRp,
        emptyText: 'No upcoming obligations to project in this window.'
    });

    renderBreakdown();
    state.table.setRows(items);
    el('pressure-table-subtitle').textContent = `${items.length} obligation${items.length === 1 ? '' : 's'} due in the next ${state.horizon} days. Click a row to open the original record.`;

    if (window.FluxyI18n?.getLang?.() === 'id') window.FluxyI18n.translate?.();
}

function dayKeyOf(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function groupBy(rows, keyFn, signed) {
    const map = new Map();
    rows.forEach(r => {
        const k = keyFn(r);
        const cur = map.get(k) || { name: k, amount: 0, count: 0 };
        cur.amount += signed ? r.amount : Math.abs(r.amount);
        cur.count += 1;
        map.set(k, cur);
    });
    return Array.from(map.values()).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

function renderBreakdown() {
    const items = inWindow();
    let rows, color = '#EA580C', valueFormat = formatRp;
    if (state.dim === 'receivables') {
        rows = groupBy(items.filter(o => o.kind === 'receivable'), (o) => o.name, false);
        color = '#16A34A';
    } else if (state.dim === 'timing') {
        const today = startOfToday();
        const wk = new Date(today.getTime()); wk.setDate(wk.getDate() + 7);
        const bucket = (o) => {
            if (o.dueDate && o.dueDate < today) return 'Overdue';
            if (!o.dueDate || o.dueDate <= wk) return 'This week';
            return 'Later in window';
        };
        rows = groupBy(items, bucket, true);
        valueFormat = formatSignedRp;
    } else {
        rows = groupBy(items.filter(o => o.kind === 'payable'), (o) => o.name, false);
        color = '#EF4444';
    }
    renderBreakdownList('pressure-breakdown', {
        rows, total: rows.reduce((s, r) => s + Math.abs(r.amount), 0), color, valueFormat,
        emptyText: 'Nothing to break down for this window.'
    });
}

function renderError() {
    el('kpi-loading')?.classList.add('hidden');
    el('kpi-content')?.classList.add('hidden');
    const err = el('kpi-error');
    if (!err) return;
    err.classList.remove('hidden');
    err.innerHTML = `
        <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-10 text-center">
            <h1 class="text-xl font-bold text-gray-900">Cash pressure could not be opened.</h1>
            <p class="mt-2 text-[13px] text-gray-500">Refresh and try again.</p>
            <a href="/dashboard" class="mt-5 inline-flex items-center justify-center rounded-lg bg-slate-950 px-4 py-2 text-[13px] font-bold text-white hover:bg-slate-800">Back to Overview</a>
        </div>`;
}
