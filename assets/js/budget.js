const STATUS_BADGE = {
    healthy: { label: 'Healthy', cls: 'fluxy-status-success', bar: 'bg-emerald-500' },
    watch: { label: 'Watch', cls: 'fluxy-status-warning', bar: 'bg-amber-500' },
    at_risk: { label: 'At Risk', cls: 'fluxy-status-warning', bar: 'bg-amber-500' },
    exceeded: { label: 'Exceeded', cls: 'fluxy-status-danger', bar: 'bg-red-500' }
};

const LEGACY_MAIN_ID = '__legacy_unparented_periods__';

const state = {
    ds: null,
    user: null,
    annualBudgets: [],
    legacyPeriods: [],
    legacyMode: false,
    selectedMainBudgetId: null,
    selectedMainBudget: null,
    annualEnvelope: null,
    periodBudgets: [],
    periodRows: [],
    modal: createModalState()
};

function createModalState(overrides = {}) {
    return {
        mode: 'annual',
        name: '',
        periodType: 'yearly',
        periodLabel: '',
        periodStart: '',
        periodEnd: '',
        totalBudget: 0,
        notes: '',
        saving: false,
        datePicker: null,
        ...overrides
    };
}

function el(id) {
    return document.getElementById(id);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatRp(amount) {
    const value = Math.round(Number(amount) || 0);
    return `Rp${Math.abs(value).toLocaleString('id-ID')}`;
}

function formatPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0%';
    const precision = Math.abs(n) < 10 && n !== 0 ? 1 : 0;
    return `${n.toFixed(precision)}%`;
}

function budgetDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value?.toDate === 'function') return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDayKey(date = new Date()) {
    const d = budgetDate(date) || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDayKey(dayKey, endOfDay = false) {
    const [year, month, day] = String(dayKey || '').split('-').map(Number);
    if (!year || !month || !day) return null;
    return endOfDay
        ? new Date(year, month - 1, day, 23, 59, 59, 999)
        : new Date(year, month - 1, day, 0, 0, 0, 0);
}

function formatDate(value) {
    const date = budgetDate(value);
    if (!date) return '—';
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatPeriod(budget) {
    const start = budgetDate(budget?.period_start);
    const end = budgetDate(budget?.period_end);
    if (!start || !end) return 'No date range';
    return `${formatDate(start)} – ${formatDate(end)}`;
}

function formatPeriodType(value) {
    const v = String(value || '').toLowerCase();
    if (v === 'yearly') return 'Yearly';
    if (v === 'monthly') return 'Monthly';
    if (v === 'quarterly') return 'Quarterly';
    if (v === 'custom') return 'Custom';
    return 'Period';
}

function classifyStatus(percent) {
    const pct = Number.isFinite(Number(percent)) ? Number(percent) : 0;
    if (pct >= 100) return 'exceeded';
    if (pct >= 85) return 'at_risk';
    if (pct >= 70) return 'watch';
    return 'healthy';
}

function clampPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
}

function getDefaultAnnualTarget(date = new Date()) {
    const d = budgetDate(date) || new Date();
    const year = d.getFullYear();
    return {
        periodType: 'yearly',
        periodLabel: `FY${year}`,
        periodStart: `${year}-01-01`,
        periodEnd: `${year}-12-31`
    };
}

function getDefaultPeriodTarget(date = new Date()) {
    const d = budgetDate(date) || new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const label = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return {
        periodType: 'monthly',
        periodLabel: label,
        periodStart: getDayKey(start),
        periodEnd: getDayKey(end)
    };
}

function formatRpInput(value) {
    const digits = String(Math.round(Math.max(0, Number(value) || 0)));
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function parseRp(value) {
    return Math.round(Number(String(value || '').replace(/[^\d]/g, '')) || 0);
}

export function initBudgetPage({ ds, user }) {
    state.ds = ds;
    state.user = user;

    const params = new URLSearchParams(window.location.search);
    const requestedBudgetId = params.get('budgetId');
    if (requestedBudgetId) state.selectedMainBudgetId = requestedBudgetId;

    wirePageControls();
    loadAndRender();
}

async function loadAndRender() {
    setLoading(true);
    try {
        const annualBudgets = await state.ds.getAnnualBudgets?.(state.user.uid) || [];
        const allPeriodBudgets = await state.ds.getPeriodBudgets?.(state.user.uid, null) || [];
        state.annualBudgets = annualBudgets;
        state.legacyPeriods = sortPeriodBudgets(allPeriodBudgets.filter(b => !b.parent_budget_id));
        state.legacyMode = false;

        if (state.selectedMainBudgetId
            && state.selectedMainBudgetId !== LEGACY_MAIN_ID
            && !annualBudgets.some(b => b.id === state.selectedMainBudgetId)) {
            const maybePeriod = await state.ds.getBudget?.(state.user.uid, state.selectedMainBudgetId);
            state.selectedMainBudgetId = maybePeriod?.parent_budget_id || (maybePeriod ? LEGACY_MAIN_ID : null);
        }

        if (!state.selectedMainBudgetId && annualBudgets.length) {
            state.selectedMainBudgetId = annualBudgets[0].id;
        } else if (!state.selectedMainBudgetId && state.legacyPeriods.length) {
            state.selectedMainBudgetId = LEGACY_MAIN_ID;
        }

        if (state.selectedMainBudgetId === LEGACY_MAIN_ID && state.legacyPeriods.length) {
            state.legacyMode = true;
            state.selectedMainBudget = buildLegacyMainBudget(state.legacyPeriods);
            state.periodBudgets = state.legacyPeriods;
            state.periodRows = await buildPeriodRows(state.periodBudgets);
            state.annualEnvelope = buildLegacyEnvelope(state.selectedMainBudget, state.periodRows);
            renderMainBudget();
            return;
        }

        if (state.selectedMainBudgetId === LEGACY_MAIN_ID && !state.legacyPeriods.length) {
            state.selectedMainBudgetId = annualBudgets[0]?.id || null;
        }

        state.selectedMainBudget = annualBudgets.find(b => b.id === state.selectedMainBudgetId) || null;
        if (!state.selectedMainBudget) {
            state.annualEnvelope = null;
            state.periodBudgets = [];
            state.periodRows = [];
            renderEmptyState();
            return;
        }

        const [annualEnvelope, periodBudgets] = await Promise.all([
            state.ds.calculateAnnualEnvelope?.(state.user.uid, state.selectedMainBudget.id),
            Promise.resolve(allPeriodBudgets.filter(b => b.parent_budget_id === state.selectedMainBudget.id))
        ]);

        state.annualEnvelope = annualEnvelope || {
            annual_budget: state.selectedMainBudget,
            yearly_budget: Number(state.selectedMainBudget.total_budget) || 0,
            planned_periods: 0,
            spent_reserved_ytd: 0,
            unplanned_capacity: Number(state.selectedMainBudget.total_budget) || 0
        };
        state.periodBudgets = sortPeriodBudgets(periodBudgets || []);
        state.periodRows = await buildPeriodRows(state.periodBudgets);
        renderMainBudget();
    } catch (error) {
        console.error('Budget load failed:', error);
        window.showToast?.('Could not load your budgets. Refresh and try again.', 'error');
        renderEmptyState();
    }
}

function setLoading(isLoading) {
    el('budget-loading')?.classList.toggle('hidden', !isLoading);
    el('budget-content')?.classList.add('hidden');
    el('budget-empty-state')?.classList.add('hidden');
    el('budget-page-title')?.classList.toggle('hidden', isLoading);
    el('budget-page-title')?.classList.toggle('flex', !isLoading);
}

function sortPeriodBudgets(budgets) {
    return [...budgets].sort((a, b) => {
        const aDate = budgetDate(a.period_start)?.getTime() || 0;
        const bDate = budgetDate(b.period_start)?.getTime() || 0;
        return aDate - bDate;
    });
}

async function buildPeriodRows(periods) {
    const rows = await Promise.all(periods.map(async (budget) => {
        try {
            const usage = await state.ds.getBudgetUsage(state.user.uid, budget.id);
            const summary = usage?.summary || {};
            const unallocated = usage?.unallocated || {};
            const total = Math.max(0, Number(budget.total_budget) || Number(summary.total_amount) || 0);
            const usedCommitted = Math.max(0,
                (Number(summary.total_actual_used) || 0)
                + (Number(summary.total_committed) || 0)
                + (Number(unallocated.actual_amount) || 0)
                + (Number(unallocated.committed_amount) || 0)
            );
            const remaining = Math.max(total - usedCommitted, 0);
            const usagePercent = total > 0 ? (usedCommitted / total) * 100 : 0;
            return {
                budget,
                total,
                usedCommitted,
                remaining,
                usagePercent: Number.isFinite(usagePercent) ? usagePercent : 0,
                status: classifyStatus(usagePercent)
            };
        } catch (error) {
            console.warn('Could not load period usage:', budget?.id, error);
            const total = Math.max(0, Number(budget.total_budget) || 0);
            return { budget, total, usedCommitted: 0, remaining: total, usagePercent: 0, status: 'healthy' };
        }
    }));
    return rows;
}

function buildLegacyMainBudget(periods) {
    const totals = periods.reduce((sum, budget) => sum + Math.max(0, Number(budget.total_budget) || 0), 0);
    const starts = periods
        .map(b => budgetDate(b.period_start))
        .filter(Boolean)
        .sort((a, b) => a.getTime() - b.getTime());
    const ends = periods
        .map(b => budgetDate(b.period_end))
        .filter(Boolean)
        .sort((a, b) => a.getTime() - b.getTime());
    return {
        id: LEGACY_MAIN_ID,
        name: 'Legacy Period Budgets',
        budget_type: 'annual',
        period_type: 'custom',
        period_label: 'Unparented periods',
        period_start: starts[0] || null,
        period_end: ends[ends.length - 1] || null,
        total_budget: totals,
        currency: 'IDR'
    };
}

function buildLegacyEnvelope(mainBudget, rows) {
    const planned = rows.reduce((sum, row) => sum + Math.max(0, Number(row.total) || 0), 0);
    const usedCommitted = rows.reduce((sum, row) => sum + Math.max(0, Number(row.usedCommitted) || 0), 0);
    return {
        annual_budget: mainBudget,
        yearly_budget: planned,
        planned_periods: planned,
        spent_reserved_ytd: usedCommitted,
        unplanned_capacity: 0
    };
}

function renderEmptyState() {
    setLoading(false);
    el('budget-content')?.classList.add('hidden');
    const empty = el('budget-empty-state');
    if (!empty) return;
    empty.classList.remove('hidden');
    empty.innerHTML = `
        <div class="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div class="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-50 text-[#EA580C]">
                <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.25" d="M12 4v16m8-8H4"></path></svg>
            </div>
            <h2 class="mt-5 text-[20px] font-bold text-gray-900">Create your first main budget</h2>
            <p class="mt-2 max-w-md text-[14px] leading-6 text-gray-500">Start with an annual budget, then split it into monthly, quarterly, or custom working periods.</p>
            <button id="budget-empty-create-main" type="button" class="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-slate-950 px-4 text-[14px] font-bold text-white transition-colors hover:bg-slate-800">Create Budget</button>
        </div>
    `;
    el('budget-empty-create-main')?.addEventListener('click', () => openBudgetModal('annual'));
}

function renderMainBudget() {
    setLoading(false);
    el('budget-empty-state')?.classList.add('hidden');
    el('budget-content')?.classList.remove('hidden');

    const budget = state.selectedMainBudget;
    const envelope = state.annualEnvelope || {};
    const annualTotal = Math.max(0, Number(envelope.yearly_budget) || Number(budget.total_budget) || 0);
    const planned = Math.max(0, Number(envelope.planned_periods) || 0);
    const notPlanned = Math.max(annualTotal - planned, 0);
    const spentReserved = Math.max(0, Number(envelope.spent_reserved_ytd) || 0);
    const plannedPercent = annualTotal > 0 ? clampPercent((planned / annualTotal) * 100) : 0;

    el('budget-main-name').textContent = budget.name || budget.period_label || 'Main Budget';
    el('budget-main-period').textContent = formatPeriod(budget);
    el('budget-annual-total').textContent = formatRp(annualTotal);
    el('budget-spent-reserved').textContent = formatRp(spentReserved);
    el('budget-not-planned').textContent = formatRp(notPlanned);
    el('budget-planned-inline').textContent = formatRp(planned);
    el('budget-annual-inline').textContent = formatRp(annualTotal);
    el('budget-planned-total').textContent = formatRp(planned);
    el('budget-not-planned-inline').textContent = formatRp(notPlanned);
    el('budget-spent-year').textContent = formatRp(spentReserved);
    el('budget-planned-bar').style.width = `${plannedPercent}%`;

    renderMainBudgetSelect();
    renderPeriodActions();
    renderPeriodTable();
}

function renderMainBudgetSelect() {
    const select = el('budget-main-select');
    if (!select) return;
    const options = state.annualBudgets.map(b => `
        <option value="${escapeHtml(b.id)}" ${b.id === state.selectedMainBudgetId ? 'selected' : ''}>
            ${escapeHtml(b.name || b.period_label || 'Main Budget')}
        </option>
    `);
    if (state.legacyPeriods.length) {
        options.push(`
            <option value="${LEGACY_MAIN_ID}" ${state.selectedMainBudgetId === LEGACY_MAIN_ID ? 'selected' : ''}>
                Legacy Period Budgets
            </option>
        `);
    }
    select.innerHTML = options.join('');
}

function renderPeriodActions() {
    const disabled = state.legacyMode;
    [el('budget-new-period-btn'), el('budget-table-new-period-btn')].forEach((button) => {
        if (!button) return;
        button.disabled = disabled;
        button.title = disabled ? 'Create a main budget before adding new period budgets.' : '';
        button.classList.toggle('cursor-not-allowed', disabled);
        button.classList.toggle('opacity-60', disabled);
    });
}

function renderPeriodTable() {
    const body = el('budget-period-body');
    const mobile = el('budget-period-mobile');
    if (!body) return;

    if (!state.periodRows.length) {
        body.innerHTML = `
            <tr>
                <td colspan="6" class="fluxy-table-loading-cell">
                    <div class="py-4">
                        <p class="font-semibold text-gray-700">No period budgets yet</p>
                        <p class="mt-1 text-[12px] font-normal text-gray-400">Create a monthly, quarterly, or custom working budget from this main budget.</p>
                    </div>
                </td>
            </tr>
        `;
        if (mobile) {
            mobile.innerHTML = `
                <div class="px-5 py-8 text-center">
                    <p class="text-[14px] font-semibold text-gray-700">No period budgets yet</p>
                    <p class="mt-1 text-[12px] text-gray-400">Create a monthly, quarterly, or custom working budget from this main budget.</p>
                </div>
            `;
        }
        return;
    }

    body.innerHTML = state.periodRows.map(renderPeriodRow).join('');
    if (mobile) mobile.innerHTML = state.periodRows.map(renderPeriodMobileCard).join('');
}

function renderPeriodRow(row) {
    const { budget, total, usedCommitted, remaining, usagePercent, status } = row;
    const badge = STATUS_BADGE[status] || STATUS_BADGE.healthy;
    const usageWidth = clampPercent(usagePercent);
    return `
        <tr class="fluxy-table-row fluxy-table-row-clickable align-top" data-action="open-period-detail" data-period-id="${escapeHtml(budget.id)}">
            <td class="fluxy-table-cell">
                <div class="min-w-0">
                    <p class="fluxy-table-cell-primary truncate">${escapeHtml(budget.name || budget.period_label || 'Period budget')}</p>
                    <p class="fluxy-table-cell-meta mt-0.5 truncate">${escapeHtml(formatPeriod(budget))}</p>
                    <p class="fluxy-table-cell-meta mt-0.5">${escapeHtml(formatPeriodType(budget.period_type))}</p>
                </div>
            </td>
            <td class="fluxy-table-cell fluxy-table-money text-gray-900">${formatRp(total)}</td>
            <td class="fluxy-table-cell fluxy-table-money text-gray-700">${formatRp(usedCommitted)}</td>
            <td class="fluxy-table-cell fluxy-table-money text-gray-900">${formatRp(remaining)}</td>
            <td class="fluxy-table-cell">
                <div class="flex items-center gap-2">
                    <span class="budget-number text-[12px] font-bold text-gray-700">${formatPercent(usagePercent)}</span>
                    <div class="hidden h-1.5 w-20 flex-shrink-0 overflow-hidden rounded-full bg-gray-100 sm:block">
                        <div class="h-full rounded-full ${badge.bar}" style="width: ${usageWidth}%"></div>
                    </div>
                </div>
            </td>
            <td class="fluxy-table-cell">
                <span class="fluxy-table-status ${badge.cls}">${badge.label}</span>
            </td>
        </tr>
    `;
}

function renderPeriodMobileCard(row) {
    const { budget, total, usedCommitted, remaining, usagePercent, status } = row;
    const badge = STATUS_BADGE[status] || STATUS_BADGE.healthy;
    return `
        <button type="button" class="w-full px-5 py-4 text-left transition-colors hover:bg-gray-50" data-action="open-period-detail" data-period-id="${escapeHtml(budget.id)}">
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="truncate text-[14px] font-semibold text-gray-900">${escapeHtml(budget.name || budget.period_label || 'Period budget')}</p>
                    <p class="mt-1 truncate text-[12px] text-gray-500">${escapeHtml(formatPeriod(budget))}</p>
                    <p class="mt-0.5 text-[12px] text-gray-400">${escapeHtml(formatPeriodType(budget.period_type))}</p>
                </div>
                <span class="fluxy-table-status ${badge.cls}">${badge.label}</span>
            </div>
            <div class="mt-4 grid grid-cols-2 gap-3 text-[12px]">
                <div>
                    <p class="font-bold uppercase tracking-wide text-gray-400">Period Budget</p>
                    <p class="budget-number mt-1 font-bold text-gray-900">${formatRp(total)}</p>
                </div>
                <div>
                    <p class="font-bold uppercase tracking-wide text-gray-400">Used + Committed</p>
                    <p class="budget-number mt-1 font-bold text-gray-900">${formatRp(usedCommitted)}</p>
                </div>
                <div>
                    <p class="font-bold uppercase tracking-wide text-gray-400">Remaining</p>
                    <p class="budget-number mt-1 font-bold text-gray-900">${formatRp(remaining)}</p>
                </div>
                <div>
                    <p class="font-bold uppercase tracking-wide text-gray-400">Usage</p>
                    <p class="budget-number mt-1 font-bold text-gray-900">${formatPercent(usagePercent)}</p>
                </div>
            </div>
        </button>
    `;
}

function wirePageControls() {
    el('budget-refresh-btn')?.addEventListener('click', loadAndRender);
    el('budget-create-main-btn')?.addEventListener('click', () => openBudgetModal('annual'));
    el('budget-new-period-btn')?.addEventListener('click', () => openBudgetModal('period'));
    el('budget-table-new-period-btn')?.addEventListener('click', () => openBudgetModal('period'));
    el('budget-main-select')?.addEventListener('change', (event) => {
        state.selectedMainBudgetId = event.target.value || null;
        loadAndRender();
    });

    document.addEventListener('click', (event) => {
        const periodRow = event.target.closest('[data-action="open-period-detail"]');
        if (!periodRow) return;
        event.preventDefault();
        openPeriodDetail(periodRow.dataset.periodId);
    });

    el('budget-modal-close')?.addEventListener('click', closeBudgetModal);
    el('budget-modal-cancel')?.addEventListener('click', closeBudgetModal);
    el('budget-modal-backdrop')?.addEventListener('click', closeBudgetModal);
    el('budget-modal-form')?.addEventListener('submit', handleBudgetModalSubmit);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !el('budget-modal-shell')?.classList.contains('hidden')) {
            closeBudgetModal();
        }
    });
}

function openPeriodDetail(periodId) {
    if (!periodId || !state.selectedMainBudgetId) return;
    const budgetId = state.legacyMode ? periodId : state.selectedMainBudgetId;
    const params = new URLSearchParams({ budgetId, periodId });
    window.location.href = `/budget-period.html?${params.toString()}`;
}

function openBudgetModal(mode) {
    if (mode === 'period' && state.legacyMode) {
        window.showToast?.('Create or select a main budget before adding a new period.', 'warning');
        return;
    }
    destroyModalDatePicker();
    const target = mode === 'annual' ? getDefaultAnnualTarget() : getDefaultPeriodTarget();
    state.modal = createModalState({
        mode,
        name: mode === 'annual'
            ? `${target.periodLabel} Main Budget`
            : `${target.periodLabel} Budget`,
        periodType: target.periodType,
        periodLabel: target.periodLabel,
        periodStart: target.periodStart,
        periodEnd: target.periodEnd,
        totalBudget: 0,
        notes: ''
    });

    el('budget-modal-backdrop')?.classList.remove('hidden');
    el('budget-modal-shell')?.classList.remove('hidden');
    el('budget-modal-shell')?.classList.add('flex');
    document.body.classList.add('overflow-hidden');
    renderBudgetModal();
}

function closeBudgetModal() {
    if (state.modal.saving) return;
    destroyModalDatePicker();
    el('budget-modal-shell')?.classList.add('hidden');
    el('budget-modal-shell')?.classList.remove('flex');
    el('budget-modal-backdrop')?.classList.add('hidden');
    el('budget-modal-error')?.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
}

function destroyModalDatePicker() {
    if (state.modal.datePicker?.destroy) state.modal.datePicker.destroy();
    state.modal.datePicker = null;
}

function renderBudgetModal() {
    const modal = state.modal;
    const isAnnual = modal.mode === 'annual';
    el('budget-modal-eyebrow').textContent = isAnnual ? 'Main Budget' : 'Period Budget';
    el('budget-modal-title').textContent = isAnnual ? 'Create a main budget' : 'Create a period budget';
    el('budget-modal-subtitle').textContent = isAnnual
        ? 'Set the annual budget that period budgets will roll up to.'
        : 'Create a monthly, quarterly, or custom working budget under the selected main budget.';
    el('budget-modal-submit').textContent = modal.saving ? 'Saving...' : (isAnnual ? 'Create Budget' : 'Create Period');
    el('budget-modal-submit').disabled = modal.saving || !isModalValid();

    el('budget-modal-body').innerHTML = `
        ${!isAnnual && !state.selectedMainBudget ? `
            <div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-medium text-amber-800">Create or select a main budget before adding a period.</div>
        ` : ''}
        ${!isAnnual && state.selectedMainBudget ? `
            <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p class="text-[12px] font-bold uppercase tracking-wide text-slate-400">Parent main budget</p>
                <p class="mt-1 text-[14px] font-semibold text-slate-900">${escapeHtml(state.selectedMainBudget.name || state.selectedMainBudget.period_label || 'Main Budget')}</p>
            </div>
        ` : ''}
        <div>
            <label for="budget-modal-name" class="mb-2 block text-[12px] font-bold text-gray-600">${isAnnual ? 'Main budget name' : 'Period name'} <span class="text-[#EA580C]">*</span></label>
            <input id="budget-modal-name" type="text" maxlength="120" value="${escapeHtml(modal.name)}" class="h-11 w-full rounded-lg border border-gray-200 bg-white px-4 text-[14px] font-semibold text-gray-900 outline-none transition-all focus:border-[#EA580C] focus:ring-2 focus:ring-orange-100">
        </div>
        ${isAnnual ? '' : `
            <div>
                <label for="budget-modal-period-type" class="mb-2 block text-[12px] font-bold text-gray-600">Period type <span class="text-[#EA580C]">*</span></label>
                <select id="budget-modal-period-type" class="h-11 w-full rounded-lg border border-gray-200 bg-white px-4 text-[14px] font-semibold text-gray-800 outline-none transition-all focus:border-[#EA580C] focus:ring-2 focus:ring-orange-100">
                    <option value="monthly" ${modal.periodType === 'monthly' ? 'selected' : ''}>Monthly</option>
                    <option value="quarterly" ${modal.periodType === 'quarterly' ? 'selected' : ''}>Quarterly</option>
                    <option value="custom" ${modal.periodType === 'custom' ? 'selected' : ''}>Custom</option>
                </select>
            </div>
        `}
        <div>
            <label for="budget-modal-period-label" class="mb-2 block text-[12px] font-bold text-gray-600">${isAnnual ? 'Annual label' : 'Period label'} <span class="text-[#EA580C]">*</span></label>
            <input id="budget-modal-period-label" type="text" maxlength="120" value="${escapeHtml(modal.periodLabel)}" class="h-11 w-full rounded-lg border border-gray-200 bg-white px-4 text-[14px] font-semibold text-gray-900 outline-none transition-all focus:border-[#EA580C] focus:ring-2 focus:ring-orange-100">
        </div>
        <div>
            <label class="mb-2 block text-[12px] font-bold text-gray-600">Date range <span class="text-[#EA580C]">*</span></label>
            <div id="budget-modal-date-picker"></div>
            <p class="mt-2 text-[12px] text-gray-500">${escapeHtml(modal.periodStart || '—')} – ${escapeHtml(modal.periodEnd || '—')}</p>
        </div>
        <div>
            <label for="budget-modal-total" class="mb-2 block text-[12px] font-bold text-gray-600">${isAnnual ? 'Annual budget amount' : 'Period budget amount'} <span class="text-[#EA580C]">*</span></label>
            <div class="flex h-11 items-center rounded-lg border border-gray-200 bg-white px-4 focus-within:border-[#EA580C] focus-within:ring-2 focus-within:ring-orange-100">
                <span class="mr-2 flex-shrink-0 text-[14px] font-bold text-gray-400">Rp</span>
                <input id="budget-modal-total" inputmode="numeric" value="${escapeHtml(formatRpInput(modal.totalBudget))}" class="min-w-0 flex-1 border-0 bg-transparent p-0 text-[14px] font-semibold tabular-nums text-gray-900 outline-none">
            </div>
        </div>
        <div>
            <label for="budget-modal-notes" class="mb-2 block text-[12px] font-bold text-gray-600">Notes</label>
            <textarea id="budget-modal-notes" maxlength="500" rows="3" class="w-full resize-none rounded-lg border border-gray-200 bg-white px-4 py-3 text-[14px] text-gray-900 outline-none transition-all focus:border-[#EA580C] focus:ring-2 focus:ring-orange-100">${escapeHtml(modal.notes)}</textarea>
        </div>
    `;

    wireModalInputs();
    mountModalDatePicker();
}

function wireModalInputs() {
    el('budget-modal-name')?.addEventListener('input', (event) => {
        state.modal.name = event.target.value;
        refreshModalSubmit();
    });
    el('budget-modal-period-label')?.addEventListener('input', (event) => {
        state.modal.periodLabel = event.target.value;
        refreshModalSubmit();
    });
    el('budget-modal-period-type')?.addEventListener('change', (event) => {
        state.modal.periodType = event.target.value;
        refreshModalSubmit();
    });
    el('budget-modal-total')?.addEventListener('input', (event) => {
        state.modal.totalBudget = parseRp(event.target.value);
        event.target.value = formatRpInput(state.modal.totalBudget);
        refreshModalSubmit();
    });
    el('budget-modal-notes')?.addEventListener('input', (event) => {
        state.modal.notes = event.target.value;
    });
}

function mountModalDatePicker() {
    const host = el('budget-modal-date-picker');
    if (!host || !window.FluxyDateRangePicker?.mount) return;
    state.modal.datePicker = window.FluxyDateRangePicker.mount(host, {
        start: state.modal.periodStart,
        end: state.modal.periodEnd,
        defaultStart: state.modal.periodStart,
        defaultEnd: state.modal.periodEnd,
        maxDate: '2099-12-31',
        onChange: ({ start, end }) => {
            state.modal.periodStart = start;
            state.modal.periodEnd = end;
            refreshModalSubmit();
        }
    });
}

function refreshModalSubmit() {
    const submit = el('budget-modal-submit');
    if (submit) submit.disabled = state.modal.saving || !isModalValid();
}

function isModalValid() {
    const modal = state.modal;
    const datesOk = /^\d{4}-\d{2}-\d{2}$/.test(modal.periodStart)
        && /^\d{4}-\d{2}-\d{2}$/.test(modal.periodEnd)
        && modal.periodEnd >= modal.periodStart;
    const parentOk = modal.mode === 'annual' || (Boolean(state.selectedMainBudgetId) && !state.legacyMode);
    return parentOk
        && modal.name.trim().length > 0
        && modal.periodLabel.trim().length > 0
        && datesOk
        && Math.round(Number(modal.totalBudget) || 0) > 0;
}

async function handleBudgetModalSubmit(event) {
    event.preventDefault();
    if (!isModalValid() || state.modal.saving) {
        refreshModalSubmit();
        return;
    }

    state.modal.saving = true;
    el('budget-modal-error')?.classList.add('hidden');
    refreshModalSubmit();
    try {
        const isAnnual = state.modal.mode === 'annual';
        const result = await state.ds.addBudgetWithAllocations(state.user.uid, {
            budget_id: null,
            name: state.modal.name.trim(),
            budget_type: isAnnual ? 'annual' : 'period',
            parent_budget_id: isAnnual ? null : state.selectedMainBudgetId,
            period_type: isAnnual ? 'yearly' : state.modal.periodType,
            period_label: state.modal.periodLabel.trim(),
            period_start: parseDayKey(state.modal.periodStart),
            period_end: parseDayKey(state.modal.periodEnd, true),
            total_budget: Math.round(Math.max(0, Number(state.modal.totalBudget) || 0)),
            currency: 'IDR',
            notes: state.modal.notes.trim()
        }, []);

        if (isAnnual && result?.budget?.id) {
            state.selectedMainBudgetId = result.budget.id;
        }

        window.showToast?.(isAnnual ? 'Main budget created.' : 'Period budget created.', 'success');
        state.modal.saving = false;
        closeBudgetModal();
        await loadAndRender();
    } catch (error) {
        console.error('Budget save failed:', error);
        state.modal.saving = false;
        const message = error?.message || 'Could not save this budget. Please try again.';
        window.showToast?.(message, 'error');
        const errorEl = el('budget-modal-error');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.classList.remove('hidden');
        }
        refreshModalSubmit();
    }
}
