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

const state = {
    ds: null,
    user: null,
    usage: null,         // { budget, allocations, summary, unallocated } or null
    drawerOpen: false,
    datePicker: null,
    periodType: 'monthly',
    periodStart: null,   // 'YYYY-MM-DD'
    periodEnd: null,
    allocRows: []        // [{ name, category, amount }]
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

    el('budget-name').textContent = budget.name || 'Operating Budget';
    el('budget-period').textContent = formatPeriod(budget);

    // ── Summary cards ───────────────────────────────────────────────
    const total = summary.total_amount;
    const allocated = summary.total_allocated;
    const unassigned = summary.unallocated_budget_amount;
    const spentReserved = summary.total_actual_used + summary.total_committed;
    const coveragePercent = total > 0 ? (allocated / total) * 100 : 0;
    const unassignedPercent = total > 0 ? (unassigned / total) * 100 : 0;

    el('budget-total').textContent = formatRp(total);

    el('budget-allocated').textContent = formatRp(allocated);
    el('budget-allocated-hint').textContent = total > 0
        ? `${formatPercent(coveragePercent)} of main budget has a purpose.`
        : 'Set a main budget to start allocating.';

    el('budget-spent').textContent = formatRp(spentReserved);
    if (spentReserved === 0) {
        el('budget-spent-hint').textContent = 'No actual or committed spend yet.';
    } else {
        el('budget-spent-hint').textContent =
            `${formatRp(summary.total_actual_used)} spent · ${formatRp(summary.total_committed)} reserved.`;
    }

    el('budget-unassigned').textContent = formatRp(unassigned);
    el('budget-unassigned-hint').textContent = total > 0
        ? `${formatPercent(unassignedPercent)} still needs allocation.`
        : '—';

    // Orange accent on the Unassigned card only when there's something to act on.
    const unassignedCard = el('budget-unassigned-card');
    if (unassigned > 0) {
        unassignedCard.className = 'rounded-lg p-4 border border-[#EA580C]/40 bg-orange-50/40 transition-colors';
    } else {
        unassignedCard.className = 'bg-gray-50 rounded-lg p-4 border border-gray-100 transition-colors';
    }

    // ── Allocation coverage bar ─────────────────────────────────────
    const coverageClamped = Math.max(0, Math.min(100, coveragePercent));
    el('budget-coverage-percent').textContent = formatPercent(coveragePercent);
    el('budget-coverage-bar').style.width = coverageClamped + '%';

    // ── Unassigned callout / all-assigned note ──────────────────────
    const callout = el('budget-unassigned-callout');
    const allAssignedNote = el('budget-all-assigned-note');
    if (unassigned > 0) {
        el('budget-callout-amount').textContent = formatRp(unassigned);
        callout.classList.remove('hidden');
        allAssignedNote.classList.add('hidden');
    } else {
        callout.classList.add('hidden');
        // Only show the "all assigned" line if the user actually has a budget
        // with allocations; an empty period reads as "—" not as a success.
        if (allocated > 0) allAssignedNote.classList.remove('hidden');
        else allAssignedNote.classList.add('hidden');
    }

    renderAllocationsTable(allocations);
    renderRiskPanel(allocations, unallocated);
    renderUnallocatedCard(unallocated);
}

function classifyStatus(percent) {
    const p = Number.isFinite(percent) ? percent : 0;
    if (p >= 100) return 'exceeded';
    if (p >= 85) return 'at_risk';
    if (p >= 70) return 'watch';
    return 'healthy';
}

function formatPeriod(budget) {
    const start = budget.period_start?.toDate?.();
    const end = budget.period_end?.toDate?.();
    if (!start || !end) return '—';
    const fmt = { day: 'numeric', month: 'short', year: 'numeric' };
    return `${start.toLocaleDateString('id-ID', fmt)} – ${end.toLocaleDateString('id-ID', fmt)}`;
}

function renderAllocationsTable(allocations) {
    const body = el('budget-alloc-body');
    el('budget-alloc-count').textContent = allocations.length
        ? `${allocations.length} allocation${allocations.length === 1 ? '' : 's'}`
        : '';
    if (allocations.length === 0) {
        body.innerHTML = `<tr><td colspan="7" class="px-6 py-10 text-center text-[13px] text-gray-400">No allocations yet. Edit this budget to add Marketing, Infrastructure, Operations, or SaaS allocations.</td></tr>`;
        return;
    }
    body.innerHTML = allocations.map(alloc => {
        const status = STATUS_BADGE[alloc.status] || STATUS_BADGE.healthy;
        const barCls = USAGE_BAR_CLASS[alloc.status] || 'bg-gray-300';
        const usagePercent = Math.max(0, Math.min(100, alloc.usage_percent));
        const scope = (alloc.scope_values || []).join(', ');
        const remainingCls = alloc.remaining_amount < 0 ? 'text-red-600' : 'text-gray-900';
        return `
            <tr class="hover:bg-gray-50/60 transition-colors">
                <td class="px-6 py-4">
                    <p class="font-semibold text-gray-900">${escapeHtml(alloc.name)}</p>
                    <p class="text-[11px] text-gray-400 mt-0.5">Category: ${escapeHtml(scope || '—')}</p>
                </td>
                <td class="px-6 py-4 text-right font-mono text-gray-900">${formatRp(alloc.allocated_amount)}</td>
                <td class="px-6 py-4 text-right font-mono text-gray-700">${formatRp(alloc.actual_used)}</td>
                <td class="px-6 py-4 text-right font-mono text-gray-700">${formatRp(alloc.committed_amount)}</td>
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
}

function renderRiskPanel(allocations, unallocated) {
    const risks = [];
    allocations.forEach(alloc => {
        if (alloc.status === 'exceeded') {
            const overage = Math.max(0, (alloc.actual_used + alloc.committed_amount) - alloc.allocated_amount);
            risks.push(`<strong>${escapeHtml(alloc.name)}</strong> exceeded the allocation by <span class="font-mono font-bold">${formatRp(overage)}</span> (${formatPercent(alloc.usage_percent)} used).`);
        } else if (alloc.status === 'at_risk') {
            risks.push(`<strong>${escapeHtml(alloc.name)}</strong> is at ${formatPercent(alloc.usage_percent)} and has only <span class="font-mono font-bold">${formatRp(alloc.remaining_amount)}</span> remaining.`);
        }
    });
    if (unallocated.actual_amount + unallocated.committed_amount > 0) {
        risks.push(`<span class="font-mono font-bold">${formatRp(unallocated.actual_amount + unallocated.committed_amount)}</span> of spend is not matched to any budget allocation.`);
    }
    const panel = el('budget-risk-panel');
    const list = el('budget-risk-list');
    if (risks.length === 0) {
        panel.classList.add('hidden');
        return;
    }
    panel.classList.remove('hidden');
    list.innerHTML = risks.map(r => `<li class="px-6 py-3 text-[13px] text-amber-800">${r}</li>`).join('');
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
