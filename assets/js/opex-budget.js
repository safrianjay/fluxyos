// OpEx & Budget — KPI drill-down page.
// Operating spend for the selected period, tracked against the active budget,
// with category / allocation / over-budget breakdowns and the expense records
// behind it. All reads route through DataService (workspace-scoped).
import {
    escapeHtml, formatRp, formatPercent, formatDate, recordDate,
    resolvePeriodFromUrl, mountPeriodControls, previousPeriod, resolvePeriod,
    renderKpiStrip, trendDelta, bucketSeries, renderTrendChart,
    renderBreakdownList, createSupportingTable, ledgerRecordUrl, parseKey
} from '/assets/js/kpi-detail-shared.js';

const SPEND_TYPES = new Set(['expense', 'fee', 'tax']);

const state = {
    ds: null,
    user: null,
    period: null,
    allExpense: [],   // spend-type transactions across a wide window (filtered per period)
    rows: [],         // spend records inside the current period
    usage: null,      // getBudgetUsage result (active budget period)
    dim: 'categories',
    table: null
};

const el = (id) => document.getElementById(id);
const isSpend = (tx) => SPEND_TYPES.has(String(tx?.type || '').toLowerCase());
const spendAmount = (tx) => Math.abs(Number(tx?.amount) || 0);

function rangeBounds(period) {
    const start = parseKey(period.start) || new Date(0);
    const end = parseKey(period.end) || new Date();
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
}
function inRange(tx, start, end) {
    const d = recordDate(tx, ['timestamp', 'date', 'created_at']);
    return d && d >= start && d <= end;
}
function filterPeriod(records, period) {
    const { start, end } = rangeBounds(period);
    return records.filter(tx => inRange(tx, start, end));
}

export function initOpexBudgetPage({ ds, user }) {
    state.ds = ds;
    state.user = user;
    ds.setActor?.(user.uid);
    state.period = resolvePeriodFromUrl();

    state.table = createSupportingTable({
        tbodyId: 'opex-table-body',
        searchInputId: 'opex-search',
        exportBtnId: 'opex-export',
        csvFilename: 'operating-expenses',
        label: 'records',
        pageSize: 10,
        paginationId: 'opex-pagination',
        summaryId: 'opex-page-summary',
        indicatorId: 'opex-page-indicator',
        prevBtnId: 'opex-prev-page',
        nextBtnId: 'opex-next-page',
        defaultSortKey: 'date',
        defaultSortDir: 'desc',
        searchText: (r) => `${r.vendor_name || ''} ${r.category || ''} ${r.type || ''}`,
        rowLink: (r) => ledgerRecordUrl(r.id),
        emptyTitle: 'No operating expenses',
        emptyDesc: 'No expenses were recorded in this period.',
        columns: [
            { key: 'date', label: 'Date', sortValue: (r) => (recordDate(r)?.getTime() || 0), csv: (r) => formatDate(recordDate(r)), render: (r) => `<span class="text-gray-600">${escapeHtml(formatDate(recordDate(r)))}</span>` },
            { key: 'desc', label: 'Description', csv: (r) => r.vendor_name || '', render: (r) => `<span class="fluxy-table-cell-primary">${escapeHtml(r.vendor_name || 'Expense')}</span>` },
            { key: 'category', label: 'Category', sortValue: (r) => String(r.category || '').toLowerCase(), csv: (r) => r.category || '', render: (r) => `<span class="text-gray-600">${escapeHtml(r.category || '—')}</span>` },
            { key: 'type', label: 'Type', csv: (r) => r.type || '', render: (r) => `<span class="text-gray-500 capitalize">${escapeHtml(String(r.type || '—'))}</span>` },
            { key: 'amount', label: 'Amount', align: 'right', sortValue: (r) => spendAmount(r), csv: (r) => spendAmount(r), render: (r) => `<span class="tabular-nums font-semibold text-red-600">${escapeHtml(formatRp(spendAmount(r)))}</span>` },
            { key: 'status', label: 'Status', csv: (r) => r.status || '', render: (r) => `<span class="fluxy-table-status fluxy-status-neutral">${escapeHtml(r.status || '—')}</span>` }
        ]
    });

    mountPeriodControls({
        period: state.period,
        pickerSelector: '#opex-date-range-picker',
        onChange: (period) => { state.period = period; loadAndRender(); }
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

async function loadAndRender() {
    try {
        // Pull a wide expense window once (all-time spend types) so period/prev
        // filters + trend are consistent, then the active-budget usage.
        if (!state.allExpense.length) {
            const all = await state.ds.getTransactions(state.user.uid, 2000).catch(() => []);
            state.allExpense = all.filter(isSpend);
        }
        const budget = await state.ds.getActiveBudget(state.user.uid).catch(() => null);
        state.usage = budget ? await state.ds.getBudgetUsage(state.user.uid, budget.id).catch(() => null) : null;
        render();
    } catch (error) {
        console.error('OpEx & budget failed:', error);
        renderError();
    }
}

function render() {
    el('kpi-loading')?.classList.add('hidden');
    el('kpi-error')?.classList.add('hidden');
    el('kpi-content')?.classList.remove('hidden');

    state.rows = filterPeriod(state.allExpense, state.period);
    const prev = previousPeriod(state.period.start, state.period.end);
    const prevRows = state.period.mode === 'all_time' ? [] : filterPeriod(state.allExpense, resolvePeriod('custom', prev.start, prev.end));

    const total = state.rows.reduce((s, r) => s + spendAmount(r), 0);
    const prevTotal = prevRows.reduce((s, r) => s + spendAmount(r), 0);
    const summary = state.usage?.summary;
    const budgetTotal = Number(summary?.total_amount) || 0;
    const usagePct = summary ? summary.usage_percent : 0;
    const remaining = summary ? summary.total_remaining : 0;

    // Header — spend up is "bad", so invert the trend colour.
    el('opex-period-label').textContent = state.period.label;
    el('opex-headline').textContent = formatRp(total);
    const delta = trendDelta(total, prevTotal, { invert: true });
    const compare = el('opex-compare');
    if (state.period.mode === 'all_time') {
        compare.textContent = `${state.rows.length} expense records`;
        compare.className = 'mt-0.5 text-[12px] font-semibold text-gray-500';
    } else {
        compare.textContent = `${delta.arrow} ${delta.text}`.trim();
        compare.className = `mt-0.5 text-[12px] font-semibold ${delta.colorClass}`;
    }

    // KPI strip
    const usageBar = usagePct >= 100 ? 'bg-red-500' : usagePct >= 85 ? 'bg-amber-500' : 'bg-emerald-500';
    renderKpiStrip('opex-kpis', [
        { label: 'OpEx (period)', value: formatRp(total), sub: `${state.rows.length} expense record${state.rows.length === 1 ? '' : 's'}`, info: 'Operating spend recorded in the selected period — expenses, fees, and taxes.' },
        { label: 'Active budget', value: budgetTotal > 0 ? formatRp(budgetTotal) : '—', sub: state.usage?.budget ? (state.usage.budget.period_label || state.usage.budget.name || 'Active budget') : 'No active budget', info: 'Total amount of your current active budget, measured over the budget’s own period.' },
        { label: 'Budget used', value: budgetTotal > 0 ? formatPercent(usagePct) : 'N/A', sub: budgetTotal > 0 ? `${formatRp(summary.total_actual_used)} actual · ${formatRp(summary.total_committed)} committed` : 'Set a budget to track this', progress: budgetTotal > 0 ? usagePct : null, barCls: usageBar, info: 'Actual plus committed spend as a percentage of the active budget.' },
        { label: 'Remaining', value: budgetTotal > 0 ? formatRp(remaining) : '—', sub: budgetTotal > 0 ? (remaining < 0 ? 'Over budget' : 'Left in active budget') : 'No active budget', negative: budgetTotal > 0 && remaining < 0, info: 'Budget left after actual and committed spend. Negative means over budget.' }
    ]);

    // Trend — burn over the selected period
    const { points, todayIndex } = bucketSeries(state.rows, state.period.start, state.period.end, {
        dateOf: (r) => recordDate(r),
        valueOf: (r) => spendAmount(r)
    });
    renderTrendChart('opex-trend', {
        points, todayIndex,
        color: '#EA580C',
        valueName: 'Spend',
        formatValue: formatRp,
        emptyText: 'No operating spend recorded in this period yet.'
    });

    renderBreakdown();
    state.table.setRows(state.rows);
    el('opex-table-subtitle').textContent = `${state.rows.length} expense record${state.rows.length === 1 ? '' : 's'} for ${state.period.label}. Click a row to open it in the Ledger.`;

    if (window.FluxyI18n?.getLang?.() === 'id') window.FluxyI18n.translate?.();
}

function groupBy(rows, keyFn) {
    const map = new Map();
    rows.forEach(r => {
        const k = keyFn(r);
        const cur = map.get(k) || { name: k, amount: 0, count: 0 };
        cur.amount += spendAmount(r);
        cur.count += 1;
        map.set(k, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

function renderBreakdown() {
    const allocations = state.usage?.allocations || [];
    if (state.dim === 'allocations') {
        const rows = allocations.map(a => ({
            name: a.name,
            amount: a.actual_used + a.committed_amount,
            meta: `of ${formatRp(a.allocated_amount)} · ${formatPercent(a.usage_percent)}`
        }));
        renderBreakdownList('opex-breakdown', {
            rows, total: rows.reduce((s, r) => s + r.amount, 0), color: '#EA580C',
            emptyText: state.usage?.budget ? 'This budget has no allocations yet.' : 'No active budget to track against.'
        });
    } else if (state.dim === 'over') {
        const rows = allocations
            .filter(a => a.usage_percent >= 100)
            .map(a => ({
                name: a.name,
                amount: a.actual_used + a.committed_amount,
                meta: `${formatPercent(a.usage_percent)} of ${formatRp(a.allocated_amount)}`
            }));
        renderBreakdownList('opex-breakdown', {
            rows, total: rows.reduce((s, r) => s + r.amount, 0), color: '#EF4444',
            emptyText: state.usage?.budget ? 'No categories are over budget. Nice.' : 'No active budget to track against.'
        });
    } else {
        const rows = groupBy(state.rows, (r) => r.category || 'Uncategorized');
        renderBreakdownList('opex-breakdown', {
            rows, total: rows.reduce((s, r) => s + r.amount, 0), color: '#EA580C',
            emptyText: 'No operating spend to break down for this period.'
        });
    }
}

function renderError() {
    el('kpi-loading')?.classList.add('hidden');
    el('kpi-content')?.classList.add('hidden');
    const err = el('kpi-error');
    if (!err) return;
    err.classList.remove('hidden');
    err.innerHTML = `
        <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-10 text-center">
            <h1 class="text-xl font-bold text-gray-900">OpEx &amp; budget could not be opened.</h1>
            <p class="mt-2 text-[13px] text-gray-500">Refresh and try again.</p>
            <a href="/dashboard" class="mt-5 inline-flex items-center justify-center rounded-lg bg-slate-950 px-4 py-2 text-[13px] font-bold text-white hover:bg-slate-800">Back to Overview</a>
        </div>`;
}
