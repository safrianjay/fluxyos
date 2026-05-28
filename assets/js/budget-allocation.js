const STATUS_BADGE = {
    healthy: { label: 'On Track', cls: 'bg-emerald-50 text-emerald-700 border-emerald-100', bar: 'bg-emerald-500' },
    watch: { label: 'Watch', cls: 'bg-amber-50 text-amber-700 border-amber-100', bar: 'bg-amber-500' },
    at_risk: { label: 'At Risk', cls: 'bg-orange-50 text-orange-700 border-orange-100', bar: 'bg-orange-500' },
    exceeded: { label: 'Exceeded', cls: 'bg-red-50 text-red-700 border-red-100', bar: 'bg-red-500' },
    not_allocated: { label: 'Not allocated', cls: 'bg-gray-50 text-gray-600 border-gray-200', bar: 'bg-gray-400' }
};

const state = {
    ds: null,
    user: null,
    budget: null,
    allocation: null,
    data: null,
    selectedGroup: null
};

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
    return 'Rp ' + Math.abs(Math.round(value)).toLocaleString('id-ID');
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
    const budgetId = getQueryParam('budgetId');
    const allocationId = getQueryParam('allocationId');
    if (!budgetId || !allocationId) {
        renderFatalState('Allocation detail could not be opened.', 'Return to Budget Overview.');
        return;
    }

    try {
        const [budget, allocation] = await Promise.all([
            state.ds.getBudget(state.user.uid, budgetId),
            state.ds.getBudgetAllocation(state.user.uid, allocationId)
        ]);

        if (!budget) {
            renderFatalState('Budget not found.', 'Return to Budget Overview.');
            return;
        }
        if (!allocation || allocation.parent_budget_id !== budget.id) {
            renderFatalState('Allocation not found.', 'Return to Budget Overview.');
            return;
        }

        state.budget = budget;
        state.allocation = allocation;
        state.data = await state.ds.getMatchedAllocationRecords(state.user.uid, budget, allocation);
        state.selectedGroup = null;
        renderPage();
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
            <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50 text-[#EA580C]">
                <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path></svg>
            </div>
            <h1 class="text-xl font-bold text-gray-900">${escapeHtml(title)}</h1>
            <p class="mt-2 text-[13px] text-gray-500">${escapeHtml(body)}</p>
            <a href="/budget" class="mt-5 inline-flex items-center justify-center rounded-lg bg-[#EA580C] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#D94E0B]">Back to Budget Overview</a>
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
        back.href = `/budget.html?budgetId=${encodeURIComponent(budget.id)}`;
        back.innerHTML = `
            <svg class="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
            <span class="truncate">Back to ${escapeHtml(budget.name || 'Budget Overview')}</span>
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

    // Area chart over the 4 weekly buckets. With 4 points the filled area
    // reads as a real trend (the single-month version drew a triangle, which
    // is why this was briefly bars — now resolved by weekly bucketing).
    const width = 680;
    const height = 200;
    const padX = 24;
    const padTop = 16;
    const padBottom = 28;
    const innerW = width - padX * 2;
    const innerH = height - padTop - padBottom;
    const max = Math.max(...trend.map(point => Number(point.actual) || 0), 1);
    const points = trend.map((point, index) => {
        const x = trend.length === 1
            ? width / 2
            : padX + (index * (innerW / (trend.length - 1)));
        const y = padTop + ((max - (Number(point.actual) || 0)) / max) * innerH;
        return { ...point, value: Number(point.actual) || 0, x, y };
    });
    const line = points.map(p => `${p.x},${p.y}`).join(' ');
    const baseline = height - padBottom;
    const area = `${points[0].x},${baseline} ${line} ${points[points.length - 1].x},${baseline}`;

    el('allocation-trend').innerHTML = `
        <svg class="h-[200px] w-full overflow-visible" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Weekly actual spend trend">
            <defs>
                <linearGradient id="allocationTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#EA580C" stop-opacity="0.18"></stop>
                    <stop offset="100%" stop-color="#EA580C" stop-opacity="0"></stop>
                </linearGradient>
            </defs>
            ${[0, 1, 2, 3].map(i => {
                const y = padTop + i * (innerH / 3);
                return `<line x1="${padX}" x2="${width - padX}" y1="${y}" y2="${y}" stroke="#F1F5F9" stroke-width="1"></line>`;
            }).join('')}
            <polygon points="${area}" fill="url(#allocationTrendFill)"></polygon>
            <polyline points="${line}" fill="none" stroke="#EA580C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></polyline>
            ${points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#fff" stroke="#EA580C" stroke-width="2"></circle>`).join('')}
            ${points.map(p => `<text x="${p.x}" y="${height - 8}" text-anchor="middle" font-size="11" fill="#9CA3AF">${escapeHtml(p.label)}</text>`).join('')}
        </svg>
    `;
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
                <span class="col-span-2 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <span class="block h-full rounded-full ${bar}" style="width: ${percent}%"></span>
                </span>
            </button>
        `;
    }).join('');
}

function renderGroupList() {
    const groups = state.data?.groups || [];
    const allocated = Math.max(0, Number(state.allocation?.allocated_amount) || 0);
    el('allocation-group-count').textContent = groups.length ? `${groups.length} group${groups.length === 1 ? '' : 's'}` : '';
    if (!groups.length) {
        el('allocation-groups').innerHTML = `
            <div class="px-6 py-10 text-center text-[13px] text-gray-500">
                No spending groups yet. Matched vendors or categories will appear here once records exist.
            </div>
        `;
        return;
    }

    el('allocation-groups').innerHTML = groups.map(group => {
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
    }).join('');
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
    document.addEventListener('click', event => {
        const groupButton = event.target.closest('[data-group-name]');
        if (!groupButton || !el('allocation-content')?.contains(groupButton)) return;
        state.selectedGroup = groupButton.dataset.groupName === state.selectedGroup
            ? null
            : groupButton.dataset.groupName;
        renderGroupList();
        renderRelatedRecords();
    });
}
