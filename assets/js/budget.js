// Budget page controller — Phase 1 + 1.5 + Phase B wizard
// Owns rendering of the active operating budget, allocation usage,
// and the Create / Edit / Duplicate Budget wizard.

const ALLOCATION_CATEGORIES = ['Marketing', 'Infrastructure', 'Operations', 'SaaS'];
const DEFAULT_ALLOCATION_ROWS = ALLOCATION_CATEGORIES.map(cat => ({ name: cat, category: cat, amount: 0 }));
const WIZARD_STEPS = [
    { id: 1, label: 'Plan' },
    { id: 2, label: 'Sizing' },
    { id: 3, label: 'Categories' },
    { id: 4, label: 'Review' }
];

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
    annualBudgets: [],
    periodBudgets: [],
    annualEnvelope: null,
    selectedAnnualId: null,
    selectedBudgetId: null,
    selectedTarget: null,
    wizardOpen: false,
    activeAllocationId: null  // Phase 2: id of allocation currently shown in the detail drawer
};

let budgetWizardState = createBudgetWizardState();

function createBudgetWizardState(overrides = {}) {
    return {
        mode: 'create', // create | edit | duplicate
        step: 1,
        budgetId: null,
        budgetType: 'annual', // annual | period
        periodType: 'yearly', // yearly | monthly | quarterly | custom
        parentBudgetId: null,
        name: '',
        periodLabel: '',
        periodStart: null,
        periodEnd: null,
        totalBudget: 0,
        currency: 'IDR',
        notes: '',
        template: 'functional', // functional | blank | gl_based_disabled
        allocations: [],
        sourceBudgetId: null,
        datePicker: null,
        saving: false,
        loadingSource: false,
        ...overrides
    };
}

function getDayKey(date = new Date()) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
function getMonthStartKey(date = new Date()) { return getDayKey(new Date(date.getFullYear(), date.getMonth(), 1)); }
function getMonthEndKey(date = new Date()) { return getDayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0)); }
function getQuarterStartKey(year, quarter) {
    return getDayKey(new Date(year, (quarter - 1) * 3, 1));
}
function getQuarterEndKey(year, quarter) {
    return getDayKey(new Date(year, quarter * 3, 0));
}

function formatRp(amount) {
    const val = Number(amount) || 0;
    return 'Rp' + Math.abs(val).toLocaleString('id-ID');
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
    const params = new URLSearchParams(window.location.search);
    const initialBudgetId = params.get('budgetId');
    if (initialBudgetId) state.selectedBudgetId = initialBudgetId;
    wireDrawerControls();
    const shouldOpenWizard = params.get('create') === '1';
    loadAndRender().then(() => {
        if (!shouldOpenWizard) return;
        // Strip the param so a refresh doesn't reopen the wizard.
        params.delete('create');
        const query = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''));
        if (state.usage?.budget) openBudgetWizard('edit');
        else openBudgetWizard('create', { budgetType: 'annual' });
    });
}

async function loadAndRender() {
    el('budget-loading').classList.remove('hidden');
    el('budget-empty-state').classList.add('hidden');
    el('budget-content').classList.add('hidden');
    el('budget-page-title')?.classList.add('hidden');

    try {
        const [annualBudgets, periodBudgets] = await Promise.all([
            state.ds.getAnnualBudgets?.(state.user.uid) || [],
            state.ds.getPeriodBudgets?.(state.user.uid) || []
        ]);
        state.annualBudgets = annualBudgets || [];
        state.periodBudgets = periodBudgets || [];
        if (!state.selectedAnnualId && state.annualBudgets.length) {
            state.selectedAnnualId = state.annualBudgets[0].id;
        }
        if (!state.selectedBudgetId && !state.selectedTarget && state.periodBudgets.length) {
            state.selectedBudgetId = state.periodBudgets[0].id;
        }
        if (!state.selectedBudgetId && !state.selectedTarget && state.selectedAnnualId) {
            state.selectedBudgetId = state.selectedAnnualId;
        }

        if (state.selectedAnnualId) {
            state.annualEnvelope = await state.ds.calculateAnnualEnvelope?.(state.user.uid, state.selectedAnnualId);
        } else {
            state.annualEnvelope = null;
        }

        if (state.selectedTarget && !state.selectedBudgetId) {
            state.usage = null;
            renderNoPeriodState();
            return;
        }

        if (!state.selectedBudgetId) {
            renderEmpty();
            return;
        }
        const usage = await state.ds.getBudgetUsage(state.user.uid, state.selectedBudgetId);
        state.usage = usage;
        renderBudget(usage);
    } catch (err) {
        console.error('Budget load failed:', err);
        window.showToast?.('Could not load your budget. Refresh and try again.', 'error');
        renderEmpty();
    }
}

function selectExistingBudget(budgetId) {
    state.selectedBudgetId = budgetId || null;
    state.selectedTarget = null;
    loadAndRender();
}

function selectTargetPeriod(target) {
    const existing = findBudgetForTarget(target);
    if (existing) {
        state.selectedBudgetId = existing.id;
        state.selectedTarget = null;
    } else {
        state.selectedBudgetId = null;
        state.selectedTarget = target;
    }
    loadAndRender();
}

// ── Empty state ───────────────────────────────────────────────────────

function renderEmpty() {
    state.usage = null;
    el('budget-loading').classList.add('hidden');
    el('budget-empty-state').classList.add('hidden');
    el('budget-content').classList.remove('hidden');
    el('budget-page-title')?.classList.add('hidden');
    el('budget-primary-workspace')?.classList.remove('hidden');
    el('budget-no-period-state')?.classList.add('hidden');
    el('budget-create-btn-label').textContent = 'Create Budget';

    // Workspace header — structure with no budget yet, so a new user sees the
    // real page (and the onboarding tour can spotlight it) instead of a blank card.
    renderWorkspaceShell(null, []);
    el('budget-name').textContent = 'Start your first budget';
    el('budget-period').textContent = 'No period set';
    el('budget-workspace-allocation-count').textContent = 'No budget yet';
    el('budget-status-pill')?.classList.add('hidden');
    const periodTypeWrap = el('budget-period-type-wrap');
    if (periodTypeWrap) periodTypeWrap.style.display = 'none';
    const updatedWrap = el('budget-workspace-updated-wrap');
    if (updatedWrap) updatedWrap.style.display = 'none';

    renderAnnualEnvelope();
    renderPeriodSelector();

    // KPI strip at zero with guidance hints.
    el('budget-total').textContent = formatRp(0);
    el('budget-total-hint').textContent = 'Set a main budget to define your spending envelope.';
    el('budget-allocated').textContent = formatRp(0);
    el('budget-allocated-hint').textContent = 'Set a main budget to start allocating.';
    el('budget-spent').textContent = formatRp(0);
    el('budget-spent-hint').textContent = 'No actual or committed spend yet.';
    el('budget-remaining').textContent = formatRp(0);
    el('budget-remaining').className = 'metric-value truncate';
    el('budget-remaining-hint').textContent = 'Budget left after spent and reserved.';
    const remainingTextEl = el('budget-remaining-text');
    remainingTextEl.textContent = ' of main budget used';
    remainingTextEl.className = '';
    el('budget-unassigned').textContent = formatRp(0);
    el('budget-unassigned-hint').textContent = 'Set a main budget to build a baseline.';

    const usageEl = el('budget-usage-percent');
    usageEl.textContent = formatPercent(0);
    usageEl.className = 'font-mono font-bold text-gray-700';
    const usageBar = el('budget-usage-bar');
    usageBar.style.width = '0%';
    usageBar.className = 'h-full rounded-full bg-emerald-500 transition-all';

    el('budget-unassigned-card').className = 'budget-metric-cell border-t sm:border-t-0 xl:border-t-0 border-gray-200 transition-colors bg-white';

    // Allocation map + sub-budgets in their own empty states.
    renderAllocationMap([], { total_amount: 0, total_allocated: 0, unallocated_budget_amount: 0 });
    el('budget-unassigned-callout')?.classList.add('hidden');
    el('budget-all-assigned-note')?.classList.add('hidden');
    renderAllocationsTable([]);
    el('budget-excluded-card')?.classList.add('hidden');
}

function makeMonthlyTarget(monthValue) {
    const value = monthValue || getDayKey(new Date()).slice(0, 7);
    const [year, month] = value.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    return {
        period_type: 'monthly',
        period_start: getDayKey(start),
        period_end: getDayKey(end),
        period_label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    };
}

function makeQuarterTarget(year, quarter) {
    const q = Number(quarter) || 1;
    const y = Number(year) || new Date().getFullYear();
    return {
        period_type: 'quarterly',
        period_start: getQuarterStartKey(y, q),
        period_end: getQuarterEndKey(y, q),
        period_label: `Q${q} ${y}`
    };
}

function targetKey(target) {
    if (!target) return '';
    return `${target.period_type}|${target.period_start}|${target.period_end}`;
}

function budgetKey(budget) {
    const start = budget.period_start?.toDate?.() || null;
    const end = budget.period_end?.toDate?.() || null;
    if (!start || !end) return '';
    return `${budget.period_type}|${getDayKey(start)}|${getDayKey(end)}`;
}

function findBudgetForTarget(target) {
    const key = targetKey(target);
    return (state.periodBudgets || []).find(b => budgetKey(b) === key) || null;
}

function renderNoPeriodState() {
    el('budget-loading').classList.add('hidden');
    el('budget-empty-state').classList.add('hidden');
    el('budget-content').classList.remove('hidden');
    el('budget-page-title')?.classList.add('hidden');
    el('budget-primary-workspace')?.classList.add('hidden');
    el('budget-no-period-state')?.classList.remove('hidden');
    el('budget-create-btn-label').textContent = 'Create Budget';
    renderWorkspaceShell(null, []);
    renderAnnualEnvelope();
    renderPeriodSelector();
    const label = state.selectedTarget?.period_label || 'this period';
    el('budget-name').textContent = label;
    el('budget-period').textContent = state.selectedTarget
        ? `${state.selectedTarget.period_start} - ${state.selectedTarget.period_end}`
        : '—';
    el('budget-workspace-allocation-count').textContent = 'No budget';
    el('budget-period-type').textContent = formatPeriodType(state.selectedTarget?.period_type);
    el('budget-no-period-title').textContent = `No budget set for ${label}`;
    el('budget-no-period-copy').textContent = 'Create a new operating budget or duplicate a previous period’s allocation structure.';
}

// ── Loaded state ──────────────────────────────────────────────────────

function renderBudget(usage) {
    el('budget-loading').classList.add('hidden');
    el('budget-empty-state').classList.add('hidden');
    el('budget-content').classList.remove('hidden');
    el('budget-page-title')?.classList.add('hidden');
    el('budget-primary-workspace')?.classList.remove('hidden');
    el('budget-no-period-state')?.classList.add('hidden');
    el('budget-create-btn-label').textContent = 'Edit Budget';

    const { budget, allocations, summary, unallocated } = usage;

    renderWorkspaceHeader(budget, allocations);
    renderAnnualEnvelope();
    renderPeriodSelector();

    // ── KPI strip ───────────────────────────────────────────────────
    // These mappings intentionally mirror DataService.getBudgetUsage().
    // Do not recalculate actual/committed/remaining with separate rules here.
    const total = Number(summary.total_amount) || 0;
    const allocated = Number(summary.total_allocated) || 0;
    const unassigned = Number(summary.unallocated_budget_amount) || 0;
    const spentReserved = (Number(summary.total_actual_used) || 0) + (Number(summary.total_committed) || 0);
    const remaining = Number(summary.total_remaining) || 0;
    const eoyForecast = total;
    const coveragePercent = total > 0 ? (allocated / total) * 100 : 0;
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
    remainingEl.className = `metric-value truncate${remaining < 0 ? ' is-negative' : ''}`;
    el('budget-remaining-hint').textContent = remaining < 0
        ? `${formatRp(remaining)} over budget after spent and reserved.`
        : 'Budget left after spent and reserved.';
    const remainingTextEl = el('budget-remaining-text');
    remainingTextEl.textContent = remaining < 0
        ? ` of main budget used · ${formatRp(remaining)} over`
        : ' of main budget used';
    remainingTextEl.className = remaining < 0 ? 'text-red-600' : '';

    el('budget-unassigned').textContent = formatRp(eoyForecast);
    el('budget-unassigned-hint').textContent = total > 0
        ? 'Current plan baseline.'
        : 'Set a main budget to build a baseline.';

    const forecastCard = el('budget-unassigned-card');
    forecastCard.className = 'budget-metric-cell border-t sm:border-t-0 xl:border-t-0 border-gray-200 transition-colors bg-white';

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

function renderWorkspaceShell(budget, allocations) {
    renderWorkspaceHeader(budget || {}, allocations || []);
}

function classifyStatus(percent) {
    const p = Number.isFinite(percent) ? percent : 0;
    if (p >= 100) return 'exceeded';
    if (p >= 85) return 'at_risk';
    if (p >= 70) return 'watch';
    return 'healthy';
}

function formatPeriodType(value) {
    const map = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly', custom: 'Custom' };
    return map[value] || 'Monthly';
}

function formatPeriod(budget) {
    const start = budget.period_start?.toDate?.();
    const end = budget.period_end?.toDate?.();
    if (!start || !end) return '—';
    const fmt = { day: 'numeric', month: 'short', year: 'numeric' };
    return `${start.toLocaleDateString('id-ID', fmt)} – ${end.toLocaleDateString('id-ID', fmt)}`;
}

function derivePeriodLabel(periodType, start, end) {
    if (periodType === 'monthly') {
        return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    if (periodType === 'quarterly') {
        return `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`;
    }
    if (periodType === 'yearly') return `FY${start.getFullYear()}`;
    const fmt = { day: 'numeric', month: 'short', year: 'numeric' };
    return `${start.toLocaleDateString('en-US', fmt)} - ${end.toLocaleDateString('en-US', fmt)}`;
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
    el('budget-status-pill')?.classList.remove('hidden');
    const period = formatPeriod(budget);
    const allocationCount = allocations.length;
    const allocationText = `${allocationCount} allocation${allocationCount === 1 ? '' : 's'}`;
    const updatedText = formatUpdatedAt(budget);

    el('budget-name').textContent = budget.name || 'Operating Budget';
    el('budget-period').textContent = period;
    el('budget-period-type').textContent = formatPeriodType(budget.period_type);
    el('budget-workspace-allocation-count').textContent = allocationText;

    const updatedEl = el('budget-workspace-updated');
    updatedEl.textContent = updatedText || '—';
    const updatedWrap = el('budget-workspace-updated-wrap');
    if (updatedWrap) updatedWrap.style.display = updatedText ? '' : 'none';
    const periodTypeWrap = el('budget-period-type-wrap');
    if (periodTypeWrap) periodTypeWrap.style.display = budget.period_type ? '' : 'none';
}

function renderAnnualEnvelope() {
    const select = el('budget-annual-select');
    const metrics = el('budget-annual-metrics');
    if (!select || !metrics) return;

    if (!state.annualBudgets.length) {
        select.classList.add('hidden');
        el('budget-annual-title').textContent = 'No annual budget set yet.';
        el('budget-annual-subtitle').textContent = 'You can still manage monthly or quarterly budgets.';
        metrics.innerHTML = '';
        return;
    }

    select.classList.remove('hidden');
    select.innerHTML = state.annualBudgets.map(b => `
        <option value="${escapeHtml(b.id)}" ${b.id === state.selectedAnnualId ? 'selected' : ''}>${escapeHtml(b.period_label || b.name || 'Annual budget')}</option>
    `).join('');

    const envelope = state.annualEnvelope;
    const annual = envelope?.annual_budget || state.annualBudgets.find(b => b.id === state.selectedAnnualId);
    el('budget-annual-title').textContent = annual?.name || annual?.period_label || 'Annual Budget';
    el('budget-annual-subtitle').textContent = formatPeriod(annual || {});
    const yearly = Number(envelope?.yearly_budget) || 0;
    const planned = Number(envelope?.planned_periods) || 0;
    const open = Number(envelope?.unplanned_capacity) || 0;
    const spent = Number(envelope?.spent_reserved_ytd) || 0;
    const plannedPercent = yearly > 0 ? Math.max(0, Math.min(100, (planned / yearly) * 100)) : 0;
    metrics.innerHTML = `
        <div class="flex flex-col gap-0.5 text-[12px] sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
            <span class="inline-flex items-center gap-1.5 font-semibold text-gray-600">
                Planned into periods
                <button type="button" class="metric-info" aria-label="Planned into periods: total of all period budgets created under this annual envelope." data-tooltip="The total of every monthly or quarterly budget you've created under this annual envelope — how much of the yearly budget already has a period plan.">?</button>
            </span>
            <span class="font-mono font-bold text-gray-900 whitespace-nowrap">${formatRp(planned)} <span class="font-semibold text-gray-400">of ${formatRp(yearly)}</span></span>
        </div>
        <div class="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div class="h-full rounded-full bg-gray-800 transition-all" style="width: ${plannedPercent}%"></div>
        </div>
        <div class="mt-2 flex flex-col gap-1 text-[12px] text-gray-500 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
            <span class="inline-flex items-center gap-1.5">
                <span class="font-mono font-bold ${open < 0 ? 'text-red-600' : 'text-gray-700'}">${formatRp(open)}</span> still open to plan
                <button type="button" class="metric-info" aria-label="Still open to plan: yearly budget minus what is planned into periods." data-tooltip="Yearly budget minus what's already planned into periods — how much of the year you can still carve into new monthly or quarterly budgets. Negative means your period budgets exceed the annual envelope.">?</button>
            </span>
            <span class="hidden text-gray-300 sm:inline">·</span>
            <span class="inline-flex items-center gap-1.5">
                <span class="font-mono font-bold text-gray-700">${formatRp(spent)}</span> spent or reserved this year
                <button type="button" class="metric-info" aria-label="Spent or reserved this year: actual spend plus unpaid committed bills year-to-date." data-tooltip="Money already spent (recorded transactions) plus money reserved by unpaid bills and pending payables, totalled across this year up to today.">?</button>
            </span>
        </div>
    `;
}

function renderPeriodSelector() {
    const select = el('budget-period-select');
    if (!select) return;
    if (!state.periodBudgets.length) {
        select.innerHTML = `<option value="">No period budgets yet</option>`;
        select.disabled = true;
    } else {
        select.disabled = false;
        select.innerHTML = state.periodBudgets.map(b => `
            <option value="${escapeHtml(b.id)}" ${b.id === state.selectedBudgetId ? 'selected' : ''}>${escapeHtml(b.period_label || b.name || 'Period budget')} · ${escapeHtml(formatPeriodType(b.period_type))}</option>
        `).join('');
    }
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
        const actionAttrs = seg.unassigned
            ? ''
            : ` data-action="open-allocation-drill-in" data-allocation-id="${escapeHtml(seg.id)}"`;
        const cursor = seg.unassigned ? '' : ' cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#EA580C] focus:ring-offset-1';
        return `
            <button type="button" class="group relative flex h-full items-center overflow-hidden border-0 px-2 transition-opacity hover:opacity-90 ${textColor}${cursor}"
                style="flex: 0 0 ${safePct}%; background: ${seg.color};"
                ${actionAttrs}
                role="img"
                aria-label="${escapeHtml(seg.label)} ${escapeHtml(formatPercent(seg.percent))} of main budget">
                <span class="truncate text-[11px] font-bold">${label}</span>
            </button>
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
        body.innerHTML = `<tr><td colspan="6" class="fluxy-table-loading-cell">No allocations yet. Edit this budget to add Marketing, Infrastructure, Operations, or SaaS allocations.</td></tr>`;
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
        // Variance line goes inside the inner text block so it indents under
        // the name + category instead of running flush-left below the swatch.
        return `
            <tr class="fluxy-table-row fluxy-table-row-clickable align-top" data-allocation-id="${escapeHtml(alloc.id)}" data-action="open-allocation-drill-in">
                <td class="fluxy-table-cell">
                    <div class="flex items-start gap-3">
                        <span class="mt-1.5 h-2.5 w-2.5 rounded-sm flex-shrink-0" style="background: ${allocationColor(index)};"></span>
                        <div class="min-w-0">
                            <p class="fluxy-table-cell-primary truncate">${escapeHtml(alloc.name)}</p>
                            <p class="fluxy-table-cell-meta mt-0.5 truncate">${escapeHtml(scope || '—')}</p>
                            ${variance ? `<p class="fluxy-table-cell-meta mt-1 leading-snug">${variance}</p>` : ''}
                        </div>
                    </div>
                </td>
                <td class="fluxy-table-cell fluxy-table-money text-gray-900">${formatRp(alloc.allocated_amount)}</td>
                <td class="fluxy-table-cell fluxy-table-money text-gray-700">${formatRp(spentReserved)}</td>
                <td class="fluxy-table-cell fluxy-table-money ${remainingCls}">${formatRp(alloc.remaining_amount)}</td>
                <td class="fluxy-table-cell">
                    <div class="flex items-center gap-2">
                        <span class="font-mono text-[12px] font-bold text-gray-700 whitespace-nowrap">${formatPercent(alloc.usage_percent)}</span>
                        <div class="hidden sm:block w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden flex-shrink-0">
                            <div class="h-full ${barCls} rounded-full" style="width: ${usagePercent}%"></div>
                        </div>
                    </div>
                </td>
                <td class="fluxy-table-cell">
                    <span class="fluxy-table-status ${status.cls}">${status.label}</span>
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
        <button type="button" class="w-full text-left px-5 py-4 hover:bg-gray-50 transition-colors" data-allocation-id="${escapeHtml(alloc.id)}" data-action="open-allocation-drill-in">
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <div class="flex items-center gap-2">
                        <span class="h-2.5 w-2.5 rounded-sm flex-shrink-0" style="background: ${allocationColor(index)};"></span>
                        <p class="font-semibold text-[13px] text-gray-900 truncate">${escapeHtml(alloc.name)}</p>
                    </div>
                    <p class="mt-1 text-[11px] text-gray-400 truncate">${escapeHtml(scope || '—')}</p>
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
                allocationId: alloc.id,
                title: `${alloc.name} exceeded allocation`,
                body: `${formatRp(Math.max(0, used - alloc.allocated_amount))} over allocation at ${formatPercent(alloc.usage_percent)} usage.`
            });
        } else if (alloc.usage_percent >= 85) {
            alerts.push({
                tone: 'warning',
                allocationId: alloc.id,
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

    // The Variance attention card was removed; the bell in the topbar now
    // surfaces the same alerts under its Variance attention tab. Guard the
    // DOM write so renderBudget() callers don't have to change.
    const list = el('budget-attention-list');
    if (!list) return;
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
        <li class="px-5 py-4 ${alert.allocationId ? 'cursor-pointer hover:bg-gray-50 transition-colors' : ''}" ${alert.allocationId ? `data-action="open-allocation-drill-in" data-allocation-id="${escapeHtml(alert.allocationId)}"` : ''}>
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

function openAllocationDrillIn(allocationId) {
    const budgetId = state.usage?.budget?.id || state.selectedBudgetId;
    if (!allocationId || !budgetId) return;
    const params = new URLSearchParams({ budgetId, allocationId });
    window.location.href = `budget-allocation.html?${params.toString()}`;
}

function renderUnallocatedCard(unallocated) {
    // Unallocated spend summary card was removed from budget.html; the same
    // signal is surfaced via the orange Unassigned KPI card and the per-row
    // chips on /ledger and /bill. Keeping the function as a guarded no-op so
    // renderBudget() callers don't have to change.
    void unallocated;
}

// ── Budget wizard controls ───────────────────────────────────────────

function wireDrawerControls() {
    el('budget-create-btn').addEventListener('click', () => {
        if (state.usage?.budget) openBudgetWizard('edit');
        else openBudgetWizard('create', { budgetType: 'annual' });
    });
    el('budget-create-period-btn')?.addEventListener('click', () => openBudgetWizard('create', { budgetType: 'period' }));
    el('budget-no-period-create')?.addEventListener('click', () => openBudgetWizard('create', { budgetType: 'period' }));
    el('budget-period-select')?.addEventListener('change', (e) => selectExistingBudget(e.target.value));
    el('budget-annual-select')?.addEventListener('change', async (e) => {
        state.selectedAnnualId = e.target.value || null;
        await loadAndRender();
    });
    el('budget-duplicate-btn')?.addEventListener('click', () => openBudgetWizard('duplicate'));
    el('budget-no-period-duplicate')?.addEventListener('click', () => openBudgetWizard('duplicate'));
    el('budget-refresh-btn')?.addEventListener('click', handleBudgetRefresh);
    el('budget-export-btn')?.addEventListener('click', handleBudgetExport);
    // The Assign Remaining Budget CTA lives inside the unassigned callout;
    // it's always in the DOM (hidden until needed) so we can wire it once.
    // Reuses the Edit Budget flow — opening the wizard prefills allocation
    // rows and shows the remaining-unallocated amount inline.
    el('budget-assign-remaining-btn')?.addEventListener('click', () => openBudgetWizard('edit'));
    el('budget-wizard-close')?.addEventListener('click', closeBudgetWizard);
    el('budget-wizard-backdrop')?.addEventListener('click', closeBudgetWizard);
    el('budget-wizard-back')?.addEventListener('click', () => {
        if (budgetWizardState.step > 1 && !budgetWizardState.saving) {
            budgetWizardState.step -= 1;
            renderBudgetWizard();
        }
    });
    el('budget-wizard-form')?.addEventListener('submit', handleBudgetWizardSubmit);

    // Phase 2: allocation detail drawer + collapsible sections + queue actions.
    el('budget-detail-close-btn')?.addEventListener('click', closeDetailDrawer);
    el('budget-detail-close-footer')?.addEventListener('click', closeDetailDrawer);
    el('budget-detail-backdrop')?.addEventListener('click', closeDetailDrawer);
    el('budget-excluded-toggle')?.addEventListener('click', () => toggleCollapsible('budget-excluded-body', 'budget-excluded-caret'));
    el('budget-activity-toggle')?.addEventListener('click', () => toggleCollapsible('budget-activity-body', 'budget-activity-caret'));

    document.addEventListener('click', (e) => {
        const allocRow = e.target.closest('[data-action="open-allocation-drill-in"]');
        if (allocRow) {
            e.preventDefault();
            openAllocationDrillIn(allocRow.dataset.allocationId);
            return;
        }
        const queueAct = e.target.closest('[data-phase2-action]');
        if (queueAct) {
            e.preventDefault();
            e.stopPropagation();
            handlePhase2Action(queueAct.dataset);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && state.wizardOpen) closeBudgetWizard();
    });
}

async function handleBudgetRefresh() {
    const btn = el('budget-refresh-btn');
    if (btn) {
        btn.disabled = true;
        btn.classList.add('opacity-70');
    }
    try {
        await loadAndRender();
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('opacity-70');
        }
    }
}

function handleBudgetExport() {
    if (!state.usage) {
        window.showToast?.('No budget data to export yet.', 'error');
        return;
    }

    const { budget, allocations, summary } = state.usage;
    const spentReserved = (Number(summary.total_actual_used) || 0) + (Number(summary.total_committed) || 0);
    const rows = [
        ['Budget', budget.name || 'Operating Budget'],
        ['Period', formatPeriod(budget)],
        [],
        ['Metric', 'Amount'],
        ['Main Budget', Number(summary.total_amount) || 0],
        ['Allocated', Number(summary.total_allocated) || 0],
        ['Spent + Reserved', spentReserved],
        ['Remaining', Number(summary.total_remaining) || 0],
        ['EOY Forecast', Number(summary.total_amount) || 0],
        [],
        ['Allocation', 'Allocated', 'Spent + Reserved', 'Remaining', 'Usage %', 'Status'],
        ...(allocations || []).map(alloc => [
            alloc.name || 'Allocation',
            Number(alloc.allocated_amount) || 0,
            (Number(alloc.actual_used) || 0) + (Number(alloc.committed_amount) || 0),
            Number(alloc.remaining_amount) || 0,
            Number(alloc.usage_percent) || 0,
            (STATUS_BADGE[alloc.status] || STATUS_BADGE.healthy).label
        ])
    ];
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\n');
    const date = new Date().toISOString().slice(0, 10);
    const name = String(budget.name || 'budget').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'budget';
    downloadTextFile(`fluxyos-${name}-${date}.csv`, csv);
}

function csvCell(value) {
    if (value == null) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadTextFile(filename, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

function pickNextCategory() {
    const used = new Set(budgetWizardState.allocations.map(r => r.category));
    return ALLOCATION_CATEGORIES.find(c => !used.has(c)) || 'Operations';
}

function formatRpInput(value) {
    const n = Math.round(Math.max(0, Number(value) || 0));
    if (!n) return '';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function parseRp(value) {
    if (value == null) return 0;
    const cleaned = String(value).replace(/\D/g, '');
    return cleaned ? parseInt(cleaned, 10) : 0;
}

function parsePercent(value) {
    const normalized = String(value || '').replace(',', '.').replace(/[^\d.]/g, '');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function parsePeriodDate(dayKey, endOfDay = false) {
    if (typeof dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return new Date();
    const [year, month, day] = dayKey.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    if (endOfDay) d.setHours(23, 59, 59, 999);
    else d.setHours(0, 0, 0, 0);
    return d;
}

function wizardMonthValue() {
    const start = budgetWizardState.periodStart || getMonthStartKey();
    return start.slice(0, 7);
}

function wizardQuarterValue() {
    const start = parsePeriodDate(budgetWizardState.periodStart || getQuarterStartKey(new Date().getFullYear(), 1));
    return String(Math.floor(start.getMonth() / 3) + 1);
}

function wizardQuarterYearValue() {
    const start = parsePeriodDate(budgetWizardState.periodStart || getQuarterStartKey(new Date().getFullYear(), 1));
    return String(start.getFullYear());
}

function getWizardAllocatedTotal() {
    return budgetWizardState.allocations.reduce((sum, row) => sum + Math.max(0, Math.round(Number(row.amount) || 0)), 0);
}

function getWizardRemainingTotal() {
    return Math.max(0, budgetWizardState.totalBudget - getWizardAllocatedTotal());
}

function allocationPercent(amount) {
    const total = Math.max(0, Number(budgetWizardState.totalBudget) || 0);
    if (total <= 0) return 0;
    const pct = (Math.max(0, Number(amount) || 0) / total) * 100;
    return Number.isFinite(pct) ? pct : 0;
}

function formatAllocationPercent(amount) {
    const pct = allocationPercent(amount);
    if (pct >= 100) return pct.toFixed(0);
    return pct.toFixed(pct >= 10 ? 1 : 2).replace(/\.0+$/, '');
}

function normalizeWizardAllocation(row = {}) {
    const category = ALLOCATION_CATEGORIES.includes(row.category) ? row.category : (ALLOCATION_CATEGORIES.includes(row.scope_values?.[0]) ? row.scope_values[0] : 'Operations');
    return {
        id: row.id || null,
        name: String(row.name || category || '').slice(0, 120),
        category,
        amount: Math.round(Math.max(0, Number(row.amount ?? row.allocated_amount) || 0)),
        sourceAllocationId: row.sourceAllocationId || row.created_from_allocation_id || row.id || null
    };
}

function buildFunctionalAllocations(totalBudget = budgetWizardState.totalBudget) {
    const total = Math.round(Math.max(0, Number(totalBudget) || 0));
    if (total <= 0) return DEFAULT_ALLOCATION_ROWS.map(row => ({ ...row }));
    const base = Math.floor(total / ALLOCATION_CATEGORIES.length);
    let used = 0;
    return ALLOCATION_CATEGORIES.map((cat, index) => {
        const amount = index === ALLOCATION_CATEGORIES.length - 1 ? total - used : base;
        used += amount;
        return { name: cat, category: cat, amount, sourceAllocationId: null };
    });
}

function ensureFunctionalAllocations() {
    if (budgetWizardState.template !== 'functional') return;
    if (budgetWizardState.allocations.length > 0) return;
    budgetWizardState.allocations = buildFunctionalAllocations();
}

function getAllocationSegments() {
    const total = Math.max(0, Number(budgetWizardState.totalBudget) || 0);
    if (total <= 0) return [];
    const segments = budgetWizardState.allocations
        .filter(row => Math.max(0, Number(row.amount) || 0) > 0)
        .map((row, index) => ({
            label: row.name || row.category || 'Allocation',
            amount: Number(row.amount) || 0,
            percent: allocationPercent(row.amount),
            color: allocationColor(index)
        }));
    const remaining = getWizardRemainingTotal();
    if (remaining > 0) {
        segments.push({
            label: 'Unallocated',
            amount: remaining,
            percent: allocationPercent(remaining),
            color: '#E5E7EB',
            unallocated: true
        });
    }
    return segments;
}

function allocationPreviewHtml({ compact = false } = {}) {
    const segments = getAllocationSegments();
    if (!segments.length) {
        return `<div class="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center text-[12px] text-gray-500">No allocation preview yet.</div>`;
    }
    return `
        <div class="flex h-${compact ? '5' : '6'} w-full overflow-hidden rounded-lg bg-gray-100 ring-1 ring-gray-200">
            ${segments.map(seg => {
                const label = seg.percent >= 12 ? escapeHtml(seg.label) : '';
                return `
                    <div class="flex min-w-[3px] items-center overflow-hidden px-2 ${seg.unallocated ? 'text-gray-500' : 'text-white'}"
                        style="flex:0 0 ${Math.max(0, seg.percent)}%; background:${seg.color};"
                        title="${escapeHtml(seg.label)} ${formatRp(seg.amount)}">
                        <span class="truncate text-[11px] font-bold">${label}</span>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

async function openBudgetWizard(mode = 'create', options = {}) {
    destroyWizardDatePicker();
    budgetWizardState = createBudgetWizardState({ mode });
    state.wizardOpen = true;
    el('budget-wizard-backdrop')?.classList.remove('hidden');
    el('budget-wizard-shell')?.classList.remove('hidden');
    el('budget-wizard-shell')?.classList.add('flex');
    document.body.classList.add('overflow-hidden');

    if (mode === 'edit' && state.usage?.budget) {
        prefillWizardFromBudget(state.usage.budget, state.usage.allocations || []);
    } else if (mode === 'duplicate') {
        await prefillDuplicateWizard(options.sourceBudgetId);
    } else {
        prefillCreateWizard(options);
    }
    renderBudgetWizard();
}

function closeBudgetWizard() {
    if (budgetWizardState.saving) return;
    destroyWizardDatePicker();
    state.wizardOpen = false;
    el('budget-wizard-shell')?.classList.add('hidden');
    el('budget-wizard-shell')?.classList.remove('flex');
    el('budget-wizard-backdrop')?.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    el('budget-wizard-error')?.classList.add('hidden');
}

function destroyWizardDatePicker() {
    if (budgetWizardState.datePicker?.destroy) budgetWizardState.datePicker.destroy();
    budgetWizardState.datePicker = null;
}

function getDefaultAnnualTarget(date = new Date()) {
    const year = date.getFullYear();
    return {
        period_type: 'yearly',
        period_start: `${year}-01-01`,
        period_end: `${year}-12-31`,
        period_label: `FY${year}`
    };
}

function prefillCreateWizard(options = {}) {
    const forcedType = options.budgetType;
    const target = state.selectedTarget;
    const budgetType = forcedType || (target ? 'period' : (!state.annualBudgets.length ? 'annual' : 'period'));
    const periodTarget = budgetType === 'annual'
        ? getDefaultAnnualTarget()
        : (target || makeMonthlyTarget());
    budgetWizardState = {
        ...budgetWizardState,
        budgetType,
        periodType: budgetType === 'annual' ? 'yearly' : periodTarget.period_type,
        parentBudgetId: budgetType === 'annual' ? null : (state.selectedAnnualId || null),
        name: `${periodTarget.period_label} Operating Budget`,
        periodLabel: periodTarget.period_label,
        periodStart: periodTarget.period_start,
        periodEnd: periodTarget.period_end,
        totalBudget: 0,
        notes: '',
        template: 'functional',
        allocations: []
    };
}

function prefillWizardFromBudget(budget, allocations = []) {
    const start = budget.period_start?.toDate?.() || new Date();
    const end = budget.period_end?.toDate?.() || start;
    const budgetType = budget.budget_type === 'annual' || budget.period_type === 'yearly' ? 'annual' : 'period';
    budgetWizardState = {
        ...budgetWizardState,
        budgetId: budget.id,
        budgetType,
        periodType: budgetType === 'annual' ? 'yearly' : (budget.period_type || 'monthly'),
        parentBudgetId: budget.parent_budget_id || null,
        name: budget.name || '',
        periodLabel: budget.period_label || derivePeriodLabel(budget.period_type || 'monthly', start, end),
        periodStart: getDayKey(start),
        periodEnd: getDayKey(end),
        totalBudget: Math.round(Math.max(0, Number(budget.total_budget) || 0)),
        notes: budget.notes || '',
        template: allocations.length ? 'functional' : 'blank',
        allocations: allocations.map(a => normalizeWizardAllocation({
            id: a.id,
            name: a.name,
            category: (a.scope_values && a.scope_values[0]) || 'Operations',
            allocated_amount: a.allocated_amount,
            created_from_allocation_id: a.created_from_allocation_id || null
        }))
    };
}

async function prefillDuplicateWizard(sourceBudgetId = null) {
    const selectedPeriodId = (state.periodBudgets || []).find(b => b.id === state.selectedBudgetId)?.id || null;
    const sourceId = sourceBudgetId || selectedPeriodId || state.periodBudgets?.[0]?.id || null;
    const target = state.selectedTarget || makeMonthlyTarget();
    budgetWizardState = {
        ...budgetWizardState,
        budgetType: 'period',
        periodType: target.period_type,
        parentBudgetId: state.selectedAnnualId || null,
        periodLabel: target.period_label,
        periodStart: target.period_start,
        periodEnd: target.period_end,
        name: `${target.period_label} Operating Budget`,
        template: 'functional',
        sourceBudgetId: sourceId
    };
    if (sourceId) await loadDuplicateSourceBudget(sourceId);
}

async function loadDuplicateSourceBudget(sourceBudgetId) {
    budgetWizardState.loadingSource = true;
    renderBudgetWizard();
    try {
        const [sourceBudget, sourceAllocations] = await Promise.all([
            state.ds.getBudget(state.user.uid, sourceBudgetId),
            state.ds.getBudgetAllocations(state.user.uid, sourceBudgetId)
        ]);
        if (!sourceBudget) throw new Error('Source budget not found.');
        if (sourceBudget.budget_type === 'annual' || sourceBudget.period_type === 'yearly') {
            throw new Error('Only period budgets can be duplicated.');
        }
        budgetWizardState.sourceBudgetId = sourceBudgetId;
        budgetWizardState.totalBudget = Math.round(Math.max(0, Number(sourceBudget.total_budget) || 0));
        budgetWizardState.allocations = (sourceAllocations || []).map(a => normalizeWizardAllocation({
            id: null,
            name: a.name,
            category: (a.scope_values && a.scope_values[0]) || 'Operations',
            allocated_amount: a.allocated_amount,
            created_from_allocation_id: a.id
        }));
    } catch (err) {
        console.error('Duplicate source load failed:', err);
        window.showToast?.(err?.message || 'Could not load source budget.', 'error');
    } finally {
        budgetWizardState.loadingSource = false;
    }
}

function syncWizardMonthlyTarget(monthValue) {
    const target = makeMonthlyTarget(monthValue);
    budgetWizardState.periodType = 'monthly';
    budgetWizardState.periodStart = target.period_start;
    budgetWizardState.periodEnd = target.period_end;
    budgetWizardState.periodLabel = target.period_label;
    if (!budgetWizardState.name.trim()) budgetWizardState.name = `${target.period_label} Operating Budget`;
}

function syncWizardQuarterTarget(year, quarter) {
    const target = makeQuarterTarget(year, quarter);
    budgetWizardState.periodType = 'quarterly';
    budgetWizardState.periodStart = target.period_start;
    budgetWizardState.periodEnd = target.period_end;
    budgetWizardState.periodLabel = target.period_label;
    if (!budgetWizardState.name.trim()) budgetWizardState.name = `${target.period_label} Operating Budget`;
}

function isWizardStepValid(step = budgetWizardState.step) {
    const nameOk = budgetWizardState.name.trim().length > 0;
    const labelOk = budgetWizardState.periodLabel.trim().length > 0;
    const startOk = /^\d{4}-\d{2}-\d{2}$/.test(String(budgetWizardState.periodStart || ''));
    const endOk = /^\d{4}-\d{2}-\d{2}$/.test(String(budgetWizardState.periodEnd || ''));
    const datesOk = startOk && endOk && budgetWizardState.periodEnd > budgetWizardState.periodStart;
    const sourceOk = budgetWizardState.mode !== 'duplicate' || !!budgetWizardState.sourceBudgetId;
    if (step === 1) return sourceOk && nameOk && labelOk && datesOk && !budgetWizardState.loadingSource;
    if (step === 2) return budgetWizardState.totalBudget > 0;
    if (step === 3) return areWizardAllocationsValid();
    return nameOk && labelOk && datesOk && budgetWizardState.totalBudget > 0 && areWizardAllocationsValid();
}

function areWizardAllocationsValid() {
    const rows = budgetWizardState.allocations || [];
    if (getWizardAllocatedTotal() > budgetWizardState.totalBudget) return false;
    return rows.every(row => {
        const amount = Math.round(Math.max(0, Number(row.amount) || 0));
        return row.name.trim().length > 0
            && amount > 0
            && row.category
            && ALLOCATION_CATEGORIES.includes(row.category)
            && Number.isFinite(amount);
    });
}

function wizardValidationMessage() {
    if (budgetWizardState.step === 1) {
        if (budgetWizardState.mode === 'duplicate' && !budgetWizardState.sourceBudgetId) return 'Choose a source period budget.';
        if (!budgetWizardState.name.trim()) return 'Budget name is required.';
        if (!budgetWizardState.periodLabel.trim()) return 'Period label is required.';
        if (!budgetWizardState.periodStart || !budgetWizardState.periodEnd) return 'Select a valid start and end date.';
        if (budgetWizardState.periodEnd <= budgetWizardState.periodStart) return 'End date must be after start date.';
    }
    if (budgetWizardState.step === 2 && budgetWizardState.totalBudget <= 0) return 'Total budget must be greater than zero.';
    if (budgetWizardState.step >= 3) {
        if (getWizardAllocatedTotal() > budgetWizardState.totalBudget) return `Allocations exceed the main budget by ${formatRp(getWizardAllocatedTotal() - budgetWizardState.totalBudget)}.`;
        const badRow = budgetWizardState.allocations.find(row => !row.name.trim() || !row.category || Math.round(Math.max(0, Number(row.amount) || 0)) <= 0);
        if (badRow) return 'Every allocation row needs a name, supported category, and amount greater than zero.';
    }
    return '';
}

function renderBudgetWizard() {
    destroyWizardDatePicker();
    const title = budgetWizardState.mode === 'edit'
        ? 'Edit budget'
        : budgetWizardState.mode === 'duplicate'
            ? 'Duplicate period budget'
            : budgetWizardState.budgetType === 'annual'
                ? 'Create a main budget'
                : 'Create a period budget';
    el('budget-wizard-eyebrow').textContent = budgetWizardState.mode === 'edit'
        ? 'Edit Budget'
        : budgetWizardState.mode === 'duplicate'
            ? 'Duplicate Budget'
            : 'New Budget';
    el('budget-wizard-title').textContent = title;
    el('budget-wizard-subtitle').textContent = budgetWizardState.mode === 'duplicate'
        ? 'Copy allocation structure only, then choose the target period.'
        : 'Set the envelope, then allocate to sub-budgets.';
    el('budget-wizard-progress').innerHTML = WIZARD_STEPS.map(step => `
        <div class="h-1 rounded-full ${step.id <= budgetWizardState.step ? 'bg-[#EA580C]' : 'bg-gray-200'}"></div>
    `).join('');
    el('budget-wizard-step').innerHTML = renderWizardStepContent();
    wireWizardStepControls();
    mountWizardDatePicker();
    refreshWizardFooterAndComputed();
}

function renderWizardStepContent() {
    if (budgetWizardState.loadingSource) {
        return `<div class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-8 text-center text-[14px] text-gray-500">Loading source budget...</div>`;
    }
    if (budgetWizardState.step === 1) return renderWizardPlanStep();
    if (budgetWizardState.step === 2) return renderWizardSizingStep();
    if (budgetWizardState.step === 3) {
        ensureFunctionalAllocations();
        return renderWizardAllocationStep();
    }
    return renderWizardReviewStep();
}

function renderWizardPlanStep() {
    const isAnnual = budgetWizardState.budgetType === 'annual';
    const isDuplicate = budgetWizardState.mode === 'duplicate';
    return `
        <div class="space-y-5">
            ${isDuplicate ? renderDuplicateSourceSelect() : ''}
            ${!isDuplicate ? `
                <div>
                    <label class="mb-2 block text-[12px] font-bold uppercase tracking-wider text-gray-400">Budget type</label>
                    <div class="grid grid-cols-1 gap-2 sm:grid-cols-2" id="budget-wizard-budget-type">
                        ${renderWizardChoiceButton('annual', 'Main / Annual budget', 'One yearly envelope for the business.', budgetWizardState.budgetType)}
                        ${renderWizardChoiceButton('period', 'Period budget', 'A monthly, quarterly, or custom budget.', budgetWizardState.budgetType)}
                    </div>
                </div>
            ` : ''}
            <div>
                <label for="budget-wizard-name-input" class="mb-2 block text-[12px] font-bold text-gray-600">Budget name <span class="text-[#EA580C]">*</span></label>
                <input id="budget-wizard-name-input" type="text" maxlength="120" value="${escapeHtml(budgetWizardState.name)}" placeholder="e.g. FY27 Operating Plan" class="h-11 w-full rounded-lg border border-gray-200 bg-white px-4 text-[15px] font-semibold text-gray-900 outline-none transition-all focus:border-[#EA580C] focus:ring-2 focus:ring-orange-100">
            </div>
            ${!isAnnual ? renderParentAnnualSelect() : ''}
            ${!isAnnual ? renderPeriodTypeControls() : ''}
            ${renderPeriodFields(isAnnual)}
            <div>
                <label for="budget-wizard-notes-input" class="mb-2 block text-[12px] font-bold text-gray-600">Description / notes</label>
                <textarea id="budget-wizard-notes-input" rows="3" maxlength="500" placeholder="Optional context for this budget." class="w-full resize-none rounded-lg border border-gray-200 bg-white px-4 py-3 text-[14px] text-gray-900 outline-none transition-all focus:border-[#EA580C] focus:ring-2 focus:ring-orange-100">${escapeHtml(budgetWizardState.notes)}</textarea>
            </div>
        </div>
    `;
}

function renderDuplicateSourceSelect() {
    if (!state.periodBudgets.length) {
        return `<div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-medium text-amber-800">No period budget is available to duplicate yet.</div>`;
    }
    return `
        <div>
            <label for="budget-wizard-source-select" class="mb-2 block text-[12px] font-bold text-gray-600">Source period budget <span class="text-[#EA580C]">*</span></label>
            <select id="budget-wizard-source-select" class="h-11 w-full rounded-lg border border-gray-200 bg-white px-4 text-[14px] font-semibold text-gray-800 outline-none transition-all focus:border-[#EA580C] focus:ring-2 focus:ring-orange-100">
                ${state.periodBudgets.map(b => `
                    <option value="${escapeHtml(b.id)}" ${b.id === budgetWizardState.sourceBudgetId ? 'selected' : ''}>${escapeHtml(b.period_label || b.name || 'Period budget')}</option>
                `).join('')}
            </select>
            <p class="mt-2 text-[12px] text-gray-500">Only structure is copied. Spend, bills, transactions, and activity stay with the original period.</p>
        </div>
    `;
}

function renderWizardChoiceButton(value, title, copy, activeValue) {
    const active = value === activeValue;
    return `
        <button type="button" data-wizard-choice="${escapeHtml(value)}" class="rounded-lg border px-4 py-3 text-left transition-all ${active ? 'border-[#EA580C] bg-orange-50/60 text-gray-900 ring-1 ring-[#EA580C]' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}">
            <span class="block text-[13px] font-bold">${escapeHtml(title)}</span>
            <span class="mt-1 block text-[12px] leading-5 text-gray-500">${escapeHtml(copy)}</span>
        </button>
    `;
}

function renderParentAnnualSelect() {
    if (!state.annualBudgets.length) return '';
    return `
        <div>
            <label for="budget-wizard-parent-select" class="mb-2 block text-[12px] font-bold text-gray-600">Parent annual budget</label>
            <select id="budget-wizard-parent-select" class="h-11 w-full rounded-lg border border-gray-200 bg-white px-4 text-[14px] font-semibold text-gray-800 outline-none transition-all focus:border-[#EA580C] focus:ring-2 focus:ring-orange-100">
                <option value="">No annual envelope</option>
                ${state.annualBudgets.map(b => `
                    <option value="${escapeHtml(b.id)}" ${b.id === budgetWizardState.parentBudgetId ? 'selected' : ''}>${escapeHtml(b.period_label || b.name || 'Annual budget')}</option>
                `).join('')}
            </select>
        </div>
    `;
}

function renderPeriodTypeControls() {
    return `
        <div>
            <label class="mb-2 block text-[12px] font-bold uppercase tracking-wider text-gray-400">Period type</label>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-3" id="budget-wizard-period-type">
                ${renderWizardChoiceButton('monthly', 'Monthly', 'Month', budgetWizardState.periodType)}
                ${renderWizardChoiceButton('quarterly', 'Quarterly', 'Quarter', budgetWizardState.periodType)}
                ${renderWizardChoiceButton('custom', 'Custom', 'Range', budgetWizardState.periodType)}
            </div>
        </div>
    `;
}

function renderPeriodFields(isAnnual) {
    const dateSummary = `
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
                <label for="budget-wizard-period-label-input" class="mb-2 block text-[12px] font-bold text-gray-600">Period label <span class="text-[#EA580C]">*</span></label>
                <input id="budget-wizard-period-label-input" type="text" maxlength="120" value="${escapeHtml(budgetWizardState.periodLabel)}" class="h-11 w-full rounded-lg border border-gray-200 bg-white px-4 text-[15px] font-semibold text-gray-900 outline-none transition-all focus:border-[#EA580C] focus:ring-2 focus:ring-orange-100">
            </div>
            <div>
                <p class="mb-2 text-[12px] font-bold text-gray-600">Start</p>
                <div id="budget-wizard-start-display" class="flex h-11 items-center rounded-lg border border-gray-200 bg-gray-50 px-4 font-mono text-[14px] font-bold text-gray-700">${escapeHtml(budgetWizardState.periodStart || '—')}</div>
            </div>
            <div>
                <p class="mb-2 text-[12px] font-bold text-gray-600">End</p>
                <div id="budget-wizard-end-display" class="flex h-11 items-center rounded-lg border border-gray-200 bg-gray-50 px-4 font-mono text-[14px] font-bold text-gray-700">${escapeHtml(budgetWizardState.periodEnd || '—')}</div>
            </div>
        </div>
    `;
    if (isAnnual || budgetWizardState.periodType === 'custom') {
        return `
            ${dateSummary}
            <div>
                <label class="mb-2 block text-[12px] font-bold text-gray-600">${isAnnual ? 'Annual period' : 'Custom period'}</label>
                <div id="budget-wizard-date-picker"></div>
                <p class="mt-2 text-[12px] text-gray-500">Use the shared FluxyOS date picker. Future planning dates are allowed for budgets.</p>
            </div>
        `;
    }
    if (budgetWizardState.periodType === 'quarterly') {
        return `
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                    <label for="budget-wizard-quarter-input" class="mb-2 block text-[12px] font-bold text-gray-600">Quarter</label>
                    <select id="budget-wizard-quarter-input" class="h-11 w-full rounded-lg border border-gray-200 bg-white px-4 text-[14px] font-semibold text-gray-800 outline-none transition-all focus:border-[#EA580C] focus:ring-2 focus:ring-orange-100">
                        ${[1, 2, 3, 4].map(q => `<option value="${q}" ${String(q) === wizardQuarterValue() ? 'selected' : ''}>Q${q}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label for="budget-wizard-quarter-year-input" class="mb-2 block text-[12px] font-bold text-gray-600">Year</label>
                    <input id="budget-wizard-quarter-year-input" type="number" min="2020" max="2099" value="${escapeHtml(wizardQuarterYearValue())}" class="h-11 w-full rounded-lg border border-gray-200 bg-white px-4 text-[14px] font-semibold text-gray-800 outline-none transition-all focus:border-[#EA580C] focus:ring-2 focus:ring-orange-100">
                </div>
            </div>
            ${dateSummary}
        `;
    }
    return `
        <div>
            <label for="budget-wizard-month-input" class="mb-2 block text-[12px] font-bold text-gray-600">Month</label>
            <input id="budget-wizard-month-input" type="month" value="${escapeHtml(wizardMonthValue())}" class="h-11 w-full rounded-lg border border-gray-200 bg-white px-4 text-[14px] font-semibold text-gray-800 outline-none transition-all focus:border-[#EA580C] focus:ring-2 focus:ring-orange-100">
        </div>
        ${dateSummary}
    `;
}

function renderWizardSizingStep() {
    return `
        <div class="space-y-5">
            <div>
                <label for="budget-wizard-total-input" class="mb-2 block text-[12px] font-bold text-gray-600">Total budget amount <span class="text-[#EA580C]">*</span></label>
                <div class="flex h-12 items-center overflow-hidden rounded-lg border border-gray-200 bg-white focus-within:border-[#EA580C] focus-within:ring-2 focus-within:ring-orange-100">
                    <span class="flex h-full items-center border-r border-gray-100 px-4 font-mono text-[14px] font-bold text-gray-400">Rp</span>
                    <input id="budget-wizard-total-input" type="text" inputmode="numeric" value="${escapeHtml(formatRpInput(budgetWizardState.totalBudget))}" placeholder="0" class="h-full min-w-0 flex-1 border-0 px-4 font-mono text-[16px] font-bold text-gray-900 outline-none">
                </div>
                <p id="budget-wizard-total-helper" class="mt-2 text-[13px] text-gray-500">${formatRp(budgetWizardState.totalBudget)} over ${escapeHtml(budgetWizardState.periodLabel || 'this period')}</p>
            </div>
            <div>
                <label class="mb-2 block text-[12px] font-bold text-gray-600">Currency</label>
                <div class="flex h-11 items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 text-[14px] font-bold text-gray-700">
                    <span>IDR</span>
                    <span class="text-[12px] font-semibold text-gray-400">Locked</span>
                </div>
            </div>
            <div class="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-[13px] leading-6 text-gray-600">
                Set the total envelope before splitting it into allocations. You can rebalance allocations later while the main budget stays the control limit.
            </div>
        </div>
    `;
}

function renderWizardAllocationStep() {
    const over = Math.max(0, getWizardAllocatedTotal() - budgetWizardState.totalBudget);
    return `
        <div class="space-y-5">
            <div>
                <p class="mb-3 text-[13px] font-bold text-gray-600">Start from a template</p>
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    ${renderTemplateCard('functional', 'Functional split', 'Marketing, Infrastructure, Operations, and SaaS.')}
                    ${renderTemplateCard('gl_based_disabled', 'GL-based', 'Coming soon once chart of accounts data exists.', true)}
                    ${renderTemplateCard('blank', 'Blank slate', 'Start with no allocations and add your own.')}
                </div>
            </div>
            <div>
                <div class="mb-3 flex items-center justify-between gap-3">
                    <p class="text-[13px] font-bold text-gray-600">Sub-budget categories</p>
                    <button id="budget-wizard-add-allocation" type="button" class="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-bold text-[#EA580C] transition-colors hover:bg-orange-50">
                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.25" d="M12 4v16m8-8H4"></path></svg>
                        Add category
                    </button>
                </div>
                <div id="budget-wizard-allocation-rows" class="space-y-2">
                    ${budgetWizardState.allocations.length ? budgetWizardState.allocations.map(renderWizardAllocationRow).join('') : `
                        <div class="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-[13px] text-gray-500">Blank slate selected. Add a category when you are ready to split the envelope.</div>
                    `}
                </div>
            </div>
            <div class="rounded-lg border ${over ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-gray-50'} px-4 py-3">
                <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p class="text-[13px] text-gray-600">Allocated <span id="budget-wizard-allocated-sum" class="font-mono font-bold text-gray-900">${formatRp(getWizardAllocatedTotal())}</span> / <span id="budget-wizard-total-display" class="font-mono font-bold text-gray-900">${formatRp(budgetWizardState.totalBudget)}</span></p>
                    <p id="budget-wizard-allocation-status" class="font-mono text-[13px] font-bold ${over ? 'text-red-600' : getWizardRemainingTotal() === 0 ? 'text-emerald-600' : 'text-gray-500'}">${over ? `Over by ${formatRp(over)}` : getWizardRemainingTotal() === 0 ? 'Fully allocated' : `${formatRp(getWizardRemainingTotal())} unallocated`}</p>
                </div>
                <div id="budget-wizard-preview-bar" class="mt-3">${allocationPreviewHtml({ compact: true })}</div>
                <p id="budget-wizard-allocation-warning" class="${over ? '' : 'hidden'} mt-3 rounded-lg border border-red-200 bg-white px-3 py-2 text-[12px] font-medium text-red-700">${over ? `Allocations exceed the main budget by ${formatRp(over)}.` : ''}</p>
            </div>
        </div>
    `;
}

function renderTemplateCard(value, title, copy, disabled = false) {
    const active = budgetWizardState.template === value;
    return `
        <button type="button" data-template="${escapeHtml(value)}" ${disabled ? 'disabled' : ''} class="relative rounded-lg border px-4 py-4 text-left transition-all ${active ? 'border-[#EA580C] bg-orange-50/50 ring-1 ring-[#EA580C]' : 'border-gray-200 bg-white hover:border-gray-300'} ${disabled ? 'cursor-not-allowed opacity-60' : ''}">
            <span class="block pr-6 text-[13px] font-bold text-gray-900">${escapeHtml(title)}</span>
            <span class="mt-2 block text-[13px] leading-5 text-gray-500">${escapeHtml(copy)}</span>
            <span class="absolute right-4 top-4 h-4 w-4 rounded-full border ${active ? 'border-[#EA580C] bg-[#EA580C]' : 'border-gray-300 bg-white'}"></span>
        </button>
    `;
}

function renderWizardAllocationRow(row, index) {
    return `
        <div class="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 bg-white p-3 sm:grid-cols-12 sm:items-center" data-allocation-row="${index}">
            <div class="flex items-center gap-3 sm:col-span-4">
                <span class="h-3 w-3 flex-shrink-0 rounded-sm" style="background:${allocationColor(index)}"></span>
                <input type="text" maxlength="120" data-field="name" value="${escapeHtml(row.name)}" placeholder="Allocation name" class="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] font-bold text-gray-900 outline-none focus:border-[#EA580C] focus:ring-2 focus:ring-orange-100">
            </div>
            <select data-field="category" class="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] font-semibold text-gray-700 outline-none focus:border-[#EA580C] focus:ring-2 focus:ring-orange-100 sm:col-span-3">
                ${ALLOCATION_CATEGORIES.map(cat => `<option value="${cat}" ${cat === row.category ? 'selected' : ''}>${cat}</option>`).join('')}
            </select>
            <div class="flex items-center rounded-lg border border-gray-200 bg-gray-50 focus-within:border-[#EA580C] focus-within:ring-2 focus-within:ring-orange-100 sm:col-span-3">
                <span class="px-3 font-mono text-[12px] font-bold text-gray-400">Rp</span>
                <input type="text" inputmode="numeric" data-field="amount" value="${escapeHtml(formatRpInput(row.amount))}" placeholder="0" class="min-w-0 flex-1 bg-transparent px-2 py-2 text-right font-mono text-[13px] font-bold text-gray-900 outline-none">
            </div>
            <div class="flex items-center rounded-lg border border-gray-200 bg-gray-50 focus-within:border-[#EA580C] focus-within:ring-2 focus-within:ring-orange-100 sm:col-span-1">
                <input type="text" inputmode="decimal" data-field="percent" value="${escapeHtml(formatAllocationPercent(row.amount))}" class="min-w-0 flex-1 bg-transparent px-2 py-2 text-right font-mono text-[12px] font-bold text-gray-700 outline-none">
                <span class="pr-2 text-[11px] text-gray-400">%</span>
            </div>
            <button type="button" data-remove-allocation class="inline-flex h-9 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 sm:col-span-1" aria-label="Remove allocation">
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.25" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
        </div>
    `;
}

function renderWizardReviewStep() {
    const allocated = getWizardAllocatedTotal();
    const unallocated = getWizardRemainingTotal();
    const action = budgetWizardState.mode === 'edit' ? 'Ready to save' : 'Ready to create';
    const actionCopy = budgetWizardState.mode === 'edit'
        ? 'FluxyOS will update this budget and replace only this budget’s active allocation set.'
        : `FluxyOS will create one budget record and ${budgetWizardState.allocations.length} active allocation record${budgetWizardState.allocations.length === 1 ? '' : 's'}.`;
    return `
        <div class="space-y-5">
            <div class="rounded-lg border border-gray-200 bg-gray-50 px-4 py-4">
                <div class="flex items-start gap-3">
                    <svg class="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.25" d="M5 13l4 4L19 7"></path></svg>
                    <div>
                        <p class="text-[14px] font-bold text-gray-900">${escapeHtml(action)}</p>
                        <p class="mt-1 text-[13px] leading-5 text-gray-500">${escapeHtml(actionCopy)}</p>
                    </div>
                </div>
            </div>
            <div class="divide-y divide-gray-100 text-[14px]">
                ${renderReviewRow('Name', budgetWizardState.name)}
                ${renderReviewRow('Budget type', budgetWizardState.budgetType === 'annual' ? 'Main / Annual budget' : 'Period budget')}
                ${renderReviewRow('Period', `${budgetWizardState.periodLabel} · ${budgetWizardState.periodStart} - ${budgetWizardState.periodEnd}`)}
                ${renderReviewRow('Total', `${formatRp(budgetWizardState.totalBudget)} IDR`, true)}
                ${renderReviewRow('Sub-budgets', `${budgetWizardState.allocations.length} allocation${budgetWizardState.allocations.length === 1 ? '' : 's'} · ${formatRp(allocated)} allocated · ${formatRp(unallocated)} unallocated`, true)}
            </div>
            <div>
                <p class="mb-3 text-[13px] font-bold text-gray-600">Allocation preview</p>
                ${allocationPreviewHtml()}
                <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    ${budgetWizardState.allocations.length ? budgetWizardState.allocations.map((row, index) => `
                        <div class="flex items-start gap-3 text-[13px]">
                            <span class="mt-1 h-3 w-3 flex-shrink-0 rounded-sm" style="background:${allocationColor(index)}"></span>
                            <div class="min-w-0 flex-1">
                                <p class="font-semibold text-gray-700">${escapeHtml(row.name)}</p>
                                <p class="mt-1 font-mono font-bold text-gray-900">${formatRp(row.amount)}</p>
                            </div>
                            <span class="font-mono text-[12px] font-bold text-gray-400">${formatPercent(allocationPercent(row.amount))}</span>
                        </div>
                    `).join('') : `<p class="text-[13px] text-gray-500">No allocations. The full amount remains unallocated.</p>`}
                </div>
            </div>
        </div>
    `;
}

function renderReviewRow(label, value, mono = false) {
    return `
        <div class="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span class="text-gray-500">${escapeHtml(label)}</span>
            <span class="${mono ? 'font-mono font-bold' : 'font-semibold'} text-gray-900 sm:text-right">${escapeHtml(value)}</span>
        </div>
    `;
}

function wireWizardStepControls() {
    el('budget-wizard-name-input')?.addEventListener('input', (e) => {
        budgetWizardState.name = e.target.value;
        refreshWizardFooterAndComputed();
    });
    el('budget-wizard-period-label-input')?.addEventListener('input', (e) => {
        budgetWizardState.periodLabel = e.target.value;
        refreshWizardFooterAndComputed();
    });
    el('budget-wizard-notes-input')?.addEventListener('input', (e) => {
        budgetWizardState.notes = e.target.value;
    });
    el('budget-wizard-parent-select')?.addEventListener('change', (e) => {
        budgetWizardState.parentBudgetId = e.target.value || null;
    });
    el('budget-wizard-source-select')?.addEventListener('change', async (e) => {
        await loadDuplicateSourceBudget(e.target.value);
        renderBudgetWizard();
    });
    document.querySelectorAll('#budget-wizard-budget-type [data-wizard-choice]').forEach(btn => {
        btn.addEventListener('click', () => {
            const nextType = btn.dataset.wizardChoice === 'period' ? 'period' : 'annual';
            if (nextType === budgetWizardState.budgetType) return;
            if (nextType === 'annual') {
                const target = getDefaultAnnualTarget(parsePeriodDate(budgetWizardState.periodStart || getDayKey(new Date())));
                budgetWizardState.budgetType = 'annual';
                budgetWizardState.periodType = 'yearly';
                budgetWizardState.parentBudgetId = null;
                budgetWizardState.periodStart = target.period_start;
                budgetWizardState.periodEnd = target.period_end;
                budgetWizardState.periodLabel = target.period_label;
                if (!budgetWizardState.name.trim()) budgetWizardState.name = `${target.period_label} Operating Budget`;
            } else {
                const target = state.selectedTarget || makeMonthlyTarget();
                budgetWizardState.budgetType = 'period';
                budgetWizardState.periodType = target.period_type;
                budgetWizardState.parentBudgetId = state.selectedAnnualId || null;
                budgetWizardState.periodStart = target.period_start;
                budgetWizardState.periodEnd = target.period_end;
                budgetWizardState.periodLabel = target.period_label;
                if (!budgetWizardState.name.trim()) budgetWizardState.name = `${target.period_label} Operating Budget`;
            }
            renderBudgetWizard();
        });
    });
    document.querySelectorAll('#budget-wizard-period-type [data-wizard-choice]').forEach(btn => {
        btn.addEventListener('click', () => {
            const value = btn.dataset.wizardChoice;
            if (!['monthly', 'quarterly', 'custom'].includes(value)) return;
            budgetWizardState.periodType = value;
            if (value === 'monthly') syncWizardMonthlyTarget(wizardMonthValue());
            else if (value === 'quarterly') syncWizardQuarterTarget(Number(wizardQuarterYearValue()), Number(wizardQuarterValue()));
            renderBudgetWizard();
        });
    });
    el('budget-wizard-month-input')?.addEventListener('change', (e) => {
        syncWizardMonthlyTarget(e.target.value);
        renderBudgetWizard();
    });
    el('budget-wizard-quarter-input')?.addEventListener('change', () => {
        syncWizardQuarterTarget(Number(el('budget-wizard-quarter-year-input')?.value), Number(el('budget-wizard-quarter-input')?.value));
        renderBudgetWizard();
    });
    el('budget-wizard-quarter-year-input')?.addEventListener('input', () => {
        syncWizardQuarterTarget(Number(el('budget-wizard-quarter-year-input')?.value), Number(el('budget-wizard-quarter-input')?.value));
        refreshWizardFooterAndComputed();
    });
    el('budget-wizard-total-input')?.addEventListener('input', (e) => {
        budgetWizardState.totalBudget = parseRp(e.target.value);
        e.target.value = formatRpInput(budgetWizardState.totalBudget);
        refreshWizardFooterAndComputed();
    });
    document.querySelectorAll('[data-template]').forEach(card => {
        card.addEventListener('click', () => {
            const value = card.dataset.template;
            if (value === 'gl_based_disabled') return;
            budgetWizardState.template = value === 'blank' ? 'blank' : 'functional';
            budgetWizardState.allocations = budgetWizardState.template === 'blank' ? [] : buildFunctionalAllocations();
            renderBudgetWizard();
        });
    });
    el('budget-wizard-add-allocation')?.addEventListener('click', () => {
        const category = pickNextCategory();
        budgetWizardState.allocations.push({
            name: category,
            category,
            amount: getWizardRemainingTotal(),
            sourceAllocationId: null
        });
        budgetWizardState.template = budgetWizardState.allocations.length ? 'functional' : 'blank';
        renderBudgetWizard();
    });
    document.querySelectorAll('[data-allocation-row]').forEach(rowEl => {
        const index = Number(rowEl.dataset.allocationRow);
        rowEl.querySelector('[data-field="name"]')?.addEventListener('input', (e) => {
            budgetWizardState.allocations[index].name = e.target.value;
            refreshWizardFooterAndComputed();
        });
        rowEl.querySelector('[data-field="category"]')?.addEventListener('change', (e) => {
            budgetWizardState.allocations[index].category = e.target.value;
            if (!budgetWizardState.allocations[index].name.trim()) budgetWizardState.allocations[index].name = e.target.value;
            refreshWizardFooterAndComputed();
        });
        const amountInput = rowEl.querySelector('[data-field="amount"]');
        const percentInput = rowEl.querySelector('[data-field="percent"]');
        amountInput?.addEventListener('input', (e) => {
            budgetWizardState.allocations[index].amount = parseRp(e.target.value);
            e.target.value = formatRpInput(budgetWizardState.allocations[index].amount);
            if (percentInput) percentInput.value = formatAllocationPercent(budgetWizardState.allocations[index].amount);
            refreshWizardFooterAndComputed();
        });
        percentInput?.addEventListener('input', (e) => {
            const pct = parsePercent(e.target.value);
            budgetWizardState.allocations[index].amount = Math.round((budgetWizardState.totalBudget * pct) / 100);
            if (amountInput) amountInput.value = formatRpInput(budgetWizardState.allocations[index].amount);
            refreshWizardFooterAndComputed();
        });
        rowEl.querySelector('[data-remove-allocation]')?.addEventListener('click', () => {
            budgetWizardState.allocations.splice(index, 1);
            if (!budgetWizardState.allocations.length) budgetWizardState.template = 'blank';
            renderBudgetWizard();
        });
    });
}

function mountWizardDatePicker() {
    const host = el('budget-wizard-date-picker');
    if (!host || !window.FluxyDateRangePicker?.mount) return;
    budgetWizardState.datePicker = window.FluxyDateRangePicker.mount(host, {
        start: budgetWizardState.periodStart,
        end: budgetWizardState.periodEnd,
        defaultStart: budgetWizardState.periodStart,
        defaultEnd: budgetWizardState.periodEnd,
        maxDate: '2099-12-31',
        onChange: ({ start, end }) => {
            budgetWizardState.periodStart = start;
            budgetWizardState.periodEnd = end;
            if (budgetWizardState.budgetType === 'annual' && !budgetWizardState.periodLabel.trim()) {
                budgetWizardState.periodLabel = `FY${parsePeriodDate(start).getFullYear()}`;
            }
            refreshWizardFooterAndComputed();
            const labelInput = el('budget-wizard-period-label-input');
            if (labelInput) labelInput.value = budgetWizardState.periodLabel;
        }
    });
}

function refreshWizardFooterAndComputed() {
    const step = WIZARD_STEPS.find(s => s.id === budgetWizardState.step) || WIZARD_STEPS[0];
    el('budget-wizard-step-label').textContent = `Step ${budgetWizardState.step} of 4 · ${step.label}`;
    const back = el('budget-wizard-back');
    back?.classList.toggle('hidden', budgetWizardState.step === 1);
    const primary = el('budget-wizard-primary');
    const finalStep = budgetWizardState.step === 4;
    const valid = isWizardStepValid();
    if (primary) {
        primary.disabled = budgetWizardState.saving || !valid;
        const label = budgetWizardState.saving
            ? 'Saving...'
            : finalStep
                ? (budgetWizardState.mode === 'edit' ? 'Save changes' : 'Create budget')
                : 'Continue';
        const iconPath = finalStep
            ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.25" d="M5 13l4 4L19 7"></path>'
            : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.25" d="m9 18 6-6-6-6"></path>';
        primary.innerHTML = budgetWizardState.saving
            ? label
            : `${label}<svg id="budget-wizard-primary-icon" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${iconPath}</svg>`;
    }
    const error = el('budget-wizard-error');
    const message = valid ? '' : wizardValidationMessage();
    if (error) {
        error.textContent = message;
        error.classList.toggle('hidden', !message);
    }
    const totalHelper = el('budget-wizard-total-helper');
    if (totalHelper) totalHelper.textContent = `${formatRp(budgetWizardState.totalBudget)} over ${budgetWizardState.periodLabel || 'this period'}`;
    if (el('budget-wizard-start-display')) el('budget-wizard-start-display').textContent = budgetWizardState.periodStart || '—';
    if (el('budget-wizard-end-display')) el('budget-wizard-end-display').textContent = budgetWizardState.periodEnd || '—';
    const allocatedEl = el('budget-wizard-allocated-sum');
    const totalEl = el('budget-wizard-total-display');
    const statusEl = el('budget-wizard-allocation-status');
    const warningEl = el('budget-wizard-allocation-warning');
    const previewEl = el('budget-wizard-preview-bar');
    const allocated = getWizardAllocatedTotal();
    const over = Math.max(0, allocated - budgetWizardState.totalBudget);
    if (allocatedEl) allocatedEl.textContent = formatRp(allocated);
    if (totalEl) totalEl.textContent = formatRp(budgetWizardState.totalBudget);
    if (statusEl) {
        statusEl.textContent = over ? `Over by ${formatRp(over)}` : getWizardRemainingTotal() === 0 ? 'Fully allocated' : `${formatRp(getWizardRemainingTotal())} unallocated`;
        statusEl.className = `font-mono text-[13px] font-bold ${over ? 'text-red-600' : getWizardRemainingTotal() === 0 ? 'text-emerald-600' : 'text-gray-500'}`;
    }
    if (warningEl) {
        warningEl.textContent = over ? `Allocations exceed the main budget by ${formatRp(over)}.` : '';
        warningEl.classList.toggle('hidden', !over);
    }
    if (previewEl) previewEl.innerHTML = allocationPreviewHtml({ compact: true });
}

async function handleBudgetWizardSubmit(e) {
    e.preventDefault();
    if (!isWizardStepValid()) {
        refreshWizardFooterAndComputed();
        return;
    }
    if (budgetWizardState.step < 4) {
        if (budgetWizardState.step === 2 && budgetWizardState.template === 'functional' && !budgetWizardState.allocations.length) {
            budgetWizardState.allocations = buildFunctionalAllocations();
        }
        budgetWizardState.step += 1;
        renderBudgetWizard();
        return;
    }
    await saveBudgetWizard();
}

async function saveBudgetWizard() {
    if (!isWizardStepValid(4)) {
        refreshWizardFooterAndComputed();
        return;
    }
    budgetWizardState.saving = true;
    refreshWizardFooterAndComputed();
    try {
        const isAnnual = budgetWizardState.budgetType === 'annual';
        const allocations = budgetWizardState.allocations.map(row => ({
            name: row.name.trim(),
            allocated_amount: Math.round(Math.max(0, Number(row.amount) || 0)),
            scope_values: [row.category],
            alert_threshold_percent: 80,
            hard_limit_enabled: false,
            created_from_allocation_id: budgetWizardState.mode === 'duplicate' ? row.sourceAllocationId : null
        }));
        const result = await state.ds.addBudgetWithAllocations(state.user.uid, {
            budget_id: budgetWizardState.mode === 'edit' ? budgetWizardState.budgetId : null,
            name: budgetWizardState.name.trim(),
            budget_type: isAnnual ? 'annual' : 'period',
            parent_budget_id: isAnnual ? null : (budgetWizardState.parentBudgetId || null),
            period_type: isAnnual ? 'yearly' : budgetWizardState.periodType,
            period_label: budgetWizardState.periodLabel.trim(),
            period_start: parsePeriodDate(budgetWizardState.periodStart),
            period_end: parsePeriodDate(budgetWizardState.periodEnd, true),
            total_budget: Math.round(Math.max(0, Number(budgetWizardState.totalBudget) || 0)),
            currency: 'IDR',
            notes: budgetWizardState.notes.trim(),
            created_from_budget_id: budgetWizardState.mode === 'duplicate' ? budgetWizardState.sourceBudgetId : null
        }, allocations);

        if (result?.budget?.budget_type === 'annual') state.selectedAnnualId = result.budget.id;
        if (result?.budget?.id) state.selectedBudgetId = result.budget.id;
        state.selectedTarget = null;

        window.showToast?.(budgetWizardState.mode === 'edit' ? 'Budget updated.' : 'Budget created.', 'success');
        budgetWizardState.saving = false;
        closeBudgetWizard();
        await loadAndRender();
    } catch (err) {
        console.error('Save budget failed:', err);
        budgetWizardState.saving = false;
        const message = err?.message || 'Could not save your budget. Please try again.';
        const friendly = message.includes('permission-denied')
            ? 'Permission denied. Check Firestore Rules.'
            : message;
        window.showToast?.(friendly, 'error');
        const error = el('budget-wizard-error');
        if (error) {
            error.textContent = friendly;
            error.classList.remove('hidden');
        }
        refreshWizardFooterAndComputed();
    }
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
    // Only release the scroll lock if the create-budget wizard isn't also open.
    if (!state.wizardOpen) document.body.classList.remove('overflow-hidden');
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
    // The per-record Unallocated records queue + Advanced budget controls
    // header were removed from budget.html. Users assign records from the
    // Allocation detail drawer's Related sections and from the Ledger /
    // Bills row chips, so the standalone queue card is redundant.
    // The function stays defined as a no-op so renderBudget() still calls
    // it without throwing — wire-up cost is zero.
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
    // The full Budget activity card was removed from budget.html. The compact
    // Recent activity preview inside the workspace (#budget-recent-activity-list)
    // is the only consumer of the audit-log fetch now. Card-related branches
    // are guarded so a future re-add doesn't require revisiting this function.
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
            card?.classList.add('hidden');
            if (recentList) {
                recentList.innerHTML = `<li class="px-5 py-4 text-[13px] text-gray-400">No budget activity yet.</li>`;
            }
            return;
        }
        if (recentList) {
            recentList.innerHTML = logs.slice(0, 4).map(renderRecentActivityRow).join('');
        }
        if (card && body) {
            card.classList.remove('hidden');
            body.innerHTML = logs.map(renderActivityRow).join('');
        }
    } catch (err) {
        console.warn('Activity timeline failed:', err);
        card?.classList.add('hidden');
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
