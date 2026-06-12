const STATUS_BADGE = {
    healthy: { label: 'On Track', cls: 'bg-emerald-50 text-emerald-700 border-emerald-100', bar: 'bg-emerald-500' },
    watch: { label: 'Watch', cls: 'bg-amber-50 text-amber-700 border-amber-100', bar: 'bg-amber-500' },
    at_risk: { label: 'At Risk', cls: 'bg-amber-50 text-amber-700 border-amber-100', bar: 'bg-amber-500' },
    exceeded: { label: 'Exceeded', cls: 'bg-red-50 text-red-700 border-red-100', bar: 'bg-red-500' },
    not_allocated: { label: 'Not allocated', cls: 'bg-gray-50 text-gray-600 border-gray-200', bar: 'bg-gray-400' }
};

const state = {
    ds: null,
    user: null,
    mainBudget: null,
    budget: null,
    allocation: null,
    data: null,
    selectedGroup: null
};

let groupPaginator = null;

function el(id) {
    return document.getElementById(id);
}

function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatRp(amount) {
    const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
    return 'Rp' + Math.abs(Math.round(value)).toLocaleString('id-ID');
}

// Compact Rp for chart axis labels (Indonesian magnitudes: rb=ribu,
// jt=juta, M=miliar). Keeps the y-axis narrow.
function formatRpCompact(amount) {
    const n = Math.abs(Number(amount) || 0);
    if (n >= 1e9) return 'Rp' + (n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1) + 'M';
    if (n >= 1e6) return 'Rp' + (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + 'jt';
    if (n >= 1e3) return 'Rp' + Math.round(n / 1e3) + 'rb';
    return 'Rp' + Math.round(n);
}

function formatPercent(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0%';
    return num.toFixed(num >= 10 ? 0 : 1) + '%';
}

function formatDate(value) {
    if (!value) return 'No date';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'No date';
    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function budgetDate(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value.toDate === 'function') {
        try {
            const date = value.toDate();
            return Number.isNaN(date.getTime()) ? null : date;
        } catch {
            return null;
        }
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatPeriod(budget) {
    const start = budgetDate(budget?.period_start);
    const end = budgetDate(budget?.period_end);
    if (!start || !end) return 'Period unavailable';
    return `${formatDate(start)} - ${formatDate(end)}`;
}

function statusFor(allocated, spentReserved) {
    const base = Math.max(0, Number(allocated) || 0);
    if (base <= 0) return 'not_allocated';
    const pct = (Number(spentReserved) || 0) / base * 100;
    if (pct >= 100) return 'exceeded';
    if (pct >= 85) return 'at_risk';
    if (pct >= 70) return 'watch';
    return 'healthy';
}

function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
}

function getBudgetAllocationPathId() {
    const match = window.location.pathname.match(/^\/budget-allocation\/([^/?#]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : null;
}

function budgetAllocationUrl(allocationId) {
    return `/budget-allocation/${encodeURIComponent(allocationId)}`;
}

function replaceBudgetAllocationUrl(allocationId, params = new URLSearchParams(window.location.search)) {
    if (!allocationId || !window.history?.replaceState) return;
    const nextParams = new URLSearchParams(params);
    nextParams.delete('budgetId');
    nextParams.delete('periodId');
    nextParams.delete('allocationId');
    const query = nextParams.toString();
    window.history.replaceState({}, '', `${budgetAllocationUrl(allocationId)}${query ? `?${query}` : ''}`);
}

function emptyMatchedData() {
    return {
        transactions: [],
        bills: [],
        records: [],
        groups: [],
        trend: [],
        totals: { actual: 0, reserved: 0, spentReserved: 0, recordCount: 0 }
    };
}

export function initBudgetAllocationPage({ ds, user }) {
    state.ds = ds;
    state.user = user;
    wireInteractions();
    loadAndRender();
}

async function loadAndRender() {
    const params = new URLSearchParams(window.location.search);
    const allocationId = getBudgetAllocationPathId() || getQueryParam('allocationId');
    if (!allocationId) {
        renderFatalState('Allocation detail could not be opened.', 'Return to Budget Overview.');
        return;
    }

    try {
        const allocation = await state.ds.getBudgetAllocation(state.user.uid, allocationId);
        if (!allocation?.parent_budget_id) {
            renderFatalState('Allocation not found.', 'Return to Budget Overview.');
            return;
        }
        const budget = await state.ds.getBudget(state.user.uid, allocation.parent_budget_id);
        if (!budget) {
            renderFatalState('Budget not found.', 'Return to Budget Overview.');
            return;
        }
        const mainBudget = budget.parent_budget_id
            ? await state.ds.getBudget(state.user.uid, budget.parent_budget_id)
            : null;

        state.mainBudget = mainBudget || null;
        state.budget = budget;
        state.allocation = allocation;
        state.data = await state.ds.getMatchedAllocationRecords(state.user.uid, budget, allocation);
        state.selectedGroup = null;
        renderPage();
        replaceBudgetAllocationUrl(allocation.id, params);
    } catch (error) {
        console.error('Allocation drill-in failed:', error);
        renderFatalState('Allocation detail could not be opened.', 'Refresh and try again.');
    }
}

function renderFatalState(title, body) {
    el('allocation-loading')?.classList.add('hidden');
    el('allocation-content')?.classList.add('hidden');
    const error = el('allocation-error');
    error.classList.remove('hidden');
    error.innerHTML = `
        <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-10 text-center">
            <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-50 text-[#EA580C]">
                <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path></svg>
            </div>
            <h1 class="text-xl font-bold text-gray-900">${escapeHtml(title)}</h1>
            <p class="mt-2 text-[13px] text-gray-500">${escapeHtml(body)}</p>
            <a href="/budget" class="mt-5 inline-flex items-center justify-center rounded-lg bg-slate-950 px-4 py-2 text-[13px] font-bold text-white hover:bg-slate-800">Back to Budget Overview</a>
        </div>
    `;
}

function renderPage() {
    el('allocation-loading').classList.add('hidden');
    el('allocation-error').classList.add('hidden');
    el('allocation-content').classList.remove('hidden');
    renderHeader();
    renderKpis();
    renderTrend();
    renderGroupSummary();
    renderGroupList();
    renderRelatedRecords();
}

function renderHeader() {
    const budget = state.budget;
    const allocation = state.allocation;
    const data = state.data || emptyMatchedData();
    const allocated = Math.max(0, Number(allocation.allocated_amount) || 0);
    const status = STATUS_BADGE[statusFor(allocated, data.totals.spentReserved)] || STATUS_BADGE.healthy;
    const scope = Array.isArray(allocation.scope_values) ? allocation.scope_values.filter(Boolean).join(', ') : '';

    const back = el('allocation-back-link');
    if (back) {
        back.href = `/budget-period/${encodeURIComponent(budget.id)}`;
        back.innerHTML = `
            <svg class="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
            <span class="truncate">Back to ${escapeHtml(budget.name || 'Period Budget')}</span>
        `;
    }

    el('allocation-title').textContent = allocation.name || 'Budget allocation';
    el('allocation-status').className = `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-bold ${status.cls}`;
    el('allocation-status').innerHTML = `<span class="h-1.5 w-1.5 rounded-full current-color bg-current"></span>${escapeHtml(status.label)}`;
    el('allocation-color').style.background = allocation.color || '#EA580C';

    const meta = [
        formatPeriod(budget),
        scope ? `Scope ${scope}` : '',
        `${data.totals.recordCount} matched record${data.totals.recordCount === 1 ? '' : 's'}`,
        allocation.alert_threshold_percent ? `Alert at ${formatPercent(allocation.alert_threshold_percent)}` : ''
    ].filter(Boolean);
    el('allocation-meta').innerHTML = meta.map(item => `<span>${escapeHtml(item)}</span>`).join('<span class="text-gray-300">·</span>');
}

function renderKpis() {
    const allocation = state.allocation;
    const data = state.data || emptyMatchedData();
    const allocated = Math.max(0, Number(allocation.allocated_amount) || 0);
    const spent = Math.max(0, Number(data.totals.actual) || 0);
    const reserved = Math.max(0, Number(data.totals.reserved) || 0);
    const spentReserved = spent + reserved;
    const remaining = allocated - spentReserved;
    const usage = allocated > 0 ? (spentReserved / allocated) * 100 : 0;
    const status = statusFor(allocated, spentReserved);
    const barCls = STATUS_BADGE[status]?.bar || 'bg-emerald-500';

    const items = [
        { label: 'Allocated', value: formatRp(allocated), sub: 'Allocation limit' },
        { label: 'Spent', value: formatRp(spent), sub: `${data.transactions.filter(tx => tx._allocationRecord?.bucket === 'actual').length} actual record(s)` },
        { label: 'Reserved', value: formatRp(reserved), sub: `${data.bills.length + data.transactions.filter(tx => tx._allocationRecord?.bucket === 'reserved').length} pending record(s)` },
        { label: 'Remaining', value: formatRp(remaining), sub: remaining < 0 ? 'Over allocation' : 'Available after spent + reserved', negative: remaining < 0 },
        { label: 'Usage', value: formatPercent(usage), sub: `${formatRp(spentReserved)} used`, progress: Math.max(0, Math.min(100, usage)), barCls }
    ];

    el('allocation-kpis').innerHTML = items.map(item => `
        <article class="allocation-kpi-cell">
            <p class="allocation-kpi-label">${escapeHtml(item.label)}</p>
            <p class="allocation-kpi-value ${item.negative ? 'text-red-600' : 'text-gray-900'}">${escapeHtml(item.value)}</p>
            <p class="allocation-kpi-sub">${escapeHtml(item.sub)}</p>
            ${item.progress != null ? `
                <div class="mt-3 h-1 rounded-full bg-gray-100 overflow-hidden">
                    <div class="h-full rounded-full ${item.barCls}" style="width: ${item.progress}%"></div>
                </div>
            ` : ''}
        </article>
    `).join('');
}

function renderTrend() {
    const trend = state.data?.trend || [];
    const hasValues = trend.some(point => Number(point.actual) > 0);
    if (!hasValues) {
        el('allocation-trend').innerHTML = `
            <div class="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-5 text-center">
                <p class="text-[13px] text-gray-500">No spend trend yet. Transactions matched to this allocation will appear here.</p>
            </div>
        `;
        return;
    }

    // Area chart over the 4 weekly buckets. Points sit at band centers
    // ((i+0.5)/n) so the invisible hover columns (flex-1) line up exactly
    // with each point — that lets the shared attachChartHover tooltip
    // (same one Overview uses) light up the right week.
    const n = trend.length;
    const width = 680;
    const height = 180;
    const padTop = 12;
    const padBottom = 6;
    const innerH = height - padTop - padBottom;
    const max = Math.max(...trend.map(point => Number(point.actual) || 0), 1);
    const points = trend.map((point, index) => {
        const x = ((index + 0.5) / n) * width;
        const value = Number(point.actual) || 0;
        const y = padTop + ((max - value) / max) * innerH;
        return { ...point, value, x, y };
    });
    const line = points.map(p => `${p.x},${p.y}`).join(' ');
    const baseline = height - padBottom;
    const area = `${points[0].x},${baseline} ${line} ${points[points.length - 1].x},${baseline}`;

    // y-axis ticks: max, 2/3, 1/3, 0.
    const yTicks = [1, 2 / 3, 1 / 3, 0].map(f => formatRpCompact(max * f));

    el('allocation-trend').innerHTML = `
        <div class="flex gap-2">
            <div class="flex flex-col justify-between items-end flex-shrink-0 w-16 font-mono text-[10px] text-gray-400" style="height: ${height}px; padding-top: ${padTop}px; padding-bottom: ${padBottom}px;">
                ${yTicks.map(t => `<span class="leading-none">${escapeHtml(t)}</span>`).join('')}
            </div>
            <div id="allocation-trend-plot" class="relative flex-1 min-w-0" style="height: ${height}px;">
                <svg class="block h-full w-full overflow-visible" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Weekly actual spend trend">
                    <defs>
                        <linearGradient id="allocationTrendFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="#EA580C" stop-opacity="0.18"></stop>
                            <stop offset="100%" stop-color="#EA580C" stop-opacity="0"></stop>
                        </linearGradient>
                    </defs>
                    ${[0, 1, 2, 3].map(i => {
                        const y = padTop + i * (innerH / 3);
                        return `<line x1="0" x2="${width}" y1="${y}" y2="${y}" stroke="#F1F5F9" stroke-width="1"></line>`;
                    }).join('')}
                    <polygon points="${area}" fill="url(#allocationTrendFill)"></polygon>
                    <polyline points="${line}" fill="none" stroke="#EA580C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></polyline>
                    ${points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#fff" stroke="#EA580C" stroke-width="2"></circle>`).join('')}
                </svg>
                <div class="absolute inset-0 flex">
                    ${points.map(p => `<div class="flex-1" data-chart-bar data-week="${escapeHtml(p.label)}" data-amount="${p.value}"></div>`).join('')}
                </div>
            </div>
        </div>
        <div class="mt-1.5 flex gap-2">
            <div class="w-16 flex-shrink-0"></div>
            <div class="flex-1 flex">
                ${points.map(p => `<span class="flex-1 text-center text-[10px] text-gray-400 truncate">${escapeHtml(p.label)}</span>`).join('')}
            </div>
        </div>
    `;

    // Wire the shared Overview-style hover tooltip + crosshair.
    const plot = document.getElementById('allocation-trend-plot');
    if (plot && typeof window.attachChartHover === 'function') {
        window.attachChartHover(plot, {
            bars: '[data-chart-bar]',
            orientation: 'vertical',
            buildTooltip: (barEl) => `
                <div class="chart-tooltip-header">${escapeHtml(barEl.dataset.week || '')}</div>
                <div class="chart-tooltip-row">
                    <span class="chart-tooltip-swatch" style="background:#EA580C"></span>
                    <span class="chart-tooltip-label">Actual spend</span>
                    <span class="chart-tooltip-value">${formatRp(Number(barEl.dataset.amount) || 0)}</span>
                </div>
            `
        });
    }
}

function renderGroupSummary() {
    const groups = state.data?.groups || [];
    const allocated = Math.max(0, Number(state.allocation?.allocated_amount) || 0);
    if (!groups.length) {
        el('allocation-group-summary').innerHTML = `
            <div class="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-5 text-center">
                <p class="text-[13px] text-gray-500">No spending groups yet. Matched vendors or categories will appear here once records exist.</p>
            </div>
        `;
        return;
    }
    el('allocation-group-summary').innerHTML = groups.slice(0, 7).map(group => {
        const percent = allocated > 0 ? Math.max(0, Math.min(100, group.spent_reserved_total / allocated * 100)) : 0;
        const bar = STATUS_BADGE[group.status]?.bar || 'bg-emerald-500';
        return `
            <button type="button" class="allocation-summary-group" data-group-name="${escapeHtml(group.name)}">
                <span class="min-w-0 truncate font-semibold text-[12px] text-gray-700">${escapeHtml(group.name)}</span>
                <span class="font-mono text-[11px] font-bold text-gray-500">${formatPercent(percent)}</span>
                <span class="col-span-2 h-1 rounded-full bg-gray-100 overflow-hidden">
                    <span class="block h-full rounded-full ${bar}" style="width: ${percent}%"></span>
                </span>
            </button>
        `;
    }).join('');
}

function renderGroupRow(group, allocated) {
    const percent = allocated > 0 ? Math.max(0, Math.min(100, group.spent_reserved_total / allocated * 100)) : 0;
    const status = STATUS_BADGE[group.status] || STATUS_BADGE.healthy;
    const selected = state.selectedGroup === group.name;
    const statusColor = group.status === 'exceeded' ? 'text-red-600' : group.status === 'at_risk' ? 'text-orange-600' : group.status === 'watch' ? 'text-amber-600' : 'text-emerald-600';
    return `
        <button type="button" class="allocation-group-row ${selected ? 'is-selected' : ''}" data-group-name="${escapeHtml(group.name)}">
            <div class="flex items-start justify-between gap-4">
                <div class="min-w-0">
                    <p class="font-semibold text-[12px] text-gray-900 truncate">${escapeHtml(group.name)}</p>
                    <p class="mt-0.5 text-[10px] text-gray-400">${group.record_count} record${group.record_count === 1 ? '' : 's'} · latest ${escapeHtml(formatDate(group.latest_record_date))}</p>
                </div>
                <p class="font-mono text-[12px] font-bold text-gray-900 flex-shrink-0">${formatRp(group.spent_reserved_total)}</p>
            </div>
            <div class="mt-2 h-1 rounded-full bg-gray-100 overflow-hidden">
                <div class="h-full rounded-full ${status.bar}" style="width: ${percent}%"></div>
            </div>
            <div class="mt-1.5 flex items-center gap-2 text-[10px] text-gray-500">
                <span class="font-mono">${formatPercent(percent)} of allocation</span>
                <span class="text-gray-300">·</span>
                <span class="${statusColor} font-semibold">${escapeHtml(status.label)}</span>
            </div>
        </button>
    `;
}

function renderGroupList() {
    const groups = state.data?.groups || [];
    const allocated = Math.max(0, Number(state.allocation?.allocated_amount) || 0);
    el('allocation-group-count').textContent = groups.length ? `${groups.length} group${groups.length === 1 ? '' : 's'}` : '';
    if (!groups.length) {
        groupPaginator?.setRows([], () => {});
        el('allocation-groups').innerHTML = `
            <div class="px-6 py-10 text-center text-[13px] text-gray-500">
                No spending groups yet. Matched vendors or categories will appear here once records exist.
            </div>
        `;
        return;
    }

    groupPaginator.setRows(groups, visible => {
        el('allocation-groups').innerHTML = visible.map(group => renderGroupRow(group, allocated)).join('');
    });
}

function renderRelatedRecords() {
    const data = state.data || emptyMatchedData();
    const allocation = state.allocation || {};
    const records = state.selectedGroup
        ? data.records.filter(record => record.group_name === state.selectedGroup)
        : data.records;
    const capped = records.slice(0, 50);
    const total = records.length;
    const subtitle = state.selectedGroup
        ? `${state.selectedGroup} · ${total} record${total === 1 ? '' : 's'}`
        : `Showing all matched records for ${allocation.name || 'this allocation'}`;
    el('allocation-record-title').textContent = state.selectedGroup || 'Related Records';
    el('allocation-record-subtitle').textContent = subtitle;

    if (!total) {
        el('allocation-records').innerHTML = `
            <div class="px-6 py-10 text-center text-[13px] text-gray-500">
                ${state.selectedGroup
                    ? 'No records in this group.'
                    : 'No records matched this allocation yet. FluxyOS only shows records inside this budget period that match this allocation scope.'}
            </div>
        `;
        el('allocation-record-cap').textContent = '';
        return;
    }

    el('allocation-records').innerHTML = capped.map(record => `
        <article class="allocation-record-row">
            <div class="min-w-0">
                <p class="font-semibold text-[12px] text-gray-900 truncate">${escapeHtml(record.counterparty || 'Unspecified')}</p>
                <p class="mt-0.5 text-[12px] text-gray-400 truncate">${escapeHtml(formatDate(record.date))} · ${escapeHtml(record.kind)} · ${escapeHtml(record.category)} · ${escapeHtml(record.status)}</p>
            </div>
            <p class="font-mono text-[12px] font-bold ${record.bucket === 'reserved' ? 'text-amber-700' : 'text-gray-900'}">${formatRp(record.amount)}</p>
        </article>
    `).join('');

    el('allocation-record-cap').textContent = total > 50
        ? `Showing 50 of ${total} matched records.`
        : '';
}

function wireInteractions() {
    groupPaginator = window.createTablePaginator({
        pageSize: 5,
        label: 'groups',
        paginationId: 'allocation-group-pagination',
        summaryId: 'allocation-group-page-summary',
        indicatorId: 'allocation-group-page-indicator',
        prevBtnId: 'allocation-group-prev',
        nextBtnId: 'allocation-group-next'
    });

    document.addEventListener('click', event => {
        const groupButton = event.target.closest('[data-group-name]');
        if (!groupButton || !el('allocation-content')?.contains(groupButton)) return;
        state.selectedGroup = groupButton.dataset.groupName === state.selectedGroup
            ? null
            : groupButton.dataset.groupName;
        // Selection only toggles the is-selected class on existing rows, so
        // refresh the current page in place instead of resetting to page 1.
        groupPaginator.refresh();
        renderRelatedRecords();
    });
}
