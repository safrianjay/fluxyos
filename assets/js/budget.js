const STATUS_BADGE = {
    healthy: { label: 'Healthy', cls: 'fluxy-status-success', bar: 'bg-emerald-500' },
    watch: { label: 'Watch', cls: 'fluxy-status-warning', bar: 'bg-amber-500' },
    at_risk: { label: 'At Risk', cls: 'fluxy-status-warning', bar: 'bg-amber-500' },
    exceeded: { label: 'Exceeded', cls: 'fluxy-status-danger', bar: 'bg-red-500' }
};

const LEGACY_MAIN_ID = '__legacy_unparented_periods__';
const WIZARD_STEPS = [
    { id: 1, label: 'Plan' },
    { id: 2, label: 'Sizing' },
    { id: 3, label: 'Categories' },
    { id: 4, label: 'Review' }
];
const QUARTER_COLORS = ['#4F46E5', '#059669', '#2563EB', '#D97706'];

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
    mainWizard: createMainWizardState(),
    modal: createModalState()
};

function createMainWizardState(overrides = {}) {
    const target = getDefaultAnnualTarget();
    return {
        step: 1,
        name: `${target.periodLabel} Main Budget`,
        periodLabel: target.periodLabel,
        periodStart: target.periodStart,
        periodEnd: target.periodEnd,
        totalBudget: 0,
        notes: '',
        template: 'quarterly',
        quarters: [],
        saving: false,
        datePicker: null,
        ...overrides
    };
}

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

function getQuarterTarget(year, quarter) {
    const q = Math.max(1, Math.min(4, Number(quarter) || 1));
    const start = new Date(year, (q - 1) * 3, 1);
    const end = new Date(year, q * 3, 0);
    return {
        periodType: 'quarterly',
        periodLabel: `Q${q} ${year}`,
        periodStart: getDayKey(start),
        periodEnd: getDayKey(end)
    };
}

function getWizardYear() {
    return budgetDate(parseDayKey(state.mainWizard.periodStart))?.getFullYear() || new Date().getFullYear();
}

function splitQuarterAmounts(totalBudget) {
    const total = Math.round(Math.max(0, Number(totalBudget) || 0));
    const base = Math.floor(total / 4);
    return [base, base, base, total - (base * 3)];
}

function buildQuarterSubBudgets(totalBudget = state.mainWizard.totalBudget) {
    const year = getWizardYear();
    const amounts = splitQuarterAmounts(totalBudget);
    return [1, 2, 3, 4].map((quarter, index) => {
        const target = getQuarterTarget(year, quarter);
        return {
            name: `${target.periodLabel} Budget`,
            periodLabel: target.periodLabel,
            periodStart: target.periodStart,
            periodEnd: target.periodEnd,
            amount: amounts[index]
        };
    });
}

function getWizardQuarterTotal() {
    return (state.mainWizard.quarters || []).reduce((sum, row) => sum + Math.max(0, Math.round(Number(row.amount) || 0)), 0);
}

function getWizardQuarterRemaining() {
    return Math.max(0, Math.round(Number(state.mainWizard.totalBudget) || 0) - getWizardQuarterTotal());
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
            <h2 class="text-[18px] font-bold text-gray-900">Create your first main budget</h2>
            <p class="mt-2 max-w-md text-[14px] leading-6 text-gray-500">Start with an annual budget, then split it into monthly, quarterly, or custom working periods.</p>
            <button id="budget-empty-create-main" type="button" class="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-slate-950 px-4 text-[14px] font-bold text-white transition-colors hover:bg-slate-800">Create Budget</button>
        </div>
    `;
    el('budget-empty-create-main')?.addEventListener('click', openMainBudgetWizard);
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
    el('budget-create-main-btn')?.addEventListener('click', openMainBudgetWizard);
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
    el('budget-wizard-close')?.addEventListener('click', closeMainBudgetWizard);
    el('budget-wizard-backdrop')?.addEventListener('click', closeMainBudgetWizard);
    el('budget-wizard-back')?.addEventListener('click', () => {
        if (state.mainWizard.step <= 1 || state.mainWizard.saving) return;
        state.mainWizard.step -= 1;
        renderMainBudgetWizard();
    });
    el('budget-wizard-form')?.addEventListener('submit', handleMainBudgetWizardSubmit);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !el('budget-wizard-shell')?.classList.contains('hidden')) {
            closeMainBudgetWizard();
        } else if (event.key === 'Escape' && !el('budget-modal-shell')?.classList.contains('hidden')) {
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

function openMainBudgetWizard() {
    destroyMainWizardDatePicker();
    const target = getDefaultAnnualTarget();
    state.mainWizard = createMainWizardState({
        name: `${target.periodLabel} Main Budget`,
        periodLabel: target.periodLabel,
        periodStart: target.periodStart,
        periodEnd: target.periodEnd,
        totalBudget: 0,
        notes: '',
        template: 'quarterly',
        quarters: [],
        step: 1
    });
    el('budget-wizard-backdrop')?.classList.remove('hidden');
    el('budget-wizard-shell')?.classList.remove('hidden');
    el('budget-wizard-shell')?.classList.add('flex');
    document.body.classList.add('overflow-hidden');
    renderMainBudgetWizard();
}

function closeMainBudgetWizard() {
    if (state.mainWizard.saving) return;
    destroyMainWizardDatePicker();
    el('budget-wizard-shell')?.classList.add('hidden');
    el('budget-wizard-shell')?.classList.remove('flex');
    el('budget-wizard-backdrop')?.classList.add('hidden');
    el('budget-wizard-error')?.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
}

function destroyMainWizardDatePicker() {
    if (state.mainWizard.datePicker?.destroy) state.mainWizard.datePicker.destroy();
    state.mainWizard.datePicker = null;
}

function renderMainBudgetWizard() {
    destroyMainWizardDatePicker();
    el('budget-wizard-eyebrow').textContent = 'Main Budget';
    el('budget-wizard-title').textContent = 'Create a main budget';
    el('budget-wizard-subtitle').textContent = 'Set the annual envelope, then split it into quarterly period budgets.';
    el('budget-wizard-progress').innerHTML = WIZARD_STEPS.map(step => `
        <div class="h-1 rounded-full ${step.id <= state.mainWizard.step ? 'bg-slate-950' : 'bg-gray-200'}"></div>
    `).join('');
    el('budget-wizard-step').innerHTML = renderMainWizardStep();
    wireMainWizardStepControls();
    mountMainWizardDatePicker();
    refreshMainWizardFooter();
}

function renderMainWizardStep() {
    if (state.mainWizard.step === 1) return renderMainWizardPlanStep();
    if (state.mainWizard.step === 2) return renderMainWizardSizingStep();
    if (state.mainWizard.step === 3) {
        ensureQuarterSubBudgets();
        return renderMainWizardQuarterStep();
    }
    return renderMainWizardReviewStep();
}

function renderMainWizardPlanStep() {
    return `
        <div class="space-y-5">
            <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p class="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Budget type</p>
                <p class="mt-1 text-[14px] font-semibold text-slate-900">Main / Annual budget</p>
            </div>
            <div>
                <label for="budget-wizard-name-input" class="mb-2 block text-[12px] font-bold text-gray-600">Budget name <span class="text-[#EA580C]">*</span></label>
                <input id="budget-wizard-name-input" type="text" maxlength="120" value="${escapeHtml(state.mainWizard.name)}" placeholder="e.g. FY27 Operating Plan" class="h-11 w-full rounded-lg border border-gray-200 bg-white px-4 text-[14px] font-semibold text-gray-900 outline-none transition-all focus:border-[#EA580C] focus:ring-2 focus:ring-orange-100">
            </div>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                    <label for="budget-wizard-period-label-input" class="mb-2 block text-[12px] font-bold text-gray-600">Annual label <span class="text-[#EA580C]">*</span></label>
                    <input id="budget-wizard-period-label-input" type="text" maxlength="120" value="${escapeHtml(state.mainWizard.periodLabel)}" class="h-11 w-full rounded-lg border border-gray-200 bg-white px-4 text-[14px] font-semibold text-gray-900 outline-none transition-all focus:border-[#EA580C] focus:ring-2 focus:ring-orange-100">
                </div>
                <div>
                    <p class="mb-2 text-[12px] font-bold text-gray-600">Start</p>
                    <div id="budget-wizard-start-display" class="flex h-11 items-center rounded-lg border border-gray-200 bg-gray-50 px-4 font-mono text-[13px] font-bold text-gray-700">${escapeHtml(state.mainWizard.periodStart || '—')}</div>
                </div>
                <div>
                    <p class="mb-2 text-[12px] font-bold text-gray-600">End</p>
                    <div id="budget-wizard-end-display" class="flex h-11 items-center rounded-lg border border-gray-200 bg-gray-50 px-4 font-mono text-[13px] font-bold text-gray-700">${escapeHtml(state.mainWizard.periodEnd || '—')}</div>
                </div>
            </div>
            <div>
                <label class="mb-2 block text-[12px] font-bold text-gray-600">Annual period <span class="text-[#EA580C]">*</span></label>
                <div id="budget-wizard-date-picker"></div>
                <p class="mt-2 text-[12px] text-gray-500">Use the shared FluxyOS date picker. Future planning dates are allowed for budgets.</p>
            </div>
            <div>
                <label for="budget-wizard-notes-input" class="mb-2 block text-[12px] font-bold text-gray-600">Description / notes</label>
                <textarea id="budget-wizard-notes-input" rows="3" maxlength="500" placeholder="Optional context for this main budget." class="w-full resize-none rounded-lg border border-gray-200 bg-white px-4 py-3 text-[14px] text-gray-900 outline-none transition-all focus:border-[#EA580C] focus:ring-2 focus:ring-orange-100">${escapeHtml(state.mainWizard.notes)}</textarea>
            </div>
        </div>
    `;
}

function renderMainWizardSizingStep() {
    return `
        <div class="space-y-5">
            <div>
                <label for="budget-wizard-total-input" class="mb-2 block text-[12px] font-bold text-gray-600">Annual budget amount <span class="text-[#EA580C]">*</span></label>
                <div class="flex h-12 items-center overflow-hidden rounded-lg border border-gray-200 bg-white focus-within:border-[#EA580C] focus-within:ring-2 focus:ring-orange-100">
                    <span class="flex h-full items-center border-r border-gray-100 px-4 font-mono text-[14px] font-bold text-gray-400">Rp</span>
                    <input id="budget-wizard-total-input" type="text" inputmode="numeric" value="${escapeHtml(formatRpInput(state.mainWizard.totalBudget))}" placeholder="0" class="h-full min-w-0 flex-1 border-0 px-4 font-mono text-[16px] font-bold text-gray-900 outline-none">
                </div>
                <p id="budget-wizard-total-helper" class="mt-2 text-[13px] text-gray-500">${formatRp(state.mainWizard.totalBudget)} over ${escapeHtml(state.mainWizard.periodLabel || 'this annual period')}</p>
            </div>
            <div class="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-[13px] leading-6 text-gray-600">
                This is the main annual envelope. The next step can split it into quarterly period budgets; allocation categories stay inside each period budget.
            </div>
        </div>
    `;
}

function ensureQuarterSubBudgets() {
    if (state.mainWizard.template !== 'quarterly') return;
    if (state.mainWizard.quarters.length) return;
    state.mainWizard.quarters = buildQuarterSubBudgets();
}

function renderMainWizardQuarterStep() {
    const over = Math.max(0, getWizardQuarterTotal() - state.mainWizard.totalBudget);
    return `
        <div class="space-y-5">
            <div>
                <p class="mb-3 text-[13px] font-bold text-gray-600">Start from a template</p>
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    ${renderQuarterTemplateCard('quarterly', 'Quarterly split', 'Create Q1, Q2, Q3, and Q4 period budgets under this main budget.')}
                    ${renderQuarterTemplateCard('blank', 'Blank slate', 'Create the main budget now and add periods later.')}
                </div>
            </div>
            <div>
                <p class="mb-3 text-[13px] font-bold text-gray-600">Quarterly sub-budgets</p>
                <div id="budget-wizard-quarter-rows" class="space-y-2">
                    ${state.mainWizard.quarters.length ? state.mainWizard.quarters.map(renderQuarterSubBudgetRow).join('') : `
                        <div class="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-[13px] text-gray-500">Blank slate selected. The annual budget will be created without period budgets.</div>
                    `}
                </div>
            </div>
            <div class="rounded-lg border ${over ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-gray-50'} px-4 py-3">
                <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p class="text-[13px] text-gray-600">Planned <span id="budget-wizard-quarter-sum" class="font-mono font-bold text-gray-900">${formatRp(getWizardQuarterTotal())}</span> / <span id="budget-wizard-total-display" class="font-mono font-bold text-gray-900">${formatRp(state.mainWizard.totalBudget)}</span></p>
                    <p id="budget-wizard-quarter-status" class="font-mono text-[13px] font-bold ${over ? 'text-red-600' : getWizardQuarterRemaining() === 0 ? 'text-emerald-600' : 'text-gray-500'}">${over ? `Over by ${formatRp(over)}` : getWizardQuarterRemaining() === 0 ? 'Fully planned' : `${formatRp(getWizardQuarterRemaining())} not planned`}</p>
                </div>
                <div id="budget-wizard-preview-bar" class="mt-3">${quarterPreviewHtml({ compact: true })}</div>
                <p id="budget-wizard-quarter-warning" class="${over ? '' : 'hidden'} mt-3 rounded-lg border border-red-200 bg-white px-3 py-2 text-[12px] font-medium text-red-700">${over ? `Quarterly sub-budgets exceed the annual budget by ${formatRp(over)}.` : ''}</p>
            </div>
        </div>
    `;
}

function renderQuarterTemplateCard(value, title, copy) {
    const active = state.mainWizard.template === value;
    return `
        <button type="button" data-template="${escapeHtml(value)}" class="relative rounded-lg border px-4 py-4 text-left transition-all ${active ? 'border-[#EA580C] bg-white ring-1 ring-[#EA580C]' : 'border-gray-200 bg-white hover:border-gray-300'}">
            <span class="block pr-6 text-[13px] font-bold text-gray-900">${escapeHtml(title)}</span>
            <span class="mt-2 block text-[13px] leading-5 text-gray-500">${escapeHtml(copy)}</span>
            <span class="absolute right-4 top-4 h-4 w-4 rounded-full border ${active ? 'border-slate-950 bg-slate-950' : 'border-gray-300 bg-white'}"></span>
        </button>
    `;
}

function renderQuarterSubBudgetRow(row, index) {
    return `
        <div class="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 bg-white p-3 sm:grid-cols-12 sm:items-center" data-quarter-row="${index}">
            <div class="flex items-center gap-3 sm:col-span-4">
                <span class="h-3 w-3 flex-shrink-0 rounded-sm" style="background:${QUARTER_COLORS[index % QUARTER_COLORS.length]}"></span>
                <input type="text" maxlength="120" data-field="name" value="${escapeHtml(row.name)}" placeholder="Quarter budget name" class="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] font-bold text-gray-900 outline-none focus:border-[#EA580C] focus:ring-2 focus:ring-orange-100">
            </div>
            <input type="text" maxlength="120" data-field="periodLabel" value="${escapeHtml(row.periodLabel)}" class="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] font-semibold text-gray-700 outline-none focus:border-[#EA580C] focus:ring-2 focus:ring-orange-100 sm:col-span-2">
            <div class="grid grid-cols-2 gap-2 sm:col-span-3">
                <div class="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-[12px] font-bold text-gray-600">${escapeHtml(row.periodStart)}</div>
                <div class="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-[12px] font-bold text-gray-600">${escapeHtml(row.periodEnd)}</div>
            </div>
            <div class="flex items-center rounded-lg border border-gray-200 bg-gray-50 focus-within:border-[#EA580C] focus-within:ring-2 focus:ring-orange-100 sm:col-span-2">
                <span class="px-3 font-mono text-[12px] font-bold text-gray-400">Rp</span>
                <input type="text" inputmode="numeric" data-field="amount" value="${escapeHtml(formatRpInput(row.amount))}" placeholder="0" class="min-w-0 flex-1 bg-transparent px-2 py-2 text-right font-mono text-[13px] font-bold text-gray-900 outline-none">
            </div>
            <div class="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-right font-mono text-[12px] font-bold text-gray-700 sm:col-span-1">${formatPercent(quarterPercent(row.amount))}</div>
        </div>
    `;
}

function renderMainWizardReviewStep() {
    const planned = getWizardQuarterTotal();
    const remaining = getWizardQuarterRemaining();
    return `
        <div class="space-y-5">
            <div class="rounded-lg border border-gray-200 bg-gray-50 px-4 py-4">
                <p class="text-[14px] font-bold text-gray-900">Ready to create</p>
                <p class="mt-1 text-[13px] leading-5 text-gray-500">FluxyOS will create one main annual budget and ${state.mainWizard.quarters.length} quarterly period budget${state.mainWizard.quarters.length === 1 ? '' : 's'}.</p>
            </div>
            <div class="divide-y divide-gray-100 text-[14px]">
                ${renderReviewRow('Name', state.mainWizard.name)}
                ${renderReviewRow('Budget type', 'Main / Annual budget')}
                ${renderReviewRow('Annual period', `${state.mainWizard.periodLabel} · ${state.mainWizard.periodStart} - ${state.mainWizard.periodEnd}`)}
                ${renderReviewRow('Annual budget', `${formatRp(state.mainWizard.totalBudget)} IDR`, true)}
                ${renderReviewRow('Quarterly periods', `${state.mainWizard.quarters.length} period budget${state.mainWizard.quarters.length === 1 ? '' : 's'} · ${formatRp(planned)} planned · ${formatRp(remaining)} not planned`, true)}
            </div>
            <div>
                <p class="mb-3 text-[13px] font-bold text-gray-600">Quarterly preview</p>
                ${quarterPreviewHtml()}
                <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    ${state.mainWizard.quarters.length ? state.mainWizard.quarters.map((row, index) => `
                        <div class="flex items-start gap-3 text-[13px]">
                            <span class="mt-1 h-3 w-3 flex-shrink-0 rounded-sm" style="background:${QUARTER_COLORS[index % QUARTER_COLORS.length]}"></span>
                            <div class="min-w-0 flex-1">
                                <p class="font-semibold text-gray-700">${escapeHtml(row.name)}</p>
                                <p class="mt-1 font-mono font-bold text-gray-900">${formatRp(row.amount)}</p>
                                <p class="mt-1 text-[12px] text-gray-500">${escapeHtml(row.periodStart)} - ${escapeHtml(row.periodEnd)}</p>
                            </div>
                        </div>
                    `).join('') : '<p class="text-[13px] text-gray-500">No period budgets will be created yet.</p>'}
                </div>
            </div>
        </div>
    `;
}

function renderReviewRow(label, value, mono = false) {
    return `
        <div class="flex items-start justify-between gap-4 py-3">
            <span class="text-[13px] font-semibold text-gray-500">${escapeHtml(label)}</span>
            <span class="${mono ? 'font-mono ' : ''}text-right text-[13px] font-bold text-gray-900">${escapeHtml(value)}</span>
        </div>
    `;
}

function quarterPercent(amount) {
    const total = Math.max(0, Number(state.mainWizard.totalBudget) || 0);
    if (total <= 0) return 0;
    return Math.max(0, (Number(amount) || 0) / total * 100);
}

function getQuarterSegments() {
    const total = Math.max(0, Number(state.mainWizard.totalBudget) || 0);
    if (total <= 0) return [];
    const segments = (state.mainWizard.quarters || [])
        .filter(row => Math.max(0, Number(row.amount) || 0) > 0)
        .map((row, index) => ({
            label: row.periodLabel || row.name || `Q${index + 1}`,
            amount: Number(row.amount) || 0,
            percent: quarterPercent(row.amount),
            color: QUARTER_COLORS[index % QUARTER_COLORS.length]
        }));
    const remaining = getWizardQuarterRemaining();
    if (remaining > 0) {
        segments.push({
            label: 'Not planned',
            amount: remaining,
            percent: quarterPercent(remaining),
            color: '#E5E7EB',
            unplanned: true
        });
    }
    return segments;
}

function quarterPreviewHtml({ compact = false } = {}) {
    const segments = getQuarterSegments();
    if (!segments.length) {
        return `<div class="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center text-[12px] text-gray-500">No quarterly preview yet.</div>`;
    }
    return `
        <div class="flex h-${compact ? '5' : '6'} w-full overflow-hidden rounded-lg bg-gray-100 ring-1 ring-gray-200">
            ${segments.map(seg => {
                const label = seg.percent >= 12 ? escapeHtml(seg.label) : '';
                return `
                    <div class="flex min-w-[3px] items-center overflow-hidden px-2 ${seg.unplanned ? 'text-gray-500' : 'text-white'}"
                        style="flex:0 0 ${Math.max(0, seg.percent)}%; background:${seg.color};"
                        title="${escapeHtml(seg.label)} ${formatRp(seg.amount)}">
                        <span class="truncate text-[11px] font-bold">${label}</span>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function wireMainWizardStepControls() {
    el('budget-wizard-name-input')?.addEventListener('input', (event) => {
        state.mainWizard.name = event.target.value;
        refreshMainWizardFooter();
    });
    el('budget-wizard-period-label-input')?.addEventListener('input', (event) => {
        state.mainWizard.periodLabel = event.target.value;
        refreshMainWizardFooter();
    });
    el('budget-wizard-notes-input')?.addEventListener('input', (event) => {
        state.mainWizard.notes = event.target.value;
    });
    el('budget-wizard-total-input')?.addEventListener('input', (event) => {
        state.mainWizard.totalBudget = parseRp(event.target.value);
        event.target.value = formatRpInput(state.mainWizard.totalBudget);
        if (state.mainWizard.template === 'quarterly') {
            state.mainWizard.quarters = buildQuarterSubBudgets();
        }
        refreshMainWizardFooter();
    });
    document.querySelectorAll('[data-template]').forEach(button => {
        button.addEventListener('click', () => {
            const value = button.dataset.template;
            state.mainWizard.template = value === 'blank' ? 'blank' : 'quarterly';
            state.mainWizard.quarters = state.mainWizard.template === 'blank' ? [] : buildQuarterSubBudgets();
            renderMainBudgetWizard();
        });
    });
    document.querySelectorAll('[data-quarter-row]').forEach(row => {
        const index = Number(row.dataset.quarterRow);
        row.querySelector('[data-field="name"]')?.addEventListener('input', (event) => {
            state.mainWizard.quarters[index].name = event.target.value;
            refreshMainWizardFooter();
        });
        row.querySelector('[data-field="periodLabel"]')?.addEventListener('input', (event) => {
            state.mainWizard.quarters[index].periodLabel = event.target.value;
            if (!state.mainWizard.quarters[index].name.trim()) state.mainWizard.quarters[index].name = `${event.target.value} Budget`;
            refreshMainWizardFooter();
        });
        row.querySelector('[data-field="amount"]')?.addEventListener('input', (event) => {
            state.mainWizard.quarters[index].amount = parseRp(event.target.value);
            event.target.value = formatRpInput(state.mainWizard.quarters[index].amount);
            refreshMainWizardFooter();
        });
    });
}

function mountMainWizardDatePicker() {
    const host = el('budget-wizard-date-picker');
    if (!host || !window.FluxyDateRangePicker?.mount) return;
    state.mainWizard.datePicker = window.FluxyDateRangePicker.mount(host, {
        start: state.mainWizard.periodStart,
        end: state.mainWizard.periodEnd,
        defaultStart: state.mainWizard.periodStart,
        defaultEnd: state.mainWizard.periodEnd,
        maxDate: '2099-12-31',
        onChange: ({ start, end }) => {
            state.mainWizard.periodStart = start;
            state.mainWizard.periodEnd = end;
            const startDate = parseDayKey(start);
            if (startDate && !state.mainWizard.periodLabel.trim()) {
                state.mainWizard.periodLabel = `FY${startDate.getFullYear()}`;
            }
            if (state.mainWizard.template === 'quarterly') {
                state.mainWizard.quarters = buildQuarterSubBudgets();
            }
            const labelInput = el('budget-wizard-period-label-input');
            if (labelInput) labelInput.value = state.mainWizard.periodLabel;
            refreshMainWizardFooter();
        }
    });
}

function isMainWizardStepValid(step = state.mainWizard.step) {
    const wizard = state.mainWizard;
    const datesOk = /^\d{4}-\d{2}-\d{2}$/.test(wizard.periodStart)
        && /^\d{4}-\d{2}-\d{2}$/.test(wizard.periodEnd)
        && wizard.periodEnd > wizard.periodStart;
    if (step === 1) {
        return wizard.name.trim().length > 0 && wizard.periodLabel.trim().length > 0 && datesOk;
    }
    if (step === 2) return Math.round(Number(wizard.totalBudget) || 0) > 0;
    if (step === 3) return areQuarterSubBudgetsValid();
    return wizard.name.trim().length > 0
        && wizard.periodLabel.trim().length > 0
        && datesOk
        && Math.round(Number(wizard.totalBudget) || 0) > 0
        && areQuarterSubBudgetsValid();
}

function areQuarterSubBudgetsValid() {
    const rows = state.mainWizard.quarters || [];
    if (getWizardQuarterTotal() > state.mainWizard.totalBudget) return false;
    return rows.every(row => {
        const amount = Math.round(Math.max(0, Number(row.amount) || 0));
        return row.name.trim().length > 0
            && row.periodLabel.trim().length > 0
            && /^\d{4}-\d{2}-\d{2}$/.test(row.periodStart)
            && /^\d{4}-\d{2}-\d{2}$/.test(row.periodEnd)
            && row.periodEnd > row.periodStart
            && amount > 0
            && Number.isFinite(amount);
    });
}

function mainWizardValidationMessage() {
    const wizard = state.mainWizard;
    if (wizard.step === 1) {
        if (!wizard.name.trim()) return 'Budget name is required.';
        if (!wizard.periodLabel.trim()) return 'Annual label is required.';
        if (!wizard.periodStart || !wizard.periodEnd) return 'Select a valid start and end date.';
        if (wizard.periodEnd <= wizard.periodStart) return 'End date must be after start date.';
    }
    if (wizard.step === 2 && wizard.totalBudget <= 0) return 'Annual budget amount must be greater than zero.';
    if (wizard.step >= 3) {
        if (getWizardQuarterTotal() > wizard.totalBudget) return `Quarterly sub-budgets exceed the annual budget by ${formatRp(getWizardQuarterTotal() - wizard.totalBudget)}.`;
        const badRow = wizard.quarters.find(row => !row.name.trim() || !row.periodLabel.trim() || Math.round(Number(row.amount) || 0) <= 0);
        if (badRow) return 'Every quarterly sub-budget needs a name, label, and amount greater than zero.';
    }
    return '';
}

function refreshMainWizardFooter() {
    const step = WIZARD_STEPS.find(s => s.id === state.mainWizard.step) || WIZARD_STEPS[0];
    el('budget-wizard-step-label').textContent = `Step ${state.mainWizard.step} of 4 · ${step.label}`;
    el('budget-wizard-back')?.classList.toggle('hidden', state.mainWizard.step === 1);
    const primary = el('budget-wizard-primary');
    const finalStep = state.mainWizard.step === 4;
    const valid = isMainWizardStepValid();
    if (primary) {
        primary.disabled = state.mainWizard.saving || !valid;
        primary.textContent = state.mainWizard.saving ? 'Saving...' : finalStep ? 'Create budget' : 'Continue';
    }
    const error = el('budget-wizard-error');
    const message = valid ? '' : mainWizardValidationMessage();
    if (error) {
        error.textContent = message;
        error.classList.toggle('hidden', !message);
    }
    const totalHelper = el('budget-wizard-total-helper');
    if (totalHelper) totalHelper.textContent = `${formatRp(state.mainWizard.totalBudget)} over ${state.mainWizard.periodLabel || 'this annual period'}`;
    if (el('budget-wizard-start-display')) el('budget-wizard-start-display').textContent = state.mainWizard.periodStart || '—';
    if (el('budget-wizard-end-display')) el('budget-wizard-end-display').textContent = state.mainWizard.periodEnd || '—';
    const plannedEl = el('budget-wizard-quarter-sum');
    const totalEl = el('budget-wizard-total-display');
    const statusEl = el('budget-wizard-quarter-status');
    const warningEl = el('budget-wizard-quarter-warning');
    const previewEl = el('budget-wizard-preview-bar');
    const over = Math.max(0, getWizardQuarterTotal() - state.mainWizard.totalBudget);
    if (plannedEl) plannedEl.textContent = formatRp(getWizardQuarterTotal());
    if (totalEl) totalEl.textContent = formatRp(state.mainWizard.totalBudget);
    if (statusEl) {
        statusEl.textContent = over ? `Over by ${formatRp(over)}` : getWizardQuarterRemaining() === 0 ? 'Fully planned' : `${formatRp(getWizardQuarterRemaining())} not planned`;
        statusEl.className = `font-mono text-[13px] font-bold ${over ? 'text-red-600' : getWizardQuarterRemaining() === 0 ? 'text-emerald-600' : 'text-gray-500'}`;
    }
    if (warningEl) {
        warningEl.textContent = over ? `Quarterly sub-budgets exceed the annual budget by ${formatRp(over)}.` : '';
        warningEl.classList.toggle('hidden', !over);
    }
    if (previewEl) previewEl.innerHTML = quarterPreviewHtml({ compact: true });
}

async function handleMainBudgetWizardSubmit(event) {
    event.preventDefault();
    if (!isMainWizardStepValid()) {
        refreshMainWizardFooter();
        return;
    }
    if (state.mainWizard.step < 4) {
        if (state.mainWizard.step === 2 && state.mainWizard.template === 'quarterly' && !state.mainWizard.quarters.length) {
            state.mainWizard.quarters = buildQuarterSubBudgets();
        }
        state.mainWizard.step += 1;
        renderMainBudgetWizard();
        return;
    }
    await saveMainBudgetWizard();
}

async function saveMainBudgetWizard() {
    if (!isMainWizardStepValid(4) || state.mainWizard.saving) {
        refreshMainWizardFooter();
        return;
    }
    state.mainWizard.saving = true;
    refreshMainWizardFooter();
    try {
        const wizard = state.mainWizard;
        const result = await state.ds.addBudgetWithAllocations(state.user.uid, {
            budget_id: null,
            name: wizard.name.trim(),
            budget_type: 'annual',
            parent_budget_id: null,
            period_type: 'yearly',
            period_label: wizard.periodLabel.trim(),
            period_start: parseDayKey(wizard.periodStart),
            period_end: parseDayKey(wizard.periodEnd, true),
            total_budget: Math.round(Math.max(0, Number(wizard.totalBudget) || 0)),
            currency: 'IDR',
            notes: wizard.notes.trim()
        }, []);

        const mainBudgetId = result?.budget?.id;
        if (!mainBudgetId) throw new Error('Main budget was created without an id.');

        for (const row of wizard.quarters) {
            await state.ds.addBudgetWithAllocations(state.user.uid, {
                budget_id: null,
                name: row.name.trim(),
                budget_type: 'period',
                parent_budget_id: mainBudgetId,
                period_type: 'quarterly',
                period_label: row.periodLabel.trim(),
                period_start: parseDayKey(row.periodStart),
                period_end: parseDayKey(row.periodEnd, true),
                total_budget: Math.round(Math.max(0, Number(row.amount) || 0)),
                currency: 'IDR',
                notes: ''
            }, []);
        }

        state.selectedMainBudgetId = mainBudgetId;
        window.showToast?.('Main budget created.', 'success');
        state.mainWizard.saving = false;
        closeMainBudgetWizard();
        await loadAndRender();
    } catch (error) {
        console.error('Main budget save failed:', error);
        state.mainWizard.saving = false;
        const message = error?.message || 'Could not save this main budget. Please try again.';
        window.showToast?.(message, 'error');
        const errorEl = el('budget-wizard-error');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.classList.remove('hidden');
        }
        refreshMainWizardFooter();
    }
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
