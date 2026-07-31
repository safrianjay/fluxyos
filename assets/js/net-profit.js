// Net Profit — KPI drill-down page.
// Answers "why did my profit change?" for the period the dashboard passed via
// the URL, not just "what is it". Net profit is revenue minus every spend-side
// type, matching _calculateOverviewPerformance in db-service.js so this page and
// the Overview card can never disagree. All reads go through DataService
// (workspace-scoped) — never a hardcoded users/ path.
//
// Negative-money convention on this page: "-Rp1.000.000" (with red), matching
// the Overview Net profit card, so the same figure reads identically either side
// of the drill-down.
import {
    escapeHtml, formatRp, formatPercent, formatDate, recordDate,
    resolvePeriodFromUrl, mountPeriodControls, previousPeriod, resolvePeriod,
    renderKpiStrip, bucketSeries, renderTrendChart,
    renderBreakdownList, createSupportingTable, ledgerRecordUrl, parseKey, dayKey
} from '/assets/js/kpi-detail-shared.js';

const REVENUE_TYPES = new Set(['revenue', 'income', 'refund', 'pending_receivable']);
const EXPENSE_TYPES = new Set(['expense', 'fee', 'tax', 'pending_payable']);

// How many buckets the "Comparison by period" table shows per grain.
const COMPARISON_SPANS = { month: 6, quarter: 6, year: 4 };

const state = {
    ds: null,
    user: null,
    period: null,
    all: [],           // every profit-and-loss transaction (revenue + spend types)
    rows: [],          // P&L records inside the current period
    prevRows: [],      // same, for the preceding period of equal length
    totals: null,      // { revenue, expenses, netProfit, margin } for the period
    dim: 'contributors',
    grain: 'month',
    scope: 'all',      // records table scope: all | revenue | expense
    filter: null,      // active breakdown filter driving the table, or null
    table: null,
    aiUsage: null,
    aiLocked: false,
    aiRequestSeq: 0
};

const el = (id) => document.getElementById(id);
const txType = (tx) => String(tx?.type || '').toLowerCase();
const isRevenue = (tx) => REVENUE_TYPES.has(txType(tx));
const isExpense = (tx) => EXPENSE_TYPES.has(txType(tx));
const isProfitAndLoss = (tx) => isRevenue(tx) || isExpense(tx);
const absAmount = (tx) => Math.abs(Number(tx?.amount) || 0);
// Signed effect on profit: revenue adds, spend subtracts.
const profitImpact = (tx) => (isRevenue(tx) ? absAmount(tx) : -absAmount(tx));

// Money that can legitimately be negative. Levels use a minus prefix (see the
// file header) — never a leading "+", which would read as a delta.
function formatProfit(value) {
    const n = Number(value) || 0;
    return n < 0 ? `-${formatRp(n)}` : formatRp(n);
}
// Explicit movement, where the sign IS the message.
function formatDelta(value) {
    const n = Number(value) || 0;
    if (Math.round(n) === 0) return 'Rp0';
    return `${n < 0 ? '−' : '+'}${formatRp(n)}`;
}
const toneClass = (n) => (Number(n) < 0 ? 'text-red-600' : 'text-emerald-600');

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

function totalsFor(rows) {
    let revenue = 0;
    let expenses = 0;
    rows.forEach(r => { if (isRevenue(r)) revenue += absAmount(r); else expenses += absAmount(r); });
    const netProfit = revenue - expenses;
    const margin = revenue > 0 ? (netProfit / revenue) * 100 : null;
    return { revenue, expenses, netProfit, margin, count: rows.length };
}

export function initNetProfitPage({ ds, user }) {
    state.ds = ds;
    state.user = user;
    ds.setActor?.(user.uid);
    state.period = resolvePeriodFromUrl();

    state.table = createSupportingTable({
        tbodyId: 'profit-table-body',
        searchInputId: 'profit-search',
        exportBtnId: 'profit-export',
        csvFilename: 'net-profit-records',
        label: 'records',
        pageSize: 10,
        paginationId: 'profit-pagination',
        summaryId: 'profit-page-summary',
        indicatorId: 'profit-page-indicator',
        prevBtnId: 'profit-prev-page',
        nextBtnId: 'profit-next-page',
        defaultSortKey: 'date',
        defaultSortDir: 'desc',
        searchText: (r) => `${r.vendor_name || ''} ${r.category || ''} ${r.type || ''}`,
        rowLink: (r) => ledgerRecordUrl(r.id),
        emptyTitle: 'No profit or loss records',
        emptyDesc: 'No revenue or expenses were recorded in this period.',
        columns: [
            { key: 'date', label: 'Date', sortValue: (r) => (recordDate(r)?.getTime() || 0), csv: (r) => formatDate(recordDate(r)), render: (r) => `<span class="text-gray-600">${escapeHtml(formatDate(recordDate(r)))}</span>` },
            { key: 'desc', label: 'Description', csv: (r) => r.vendor_name || '', render: (r) => `<span class="fluxy-table-cell-primary">${escapeHtml(r.vendor_name || (isRevenue(r) ? 'Revenue' : 'Expense'))}</span>` },
            { key: 'category', label: 'Category', sortValue: (r) => String(r.category || '').toLowerCase(), csv: (r) => r.category || '', render: (r) => `<span class="text-gray-600">${escapeHtml(r.category || '—')}</span>` },
            { key: 'type', label: 'Type', csv: (r) => r.type || '', render: (r) => `<span class="text-gray-500 capitalize">${escapeHtml(String(r.type || '—').replace(/_/g, ' '))}</span>` },
            { key: 'impact', label: 'Profit impact', align: 'right', sortValue: (r) => profitImpact(r), csv: (r) => profitImpact(r), render: (r) => `<span class="tabular-nums font-semibold ${toneClass(profitImpact(r))}">${escapeHtml(formatDelta(profitImpact(r)))}</span>` },
            { key: 'status', label: 'Status', csv: (r) => r.status || '', render: (r) => `<span class="fluxy-table-status fluxy-status-neutral">${escapeHtml(r.status || '—')}</span>` }
        ]
    });

    mountPeriodControls({
        period: state.period,
        pickerSelector: '#profit-date-range-picker',
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

    document.querySelectorAll('[data-comparison-grain]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.grain = btn.dataset.comparisonGrain;
            document.querySelectorAll('[data-comparison-grain]').forEach(b => b.classList.toggle('is-active', b === btn));
            renderComparison();
        });
    });

    document.querySelectorAll('[data-record-scope]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.scope = btn.dataset.recordScope;
            document.querySelectorAll('[data-record-scope]').forEach(b => b.classList.toggle('is-active', b === btn));
            applyTableFilter();
        });
    });

    el('profit-filter-clear')?.addEventListener('click', () => {
        state.filter = null;
        renderBreakdown();
        applyTableFilter();
    });

    el('profit-ai-generate')?.addEventListener('click', generateAiAnalysis);

    registerAiPageContext();
    loadAndRender();
}

async function loadAndRender() {
    try {
        // One wide read, cached: the period strip, the previous-period bridge and
        // the month/quarter/year comparison all slice the same history client-side.
        if (!state.all.length) {
            const all = await state.ds.getTransactionsForDashboardOverview(state.user.uid, true);
            state.all = all.filter(isProfitAndLoss);
        }
        render();
    } catch (error) {
        console.error('Net profit page failed:', error);
        renderError();
    }
}

function render() {
    el('kpi-loading')?.classList.add('hidden');
    el('kpi-error')?.classList.add('hidden');
    el('kpi-content')?.classList.remove('hidden');

    state.rows = filterPeriod(state.all, state.period);
    const prev = previousPeriod(state.period.start, state.period.end);
    state.prevRows = state.period.mode === 'all_time' ? [] : filterPeriod(state.all, resolvePeriod('custom', prev.start, prev.end));

    const totals = totalsFor(state.rows);
    const prevTotals = totalsFor(state.prevRows);
    state.totals = totals;
    const hasComparison = state.period.mode !== 'all_time' && state.prevRows.length > 0;

    // Header
    el('profit-period-label').textContent = state.period.label;
    const headline = el('profit-headline');
    headline.textContent = formatProfit(totals.netProfit);
    headline.className = `text-2xl font-bold tracking-tight tabular-nums ${totals.netProfit < 0 ? 'text-red-600' : 'text-gray-900'}`;

    const diff = totals.netProfit - prevTotals.netProfit;
    const changePct = prevTotals.netProfit !== 0 ? (diff / Math.abs(prevTotals.netProfit)) * 100 : null;
    const compare = el('profit-compare');
    if (!hasComparison) {
        compare.textContent = `${totals.count} profit and loss record${totals.count === 1 ? '' : 's'}`;
        compare.className = 'mt-0.5 text-[12px] font-semibold text-gray-500';
    } else if (Math.round(diff) === 0) {
        compare.textContent = 'No change vs previous period';
        compare.className = 'mt-0.5 text-[12px] font-semibold text-gray-500';
    } else {
        const pctText = changePct === null ? '' : ` (${formatPercent(Math.abs(changePct))})`;
        compare.textContent = `${diff > 0 ? '▲' : '▼'} ${formatDelta(diff)}${pctText} vs previous period`;
        compare.className = `mt-0.5 text-[12px] font-semibold ${diff >= 0 ? 'text-emerald-600' : 'text-red-600'}`;
    }

    // KPI strip
    const marginBar = totals.margin === null ? null : Math.max(0, Math.min(100, totals.margin));
    renderKpiStrip('profit-kpis', [
        {
            label: 'Net profit (period)',
            value: formatProfit(totals.netProfit),
            sub: hasComparison ? `${formatDelta(diff)} vs previous period` : `${totals.count} record${totals.count === 1 ? '' : 's'}`,
            negative: totals.netProfit < 0,
            tone: totals.netProfit > 0 ? 'positive' : '',
            info: 'Revenue minus every expense recorded in the selected period — operating expenses, fees, taxes, and pending payables.'
        },
        {
            label: 'Profit margin',
            value: totals.margin === null ? 'N/A' : formatPercent(totals.margin),
            sub: totals.margin === null ? 'No revenue in this period' : marginLabel(totals.margin),
            negative: totals.margin !== null && totals.margin < 0,
            progress: marginBar,
            barCls: totals.margin === null || totals.margin < 0 ? 'bg-red-500' : totals.margin < 20 ? 'bg-amber-500' : 'bg-emerald-500',
            info: 'Net profit as a percentage of revenue. Unavailable when no revenue was recorded in the period.'
        },
        {
            label: 'Total revenue',
            value: formatRp(totals.revenue),
            sub: `${state.rows.filter(isRevenue).length} revenue record${state.rows.filter(isRevenue).length === 1 ? '' : 's'}`,
            tone: 'positive',
            info: 'All income, refunds, and receivables recorded in the selected period, summed as absolute amounts.'
        },
        {
            label: 'Total expenses',
            value: formatRp(totals.expenses),
            sub: `${state.rows.filter(isExpense).length} expense record${state.rows.filter(isExpense).length === 1 ? '' : 's'}`,
            negative: totals.expenses > 0,
            info: 'All expenses, fees, taxes, and pending payables recorded in the selected period.'
        }
    ]);

    // Trend — net profit per bucket, allowed to cross below zero.
    const { points, todayIndex } = bucketSeries(state.rows, state.period.start, state.period.end, {
        dateOf: (r) => recordDate(r),
        valueOf: (r) => profitImpact(r)
    });
    renderTrendChart('profit-trend', {
        points, todayIndex,
        color: '#16A34A',
        negColor: '#EF4444',
        allowNegative: true,
        valueName: 'Net profit',
        formatValue: formatProfit,
        emptyText: 'No revenue or expenses recorded in this period yet.'
    });

    state.filter = null; // fresh data (period/reload) clears any active filter
    renderBreakdown();
    renderComposition(totals);
    renderBridge(totals, prevTotals, hasComparison);
    renderMovers(hasComparison);
    renderComparison();
    renderAiIdle();
    applyTableFilter();

    if (window.FluxyI18n?.getLang?.() === 'id') window.FluxyI18n.translate?.();
}

function marginLabel(margin) {
    if (margin < 0) return 'Operating at a loss';
    if (margin < 10) return 'Thin margin';
    if (margin < 25) return 'Workable margin';
    return 'Healthy margin';
}

// ── Breakdowns ──────────────────────────────────────────────────────
function sourceLabel(r) {
    const s = String(r.source || '').trim();
    if (!s || s === 'manual') return 'Manual entry';
    return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function groupBy(rows, keyFn, valueFn) {
    const map = new Map();
    rows.forEach(r => {
        const k = keyFn(r);
        const cur = map.get(k) || { name: k, amount: 0, count: 0 };
        cur.amount += valueFn(r);
        cur.count += 1;
        map.set(k, cur);
    });
    return Array.from(map.values());
}

// The grouping key per dimension — shared by the breakdown list and the table
// filter so a clicked row filters the table to exactly that group.
function dimKeyFn(dim) {
    if (dim === 'revenue') return (r) => sourceLabel(r);
    return (r) => r.category || 'Uncategorized';
}
function dimRows(dim) {
    if (dim === 'expenses') return state.rows.filter(isExpense);
    if (dim === 'revenue') return state.rows.filter(isRevenue);
    return state.rows;
}

const BREAKDOWN_HINTS = {
    contributors: 'Net effect on profit by category — revenue minus expenses.',
    expenses: 'What the money went to, largest first.',
    revenue: 'Where the money came from, largest first.'
};

function renderBreakdown() {
    const dim = state.dim;
    let rows;
    let color = '#EA580C';
    let emptyText;
    if (dim === 'expenses') {
        rows = groupBy(dimRows(dim), dimKeyFn(dim), absAmount).sort((a, b) => b.amount - a.amount);
        emptyText = 'No expenses to break down for this period.';
    } else if (dim === 'revenue') {
        rows = groupBy(dimRows(dim), dimKeyFn(dim), absAmount).sort((a, b) => b.amount - a.amount);
        color = '#16A34A';
        emptyText = 'No revenue to break down for this period.';
    } else {
        // Contributors mixes gains and losses, so rank by size of impact — the
        // biggest drag on profit is as interesting as the biggest driver.
        rows = groupBy(dimRows(dim), dimKeyFn(dim), profitImpact)
            .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
        color = '#16A34A';
        emptyText = 'No profit or loss records to break down for this period.';
    }

    el('profit-breakdown-hint').textContent = BREAKDOWN_HINTS[dim] || BREAKDOWN_HINTS.contributors;
    renderBreakdownList('profit-breakdown', {
        rows,
        total: rows.reduce((s, r) => s + Math.abs(r.amount), 0),
        color,
        valueFormat: dim === 'contributors' ? formatDelta : formatRp,
        interactive: true,
        selected: (state.filter && state.filter.dim === dim) ? state.filter.name : null,
        onSelect: onBreakdownSelect,
        emptyText
    });
}

function onBreakdownSelect(name) {
    const isSame = state.filter && state.filter.dim === state.dim && state.filter.name === name;
    state.filter = isSame ? null : { dim: state.dim, name };
    renderBreakdown();
    applyTableFilter();
}

// ── Revenue vs expenses composition ─────────────────────────────────
function renderComposition(totals) {
    const host = el('profit-composition');
    if (!host) return;
    if (totals.revenue === 0 && totals.expenses === 0) {
        host.innerHTML = '<p class="text-[13px] text-gray-500">No revenue or expenses recorded in this period yet.</p>';
        return;
    }
    const scale = Math.max(totals.revenue, totals.expenses, 1);
    const bar = (label, amount, colorCls, valueCls) => `
        <div>
            <div class="flex items-baseline justify-between gap-4">
                <span class="text-[13px] font-semibold text-gray-700">${escapeHtml(label)}</span>
                <span class="text-[14px] font-bold tabular-nums ${valueCls}">${escapeHtml(formatRp(amount))}</span>
            </div>
            <div class="np-bar-track mt-2">
                <div class="np-bar-fill ${colorCls}" style="width:${Math.max(2, (amount / scale) * 100).toFixed(2)}%"></div>
            </div>
        </div>`;
    let keptCopy;
    if (totals.revenue <= 0) keptCopy = 'No revenue to measure against';
    else if (totals.netProfit < 0) keptCopy = `Expenses exceed revenue by ${escapeHtml(formatRp(Math.abs(totals.netProfit)))}`;
    else keptCopy = `You kept ${escapeHtml(formatPercent((totals.netProfit / totals.revenue) * 100))} of every rupiah earned`;
    host.innerHTML = `
        <div class="space-y-4">
            ${bar('Revenue', totals.revenue, 'bg-emerald-500', 'text-emerald-600')}
            ${bar('Expenses', totals.expenses, 'bg-red-500', 'text-red-600')}
        </div>
        <div class="mt-5 flex items-baseline justify-between gap-4 border-t border-gray-100 pt-4">
            <div class="min-w-0">
                <p class="text-[13px] font-semibold text-gray-900">Net profit</p>
                <p class="mt-0.5 text-[12px] text-gray-400">${keptCopy}</p>
            </div>
            <span class="text-xl font-bold tabular-nums ${totals.netProfit < 0 ? 'text-red-600' : 'text-gray-900'}">${escapeHtml(formatProfit(totals.netProfit))}</span>
        </div>`;
}

// ── Why net profit changed (bridge) ─────────────────────────────────
function renderBridge(totals, prevTotals, hasComparison) {
    const host = el('profit-bridge');
    if (!host) return;
    if (!hasComparison) {
        host.innerHTML = `<p class="text-[13px] text-gray-500">${state.period.mode === 'all_time'
            ? 'Pick a specific period to compare it against the one before it.'
            : 'No records in the previous period of equal length, so there is nothing to compare against yet.'}</p>`;
        return;
    }
    const revenueDelta = totals.revenue - prevTotals.revenue;
    const expenseDelta = totals.expenses - prevTotals.expenses;
    // Expenses moving up pushes profit down — the bridge shows the profit effect,
    // which is the negated expense movement.
    const expenseEffect = -expenseDelta;

    const row = (label, value, cls, meta) => `
        <div class="np-bridge-row">
            <div class="min-w-0">
                <p class="text-[13px] font-semibold text-gray-700">${escapeHtml(label)}</p>
                ${meta ? `<p class="mt-0.5 text-[12px] text-gray-400">${escapeHtml(meta)}</p>` : ''}
            </div>
            <span class="text-[14px] font-bold tabular-nums flex-shrink-0 ${cls}">${escapeHtml(value)}</span>
        </div>`;

    host.innerHTML = `
        ${row('Previous net profit', formatProfit(prevTotals.netProfit), prevTotals.netProfit < 0 ? 'text-red-600' : 'text-gray-900')}
        ${row('Revenue movement', formatDelta(revenueDelta), toneClass(revenueDelta), `${formatRp(prevTotals.revenue)} → ${formatRp(totals.revenue)}`)}
        ${row('Expense movement', formatDelta(expenseEffect), toneClass(expenseEffect), `${formatRp(prevTotals.expenses)} → ${formatRp(totals.expenses)}`)}
        ${row('Net profit this period', formatProfit(totals.netProfit), totals.netProfit < 0 ? 'text-red-600' : 'text-gray-900')}`;
}

// Top categories by change in profit contribution — the concrete answer to
// "what actually moved?" behind the bridge above.
function renderMovers(hasComparison) {
    const host = el('profit-movers');
    if (!host) return;
    if (!hasComparison) { host.innerHTML = ''; return; }

    const key = (r) => r.category || 'Uncategorized';
    const current = new Map();
    const previous = new Map();
    state.rows.forEach(r => current.set(key(r), (current.get(key(r)) || 0) + profitImpact(r)));
    state.prevRows.forEach(r => previous.set(key(r), (previous.get(key(r)) || 0) + profitImpact(r)));

    const names = new Set([...current.keys(), ...previous.keys()]);
    const movers = [...names]
        .map(name => ({ name, delta: (current.get(name) || 0) - (previous.get(name) || 0) }))
        .filter(m => Math.round(Math.abs(m.delta)) > 0)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 3);

    if (!movers.length) { host.innerHTML = ''; return; }
    host.innerHTML = `
        <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Biggest movers by category</p>
        <div class="mt-2 space-y-1.5">
            ${movers.map(m => `
                <div class="flex items-center justify-between gap-4">
                    <span class="text-[13px] text-gray-600 truncate">${escapeHtml(m.name)}</span>
                    <span class="text-[13px] font-semibold tabular-nums flex-shrink-0 ${toneClass(m.delta)}">${escapeHtml(formatDelta(m.delta))}</span>
                </div>`).join('')}
        </div>`;
}

// ── Comparison by period (month / quarter / year) ────────────────────
function comparisonBuckets(grain, anchorDate, count) {
    const buckets = [];
    for (let i = count - 1; i >= 0; i--) {
        let start;
        let end;
        let label;
        if (grain === 'month') {
            start = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - i, 1);
            end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
            label = start.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
        } else if (grain === 'quarter') {
            const anchorQuarterStart = Math.floor(anchorDate.getMonth() / 3) * 3;
            start = new Date(anchorDate.getFullYear(), anchorQuarterStart - i * 3, 1);
            end = new Date(start.getFullYear(), start.getMonth() + 3, 0);
            label = `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`;
        } else {
            start = new Date(anchorDate.getFullYear() - i, 0, 1);
            end = new Date(start.getFullYear(), 12, 0);
            label = String(start.getFullYear());
        }
        buckets.push({ label, start: dayKey(start), end: dayKey(end) });
    }
    return buckets;
}

function renderComparison() {
    const body = el('profit-comparison-body');
    if (!body) return;
    const grain = state.grain;
    const anchor = parseKey(state.period.end) || new Date();
    const buckets = comparisonBuckets(grain, anchor, COMPARISON_SPANS[grain] || 6)
        .map(b => ({ ...b, totals: totalsFor(filterPeriod(state.all, resolvePeriod('custom', b.start, b.end))) }));

    // Drop leading buckets with no activity at all so an early-stage workspace
    // doesn't read as a wall of zeros; keep every bucket once data starts.
    const firstActive = buckets.findIndex(b => b.totals.count > 0);
    const visible = firstActive === -1 ? [] : buckets.slice(firstActive);

    const grainNoun = grain === 'month' ? 'months' : grain === 'quarter' ? 'quarters' : 'years';
    el('profit-comparison-subtitle').textContent = `Net profit across the last ${grainNoun} up to ${state.period.label.toLowerCase()}, so a single period is never read in isolation.`;

    if (!visible.length) {
        body.innerHTML = `
            <tr><td colspan="6" class="px-6 py-12 text-center">
                <p class="text-[14px] font-semibold text-gray-900">No comparable periods yet</p>
                <p class="mt-1 text-[13px] text-gray-500">Record revenue or expenses to compare ${escapeHtml(grainNoun)} side by side.</p>
            </td></tr>`;
        return;
    }

    body.innerHTML = visible.map((b, i) => {
        const prev = i > 0 ? visible[i - 1].totals : null;
        const change = prev ? b.totals.netProfit - prev.netProfit : null;
        return `
            <tr class="fluxy-table-row">
                <td class="fluxy-table-cell"><span class="fluxy-table-cell-primary">${escapeHtml(b.label)}</span></td>
                <td class="fluxy-table-cell fluxy-table-money"><span class="tabular-nums text-gray-600">${escapeHtml(formatRp(b.totals.revenue))}</span></td>
                <td class="fluxy-table-cell fluxy-table-money"><span class="tabular-nums text-gray-600">${escapeHtml(formatRp(b.totals.expenses))}</span></td>
                <td class="fluxy-table-cell fluxy-table-money"><span class="tabular-nums font-semibold ${b.totals.netProfit < 0 ? 'text-red-600' : 'text-gray-900'}">${escapeHtml(formatProfit(b.totals.netProfit))}</span></td>
                <td class="fluxy-table-cell fluxy-table-money"><span class="tabular-nums text-gray-600">${escapeHtml(b.totals.margin === null ? 'N/A' : formatPercent(b.totals.margin))}</span></td>
                <td class="fluxy-table-cell fluxy-table-money"><span class="tabular-nums ${change === null ? 'text-gray-400' : toneClass(change)}">${escapeHtml(change === null ? '—' : formatDelta(change))}</span></td>
            </tr>`;
    }).join('');
}

// ── AI insights ─────────────────────────────────────────────────────
function renderAiIdle() {
    if (state.aiLocked) return; // a hit quota survives a period change
    const host = el('profit-ai-body');
    if (!host) return;
    host.innerHTML = `
        <p class="text-[13px] text-gray-500">Fluxy AI reads the revenue, expenses, net profit, and margin shown above for ${escapeHtml(state.period.label.toLowerCase())} and returns what changed, the main risk, and what to do next.</p>`;
    const btn = el('profit-ai-generate');
    if (btn) {
        btn.disabled = false;
        btn.classList.remove('hidden');
        const label = btn.querySelector('[data-ai-btn-label]');
        if (label) label.textContent = 'Generate AI analysis';
    }
}

function renderAiLoading() {
    const host = el('profit-ai-body');
    if (host) host.innerHTML = '<p class="text-[13px] text-gray-400" role="status">Fluxy AI is analyzing this period…</p>';
}

function renderAiLocked() {
    state.aiLocked = true;
    const btn = el('profit-ai-generate');
    if (btn) btn.classList.add('hidden');
    const host = el('profit-ai-body');
    if (!host) return;
    host.innerHTML = `
        <p class="text-[14px] font-semibold text-gray-900">You've reached your Fluxy AI limit.</p>
        <p class="mt-1 text-[13px] text-gray-500">Your current plan includes a limited number of AI generations. Upgrade to keep using AI analysis.</p>
        <a href="/settings-billing" class="mt-4 inline-flex items-center justify-center rounded-lg bg-slate-950 px-4 py-2 text-[13px] font-bold text-white hover:bg-slate-800">Upgrade plan</a>`;
}

function renderAiError() {
    const host = el('profit-ai-body');
    if (host) host.innerHTML = '<p class="text-[13px] text-gray-500">AI analysis is unavailable right now. The numbers above are unaffected — try again in a moment.</p>';
    const btn = el('profit-ai-generate');
    if (btn) btn.disabled = false;
}

function renderAiAnswer(answer) {
    const host = el('profit-ai-body');
    if (!host) return;
    const insights = (answer.insights || []).filter(i => i && (i.title || i.description)).slice(0, 3);
    const actions = (answer.recommended_actions || []).filter(a => a && (a.title || a.description)).slice(0, 3);
    const limitation = (answer.limitations || []).find(l => typeof l === 'string' && l.trim());
    const usage = state.aiUsage;
    host.innerHTML = `
        <p class="text-[14px] leading-relaxed text-gray-900">${escapeHtml(answer.direct_answer || 'Not enough data for a grounded analysis yet.')}</p>
        <div class="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div>
                <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Insights</p>
                <ul class="mt-2 space-y-2">
                    ${insights.length ? insights.map(i => `
                        <li class="text-[13px] text-gray-600">
                            <span class="font-semibold text-gray-900">${escapeHtml(i.title || 'Insight')}</span>${i.description ? ` — ${escapeHtml(i.description)}` : ''}
                        </li>`).join('') : '<li class="text-[13px] text-gray-500">No specific risk stood out for this period.</li>'}
                </ul>
            </div>
            <div>
                <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Recommended actions</p>
                <ul class="mt-2 space-y-2">
                    ${actions.length ? actions.map(a => `
                        <li class="text-[13px] text-gray-600">
                            <span class="font-semibold text-gray-900">${escapeHtml(a.title || 'Action')}</span>${a.description ? ` — ${escapeHtml(a.description)}` : ''}
                        </li>`).join('') : '<li class="text-[13px] text-gray-500">Keep reviewing new records as they come in.</li>'}
                </ul>
            </div>
        </div>
        ${limitation ? `<p class="mt-4 text-[12px] text-gray-400">${escapeHtml(limitation)}</p>` : ''}
        ${usage && !usage.unlimited && Number.isFinite(usage.remaining)
            ? `<p class="mt-4 text-[12px] text-gray-400"><span class="tabular-nums font-semibold">${escapeHtml(String(usage.remaining))}</span> AI Finance generations left</p>`
            : ''}`;
    const btn = el('profit-ai-generate');
    if (btn) {
        btn.disabled = false;
        const label = btn.querySelector('[data-ai-btn-label]');
        if (label) label.textContent = 'Regenerate AI analysis';
    }
    if (window.FluxyI18n?.getLang?.() === 'id') window.FluxyI18n.translate?.();
}

// Ask Fluxy AI to narrate THIS page's numbers. `page_context: 'overview_summary'`
// is the backend seam that narrates the KPI snapshot verbatim instead of
// recomputing from its own read — that is what keeps the AI paragraph and the
// cards above it from ever disagreeing. Generation is click-only because every
// call consumes an AI credit.
async function generateAiAnalysis() {
    if (state.aiLocked || !state.totals) return;
    const btn = el('profit-ai-generate');
    if (btn) btn.disabled = true;
    const seq = ++state.aiRequestSeq;
    renderAiLoading();

    try {
        const token = await state.user.getIdToken();
        const response = await fetch('/api/v1/brain/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                message: 'Explain my net profit for this period: what drove it, whether revenue or expenses moved it most, and what I should do first.',
                workspace_id: window.FluxyWorkspace?.id || null,
                page_context: 'overview_summary',
                language: window.FluxyI18n?.getLang?.() === 'id' ? 'id' : 'en',
                period: { type: 'custom', start_date: state.period.start, end_date: state.period.end },
                finance_snapshot: {
                    kpis: {
                        period_label: state.period.label,
                        revenue: state.totals.revenue,
                        revenue_records: state.rows.filter(isRevenue).length,
                        opex: state.totals.expenses,
                        net_profit: state.totals.netProfit,
                        gross_margin: state.totals.margin
                    }
                }
            })
        });
        const data = await response.json().catch(() => ({}));
        if (seq !== state.aiRequestSeq) return;
        if (response.status === 402 || ['trial_ai_limit_reached', 'ai_limit_reached'].includes(data?.error?.code)) {
            renderAiLocked();
            return;
        }
        if (!response.ok || data.success === false || !data.answer) throw new Error('AI analysis unavailable.');
        if (data.usage) state.aiUsage = data.usage;
        renderAiAnswer(data.answer);
    } catch (error) {
        if (seq !== state.aiRequestSeq) return;
        renderAiError();
    }
}

// Live page context for the Fluxy AI drawer, so opening it from this page starts
// oriented on profit rather than the generic workspace summary.
function registerAiPageContext() {
    window.FluxyAIContext?.register?.(() => {
        const t = state.totals || { revenue: 0, expenses: 0, netProfit: 0, margin: null };
        return {
            pageTitle: 'Net Profit',
            summary: [
                { label: 'Period', value: state.period?.label || 'This month' },
                { label: 'Net profit', value: formatProfit(t.netProfit), status: t.netProfit < 0 ? 'critical' : 'good' },
                { label: 'Revenue', value: formatRp(t.revenue) },
                { label: 'Expenses', value: formatRp(t.expenses) },
                { label: 'Profit margin', value: t.margin === null ? 'N/A' : formatPercent(t.margin) }
            ],
            filters: { period_mode: state.period?.mode || 'this_month' },
            selectedRecord: null
        };
    });
}

// ── Records table ───────────────────────────────────────────────────
function filterPredicate(dim, name) {
    const keyFn = dimKeyFn(dim);
    if (dim === 'expenses') return (r) => isExpense(r) && keyFn(r) === name;
    if (dim === 'revenue') return (r) => isRevenue(r) && keyFn(r) === name;
    return (r) => keyFn(r) === name;
}

function scopePredicate(scope) {
    if (scope === 'revenue') return isRevenue;
    if (scope === 'expense') return isExpense;
    return () => true;
}

// Point the records table at the current scope + breakdown selection.
function applyTableFilter() {
    let rows = state.rows.filter(scopePredicate(state.scope));
    const f = state.filter;
    if (f) rows = rows.filter(filterPredicate(f.dim, f.name));

    const noun = state.scope === 'revenue' ? 'revenue record' : state.scope === 'expense' ? 'expense record' : 'record';
    const scopedIn = f ? ` in ${f.name}` : '';
    el('profit-table-subtitle').textContent =
        `${rows.length} ${noun}${rows.length === 1 ? '' : 's'}${scopedIn} for ${state.period.label}. Click a row to open it in the Ledger.`;

    state.table.setRows(rows);

    const chip = el('profit-filter-clear');
    if (chip) {
        if (f) {
            el('profit-filter-clear-label').textContent = `Showing ${f.name}`;
            chip.classList.remove('hidden'); chip.classList.add('inline-flex');
        } else {
            chip.classList.add('hidden'); chip.classList.remove('inline-flex');
        }
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
            <h1 class="text-xl font-bold text-gray-900">Net profit could not be opened.</h1>
            <p class="mt-2 text-[13px] text-gray-500">Refresh and try again.</p>
            <a href="/dashboard" class="mt-5 inline-flex items-center justify-center rounded-lg bg-slate-950 px-4 py-2 text-[13px] font-bold text-white hover:bg-slate-800">Back to Overview</a>
        </div>`;
}
