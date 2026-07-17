// Cash Position — KPI drill-down page.
// Shows the running cash balance, in/out movement, cash by account, and
// upcoming receivables/payables for the period the dashboard passed. All
// reads route through DataService (workspace-scoped).
import {
    escapeHtml, formatRp, formatSignedRp, formatDate, recordDate, toDate,
    resolvePeriodFromUrl, mountPeriodControls,
    renderKpiStrip, bucketSeries, toCumulative, renderTrendChart,
    renderBreakdownList, createSupportingTable, ledgerRecordUrl, parseKey
} from '/assets/js/kpi-detail-shared.js';

const state = {
    ds: null,
    user: null,
    period: null,
    ledgerCash: { cashIn: 0, cashOut: 0, net: 0, recordCount: 0, _entries: [] },
    accounts: [],
    invoices: [],
    bills: [],
    periodTx: [],   // cash-effective transactions inside the period (with ids)
    dim: 'accounts',
    // Active breakdown filter driving the table below, or null for "all cash
    // movements". { dim, key: 'in'|'out'|'receivable'|'payable', name }.
    filter: null,
    table: null
};

const INVOICE_OPEN_STATUSES = ['open', 'sent', 'overdue'];
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const el = (id) => document.getElementById(id);
const isCashTx = (tx) => tx?.cash_effective === true && (tx.cash_direction === 'in' || tx.cash_direction === 'out') && !tx.is_voided;
const signedCash = (tx) => (tx.cash_direction === 'in' ? 1 : -1) * Math.abs(Number(tx.amount) || 0);

function rangeBounds(period) {
    const start = parseKey(period.start) || new Date(0);
    const end = parseKey(period.end) || new Date();
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
}

export function initCashPositionPage({ ds, user }) {
    state.ds = ds;
    state.user = user;
    ds.setActor?.(user.uid);
    state.period = resolvePeriodFromUrl();

    state.table = createSupportingTable({
        tbodyId: 'cash-table-body',
        searchInputId: 'cash-search',
        exportBtnId: 'cash-export',
        csvFilename: 'cash-movements',
        label: 'records',
        pageSize: 10,
        paginationId: 'cash-pagination',
        summaryId: 'cash-page-summary',
        indicatorId: 'cash-page-indicator',
        prevBtnId: 'cash-prev-page',
        nextBtnId: 'cash-next-page',
        defaultSortKey: 'date',
        defaultSortDir: 'desc',
        searchText: (r) => `${r.vendor_name || ''} ${r.category || ''}`,
        // Cash movements deep-link into the Ledger; normalized upcoming rows
        // carry their own _href into Invoices / Bills.
        rowLink: (r) => r._href || ledgerRecordUrl(r.id),
        emptyTitle: 'No cash movements',
        emptyDesc: 'No transactions were marked as received or paid in this period.',
        columns: [
            { key: 'date', label: 'Date', sortValue: (r) => (recordDate(r)?.getTime() || 0), csv: (r) => formatDate(recordDate(r)), render: (r) => `<span class="text-gray-600">${escapeHtml(formatDate(recordDate(r)))}</span>` },
            { key: 'desc', label: 'Description', csv: (r) => r.vendor_name || '', render: (r) => `<span class="fluxy-table-cell-primary">${escapeHtml(r.vendor_name || 'Cash movement')}</span>` },
            { key: 'category', label: 'Category', sortValue: (r) => String(r.category || '').toLowerCase(), csv: (r) => r.category || '', render: (r) => `<span class="text-gray-600">${escapeHtml(r.category || '—')}</span>` },
            { key: 'direction', label: 'Direction', csv: (r) => r._directionLabel || (r.cash_direction === 'in' ? 'In' : 'Out'), render: (r) => {
                const label = r._directionLabel || (r.cash_direction === 'in' ? 'Cash in' : 'Cash out');
                const tone = r.cash_direction === 'in' ? 'fluxy-status-success' : 'fluxy-status-danger';
                return `<span class="fluxy-table-status ${tone}">${escapeHtml(label)}</span>`;
            } },
            { key: 'amount', label: 'Amount', align: 'right', sortValue: (r) => signedCash(r), csv: (r) => signedCash(r), render: (r) => `<span class="tabular-nums font-semibold ${r.cash_direction === 'in' ? 'text-emerald-600' : 'text-red-600'}">${r.cash_direction === 'in' ? '+' : '−'}${escapeHtml(formatRp(Math.abs(Number(r.amount) || 0)))}</span>` },
            { key: 'status', label: 'Status', csv: (r) => r.status || '', render: (r) => `<span class="fluxy-table-status fluxy-status-neutral">${escapeHtml(r.status || '—')}</span>` }
        ]
    });

    mountPeriodControls({
        period: state.period,
        pickerSelector: '#cash-date-range-picker',
        onChange: (period) => { state.period = period; loadAndRender(); }
    });

    document.querySelectorAll('[data-breakdown-dim]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.dim = btn.dataset.breakdownDim;
            state.filter = null; // a filter belongs to one dimension — reset on switch
            document.querySelectorAll('[data-breakdown-dim]').forEach(b => b.classList.toggle('is-active', b === btn));
            renderBreakdown();
            applyTableFilter();
        });
    });

    el('cash-filter-clear')?.addEventListener('click', () => {
        state.filter = null;
        renderBreakdown();
        applyTableFilter();
    });

    loadAndRender();
}

// A breakdown row was clicked — toggle it as the table filter. Only the In/Out
// and Upcoming dimensions are interactive; Accounts stays informational.
function onBreakdownSelect(name) {
    let key = null;
    if (state.dim === 'flow') key = name === 'Cash in' ? 'in' : name === 'Cash out' ? 'out' : null;
    else if (state.dim === 'upcoming') key = name === 'Upcoming receivables' ? 'receivable' : name === 'Upcoming payables' ? 'payable' : null;
    if (!key) return;
    const isSame = state.filter && state.filter.dim === state.dim && state.filter.name === name;
    state.filter = isSame ? null : { dim: state.dim, key, name };
    renderBreakdown();
    applyTableFilter();
}

async function loadAndRender() {
    try {
        const [ledgerCash, accounts, invoices, bills, periodTx] = await Promise.all([
            state.ds.getLedgerCashPosition(state.user.uid),
            state.ds.getBankAccounts(state.user.uid).catch(() => []),
            state.ds.getInvoices(state.user.uid).catch(() => []),
            state.ds.getBills(state.user.uid).catch(() => []),
            state.ds.getTransactionsForPeriod(state.user.uid, state.period.start, state.period.end).catch(() => [])
        ]);
        state.ledgerCash = ledgerCash || state.ledgerCash;
        state.accounts = accounts || [];
        state.invoices = invoices || [];
        state.bills = bills || [];
        state.periodTx = (periodTx || []).filter(isCashTx);
        render();
    } catch (error) {
        console.error('Cash position failed:', error);
        renderError();
    }
}

function render() {
    el('kpi-loading')?.classList.add('hidden');
    el('kpi-error')?.classList.add('hidden');
    el('kpi-content')?.classList.remove('hidden');
    state.filter = null; // fresh data (period/reload) clears any active filter

    const { start } = rangeBounds(state.period);
    const startMs = start.getTime();
    const entries = state.ledgerCash._entries || [];

    // Opening balance = net of cash-effective entries before the period start.
    const opening = state.period.mode === 'all_time'
        ? 0
        : entries.reduce((s, e) => s + (e.tsMs && e.tsMs < startMs ? (e.direction === 'in' ? e.amount : -e.amount) : 0), 0);

    const net = Number(state.ledgerCash.net) || 0;
    const periodIn = state.periodTx.filter(t => t.cash_direction === 'in').reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
    const periodOut = state.periodTx.filter(t => t.cash_direction === 'out').reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
    const bankCash = state.accounts.filter(a => a.status !== 'archived').reduce((s, a) => s + (Number(a.latest_balance) || 0), 0);

    // Header
    el('cash-headline').textContent = formatSignedRp(net);
    el('cash-headline').className = `text-2xl font-bold tracking-tight tabular-nums ${net < 0 ? 'text-red-600' : 'text-gray-900'}`;
    const movement = periodIn - periodOut;
    const compare = el('cash-compare');
    compare.textContent = `${movement >= 0 ? '+' : '−'}${formatRp(movement)} net this period · ${formatRp(periodIn)} in · ${formatRp(periodOut)} out`;
    compare.className = `mt-0.5 text-[12px] font-semibold ${movement >= 0 ? 'text-emerald-600' : 'text-red-600'}`;

    // KPI strip
    renderKpiStrip('cash-kpis', [
        { label: 'Cash position', value: formatSignedRp(net), sub: `${state.ledgerCash.recordCount || 0} cash records`, negative: net < 0, info: 'Net cash from every transaction marked as already received or paid — cash in minus cash out, across all time.' },
        { label: 'Cash in (period)', value: formatRp(periodIn), sub: `${state.periodTx.filter(t => t.cash_direction === 'in').length} inflow record(s)`, tone: 'positive', info: 'Money received in the selected period from transactions marked as actual cash in.' },
        { label: 'Cash out (period)', value: formatRp(periodOut), sub: `${state.periodTx.filter(t => t.cash_direction === 'out').length} outflow record(s)`, negative: periodOut > 0, info: 'Money paid out in the selected period from transactions marked as actual cash out.' },
        { label: 'Bank cash', value: formatRp(bankCash), sub: state.accounts.length ? `${state.accounts.filter(a => a.status !== 'archived').length} account(s)` : 'No bank accounts linked', info: 'Latest reported balance across your active bank accounts.' }
    ]);

    // Trend — running balance (opening + cumulative period flows)
    const flow = bucketSeries(state.periodTx, state.period.start, state.period.end, {
        dateOf: (t) => recordDate(t, ['timestamp', 'cash_effective_at', 'date']),
        valueOf: (t) => signedCash(t)
    });
    const cumulative = toCumulative(flow.points, opening);
    renderTrendChart('cash-trend', {
        points: cumulative.map(p => ({ label: p.label, value: p.value, sub: `Net move ${formatSignedRp(p.flow)}` })),
        todayIndex: flow.todayIndex,
        allowNegative: true,
        color: '#3B82F6',
        negColor: '#EF4444',
        valueName: 'Balance',
        formatValue: formatSignedRp,
        emptyText: 'No cash movements to plot in this period yet.'
    });

    renderBreakdown();
    applyTableFilter();

    if (window.FluxyI18n?.getLang?.() === 'id') window.FluxyI18n.translate?.();
}

// Normalize the open invoices behind "Upcoming receivables" into rows the
// supporting table understands (matches the breakdown's math: total_amount,
// open/sent/overdue). Amount is positive → the Amount column shows it as cash in.
function receivableRows() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return state.invoices
        .filter(inv => INVOICE_OPEN_STATUSES.includes(String(inv.status || '').toLowerCase()))
        .map(inv => {
            const due = toDate(inv.due_date);
            const statusRaw = String(inv.status || '').toLowerCase();
            const status = (due && due < today && statusRaw !== 'paid') ? 'Overdue' : (capitalize(statusRaw) || 'Open');
            return {
                id: inv.id,
                vendor_name: inv.customer_name || inv.invoice_number || 'Invoice',
                category: inv.invoice_number || 'Receivable',
                cash_direction: 'in',
                amount: Number(inv.total_amount) || 0,
                status,
                timestamp: due,
                _directionLabel: 'Expected in',
                _href: `/invoices?invoice=${encodeURIComponent(inv.id)}`
            };
        });
}

// Normalize the unpaid bills behind "Upcoming payables" (matches the breakdown:
// any bill not marked paid, |amount|). Amount is positive with cash_direction
// 'out' → the Amount column shows it as a negative cash outflow.
function payableRows() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return state.bills
        .filter(b => String(b.payment_status || '').toLowerCase() !== 'paid')
        .map(b => {
            const due = toDate(b.due_date) || recordDate(b, ['timestamp', 'date']);
            return {
                id: b.id,
                vendor_name: b.vendor_name || 'Bill',
                category: b.category || 'Unpaid bill',
                cash_direction: 'out',
                amount: Math.abs(Number(b.amount) || 0),
                status: (due && due < today) ? 'Overdue' : 'Unpaid',
                timestamp: due,
                _directionLabel: 'Expected out',
                _href: `/bill?record=${encodeURIComponent(b.id)}`
            };
        });
}

// Point the supporting table (title, rows, subtitle, clear chip) at whatever
// breakdown row is currently selected — or all cash movements when none is.
function applyTableFilter() {
    const f = state.filter;
    const periodLabel = state.period.label;
    let rows = state.periodTx;
    let title = 'Cash movements';
    let subtitle;

    if (!f) {
        subtitle = `${plural(state.periodTx.length, 'cash movement', 'cash movements')} for ${periodLabel}. Click a row to open it in the Ledger.`;
    } else if (f.key === 'in' || f.key === 'out') {
        rows = state.periodTx.filter(t => t.cash_direction === f.key);
        title = f.key === 'in' ? 'Cash in' : 'Cash out';
        subtitle = `${plural(rows.length, f.key === 'in' ? 'cash inflow' : 'cash outflow', f.key === 'in' ? 'cash inflows' : 'cash outflows')} for ${periodLabel}. Click a row to open it in the Ledger.`;
    } else if (f.key === 'receivable') {
        rows = receivableRows();
        title = 'Upcoming receivables';
        subtitle = `${plural(rows.length, 'open invoice', 'open invoices')} still expected in. Click a row to open it in Invoices.`;
    } else if (f.key === 'payable') {
        rows = payableRows();
        title = 'Upcoming payables';
        subtitle = `${plural(rows.length, 'unpaid bill', 'unpaid bills')} still due out. Click a row to open it in Bills.`;
    }

    el('cash-table-title').textContent = title;
    el('cash-table-subtitle').textContent = subtitle;
    state.table.setRows(rows);

    const chip = el('cash-filter-clear');
    if (chip) {
        if (f) {
            el('cash-filter-clear-label').textContent = `Showing ${f.name}`;
            chip.classList.remove('hidden');
            chip.classList.add('inline-flex');
        } else {
            chip.classList.add('hidden');
            chip.classList.remove('inline-flex');
        }
    }
}

function renderBreakdown() {
    let rows;
    let color = '#3B82F6';
    let valueFormat = formatRp;
    if (state.dim === 'flow') {
        const periodIn = state.periodTx.filter(t => t.cash_direction === 'in').reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
        const periodOut = state.periodTx.filter(t => t.cash_direction === 'out').reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
        rows = [
            { name: 'Cash in', amount: periodIn, count: state.periodTx.filter(t => t.cash_direction === 'in').length },
            { name: 'Cash out', amount: -periodOut, count: state.periodTx.filter(t => t.cash_direction === 'out').length }
        ];
        valueFormat = formatSignedRp;
    } else if (state.dim === 'upcoming') {
        const receivable = state.invoices
            .filter(inv => ['open', 'sent', 'overdue'].includes(String(inv.status || '').toLowerCase()))
            .reduce((s, inv) => s + (Number(inv.total_amount) || 0), 0);
        const receivableCount = state.invoices.filter(inv => ['open', 'sent', 'overdue'].includes(String(inv.status || '').toLowerCase())).length;
        const payable = state.bills
            .filter(b => String(b.payment_status || '').toLowerCase() !== 'paid')
            .reduce((s, b) => s + Math.abs(Number(b.amount) || 0), 0);
        const payableCount = state.bills.filter(b => String(b.payment_status || '').toLowerCase() !== 'paid').length;
        rows = [
            { name: 'Upcoming receivables', amount: receivable, count: receivableCount, meta: 'Open invoices' },
            { name: 'Upcoming payables', amount: -payable, count: payableCount, meta: 'Unpaid bills' }
        ];
        valueFormat = formatSignedRp;
    } else {
        rows = state.accounts
            .filter(a => a.status !== 'archived')
            .map(a => ({ name: a.account_name || a.bank_name || 'Account', amount: Number(a.latest_balance) || 0, meta: a.bank_name || '' }));
    }
    const total = rows.reduce((s, r) => s + r.amount, 0);
    // In/Out and Upcoming rows double as a table filter; Accounts is read-only.
    const interactive = state.dim === 'flow' || state.dim === 'upcoming';
    renderBreakdownList('cash-breakdown', {
        rows, total, color, valueFormat,
        interactive,
        selected: (state.filter && state.filter.dim === state.dim) ? state.filter.name : null,
        onSelect: onBreakdownSelect,
        emptyText: state.dim === 'accounts' ? 'No bank accounts linked yet.' : 'Nothing to show for this period.'
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
            <h1 class="text-xl font-bold text-gray-900">Cash position could not be opened.</h1>
            <p class="mt-2 text-[13px] text-gray-500">Refresh and try again.</p>
            <a href="/dashboard" class="mt-5 inline-flex items-center justify-center rounded-lg bg-slate-950 px-4 py-2 text-[13px] font-bold text-white hover:bg-slate-800">Back to Overview</a>
        </div>`;
}
