// Revenue Overview — KPI drill-down page.
// Answers "where is my revenue coming from?" for the period the dashboard
// passed via the URL. Reuses the shared KPI-detail scaffold; all reads go
// through DataService (workspace-scoped) — never a hardcoded users/ path.
import {
    escapeHtml, formatRp, formatPercent, formatDate, recordDate,
    resolvePeriodFromUrl, mountPeriodControls, previousPeriod, resolvePeriod,
    renderKpiStrip, trendDelta, bucketSeries, renderTrendChart,
    renderBreakdownList, createSupportingTable, ledgerRecordUrl, parseKey
} from '/assets/js/kpi-detail-shared.js';

const REVENUE_TYPES = new Set(['revenue', 'income', 'refund', 'pending_receivable']);

const state = {
    ds: null,
    user: null,
    period: null,
    allRevenue: [],   // every revenue-family transaction (active)
    rows: [],         // revenue records inside the current period
    dim: 'category',
    table: null
};

const el = (id) => document.getElementById(id);
const isRevenue = (tx) => REVENUE_TYPES.has(String(tx?.type || '').toLowerCase());
const revAmount = (tx) => Math.abs(Number(tx?.amount) || 0);

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

export function initRevenueOverviewPage({ ds, user }) {
    state.ds = ds;
    state.user = user;
    ds.setActor?.(user.uid);
    state.period = resolvePeriodFromUrl();

    state.table = createSupportingTable({
        tbodyId: 'revenue-table-body',
        searchInputId: 'revenue-search',
        exportBtnId: 'revenue-export',
        csvFilename: 'revenue-records',
        label: 'records',
        pageSize: 10,
        paginationId: 'revenue-pagination',
        summaryId: 'revenue-page-summary',
        indicatorId: 'revenue-page-indicator',
        prevBtnId: 'revenue-prev-page',
        nextBtnId: 'revenue-next-page',
        defaultSortKey: 'date',
        defaultSortDir: 'desc',
        searchText: (r) => `${r.vendor_name || ''} ${r.category || ''} ${r.source || ''}`,
        rowLink: (r) => ledgerRecordUrl(r.id),
        emptyTitle: 'No revenue records',
        emptyDesc: 'No revenue was recorded in this period.',
        columns: [
            { key: 'date', label: 'Date', sortValue: (r) => (recordDate(r)?.getTime() || 0), csv: (r) => formatDate(recordDate(r)), render: (r) => `<span class="text-gray-600">${escapeHtml(formatDate(recordDate(r)))}</span>` },
            { key: 'desc', label: 'Description', csv: (r) => r.vendor_name || '', render: (r) => `<span class="fluxy-table-cell-primary">${escapeHtml(r.vendor_name || 'Revenue')}</span>` },
            { key: 'category', label: 'Category', sortValue: (r) => String(r.category || '').toLowerCase(), csv: (r) => r.category || '', render: (r) => `<span class="text-gray-600">${escapeHtml(r.category || '—')}</span>` },
            { key: 'source', label: 'Channel', csv: (r) => sourceLabel(r), render: (r) => `<span class="text-gray-500">${escapeHtml(sourceLabel(r))}</span>` },
            { key: 'amount', label: 'Amount', align: 'right', sortValue: (r) => revAmount(r), csv: (r) => revAmount(r), render: (r) => `<span class="tabular-nums font-semibold text-emerald-600">${escapeHtml(formatRp(revAmount(r)))}</span>` },
            { key: 'status', label: 'Status', csv: (r) => r.status || '', render: (r) => `<span class="fluxy-table-status fluxy-status-neutral">${escapeHtml(r.status || '—')}</span>` }
        ]
    });

    // Period strip
    mountPeriodControls({
        period: state.period,
        pickerSelector: '#revenue-date-range-picker',
        onChange: (period) => { state.period = period; loadAndRender(); }
    });

    // Breakdown dimension toggle
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
        if (!state.allRevenue.length) {
            state.allRevenue = (await state.ds.getRevenueTransactionsForDashboardStats(state.user.uid)).filter(isRevenue);
        }
        render();
    } catch (error) {
        console.error('Revenue overview failed:', error);
        renderError();
    }
}

function render() {
    el('kpi-loading')?.classList.add('hidden');
    el('kpi-error')?.classList.add('hidden');
    el('kpi-content')?.classList.remove('hidden');

    state.rows = filterPeriod(state.allRevenue, state.period);
    const prev = previousPeriod(state.period.start, state.period.end);
    const prevRows = state.period.mode === 'all_time' ? [] : filterPeriod(state.allRevenue, resolvePeriod('custom', prev.start, prev.end));

    const total = state.rows.reduce((s, r) => s + revAmount(r), 0);
    const prevTotal = prevRows.reduce((s, r) => s + revAmount(r), 0);
    const allTime = state.allRevenue.reduce((s, r) => s + revAmount(r), 0);
    const avg = state.rows.length ? total / state.rows.length : 0;

    // Header
    el('revenue-period-label').textContent = state.period.label;
    el('revenue-headline').textContent = formatRp(total);
    const delta = trendDelta(total, prevTotal);
    const compare = el('revenue-compare');
    if (state.period.mode === 'all_time') {
        compare.textContent = `${state.rows.length} revenue records`;
        compare.className = 'mt-0.5 text-[12px] font-semibold text-gray-500';
    } else {
        compare.textContent = `${delta.arrow} ${delta.text}`.trim();
        compare.className = `mt-0.5 text-[12px] font-semibold ${delta.colorClass}`;
    }

    // KPI strip
    const topCategory = topGroup(state.rows, (r) => r.category || 'Uncategorized');
    renderKpiStrip('revenue-kpis', [
        { label: 'Revenue (period)', value: formatRp(total), sub: `${state.rows.length} record${state.rows.length === 1 ? '' : 's'}` },
        { label: 'Vs previous period', value: state.period.mode === 'all_time' ? '—' : formatRp(prevTotal), sub: state.period.mode === 'all_time' ? 'Not applicable' : delta.text, tone: state.period.mode === 'all_time' ? '' : delta.tone },
        { label: 'Average per record', value: formatRp(avg), sub: 'Mean revenue booking' },
        { label: 'All-time revenue', value: formatRp(allTime), sub: `${state.allRevenue.length} records total` }
    ]);

    // Trend
    const { points, todayIndex } = bucketSeries(state.rows, state.period.start, state.period.end, {
        dateOf: (r) => recordDate(r),
        valueOf: (r) => revAmount(r)
    });
    renderTrendChart('revenue-trend', {
        points, todayIndex,
        color: '#16A34A',
        valueName: 'Revenue',
        formatValue: formatRp,
        emptyText: 'No revenue recorded in this period yet.'
    });

    renderBreakdown();
    state.table.setRows(state.rows);
    el('revenue-table-subtitle').textContent = `${state.rows.length} revenue record${state.rows.length === 1 ? '' : 's'} for ${state.period.label}. Click a row to open it in the Ledger.`;

    if (window.FluxyI18n?.getLang?.() === 'id') window.FluxyI18n.translate?.();
}

function sourceLabel(r) {
    const s = String(r.source || '').trim();
    if (!s || s === 'manual') return 'Manual entry';
    return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function topGroup(rows, keyFn) {
    const map = new Map();
    rows.forEach(r => { const k = keyFn(r); map.set(k, (map.get(k) || 0) + revAmount(r)); });
    let best = null;
    map.forEach((v, k) => { if (!best || v > best.amount) best = { name: k, amount: v }; });
    return best;
}

function groupBy(rows, keyFn) {
    const map = new Map();
    rows.forEach(r => {
        const k = keyFn(r);
        const cur = map.get(k) || { name: k, amount: 0, count: 0 };
        cur.amount += revAmount(r);
        cur.count += 1;
        map.set(k, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

function renderBreakdown() {
    let rows;
    if (state.dim === 'source') rows = groupBy(state.rows, (r) => sourceLabel(r));
    else if (state.dim === 'business') rows = groupBy(state.rows, (r) => r.entity_name || r.entity_id || 'Unassigned');
    else rows = groupBy(state.rows, (r) => r.category || 'Uncategorized');
    const total = rows.reduce((s, r) => s + r.amount, 0);
    renderBreakdownList('revenue-breakdown', {
        rows, total, color: '#16A34A',
        emptyText: 'No revenue to break down for this period.'
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
            <h1 class="text-xl font-bold text-gray-900">Revenue overview could not be opened.</h1>
            <p class="mt-2 text-[13px] text-gray-500">Refresh and try again.</p>
            <a href="/dashboard" class="mt-5 inline-flex items-center justify-center rounded-lg bg-slate-950 px-4 py-2 text-[13px] font-bold text-white hover:bg-slate-800">Back to Overview</a>
        </div>`;
}
