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
    escapeHtml, formatRp, formatPercent, formatDate, recordDate, changePercent,
    resolvePeriodFromUrl, mountPeriodControls, previousPeriod, resolvePeriod,
    renderKpiStrip, bucketSeries, renderTrendChart, renderComparisonColumns,
    renderBreakdownList, createSupportingTable, ledgerRecordUrl, parseKey, dayKey,
    formatRpCompact
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
    table: null
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

    registerAiPageContext();
    loadAndRender();
    // Reload when any page saves a transaction/bill/invoice. Without this a save
    // made from the entry drawer here wrote to Firestore and left every figure on
    // screen stale, which reads as "it didn't save".
    window.FluxyDataSync?.onChange(() => loadAndRender());
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
    // Suppressed when the previous period was a loss (or zero): a percentage
    // against a negative base inverts its own meaning — a move from -Rp1,9bn to
    // -Rp34k computed as "+100%", reading as though the loss were gone. The
    // absolute change still shows, and it is the honest number.
    const changePct = changePercent(totals.netProfit, prevTotals.netProfit);
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
        host.innerHTML = '<p class="text-[14px] text-gray-500">No revenue or expenses recorded in this period yet.</p>';
        return;
    }
    // The meter answers "how much of the money that came in stayed in": the track
    // is revenue = 100%, the red segment is the share spent, the green remainder
    // is what was kept. Deliberately not a donut — a ring cannot render a slice at
    // 710% of itself, which is exactly what a loss-making period looks like.
    const { revenue, expenses, netProfit } = totals;
    const spentShare = revenue > 0 ? (expenses / revenue) * 100 : (expenses > 0 ? Infinity : 0);
    const overspent = expenses > revenue;
    // Segment widths only ever describe the part of spend covered by revenue.
    const spentWidth = revenue > 0 ? Math.min(100, spentShare) : 100;
    const keptWidth = Math.max(0, 100 - spentWidth);
    // Show a label inside a segment only when it has room, so text never clips.
    const segLabel = (width, text) => (width >= 22 ? escapeHtml(text) : '');

    let meter;
    if (revenue <= 0) {
        meter = `
            <div class="np-meter" role="img" aria-label="No revenue recorded, so there is no ratio to measure">
                <div class="np-meter-seg np-meter-spent" style="flex:1 1 100%">${segLabel(100, 'All spend, no revenue')}</div>
            </div>`;
    } else {
        meter = `
            <div class="np-meter" role="img" aria-label="Of every rupiah of revenue, ${Math.round(spentWidth)} percent was spent">
                <div class="np-meter-seg np-meter-spent" style="flex:0 0 ${spentWidth.toFixed(2)}%">${segLabel(spentWidth, 'Spent')}</div>
                ${keptWidth > 0 ? `<div class="np-meter-seg np-meter-kept" style="flex:0 0 ${keptWidth.toFixed(2)}%">${segLabel(keptWidth, 'Kept')}</div>` : ''}
            </div>`;
    }

    // Over-run: how far past revenue the spending went. Rendered as its own
    // hatched bar rather than a longer red fill, because it is past the limit.
    const overrunPct = overspent && revenue > 0 ? spentShare - 100 : 0;
    const overrunWidth = Math.min(100, overrunPct);
    const overrun = overspent ? `
        <div class="mt-2">
            <div class="flex items-center justify-between gap-3 text-[12px] font-semibold text-red-700">
                <span>Over revenue by ${escapeHtml(formatRp(expenses - revenue))}</span>
                ${revenue > 0 ? `<span class="tabular-nums">${escapeHtml(formatPercent(overrunPct))} over</span>` : ''}
            </div>
            <div class="np-overrun mt-1.5" style="width:${Math.max(6, overrunWidth).toFixed(2)}%" aria-hidden="true"></div>
        </div>` : '';

    const scale = Math.max(revenue, expenses, 1);
    const figure = (label, amount, fillCls, dotCls, valueCls) => `
        <div>
            <div class="flex items-baseline justify-between gap-4">
                <span class="inline-flex items-center gap-2 text-[14px] font-semibold text-gray-700">
                    <span class="np-dot ${dotCls}" aria-hidden="true"></span>${escapeHtml(label)}
                </span>
                <span class="text-[14px] font-semibold tabular-nums ${valueCls}">${escapeHtml(formatRp(amount))}</span>
            </div>
            <div class="np-bar-track mt-1.5">
                <div class="np-bar-fill ${fillCls}" style="width:${Math.max(2, (amount / scale) * 100).toFixed(2)}%"></div>
            </div>
        </div>`;

    let keptCopy;
    if (revenue <= 0) keptCopy = 'No revenue to measure against';
    else if (netProfit < 0) keptCopy = `Spending is ${escapeHtml(formatNumber(expenses / revenue))}× revenue this period`;
    else keptCopy = `You kept ${escapeHtml(formatPercent((netProfit / revenue) * 100))} of every rupiah earned`;

    host.innerHTML = `
        <p class="text-[12px] font-semibold uppercase tracking-wide text-gray-400">Of every rupiah of revenue</p>
        ${meter}
        ${overrun}
        <div class="mt-5 space-y-3">
            ${figure('Revenue', revenue, 'bg-emerald-500', 'bg-emerald-500', 'text-emerald-600')}
            ${figure('Expenses', expenses, 'bg-red-600', 'bg-red-600', 'text-red-600')}
        </div>
        <div class="mt-4 flex items-baseline justify-between gap-4 border-t border-gray-100 pt-4">
            <div class="min-w-0">
                <p class="text-[14px] font-semibold text-gray-900">Net profit</p>
                <p class="mt-0.5 text-[12px] text-gray-400">${keptCopy}</p>
            </div>
            <span class="text-[16px] font-semibold tabular-nums ${netProfit < 0 ? 'text-red-600' : 'text-gray-900'}">${escapeHtml(formatProfit(netProfit))}</span>
        </div>`;
}

// One decimal, for the "spending is 7.1× revenue" multiple.
function formatNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toFixed(1);
}

// ── Why net profit changed (bridge) ─────────────────────────────────
function renderBridge(totals, prevTotals, hasComparison) {
    const host = el('profit-bridge');
    if (!host) return;
    if (!hasComparison) {
        host.innerHTML = `<p class="text-[14px] text-gray-500">${state.period.mode === 'all_time'
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
                <p class="text-[14px] font-semibold text-gray-700">${escapeHtml(label)}</p>
                ${meta ? `<p class="mt-0.5 text-[12px] text-gray-400">${escapeHtml(meta)}</p>` : ''}
            </div>
            <span class="text-[14px] font-semibold tabular-nums flex-shrink-0 ${cls}">${escapeHtml(value)}</span>
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
        <p class="text-[12px] font-semibold uppercase tracking-wide text-gray-400">Biggest movers by category</p>
        <div class="mt-2 space-y-1.5">
            ${movers.map(m => `
                <div class="flex items-center justify-between gap-4">
                    <span class="text-[14px] text-gray-600 truncate">${escapeHtml(m.name)}</span>
                    <span class="text-[14px] font-semibold tabular-nums flex-shrink-0 ${toneClass(m.delta)}">${escapeHtml(formatDelta(m.delta))}</span>
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

    // The chart replaces a table, so each column carries its value as a direct
    // label and the tooltip carries every column that table used to show.
    renderComparisonColumns('profit-comparison-chart', {
        cols: visible.map((b, i) => {
            const prev = i > 0 ? visible[i - 1].totals : null;
            const change = prev ? b.totals.netProfit - prev.netProfit : null;
            return {
                label: b.label,
                value: b.totals.netProfit,
                caption: b.totals.margin === null ? 'N/A' : formatPercent(b.totals.margin),
                rows: [
                    { label: 'Revenue', value: formatRp(b.totals.revenue), swatch: '#16A34A' },
                    { label: 'Expenses', value: formatRp(b.totals.expenses), swatch: '#DC2626' },
                    { label: 'Net profit', value: formatProfit(b.totals.netProfit) },
                    { label: 'Margin', value: b.totals.margin === null ? 'N/A' : formatPercent(b.totals.margin) },
                    { label: 'Change', value: change === null ? '\u2014' : formatDelta(change) }
                ]
            };
        }),
        formatValue: (v) => (v < 0 ? '-' : '') + formatRpCompact(Math.abs(v)),
        emptyTitle: 'No comparable periods yet',
        emptyDesc: `Record revenue or expenses to compare ${grainNoun} side by side.`
    });
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
            <p class="mt-2 text-[14px] text-gray-500">Refresh and try again.</p>
            <a href="/dashboard" class="mt-5 inline-flex items-center justify-center rounded-lg bg-slate-950 px-4 py-2 text-[14px] font-bold text-white hover:bg-slate-800">Back to Overview</a>
        </div>`;
}
