// Budget page controller — Phase 1 + 1.5
// Owns rendering of the active operating budget, allocation usage,
// and the Create / Edit Budget drawer.

const ALLOCATION_CATEGORIES = ['Marketing', 'Infrastructure', 'Operations', 'SaaS'];
const DEFAULT_ALLOCATION_ROWS = ALLOCATION_CATEGORIES.map(cat => ({ name: cat, category: cat, amount: '' }));

const STATUS_BADGE = {
    healthy:  { label: 'Healthy',  cls: 'bg-emerald-50 text-emerald-700 border border-emerald-100' },
    watch:    { label: 'Watch',    cls: 'bg-amber-50 text-amber-700 border border-amber-100' },
    at_risk:  { label: 'At Risk',  cls: 'bg-orange-50 text-orange-700 border border-orange-100' },
    exceeded: { label: 'Exceeded', cls: 'bg-red-50 text-red-700 border border-red-100' }
};

const USAGE_BAR_CLASS = {
    healthy:  'bg-emerald-500',
    watch:    'bg-amber-500',
    at_risk:  'bg-orange-500',
    exceeded: 'bg-red-500'
};

const ALLOCATION_COLORS = [
    '#4F46E5',
    '#059669',
    '#2563EB',
    '#D97706',
    '#9333EA',
    '#0F766E',
    '#64748B',
    '#BE123C'
];

const state = {
    ds: null,
    user: null,
    usage: null,         // { budget, allocations, summary, unallocated } or null
    drawerOpen: false,
    datePicker: null,
    periodType: 'monthly',
    periodStart: null,   // 'YYYY-MM-DD'
    periodEnd: null,
    allocRows: [],       // [{ name, category, amount }]
    activeAllocationId: null  // Phase 2: id of allocation currently shown in the detail drawer
};

function getDayKey(date = new Date()) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
function getMonthStartKey(date = new Date()) { return getDayKey(new Date(date.getFullYear(), date.getMonth(), 1)); }
function getMonthEndKey(date = new Date()) { return getDayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0)); }

function formatRp(amount) {
    const val = Number(amount) || 0;
    return 'Rp ' + Math.abs(val).toLocaleString('id-ID');
}

function formatPercent(val) {
    if (!Number.isFinite(val)) return '0%';
    if (val >= 1000) return Math.round(val) + '%';
    return val.toFixed(val >= 10 ? 0 : 1) + '%';
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function el(id) { return document.getElementById(id); }

// ── Init ──────────────────────────────────────────────────────────────

export function initBudgetPage({ ds, user }) {
    state.ds = ds;
    state.user = user;
    wireDrawerControls();
    loadAndRender();
}

async function loadAndRender() {
    el('budget-loading').classList.remove('hidden');
    el('budget-empty-state').classList.add('hidden');
    el('budget-content').classList.add('hidden');

    try {
        const activeBudget = await state.ds.getActiveBudget(state.user.uid);
        if (!activeBudget) {
            renderEmpty();
            return;
        }
        const usage = await state.ds.getBudgetUsage(state.user.uid, activeBudget.id);
        state.usage = usage;
        renderBudget(usage);
    } catch (err) {
        console.error('Budget load failed:', err);
        window.showToast?.('Could not load your budget. Refresh and try again.', 'error');
        renderEmpty();
    }
}

// ── Empty state ───────────────────────────────────────────────────────

function renderEmpty() {
    state.usage = null;
    el('budget-loading').classList.add('hidden');
    el('budget-content').classList.add('hidden');
    const container = el('budget-empty-state');
    container.classList.remove('hidden');
    container.innerHTML = `
        <div class="p-10 text-center">
            <div class="mx-auto w-12 h-12 rounded-xl bg-orange-50 text-[#EA580C] flex items-center justify-center mb-4">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-9-9v9z"></path></svg>
            </div>
            <h2 class="text-xl font-bold text-gray-900">Create your first operating budget</h2>
            <p class="mt-2 text-[13px] text-gray-500 max-w-md mx-auto">Set one main spending limit, then split it into allocations like Marketing, Infrastructure, Operations, or SaaS.</p>
            <button id="budget-empty-create" type="button" class="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-[#EA580C] text-white rounded-lg text-[13px] font-bold hover:bg-[#D94E0B] transition-colors shadow-sm active:scale-95">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"></path></svg>
                Create Budget
            </button>
        </div>
    `;
    el('budget-empty-create')?.addEventListener('click', () => openDrawer());
    el('budget-create-btn-label').textContent = 'Create Budget';
}

// ── Loaded state ──────────────────────────────────────────────────────

function renderBudget(usage) {
    el('budget-loading').classList.add('hidden');
    el('budget-empty-state').classList.add('hidden');
    el('budget-content').classList.remove('hidden');
    el('budget-create-btn-label').textContent = 'Edit Budget';

    const { budget, allocations, summary, unallocated } = usage;

    renderWorkspaceHeader(budget, allocations);

    // ── KPI strip ───────────────────────────────────────────────────
    // These mappings intentionally mirror DataService.getBudgetUsage().
    // Do not recalculate actual/committed/remaining with separate rules here.
    const total = Number(summary.total_amount) || 0;
    const allocated = Number(summary.total_allocated) || 0;
    const unassigned = Number(summary.unallocated_budget_amount) || 0;
    const spentReserved = (Number(summary.total_actual_used) || 0) + (Number(summary.total_committed) || 0);
    const remaining = Number(summary.total_remaining) || 0;
    const coveragePercent = total > 0 ? (allocated / total) * 100 : 0;
    const unassignedPercent = total > 0 ? (unassigned / total) * 100 : 0;
    const usagePercent = Number(summary.usage_percent) || 0;

    el('budget-total').textContent = formatRp(total);
    el('budget-total-hint').textContent = 'Total spending envelope for this period.';

    el('budget-allocated').textContent = formatRp(allocated);
    el('budget-allocated-hint').textContent = total > 0
        ? `${formatPercent(coveragePercent)} of main budget has a purpose.`
        : 'Set a main budget to start allocating.';

    el('budget-spent').textContent = formatRp(spentReserved);
    el('budget-spent-hint').textContent = spentReserved === 0
        ? 'No actual or committed spend yet.'
        : `${formatRp(summary.total_actual_used)} spent · ${formatRp(summary.total_committed)} reserved.`;

    const usageClamped = Math.max(0, Math.min(100, usagePercent));
    const usageStatus = classifyStatus(usagePercent);
    const usageEl = el('budget-usage-percent');
    usageEl.textContent = formatPercent(usagePercent);
    usageEl.className = usageStatus === 'exceeded'
        ? 'font-mono font-bold text-red-600'
        : 'font-mono font-bold text-gray-700';
    const usageBar = el('budget-usage-bar');
    usageBar.style.width = usageClamped + '%';
    usageBar.className = `h-full rounded-full transition-all ${USAGE_BAR_CLASS[usageStatus] || 'bg-emerald-500'}`;

    const remainingEl = el('budget-remaining');
    remainingEl.textContent = formatRp(remaining);
    remainingEl.className = `mt-2 text-2xl font-bold font-mono truncate ${remaining < 0 ? 'text-red-600' : 'text-gray-900'}`;
    el('budget-remaining-hint').textContent = remaining < 0
        ? `${formatRp(remaining)} over budget after spent and reserved.`
        : 'Budget left after spent and reserved.';
    const remainingTextEl = el('budget-remaining-text');
    remainingTextEl.textContent = remaining < 0
        ? ` of main budget used · ${formatRp(remaining)} over`
        : ' of main budget used';
    remainingTextEl.className = remaining < 0 ? 'text-red-600' : '';

    el('budget-unassigned').textContent = formatRp(unassigned);
    el('budget-unassigned-hint').textContent = total > 0
        ? `${formatPercent(unassignedPercent)} still needs allocation.`
        : '—';

    const unassignedCard = el('budget-unassigned-card');
    unassignedCard.className = unassigned > 0
        ? 'p-4 sm:p-5 border-t sm:border-t-0 xl:border-t-0 border-gray-200 transition-colors bg-white shadow-[inset_3px_0_0_#EA580C]'
        : 'p-4 sm:p-5 border-t sm:border-t-0 xl:border-t-0 border-gray-200 transition-colors bg-white';

    const callout = el('budget-unassigned-callout');
    const allAssignedNote = el('budget-all-assigned-note');
    if (unassigned > 0) {
        el('budget-callout-amount').textContent = formatRp(unassigned);
        callout.classList.remove('hidden');
        allAssignedNote.classList.add('hidden');
    } else {
        callout.classList.add('hidden');
        if (allocated > 0) allAssignedNote.classList.remove('hidden');
        else allAssignedNote.classList.add('hidden');
    }

    renderAllocationMap(allocations, summary);
    el('budget-name').textContent = budget.name || 'Operating Budget';
    el('budget-period').textContent = formatPeriod(budget);
    renderAllocationsTable(allocations);
    renderBudgetAttention(allocations, summary, unallocated);
    renderUnallocatedCard(unallocated);

    // Phase 2 sections (each is async; they don't block the main render).
    renderUnallocatedQueue();
    renderExcludedRecords();
    renderActivityTimeline();
}

function classifyStatus(percent) {
    const p = Number.isFinite(percent) ? percent : 0;
    if (p >= 100) return 'exceeded';
    if (p >= 85) return 'at_risk';
    if (p >= 70) return 'watch';
    return 'healthy';
}

function formatPeriodType(value) {
    const map = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
    return map[value] || 'Monthly';
}

function formatPeriod(budget) {
    const start = budget.period_start?.toDate?.();
    const end = budget.period_end?.toDate?.();
    if (!start || !end) return '—';
    const fmt = { day: 'numeric', month: 'short', year: 'numeric' };
    return `${start.toLocaleDateString('id-ID', fmt)} – ${end.toLocaleDateString('id-ID', fmt)}`;
}

function formatUpdatedAt(budget) {
    const when = budget.updated_at?.toDate?.() || budget.created_at?.toDate?.();
    if (!when) return '';
    const diffMs = Math.max(0, Date.now() - when.getTime());
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return 'Updated just now';
    if (min < 60) return `Updated ${min}m ago`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `Updated ${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `Updated ${days}d ago`;
    return `Updated ${when.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function renderWorkspaceHeader(budget, allocations) {
    const period = formatPeriod(budget);
    const allocationCount = allocations.length;
    const allocationText = `${allocationCount} allocation${allocationCount === 1 ? '' : 's'}`;
    const updatedText = formatUpdatedAt(budget);

    el('budget-name').textContent = budget.name || 'Operating Budget';
    el('budget-period').textContent = period;
    el('budget-period-type').textContent = formatPeriodType(budget.period_type);
    el('budget-workspace-allocation-count').textContent = allocationText;

    const updatedEl = el('budget-workspace-updated');
    const updatedCard = updatedEl.closest('div');
    updatedEl.textContent = updatedText || '—';
    updatedCard?.classList.toggle('hidden', !updatedText);

    const metaParts = [period, allocationText];
    if (updatedText) metaParts.push(updatedText);
    el('budget-workspace-meta').textContent = metaParts.filter(Boolean).join(' · ');
}

function allocationColor(index) {
    return ALLOCATION_COLORS[index % ALLOCATION_COLORS.length];
}

function renderAllocationMap(allocations, summary) {
    const bar = el('budget-allocation-bar');
    const empty = el('budget-allocation-empty');
    const legend = el('budget-allocation-legend');
    const total = Math.max(0, Number(summary.total_amount) || 0);
    const allocated = Math.max(0, Number(summary.total_allocated) || 0);
    const unassigned = Math.max(0, Number(summary.unallocated_budget_amount) || 0);

    el('budget-allocation-summary').textContent = total > 0
        ? `Allocation · ${formatRp(allocated)} of ${formatRp(total)}`
        : 'Allocation map appears after a main budget amount is set.';

    if (total <= 0) {
        bar.classList.add('hidden');
        empty.classList.remove('hidden');
        legend.innerHTML = '';
        return;
    }

    bar.classList.remove('hidden');
    empty.classList.add('hidden');

    const segments = (allocations || [])
        .filter(alloc => Number(alloc.allocated_amount) > 0)
        .map((alloc, index) => ({
            id: alloc.id,
            label: alloc.name || 'Allocation',
            amount: Number(alloc.allocated_amount) || 0,
            percent: total > 0 ? ((Number(alloc.allocated_amount) || 0) / total) * 100 : 0,
            color: allocationColor(index)
        }));

    if (unassigned > 0) {
        segments.push({
            id: 'unassigned',
            label: 'Unassigned',
            amount: unassigned,
            percent: total > 0 ? (unassigned / total) * 100 : 0,
            color: '#E5E7EB',
            unassigned: true
        });
    }

    if (segments.length === 0) {
        bar.classList.add('hidden');
        empty.classList.remove('hidden');
        legend.innerHTML = '';
        return;
    }

    bar.innerHTML = segments.map(seg => {
        const safePct = Math.max(0, seg.percent);
        const label = safePct >= 10 ? escapeHtml(seg.label) : '';
        const textColor = seg.unassigned ? 'text-gray-500' : 'text-white';
        return `
            <div class="group relative flex h-full items-center overflow-hidden px-2 transition-opacity hover:opacity-90 ${textColor}"
                style="flex: 0 0 ${safePct}%; background: ${seg.color};"
                role="img"
                aria-label="${escapeHtml(seg.label)} ${escapeHtml(formatPercent(seg.percent))} of main budget">
                <span class="truncate text-[11px] font-bold">${label}</span>
            </div>
        `;
    }).join('');

    legend.innerHTML = segments.map(seg => `
        <div class="flex items-center gap-2 text-[12px] min-w-0">
            <span class="h-2.5 w-2.5 rounded-sm flex-shrink-0" style="background: ${seg.color};"></span>
            <span class="text-gray-600 truncate">${escapeHtml(seg.label)}</span>
            <span class="ml-auto font-mono font-bold text-gray-900">${formatPercent(seg.percent)}</span>
        </div>
    `).join('');
}

function renderAllocationsTable(allocations) {
    const body = el('budget-alloc-body');
    const mobile = el('budget-alloc-mobile');
    el('budget-alloc-count').textContent = allocations.length
        ? `${allocations.length} allocation${allocations.length === 1 ? '' : 's'}`
        : '';
    if (allocations.length === 0) {
        body.innerHTML = `<tr><td colspan="6" class="px-6 py-10 text-center text-[13px] text-gray-400">No allocations yet. Edit this budget to add Marketing, Infrastructure, Operations, or SaaS allocations.</td></tr>`;
        if (mobile) {
            mobile.innerHTML = `<div class="px-5 py-8 text-center text-[13px] text-gray-400">No allocations yet. Edit this budget to split it by purpose.</div>`;
        }
        return;
    }
    body.innerHTML = allocations.map((alloc, index) => {
        const status = STATUS_BADGE[alloc.status] || STATUS_BADGE.healthy;
        const barCls = USAGE_BAR_CLASS[alloc.status] || 'bg-gray-300';
        const usagePercent = Math.max(0, Math.min(100, alloc.usage_percent));
        const scope = (alloc.scope_values || []).join(', ');
        const remainingCls = alloc.remaining_amount < 0 ? 'text-red-600' : 'text-gray-900';
        const spentReserved = (Number(alloc.actual_used) || 0) + (Number(alloc.committed_amount) || 0);
        const variance = explainAllocationVariance(alloc);
        return `
            <tr class="hover:bg-gray-50 transition-colors cursor-pointer" data-allocation-id="${escapeHtml(alloc.id)}" data-action="open-allocation">
                <td class="px-6 py-4">
                    <div class="flex items-start gap-3">
                        <span class="mt-1.5 h-2.5 w-2.5 rounded-sm flex-shrink-0" style="background: ${allocationColor(index)};"></span>
                        <div class="min-w-0">
                            <p class="font-semibold text-gray-900">${escapeHtml(alloc.name)}</p>
                            <p class="text-[11px] text-gray-400 mt-0.5">Category: ${escapeHtml(scope || '—')}</p>
                        </div>
                    </div>
                    ${variance ? `<p class="mt-1 text-[11px] text-gray-500 max-w-[360px]">${variance}</p>` : ''}
                </td>
                <td class="px-6 py-4 text-right font-mono text-gray-900">${formatRp(alloc.allocated_amount)}</td>
                <td class="px-6 py-4 text-right font-mono text-gray-700">${formatRp(spentReserved)}</td>
                <td class="px-6 py-4 text-right font-mono ${remainingCls}">${formatRp(alloc.remaining_amount)}</td>
                <td class="px-6 py-4">
                    <div class="flex items-center justify-end gap-2">
                        <div class="hidden sm:block w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div class="h-full ${barCls} rounded-full" style="width: ${usagePercent}%"></div>
                        </div>
                        <span class="font-mono text-[12px] font-bold text-gray-700">${formatPercent(alloc.usage_percent)}</span>
                    </div>
                </td>
                <td class="px-6 py-4">
                    <span class="px-2.5 py-1 rounded-full text-[11px] font-bold ${status.cls}">${status.label}</span>
                </td>
            </tr>
        `;
    }).join('');
    if (mobile) {
        mobile.innerHTML = allocations.map((alloc, index) => renderAllocationMobileCard(alloc, index)).join('');
    }
}

function renderAllocationMobileCard(alloc, index) {
    const status = STATUS_BADGE[alloc.status] || STATUS_BADGE.healthy;
    const barCls = USAGE_BAR_CLASS[alloc.status] || 'bg-gray-300';
    const usagePercent = Math.max(0, Math.min(100, alloc.usage_percent));
    const scope = (alloc.scope_values || []).join(', ');
    const spentReserved = (Number(alloc.actual_used) || 0) + (Number(alloc.committed_amount) || 0);
    const remainingCls = alloc.remaining_amount < 0 ? 'text-red-600' : 'text-gray-900';
    return `
        <button type="button" class="w-full text-left px-5 py-4 hover:bg-gray-50 transition-colors" data-allocation-id="${escapeHtml(alloc.id)}" data-action="open-allocation">
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <div class="flex items-center gap-2">
                        <span class="h-2.5 w-2.5 rounded-sm flex-shrink-0" style="background: ${allocationColor(index)};"></span>
                        <p class="font-semibold text-[13px] text-gray-900 truncate">${escapeHtml(alloc.name)}</p>
                    </div>
                    <p class="mt-1 text-[11px] text-gray-400">Category: ${escapeHtml(scope || '—')}</p>
                </div>
                <span class="px-2.5 py-1 rounded-full text-[11px] font-bold ${status.cls} flex-shrink-0">${status.label}</span>
            </div>
            <div class="mt-4 grid grid-cols-2 gap-3">
                <div>
                    <p class="text-[10px] font-bold uppercase tracking-wider text-gray-400">Allocated</p>
                    <p class="mt-1 font-mono font-bold text-gray-900">${formatRp(alloc.allocated_amount)}</p>
                </div>
                <div>
                    <p class="text-[10px] font-bold uppercase tracking-wider text-gray-400">Spent + Reserved</p>
                    <p class="mt-1 font-mono font-bold text-gray-900">${formatRp(spentReserved)}</p>
                </div>
                <div>
                    <p class="text-[10px] font-bold uppercase tracking-wider text-gray-400">Remaining</p>
                    <p class="mt-1 font-mono font-bold ${remainingCls}">${formatRp(alloc.remaining_amount)}</p>
                </div>
                <div>
                    <p class="text-[10px] font-bold uppercase tracking-wider text-gray-400">Usage</p>
                    <p class="mt-1 font-mono font-bold text-gray-900">${formatPercent(alloc.usage_percent)}</p>
                </div>
            </div>
            <div class="mt-3 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                <div class="h-full ${barCls} rounded-full" style="width: ${usagePercent}%"></div>
            </div>
        </button>
    `;
}

function explainAllocationVariance(alloc) {
    const allocated = alloc.allocated_amount;
    const actual = alloc.actual_used;
    const committed = alloc.committed_amount;
    const remaining = alloc.remaining_amount;
    if (allocated <= 0) return '';
    if (alloc.status === 'exceeded') {
        const over = (actual + committed) - allocated;
        return `Exceeded by <span class="font-mono font-bold text-red-600">${escapeHtml(formatRp(over))}</span>.`;
    }
    if (alloc.status === 'at_risk') {
        return `Actual + committed has reached ${escapeHtml(formatPercent(alloc.usage_percent))} of the allocation.`;
    }
    if (alloc.status === 'watch') {
        return `${escapeHtml(formatPercent(alloc.usage_percent))} used. <span class="font-mono font-bold">${escapeHtml(formatRp(remaining))}</span> remaining.`;
    }
    // Healthy
    if (committed === 0 && actual === 0) {
        return `No spend yet. <span class="font-mono font-bold">${escapeHtml(formatRp(remaining))}</span> remaining.`;
    }
    if (committed === 0) {
        return `<span class="font-mono font-bold">${escapeHtml(formatRp(remaining))}</span> remaining and no committed bills.`;
    }
    return `<span class="font-mono font-bold">${escapeHtml(formatRp(remaining))}</span> remaining after actual and committed spend.`;
}

function renderBudgetAttention(allocations, summary) {
    const alerts = [];
    const total = Math.max(0, Number(summary.total_amount) || 0);
    const allocated = Math.max(0, Number(summary.total_allocated) || 0);
    const unassigned = Math.max(0, Number(summary.unallocated_budget_amount) || 0);
    const spentReserved = (Number(summary.total_actual_used) || 0) + (Number(summary.total_committed) || 0);

    if (total > 0 && allocated > total) {
        alerts.push({
            tone: 'danger',
            title: 'Allocation total exceeds main budget',
            body: `${formatRp(allocated - total)} is allocated beyond the main budget. Reduce allocations before using this plan for approvals.`
        });
    }

    if (unassigned > 0) {
        alerts.push({
            tone: 'warning',
            title: `${formatRp(unassigned)} is still unassigned`,
            body: 'Assign it to allocations so this budget can be tracked by purpose.'
        });
    }

    allocations.forEach(alloc => {
        const used = (Number(alloc.actual_used) || 0) + (Number(alloc.committed_amount) || 0);
        if (alloc.status === 'exceeded') {
            alerts.push({
                tone: 'danger',
                title: `${alloc.name} exceeded allocation`,
                body: `${formatRp(Math.max(0, used - alloc.allocated_amount))} over allocation at ${formatPercent(alloc.usage_percent)} usage.`
            });
        } else if (alloc.usage_percent >= 85) {
            alerts.push({
                tone: 'warning',
                title: `${alloc.name} is at ${formatPercent(alloc.usage_percent)} usage`,
                body: 'Review reserved bills before approving new spend.'
            });
        }
    });

    if (spentReserved === 0) {
        alerts.push({
            tone: 'neutral',
            title: 'No spend or reserved bills recorded yet',
            body: 'Budget usage will update after in-period expense transactions, pending payables, or unpaid bills are added.'
        });
    }

    const list = el('budget-attention-list');
    if (alerts.length === 0) {
        list.innerHTML = `
            <li class="px-5 py-4">
                <p class="text-[13px] font-semibold text-gray-900">No budget issues detected from current records.</p>
                <p class="mt-1 text-[12px] text-gray-500">Allocations, spend, and reserved bills are inside the current thresholds.</p>
            </li>
        `;
        return;
    }

    list.innerHTML = alerts.map(renderAttentionItem).join('');
}

function renderAttentionItem(alert) {
    const tone = {
        danger: 'border-red-200 text-red-700',
        warning: 'border-amber-200 text-amber-700',
        neutral: 'border-gray-200 text-gray-500'
    }[alert.tone] || 'border-gray-200 text-gray-500';
    return `
        <li class="px-5 py-4">
            <div class="flex items-start gap-3">
                <span class="mt-1 h-2.5 w-2.5 rounded-full border ${tone} flex-shrink-0"></span>
                <div class="min-w-0">
                    <p class="text-[13px] font-semibold text-gray-900">${escapeHtml(alert.title)}</p>
                    <p class="mt-1 text-[12px] text-gray-500 leading-relaxed">${escapeHtml(alert.body)}</p>
                </div>
            </div>
        </li>
    `;
}

function renderUnallocatedCard(unallocated) {
    const card = el('budget-unallocated-card');
    if (unallocated.actual_amount === 0 && unallocated.committed_amount === 0) {
        card.classList.add('hidden');
        return;
    }
    card.classList.remove('hidden');
    el('budget-unallocated-actual').textContent = formatRp(unallocated.actual_amount);
    el('budget-unallocated-committed').textContent = formatRp(unallocated.committed_amount);
}

// ── Drawer ────────────────────────────────────────────────────────────

function wireDrawerControls() {
    el('budget-create-btn').addEventListener('click', () => openDrawer());
    // The Assign Remaining Budget CTA lives inside the unassigned callout;
    // it's always in the DOM (hidden until needed) so we can wire it once.
    // Reuses the Edit Budget flow — opening the drawer prefills allocation
    // rows and shows the remaining-unallocated amount inline.
    el('budget-assign-remaining-btn')?.addEventListener('click', () => openDrawer());
    el('budget-drawer-close-btn').addEventListener('click', closeDrawer);
    el('budget-drawer-cancel').addEventListener('click', closeDrawer);
    el('budget-drawer-backdrop').addEventListener('click', closeDrawer);

    // Phase 2: allocation detail drawer + collapsible sections + queue actions.
    el('budget-detail-close-btn')?.addEventListener('click', closeDetailDrawer);
    el('budget-detail-close-footer')?.addEventListener('click', closeDetailDrawer);
    el('budget-detail-backdrop')?.addEventListener('click', closeDetailDrawer);
    el('budget-excluded-toggle')?.addEventListener('click', () => toggleCollapsible('budget-excluded-body', 'budget-excluded-caret'));
    el('budget-activity-toggle')?.addEventListener('click', () => toggleCollapsible('budget-activity-body', 'budget-activity-caret'));

    document.addEventListener('click', (e) => {
        const allocRow = e.target.closest('[data-action="open-allocation"]');
        if (allocRow) {
            openAllocationDetail(allocRow.dataset.allocationId);
            return;
        }
        const queueAct = e.target.closest('[data-phase2-action]');
        if (queueAct) {
            e.preventDefault();
            e.stopPropagation();
            handlePhase2Action(queueAct.dataset);
        }
    });

    el('budget-form-name').addEventListener('input', updateDrawerValidity);
    el('budget-form-amount').addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, '');
        e.target.value = value.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        updateAllocationTotals();
        updateDrawerValidity();
    });
    el('budget-form-notes').addEventListener('input', updateDrawerValidity);
    el('budget-form-add-allocation').addEventListener('click', () => {
        state.allocRows.push({ name: '', category: pickNextCategory(), amount: '' });
        renderAllocationRows();
        updateAllocationTotals();
        updateDrawerValidity();
    });

    document.querySelectorAll('#budget-form-period-type .period-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.periodType = btn.dataset.value;
            document.querySelectorAll('#budget-form-period-type .period-type-btn').forEach(b => {
                const active = b === btn;
                b.className = active
                    ? 'period-type-btn px-3 py-2 rounded-lg border border-[#EA580C] bg-orange-50 text-[#EA580C] text-[12px] font-bold'
                    : 'period-type-btn px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 text-[12px] font-bold hover:border-gray-300';
            });
        });
    });

    el('budget-drawer-form').addEventListener('submit', handleSubmit);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && state.drawerOpen) closeDrawer();
    });
}

function pickNextCategory() {
    const used = new Set(state.allocRows.map(r => r.category));
    return ALLOCATION_CATEGORIES.find(c => !used.has(c)) || 'Operations';
}

function openDrawer() {
    state.drawerOpen = true;
    el('budget-drawer-backdrop').classList.remove('hidden');
    requestAnimationFrame(() => el('budget-drawer').classList.remove('translate-x-full'));
    document.body.classList.add('overflow-hidden');
    prefillDrawerFromState();
    mountDrawerDatePicker();
    renderAllocationRows();
    updateAllocationTotals();
    updateDrawerValidity();
}

function closeDrawer() {
    state.drawerOpen = false;
    el('budget-drawer').classList.add('translate-x-full');
    el('budget-drawer-backdrop').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    state.datePicker = null;
    el('budget-form-date-picker').innerHTML = '';
}

function prefillDrawerFromState() {
    const usage = state.usage;
    if (usage?.budget) {
        el('budget-drawer-title').textContent = 'Edit operating budget';
        el('budget-drawer-submit').textContent = 'Save Changes';
        el('budget-form-name').value = usage.budget.name || '';
        el('budget-form-amount').value = formatRpInput(usage.budget.total_budget);
        el('budget-form-notes').value = usage.budget.notes || '';
        const start = usage.budget.period_start?.toDate?.() || new Date();
        const end = usage.budget.period_end?.toDate?.() || new Date();
        state.periodStart = getDayKey(start);
        state.periodEnd = getDayKey(end);
        state.periodType = usage.budget.period_type || 'monthly';
        setActivePeriodTypeButton(state.periodType);
        state.allocRows = (usage.allocations || []).map(a => ({
            name: a.name,
            category: (a.scope_values && a.scope_values[0]) || 'Operations',
            amount: formatRpInput(a.allocated_amount)
        }));
        if (state.allocRows.length === 0) {
            state.allocRows = DEFAULT_ALLOCATION_ROWS.map(r => ({ ...r }));
        }
    } else {
        el('budget-drawer-title').textContent = 'Create operating budget';
        el('budget-drawer-submit').textContent = 'Save Budget';
        el('budget-form-name').value = '';
        el('budget-form-amount').value = '';
        el('budget-form-notes').value = '';
        state.periodStart = getMonthStartKey();
        state.periodEnd = getMonthEndKey();
        state.periodType = 'monthly';
        setActivePeriodTypeButton(state.periodType);
        state.allocRows = DEFAULT_ALLOCATION_ROWS.map(r => ({ ...r }));
    }
}

function formatRpInput(value) {
    const n = Math.round(Math.max(0, Number(value) || 0));
    if (!n) return '';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function setActivePeriodTypeButton(value) {
    document.querySelectorAll('#budget-form-period-type .period-type-btn').forEach(b => {
        const active = b.dataset.value === value;
        b.className = active
            ? 'period-type-btn px-3 py-2 rounded-lg border border-[#EA580C] bg-orange-50 text-[#EA580C] text-[12px] font-bold'
            : 'period-type-btn px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 text-[12px] font-bold hover:border-gray-300';
    });
}

function mountDrawerDatePicker() {
    if (!window.FluxyDateRangePicker?.mount) return;
    state.datePicker = window.FluxyDateRangePicker.mount('#budget-form-date-picker', {
        start: state.periodStart,
        end: state.periodEnd,
        defaultStart: state.periodStart,
        defaultEnd: state.periodEnd,
        maxDate: '2099-12-31',
        onChange: ({ start, end }) => {
            state.periodStart = start;
            state.periodEnd = end;
            updateDrawerValidity();
        }
    });
}

function renderAllocationRows() {
    const container = el('budget-form-allocation-rows');
    container.innerHTML = state.allocRows.map((row, i) => `
        <div class="grid grid-cols-12 gap-2 items-center" data-row-index="${i}">
            <input type="text" maxlength="120" placeholder="Name" value="${escapeHtml(row.name)}" class="col-span-4 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#E85D19] text-[13px]" data-field="name">
            <select class="col-span-3 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#E85D19] text-[13px]" data-field="category">
                ${ALLOCATION_CATEGORIES.map(cat => `<option value="${cat}" ${cat === row.category ? 'selected' : ''}>${cat}</option>`).join('')}
            </select>
            <input type="text" inputmode="numeric" placeholder="0" value="${escapeHtml(row.amount)}" class="col-span-4 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#E85D19] text-[13px] font-mono text-right" data-field="amount">
            <button type="button" data-action="remove-row" class="col-span-1 inline-flex items-center justify-center w-8 h-8 mx-auto text-gray-400 hover:text-red-500 transition-colors" aria-label="Remove allocation row">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
        </div>
    `).join('');

    container.querySelectorAll('[data-row-index]').forEach((rowEl) => {
        const idx = Number(rowEl.dataset.rowIndex);
        rowEl.querySelector('[data-field="name"]').addEventListener('input', (e) => {
            state.allocRows[idx].name = e.target.value;
            updateDrawerValidity();
        });
        rowEl.querySelector('[data-field="category"]').addEventListener('change', (e) => {
            state.allocRows[idx].category = e.target.value;
            updateDrawerValidity();
        });
        const amountInput = rowEl.querySelector('[data-field="amount"]');
        amountInput.addEventListener('input', (e) => {
            const raw = e.target.value.replace(/\D/g, '');
            e.target.value = raw.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
            state.allocRows[idx].amount = e.target.value;
            updateAllocationTotals();
            updateDrawerValidity();
        });
        rowEl.querySelector('[data-action="remove-row"]').addEventListener('click', () => {
            state.allocRows.splice(idx, 1);
            renderAllocationRows();
            updateAllocationTotals();
            updateDrawerValidity();
        });
    });
}

function parseRp(value) {
    if (value == null) return 0;
    const cleaned = String(value).replace(/\D/g, '');
    return cleaned ? parseInt(cleaned, 10) : 0;
}

function totalRowsAmount() {
    return state.allocRows.reduce((sum, r) => sum + parseRp(r.amount), 0);
}

function updateAllocationTotals() {
    const total = parseRp(el('budget-form-amount').value);
    const allocated = totalRowsAmount();
    const remaining = total - allocated;
    el('budget-form-total-display').textContent = formatRp(total);
    el('budget-form-allocated-sum').textContent = formatRp(allocated);
    const unallocSpan = el('budget-form-unallocated-amt').querySelector('span');
    if (unallocSpan) unallocSpan.textContent = formatRp(Math.max(0, remaining));
    const warning = el('budget-form-warning');
    if (allocated > total && total > 0) {
        warning.classList.remove('hidden');
        warning.textContent = `Allocations exceed the main budget by ${formatRp(allocated - total)}.`;
    } else {
        warning.classList.add('hidden');
        warning.textContent = '';
    }
}

function updateDrawerValidity() {
    const total = parseRp(el('budget-form-amount').value);
    const allocated = totalRowsAmount();
    const nameOk = el('budget-form-name').value.trim().length > 0;
    const totalOk = total > 0;
    const periodOk = !!state.periodStart && !!state.periodEnd && state.periodStart <= state.periodEnd;
    const rowsOk = state.allocRows.length > 0 && state.allocRows.every(r => r.name.trim().length > 0 && parseRp(r.amount) > 0 && r.category);
    const allocSumOk = allocated <= total;

    const submit = el('budget-drawer-submit');
    submit.disabled = !(nameOk && totalOk && periodOk && rowsOk && allocSumOk);
}

async function handleSubmit(e) {
    e.preventDefault();
    const submit = el('budget-drawer-submit');
    if (submit.disabled) return;
    submit.disabled = true;
    const originalLabel = submit.textContent;
    submit.textContent = 'Saving...';

    try {
        const total = parseRp(el('budget-form-amount').value);
        const start = parsePeriodDate(state.periodStart);
        const end = parsePeriodDate(state.periodEnd, true);
        const allocations = state.allocRows.map(r => ({
            name: r.name.trim(),
            allocated_amount: parseRp(r.amount),
            scope_values: [r.category]
        }));

        await state.ds.addBudgetWithAllocations(state.user.uid, {
            name: el('budget-form-name').value.trim(),
            period_type: state.periodType,
            period_start: start,
            period_end: end,
            total_budget: total,
            notes: el('budget-form-notes').value.trim()
        }, allocations);

        window.showToast?.('Budget saved.', 'success');
        closeDrawer();
        await loadAndRender();
    } catch (err) {
        console.error('Save budget failed:', err);
        const message = err?.message || 'Could not save your budget. Please try again.';
        const friendly = message.includes('permission-denied')
            ? 'Permission denied. Check Firestore Rules.'
            : message;
        window.showToast?.(friendly, 'error');
        submit.textContent = originalLabel;
        submit.disabled = false;
    }
}

function parsePeriodDate(dayKey, endOfDay = false) {
    if (typeof dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return new Date();
    const [year, month, day] = dayKey.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    if (endOfDay) d.setHours(23, 59, 59, 999);
    else d.setHours(0, 0, 0, 0);
    return d;
}

// ── Phase 2: allocation detail drawer ─────────────────────────────────

function toggleCollapsible(bodyId, caretId) {
    const body = el(bodyId);
    const caret = el(caretId);
    if (!body) return;
    const hidden = body.classList.toggle('hidden');
    if (caret) caret.style.transform = hidden ? '' : 'rotate(180deg)';
}

async function openAllocationDetail(allocationId) {
    if (!allocationId || !state.usage) return;
    const alloc = (state.usage.allocations || []).find(a => a.id === allocationId);
    if (!alloc) return;

    state.activeAllocationId = allocationId;
    el('budget-detail-name').textContent = alloc.name;
    el('budget-detail-content').innerHTML = renderAllocationDetailSkeleton(alloc);
    el('budget-detail-backdrop').classList.remove('hidden');
    requestAnimationFrame(() => el('budget-detail-drawer').classList.remove('translate-x-full'));
    document.body.classList.add('overflow-hidden');

    try {
        const data = await state.ds.getBudgetRelatedRecords(state.user.uid, state.usage.budget.id, allocationId);
        el('budget-detail-content').innerHTML = renderAllocationDetailFull(alloc, data, state.usage);
    } catch (err) {
        console.error('Detail load failed:', err);
        el('budget-detail-content').innerHTML = `<p class="text-[13px] text-red-600">Could not load related records. ${escapeHtml(err?.message || '')}</p>`;
    }
}

function closeDetailDrawer() {
    state.activeAllocationId = null;
    el('budget-detail-drawer').classList.add('translate-x-full');
    el('budget-detail-backdrop').classList.add('hidden');
    // Only release the scroll lock if the create-budget drawer isn't also open
    // (unlikely but safe — that drawer manages its own lock).
    if (!state.drawerOpen) document.body.classList.remove('overflow-hidden');
}

function renderAllocationDetailSkeleton(alloc) {
    return `
        ${renderAllocationDetailHeader(alloc)}
        <p class="text-[13px] text-gray-400">Loading related records…</p>
    `;
}

function renderAllocationDetailHeader(alloc) {
    const status = STATUS_BADGE[alloc.status] || STATUS_BADGE.healthy;
    const variance = explainAllocationVariance(alloc);
    return `
        <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div class="flex items-center justify-between gap-3">
                <p class="text-[12px] text-gray-500">${escapeHtml((alloc.scope_values || []).join(', ') || 'No category')}</p>
                <span class="px-2.5 py-1 rounded-full text-[11px] font-bold ${status.cls}">${status.label}</span>
            </div>
            <div class="mt-3 grid grid-cols-2 gap-3 text-[12px]">
                <div><p class="text-gray-400 uppercase tracking-wider text-[10px] font-bold">Allocated</p><p class="font-mono font-bold text-gray-900 mt-1">${formatRp(alloc.allocated_amount)}</p></div>
                <div><p class="text-gray-400 uppercase tracking-wider text-[10px] font-bold">Remaining</p><p class="font-mono font-bold ${alloc.remaining_amount < 0 ? 'text-red-600' : 'text-gray-900'} mt-1">${formatRp(alloc.remaining_amount)}</p></div>
                <div><p class="text-gray-400 uppercase tracking-wider text-[10px] font-bold">Actual</p><p class="font-mono text-gray-700 mt-1">${formatRp(alloc.actual_used)}</p></div>
                <div><p class="text-gray-400 uppercase tracking-wider text-[10px] font-bold">Committed</p><p class="font-mono text-gray-700 mt-1">${formatRp(alloc.committed_amount)}</p></div>
            </div>
            ${variance ? `<p class="mt-3 text-[12px] text-gray-600">${variance}</p>` : ''}
        </div>
    `;
}

function renderAllocationDetailFull(alloc, data, usage) {
    const txRows = data.transactions
        .map(tx => renderDetailRecordRow(tx, 'transactions', alloc))
        .join('') || `<p class="px-4 py-6 text-[12px] text-gray-400 text-center">No related transactions in this period.</p>`;
    const billRows = data.bills
        .map(b => renderDetailRecordRow(b, 'bills', alloc))
        .join('') || `<p class="px-4 py-6 text-[12px] text-gray-400 text-center">No related unpaid bills in this period.</p>`;
    return `
        ${renderAllocationDetailHeader(alloc)}
        <div>
            <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Related transactions · ${data.transactions.length}</p>
            <div class="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
                ${txRows}
            </div>
        </div>
        <div>
            <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Related bills · ${data.bills.length}</p>
            <div class="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
                ${billRows}
            </div>
        </div>
    `;
}

function renderDetailRecordRow(record, type, alloc) {
    const date = (type === 'bills' && record.due_date?.toDate?.()) || record.timestamp?.toDate?.();
    const dateText = date ? date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '—';
    const vendor = record.vendor_name || 'Unknown';
    const amount = formatRp(record.amount);
    const source = record._matchSource === 'manual' ? 'Manual' : record._matchSource === 'explicit' ? 'Explicit' : 'Auto by category';
    return `
        <div class="flex items-start justify-between gap-3 px-3 py-2.5">
            <div class="min-w-0">
                <p class="text-[12px] font-semibold text-gray-900 truncate">${escapeHtml(vendor)}</p>
                <p class="text-[11px] text-gray-400 mt-0.5">${escapeHtml(dateText)} · ${escapeHtml(record.category || '—')} · ${escapeHtml(source)}</p>
            </div>
            <div class="flex items-center gap-3 flex-shrink-0">
                <p class="text-[12px] font-mono font-bold text-gray-900">${amount}</p>
                <button type="button" class="text-[11px] font-bold text-[#EA580C] hover:underline" data-phase2-action data-action-type="assign" data-record-type="${type}" data-record-id="${escapeHtml(record.id)}" data-vendor="${escapeHtml(vendor)}" data-amount-text="${escapeHtml(amount)}" data-current-allocation-id="${escapeHtml(record.budget_allocation_id || '')}">Change</button>
                <button type="button" class="text-[11px] font-bold text-gray-500 hover:text-red-600" data-phase2-action data-action-type="exclude" data-record-type="${type}" data-record-id="${escapeHtml(record.id)}" data-vendor="${escapeHtml(vendor)}" data-amount-text="${escapeHtml(amount)}">Exclude</button>
            </div>
        </div>
    `;
}

// ── Phase 2: unallocated queue + excluded list + activity timeline ────

async function renderUnallocatedQueue() {
    if (!state.usage?.budget) return;
    const card = el('budget-unallocated-queue');
    const body = el('budget-unalloc-body');
    const count = el('budget-unalloc-count');
    try {
        const { transactions, bills } = await state.ds.getUnallocatedBudgetRecords(state.user.uid, state.usage.budget.id);
        const rows = [
            ...transactions.map(r => ({ ...r, _type: 'transactions' })),
            ...bills.map(r => ({ ...r, _type: 'bills' }))
        ];
        if (rows.length === 0) {
            card.classList.add('hidden');
            return;
        }
        card.classList.remove('hidden');
        count.textContent = `${rows.length} record${rows.length === 1 ? '' : 's'}`;
        body.innerHTML = rows.map(renderUnallocRow).join('');
    } catch (err) {
        console.warn('Unallocated queue failed:', err);
        card.classList.add('hidden');
    }
}

function renderUnallocRow(record) {
    const date = (record._type === 'bills' && record.due_date?.toDate?.()) || record.timestamp?.toDate?.();
    const dateText = date ? date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '—';
    const vendor = record.vendor_name || 'Unknown';
    const amount = formatRp(record.amount);
    const typeLabel = record._type === 'bills' ? 'Bill' : (record.type || 'transaction').replace(/_/g, ' ');
    // Suggested allocation: any allocation whose scope_values match the record category.
    const cat = String(record.category || '').trim();
    const suggested = (state.usage?.allocations || []).find(a => Array.isArray(a.scope_values) && a.scope_values.includes(cat));
    const suggestedText = suggested ? suggested.name : '—';
    return `
        <tr class="hover:bg-gray-50/60">
            <td class="px-6 py-3 text-gray-500 text-[12px]">${escapeHtml(dateText)}</td>
            <td class="px-6 py-3 text-gray-500 text-[12px]">${escapeHtml(typeLabel)}</td>
            <td class="px-6 py-3">
                <p class="font-semibold text-gray-900 truncate max-w-[220px]">${escapeHtml(vendor)}</p>
                <p class="text-[11px] text-gray-400">${escapeHtml(record.category || '—')}</p>
            </td>
            <td class="px-6 py-3 text-right font-mono font-bold text-gray-900">${amount}</td>
            <td class="px-6 py-3 text-gray-500 text-[12px]">${escapeHtml(suggestedText)}</td>
            <td class="px-6 py-3 text-right">
                <button type="button" class="text-[12px] font-bold text-[#EA580C] hover:underline mr-3" data-phase2-action data-action-type="assign" data-record-type="${record._type}" data-record-id="${escapeHtml(record.id)}" data-vendor="${escapeHtml(vendor)}" data-amount-text="${escapeHtml(amount)}" data-current-allocation-id="${escapeHtml(suggested?.id || '')}">Assign</button>
                <button type="button" class="text-[12px] font-bold text-gray-500 hover:text-red-600" data-phase2-action data-action-type="exclude" data-record-type="${record._type}" data-record-id="${escapeHtml(record.id)}" data-vendor="${escapeHtml(vendor)}" data-amount-text="${escapeHtml(amount)}">Exclude</button>
            </td>
        </tr>
    `;
}

async function renderExcludedRecords() {
    if (!state.usage?.budget) return;
    const card = el('budget-excluded-card');
    const body = el('budget-excluded-body');
    const countEl = el('budget-excluded-count');
    try {
        // Fetch excluded via getBudgetRelatedRecords on any allocation (the excluded
        // set is allocation-agnostic — same list returns from every call).
        const firstAlloc = state.usage.allocations?.[0];
        if (!firstAlloc) { card.classList.add('hidden'); return; }
        const { excluded } = await state.ds.getBudgetRelatedRecords(state.user.uid, state.usage.budget.id, firstAlloc.id);
        const rows = [
            ...excluded.transactions.map(r => ({ ...r, _type: 'transactions' })),
            ...excluded.bills.map(r => ({ ...r, _type: 'bills' }))
        ];
        if (rows.length === 0) { card.classList.add('hidden'); return; }
        card.classList.remove('hidden');
        countEl.textContent = String(rows.length);
        body.innerHTML = rows.map(renderExcludedRow).join('');
    } catch (err) {
        console.warn('Excluded records load failed:', err);
        card.classList.add('hidden');
    }
}

function renderExcludedRow(record) {
    const date = (record._type === 'bills' && record.due_date?.toDate?.()) || record.timestamp?.toDate?.();
    const dateText = date ? date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '—';
    const vendor = record.vendor_name || 'Unknown';
    const amount = formatRp(record.amount);
    const reason = record.budget_exclusion_reason || 'No reason recorded.';
    return `
        <div class="px-6 py-3 flex items-start justify-between gap-3">
            <div class="min-w-0">
                <p class="text-[13px] font-semibold text-gray-900 truncate">${escapeHtml(vendor)} <span class="text-gray-400 font-normal">· ${escapeHtml(record.category || '—')} · ${escapeHtml(dateText)}</span></p>
                <p class="text-[11px] text-gray-500 mt-0.5">Reason: ${escapeHtml(reason)}</p>
            </div>
            <div class="flex items-center gap-3 flex-shrink-0">
                <p class="text-[12px] font-mono font-bold text-gray-700">${amount}</p>
                <button type="button" class="text-[12px] font-bold text-[#EA580C] hover:underline" data-phase2-action data-action-type="restore" data-record-type="${record._type}" data-record-id="${escapeHtml(record.id)}" data-vendor="${escapeHtml(vendor)}" data-amount-text="${escapeHtml(amount)}">Restore</button>
            </div>
        </div>
    `;
}

async function renderActivityTimeline() {
    if (!state.usage?.budget) return;
    const card = el('budget-activity-card');
    const body = el('budget-activity-body');
    const recentList = el('budget-recent-activity-list');
    if (recentList) {
        recentList.innerHTML = `<li class="px-5 py-4 text-[13px] text-gray-400">Checking budget activity...</li>`;
    }
    try {
        const logs = await state.ds.getBudgetActivityLogs(state.user.uid, state.usage.budget.id, 50);
        if (logs.length === 0) {
            card.classList.add('hidden');
            if (recentList) {
                recentList.innerHTML = `<li class="px-5 py-4 text-[13px] text-gray-400">No budget activity yet.</li>`;
            }
            return;
        }
        if (recentList) {
            recentList.innerHTML = logs.slice(0, 4).map(renderRecentActivityRow).join('');
        }
        card.classList.remove('hidden');
        body.innerHTML = logs.map(renderActivityRow).join('');
    } catch (err) {
        console.warn('Activity timeline failed:', err);
        card.classList.add('hidden');
        if (recentList) {
            recentList.innerHTML = `<li class="px-5 py-4 text-[13px] text-gray-400">No budget activity yet.</li>`;
        }
    }
}

function renderRecentActivityRow(log) {
    const when = log.created_at?.toDate?.();
    const whenText = when ? when.toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
    const actionMap = {
        'budget_assignment.update': 'updated an allocation assignment',
        'budget_assignment.exclude': 'excluded a record from this budget',
        'budget_assignment.restore': 'restored a record to this budget',
        'budget.created': 'created this budget',
        'budget.updated': 'updated this budget',
        'budget.allocations_updated': 'updated budget allocations'
    };
    const label = actionMap[log.action] || String(log.action || 'Budget activity').replace(/_/g, ' ');
    return `
        <li class="px-5 py-4">
            <p class="text-[13px] font-semibold text-gray-900">${escapeHtml(label)}</p>
            <p class="mt-1 text-[12px] text-gray-500">${escapeHtml(whenText)}${log.reason ? ` · ${escapeHtml(log.reason)}` : ''}</p>
        </li>
    `;
}

function renderActivityRow(log) {
    const when = log.created_at?.toDate?.();
    const whenText = when ? when.toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
    const actionMap = {
        'budget_assignment.update': 'Assignment updated',
        'budget_assignment.exclude': 'Excluded from budget',
        'budget_assignment.restore': 'Restored to budget'
    };
    const label = actionMap[log.action] || log.action;
    return `
        <li class="px-6 py-3">
            <p class="text-[11px] text-gray-400">${escapeHtml(whenText)}</p>
            <p class="text-[13px] font-semibold text-gray-900 mt-0.5">${escapeHtml(label)} · ${escapeHtml(log.target_collection)}</p>
            ${log.reason ? `<p class="text-[12px] text-gray-500 mt-0.5">Reason: ${escapeHtml(log.reason)}</p>` : ''}
        </li>
    `;
}

// ── Phase 2: action delegation handler ────────────────────────────────

function handlePhase2Action(dataset) {
    const action = dataset.actionType;
    if (!action) return;
    if (!state.usage?.budget) return;
    if (!window.FluxyBudgetAssignment?.open) {
        window.showToast?.('Assignment drawer is still loading. Please try again.', 'error');
        return;
    }
    window.FluxyBudgetAssignment.open({
        action,
        recordType: dataset.recordType,
        recordId: dataset.recordId,
        vendor: dataset.vendor,
        amountText: dataset.amountText,
        currentAllocationId: dataset.currentAllocationId || null,
        budgetId: state.usage.budget.id,
        allocations: state.usage.allocations || [],
        onDone: async () => {
            // Reload the usage + dependent sections so totals reflect the change.
            await loadAndRender();
            // If the detail drawer is open, refresh it too.
            if (state.activeAllocationId) {
                const alloc = state.usage?.allocations?.find(a => a.id === state.activeAllocationId);
                if (alloc) openAllocationDetail(state.activeAllocationId);
            }
        }
    });
}
