// Accounting Center page controller — Phase 1.
// Primary surface is the Income Statement Preview (a deterministic P&L built from
// ledger transactions). Readiness is reused as supporting "report confidence"
// metadata, not the main experience. The Cleanup, Account Mapping, and Close tabs
// keep the read-only readiness flows. No journal posting, no period close, no AI
// writes. All data access goes through DataService.

const state = {
    ds: null,
    user: null,
    startKey: null,
    endKey: null,
    picker: null,
    activeTab: 'income',
    loading: false,
    data: null,
    rowsById: {}
};

// Display-only account catalog for the mapping <select>. Mirrors the catalog in
// db-service.js (which is the source of truth used for validation/save).
const ACCOUNT_OPTIONS = [
    { code: '1100', name: 'Accounts Receivable', type: 'asset' },
    { code: '2000', name: 'Accounts Payable', type: 'liability' },
    { code: '4000', name: 'Revenue', type: 'revenue' },
    { code: '6100', name: 'Marketing Expense', type: 'expense' },
    { code: '6200', name: 'Software / SaaS Expense', type: 'expense' },
    { code: '6300', name: 'Infrastructure Expense', type: 'expense' },
    { code: '6400', name: 'Operations Expense', type: 'expense' },
    { code: '6500', name: 'Tax Expense', type: 'expense' },
    { code: '6600', name: 'Bank Fees', type: 'expense' },
    { code: '6999', name: 'Other Expense', type: 'expense' }
];

const TONE_COLOR = { success: '#16A34A', warning: '#EA580C', danger: '#EF4444', neutral: '#94A3B8' };
const TONE_PILL = { success: 'acct-pill-ready', warning: 'acct-pill-almost', danger: 'acct-pill-needs', neutral: 'acct-pill-planned' };
const TONE_STATUS = { success: 'fluxy-status-success', warning: 'fluxy-status-warning', danger: 'fluxy-status-danger', neutral: 'fluxy-status-neutral' };

const SOURCE_LINKS = {
    transactions: '/ledger',
    bills: '/bill',
    subscriptions: '/subscription',
    bank_statement_imports: '/integration'
};
// --- helpers ---
function el(id) { return document.getElementById(id); }

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatRupiah(n) {
    if (n === null || n === undefined || n === '') return null;
    const value = Number(n);
    if (!Number.isFinite(value)) return null;
    return `Rp${Math.abs(Math.round(value)).toLocaleString('id-ID')}`;
}

// Signed display: negatives wrapped in parentheses, e.g. (Rp4.750.000).
function signedRupiah(n) {
    const value = Number(n) || 0;
    const text = formatRupiah(value) || 'Rp0';
    return value < 0 ? `(${text})` : text;
}

function getDayKey(date = new Date()) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
function getMonthStartKey(date = new Date()) { return getDayKey(new Date(date.getFullYear(), date.getMonth(), 1)); }
function getMonthEndKey(date = new Date()) { return getDayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0)); }

function show(id) { el(id)?.classList.remove('hidden'); }
function hide(id) { el(id)?.classList.add('hidden'); }

// --- boot ---
export function initAccountingPage({ ds, user }) {
    state.ds = ds;
    state.user = user;
    state.startKey = getMonthStartKey();
    state.endKey = getMonthEndKey();

    mountPicker();
    wireStaticControls();
    load();
}

function mountPicker() {
    if (!window.FluxyDateRangePicker) return;
    state.picker = window.FluxyDateRangePicker.mount('#accounting-date-range-picker', {
        start: state.startKey,
        end: state.endKey,
        onChange: ({ start, end }) => {
            state.startKey = start;
            state.endKey = end;
            load();
        }
    });
}

function wireStaticControls() {
    el('acct-ask-ai')?.addEventListener('click', () => openFluxyAI());
    el('acct-retry')?.addEventListener('click', () => load());

    document.querySelectorAll('[data-acct-tab]').forEach(btn => {
        btn.addEventListener('click', () => setTab(btn.getAttribute('data-acct-tab')));
    });
}

function openFluxyAI() {
    if (typeof window.toggleFluxyAI === 'function') window.toggleFluxyAI(true);
    else window.showToast?.('Fluxy AI is still loading. Try again in a moment.', 'info');
}

function setTab(tab) {
    if (!tab) return;
    state.activeTab = tab;
    document.querySelectorAll('[data-acct-tab]').forEach(btn => {
        btn.classList.toggle('is-active', btn.getAttribute('data-acct-tab') === tab);
    });
    document.querySelectorAll('[data-acct-panel]').forEach(panel => {
        panel.classList.toggle('hidden', panel.getAttribute('data-acct-panel') !== tab);
    });
}

// --- data load ---
async function load() {
    if (state.loading) return;
    state.loading = true;
    show('accounting-loading');
    hide('accounting-error');
    hide('accounting-content');

    try {
        const data = await state.ds.getIncomeStatementPreview(state.user.uid, {
            start: state.startKey,
            end: state.endKey
        });
        state.data = data;
        hide('accounting-loading');

        // Always render the full layout — KPI strip, tabs, and tables. When the
        // period has no records, the KPIs read Rp0 and each table/section shows
        // its own inline empty state (see renderIncomeStatement / renderCleanup /
        // renderMapping). This keeps the page explorable instead of collapsing to
        // a single centered "no data" card.
        render(data);
        show('accounting-content');
    } catch (err) {
        console.error('Income statement preview failed:', err);
        hide('accounting-loading');
        show('accounting-error');
    } finally {
        state.loading = false;
    }
}

// --- render ---
function render(data) {
    renderKpis(data);
    indexRows(data);
    renderIncomeStatement(data);

    const readiness = data.readiness;
    if (readiness) {
        renderCleanup(readiness);
        renderMapping(readiness);
        renderClose(readiness);
        el('tab-cleanup-count').textContent = `${readiness.cleanupItems.length}`;
    }
    setTab(state.activeTab);
}

function renderKpis(data) {
    const s = data.summary;
    el('kpi-revenue-value').textContent = formatRupiah(s.revenue) || 'Rp0';
    el('kpi-gross-value').textContent = signedRupiah(s.gross_profit);
    el('kpi-gross-sub').textContent = `${s.gross_margin_pct}% gross margin`;
    el('kpi-opex-value').textContent = formatRupiah(s.operating_expenses) || 'Rp0';
    el('kpi-net-value').textContent = signedRupiah(s.net_income);
    el('kpi-net-sub').textContent = `${s.net_margin_pct}% net margin`;

    const c = data.confidence;
    el('kpi-readiness-value').textContent = (c.score === null || c.score === undefined) ? '—' : `${c.score}`;
    const ring = el('kpi-readiness-ring');
    if (ring) {
        ring.style.setProperty('--pct', (c.score === null || c.score === undefined) ? 0 : c.score);
        ring.style.setProperty('--ring-color', TONE_COLOR[c.tone] || TONE_COLOR.neutral);
    }
    const band = el('kpi-readiness-band');
    band.textContent = c.label;
    band.className = `acct-pill ${TONE_PILL[c.tone] || TONE_PILL.neutral}`;
}


// --- income statement table ---
function indexRows(data) {
    const map = {};
    (data.rows || []).forEach(row => {
        map[row.id] = { ...row };
        (row.children || []).forEach(child => { map[child.id] = { ...child, parent_id: row.id }; });
    });
    state.rowsById = map;
}

function amountCell(value, kind) {
    const v = Number(value) || 0;
    if (kind === 'cost') {
        if (v === 0) return { text: 'Rp0', cls: 'is-zero' };
        return { text: `(${formatRupiah(v)})`, cls: 'is-neg' };
    }
    if (v < 0) return { text: `(${formatRupiah(v)})`, cls: 'is-neg' };
    if (v === 0) return { text: 'Rp0', cls: 'is-zero' };
    return { text: formatRupiah(v), cls: 'is-pos' };
}

function changeDisplay(row) {
    const c = Number(row.change_amount) || 0;
    let tone = 'neutral';
    if (c !== 0) {
        if (row.kind === 'cost') tone = c > 0 ? 'danger' : 'success';
        else tone = c > 0 ? 'success' : 'danger';
    }
    let text;
    if (c === 0) text = 'Rp0';
    else if (row.kind === 'cost') text = c > 0 ? `(${formatRupiah(c)})` : formatRupiah(c);
    else text = c > 0 ? formatRupiah(c) : `(${formatRupiah(c)})`;

    let pctText;
    if (row.change_pct === null || row.change_pct === undefined) pctText = 'N/A';
    else {
        const p = Number(row.change_pct);
        pctText = `${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
    }
    return { tone, text, pctText, pctTone: (row.change_pct === null || row.change_pct === undefined) ? 'neutral' : tone };
}

function statusCellHtml(row, isChild) {
    const tone = row.status_tone || 'neutral';
    if (row.level === 'subtotal' || row.level === 'total') {
        return `<span class="acct-is-status-text fluxy-table-cell-meta" style="font-weight:600;">${escapeHtml(row.status)}</span>`;
    }
    if (isChild) {
        return `<span class="acct-is-status-text fluxy-table-cell-meta acct-tone-${tone}">${escapeHtml(row.status)}</span>`;
    }
    return `<span class="acct-pill fluxy-table-status ${TONE_STATUS[tone] || TONE_STATUS.neutral} ${TONE_PILL[tone] || TONE_PILL.neutral}">${escapeHtml(row.status)}</span>`;
}

function isActionableIncomeRow(row) {
    return row && row.level !== 'subtotal' && row.level !== 'total';
}

function slugParam(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/_/g, '-')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'revenue';
}

function isFullMonthRange(startKey, endKey) {
    if (!startKey || !endKey) return false;
    return startKey === getMonthStartKey(new Date(`${startKey}T00:00:00`))
        && endKey === getMonthEndKey(new Date(`${startKey}T00:00:00`));
}

function periodQueryValue() {
    if (isFullMonthRange(state.startKey, state.endKey)) return String(state.startKey).slice(0, 7);
    return `${state.startKey}..${state.endKey}`;
}

function comparisonQueryValue() {
    return isFullMonthRange(state.startKey, state.endKey) ? 'previous_month' : 'previous_period';
}

function navigateToRelatedRecords(rowId) {
    const row = state.rowsById[rowId];
    if (!isActionableIncomeRow(row)) return;
    const params = new URLSearchParams();
    params.set('period', periodQueryValue());
    params.set('compare', comparisonQueryValue());
    if (row.parent_id) {
        params.set('section', slugParam(row.label));
        params.set('parent', slugParam(row.parent_id));
        params.set('category', row.label || '');
    } else {
        params.set('section', slugParam(row.id));
    }
    window.location.href = `/accounting-records?${params.toString()}`;
}

function rowTr(row, isChild, parentId) {
    const cur = amountCell(row.current_amount, row.kind);
    const prev = amountCell(row.previous_amount, row.kind);
    const ch = changeDisplay(row);
    const hasChildren = !isChild && row.children && row.children.length;
    const levelClass = isChild
        ? 'acct-is-child'
        : row.level === 'total' ? 'acct-is-total'
        : row.level === 'subtotal' ? 'acct-is-subtotal'
        : 'acct-is-group';
    const chevron = hasChildren
        ? `<button type="button" class="acct-is-chevron" data-toggle="${escapeHtml(row.id)}" aria-label="Toggle ${escapeHtml(row.label)} rows"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6"/></svg></button>`
        : '<span class="acct-is-chevron-spacer"></span>';
    const parentAttr = isChild ? ` data-parent="${escapeHtml(parentId)}"` : '';
    const actionable = isActionableIncomeRow(row);
    const rowAttrs = actionable
        ? ` data-row-id="${escapeHtml(row.id)}" tabindex="0" role="button" aria-label="Open ${escapeHtml(row.label)} records"`
        : ' aria-disabled="true"';
    const fluxyLevelClass = row.level === 'total'
        ? 'fluxy-table-row-final'
        : row.level === 'subtotal'
            ? 'fluxy-table-row-total'
            : '';
    return `
        <tr class="fluxy-table-row ${fluxyLevelClass} acct-is-row ${levelClass} ${actionable ? 'fluxy-table-row-clickable acct-is-actionable' : 'acct-is-static'}"${rowAttrs}${parentAttr}>
            <td class="fluxy-table-cell fluxy-table-cell-primary acct-is-line">${chevron}<span>${escapeHtml(row.label)}</span></td>
            <td class="fluxy-table-cell fluxy-table-money acct-is-num ${cur.cls}">${cur.text}</td>
            <td class="fluxy-table-cell fluxy-table-money acct-is-num ${prev.cls}">${prev.text}</td>
            <td class="fluxy-table-cell fluxy-table-money acct-is-num acct-tone-${ch.tone}">${ch.text}</td>
            <td class="fluxy-table-cell fluxy-table-money acct-is-num acct-tone-${ch.pctTone}">${ch.pctText}</td>
            <td class="fluxy-table-cell acct-is-status">${statusCellHtml(row, isChild)}</td>
        </tr>`;
}

function rowGroupHtml(row) {
    if (row.level === 'group') {
        const children = (row.children || []).map(c => rowTr(c, true, row.id)).join('');
        return rowTr(row, false) + children;
    }
    return rowTr(row, false);
}

function incomeEmptyRow() {
    return `
        <tr>
            <td colspan="6" class="fluxy-table-loading-cell" style="text-align:center;">
                <div class="fluxy-table-empty-title">No income statement data for this period</div>
                <p class="fluxy-table-empty-description" style="margin:6px auto 16px;max-width:440px;">Add transactions, bills, or revenue records and FluxyOS will build the statement here. Switch periods to explore other months.</p>
                <button type="button" class="acct-btn acct-btn-primary" data-add-tx style="margin:0 auto;">Add transaction</button>
            </td>
        </tr>`;
}

function renderIncomeStatement(data) {
    const wrap = el('income-statement-table');
    if (!wrap) return;

    const curLabel = data.period.label;
    const prevLabel = data.comparison_period.label;
    const body = data.hasIncomeData
        ? (data.rows || []).map(rowGroupHtml).join('')
        : incomeEmptyRow();
    wrap.innerHTML = `
        <table class="fluxy-table acct-is-table">
            <thead>
                <tr class="fluxy-table-header">
                    <th class="acct-is-th-line">Line item</th>
                    <th class="fluxy-table-money acct-is-th-num">${escapeHtml(curLabel)}</th>
                    <th class="fluxy-table-money acct-is-th-num">${escapeHtml(prevLabel)}</th>
                    <th class="fluxy-table-money acct-is-th-num">Change</th>
                    <th class="fluxy-table-money acct-is-th-num">Change %</th>
                    <th class="acct-is-th-status">Status</th>
                </tr>
            </thead>
            <tbody>${body}</tbody>
        </table>`;

    if (!data.hasIncomeData) {
        wrap.querySelector('[data-add-tx]')?.addEventListener('click', () => {
            if (typeof window.showAddTransactionModal === 'function') {
                window.showAddTransactionModal({ title: 'Add Transaction', submitLabel: 'Add Transaction', context: 'transaction' });
            } else {
                window.location.href = '/ledger';
            }
        });
        return;
    }

    wireIncomeStatement(wrap);
}

function wireIncomeStatement(wrap) {
    wrap.querySelectorAll('[data-toggle]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-toggle');
            const collapsed = btn.classList.toggle('is-collapsed');
            wrap.querySelectorAll(`tr[data-parent="${CSS.escape(id)}"]`).forEach(tr => {
                tr.classList.toggle('hidden', collapsed);
            });
        });
    });

    wrap.querySelectorAll('tr[data-row-id]').forEach(tr => {
        const open = () => navigateToRelatedRecords(tr.getAttribute('data-row-id'));
        tr.addEventListener('click', open);
        tr.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
    });
}

// --- cleanup / mapping / close (readiness-backed) ---
function severityDot(severity) {
    const cls = severity === 'high' ? 'acct-dot-high' : severity === 'low' ? 'acct-dot-low' : 'acct-dot-medium';
    return `<span class="acct-dot ${cls}" aria-hidden="true"></span>`;
}

function cleanupRowHtml(item) {
    const link = SOURCE_LINKS[item.source_collection] || null;
    const amount = formatRupiah(item.amount);
    const meta = [item.vendor_name, amount].filter(Boolean).map(escapeHtml).join(' · ');
    const action = link
        ? `<a href="${link}" class="acct-btn acct-btn-secondary" style="text-decoration:none;">Open</a>`
        : '';
    return `
        <div class="acct-row">
            ${severityDot(item.severity)}
            <div style="flex:1;min-width:0;">
                <div class="fluxy-body-strong" style="color:#111827;">${escapeHtml(item.label)}</div>
                <div class="fluxy-meta" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.description)}</div>
                ${meta ? `<div class="fluxy-meta acct-mono" style="margin-top:2px;">${meta}</div>` : ''}
            </div>
            <div class="fluxy-meta hidden sm:block" style="max-width:220px;text-align:right;color:#6B7280;">${escapeHtml(item.recommended_action)}</div>
            ${action}
        </div>`;
}

function emptyInline(title, body) {
    return `
        <div style="padding:32px 16px;text-align:center;">
            <div class="fluxy-body-strong" style="color:#111827;margin-bottom:4px;">${escapeHtml(title)}</div>
            <div class="fluxy-meta">${escapeHtml(body)}</div>
        </div>`;
}

function renderCleanup(data) {
    const wrap = el('cleanup-queue-content');
    if (!wrap) return;
    if (!data.cleanupItems.length) {
        wrap.innerHTML = emptyInline('Nothing to clean up', 'Every record in this period is accounting-ready.');
        return;
    }
    const rank = { high: 0, medium: 1, low: 2 };
    const sorted = [...data.cleanupItems].sort((a, b) => (rank[a.severity] - rank[b.severity]));
    wrap.innerHTML = sorted.map(cleanupRowHtml).join('');
}

function mappingPillClass(status) {
    return status === 'saved' ? 'acct-pill-saved' : status === 'suggested' ? 'acct-pill-suggested' : 'acct-pill-unmapped';
}
function mappingPillLabel(status) {
    return status === 'saved' ? 'Saved' : status === 'suggested' ? 'Suggested' : 'Unmapped';
}

function renderMapping(data) {
    const wrap = el('mapping-preview-content');
    if (!wrap) return;
    if (!data.mappingPreview.length) {
        wrap.innerHTML = emptyInline('No categories to map yet', 'Add categorized transactions and they will appear here.');
        return;
    }
    const rows = data.mappingPreview.map((m, idx) => {
        const options = ACCOUNT_OPTIONS.map(opt =>
            `<option value="${opt.code}" ${opt.code === m.target_account_code ? 'selected' : ''}>${escapeHtml(opt.code)} · ${escapeHtml(opt.name)}</option>`
        ).join('');
        return `
            <div class="acct-row" data-mapping-idx="${idx}">
                <div style="flex:1;min-width:140px;">
                    <div class="fluxy-body-strong" style="color:#111827;">${escapeHtml(m.source_value)}</div>
                    <div class="fluxy-meta">${m.source_type === 'transaction_type' ? 'Transaction type' : 'Category'}</div>
                </div>
                <span class="acct-pill ${mappingPillClass(m.status)}">${mappingPillLabel(m.status)}</span>
                <select class="acct-btn acct-btn-secondary" data-mapping-select="${idx}" style="min-width:200px;">${options}</select>
                <button type="button" class="acct-btn acct-btn-ghost" data-mapping-save="${idx}">Save</button>
            </div>`;
    }).join('');
    wrap.innerHTML = `<div style="min-width:560px;">${rows}</div>`;

    wrap.querySelectorAll('[data-mapping-save]').forEach(btn => {
        btn.addEventListener('click', () => handleMappingSave(Number(btn.getAttribute('data-mapping-save'))));
    });
}

async function handleMappingSave(idx) {
    const mapping = state.data?.readiness?.mappingPreview?.[idx];
    if (!mapping) return;
    const select = document.querySelector(`[data-mapping-select="${idx}"]`);
    const code = select ? select.value : mapping.target_account_code;
    const account = ACCOUNT_OPTIONS.find(a => a.code === code);
    if (!account) {
        window.showToast?.('Pick an account before saving.', 'error');
        return;
    }

    const confirmed = await window.showConfirmDialog?.({
        title: 'Save account mapping?',
        body: `<strong>${escapeHtml(mapping.source_value)}</strong> will map to <strong>${escapeHtml(account.code)} ${escapeHtml(account.name)}</strong> for future accounting previews.`,
        confirmLabel: 'Save mapping',
        cancelLabel: 'Cancel',
        tone: 'default'
    });
    if (confirmed === false) return;

    const btn = document.querySelector(`[data-mapping-save="${idx}"]`);
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
        await state.ds.saveAccountingMapping(state.user.uid, {
            source_type: mapping.source_type,
            source_value: mapping.source_value,
            target_account_code: account.code,
            target_account_name: account.name,
            target_account_type: account.type
        });
        window.showToast?.('Account mapping saved.', 'success');
        await load();
        setTab('mapping');
    } catch (err) {
        console.error('Save mapping failed:', err);
        window.showToast?.('Could not save the mapping. Try again.', 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    }
}

function checkRow(label, done) {
    const icon = done
        ? `<span class="acct-check-icon acct-check-done">✓</span>`
        : `<span class="acct-check-icon acct-check-pending">!</span>`;
    return `<div class="acct-check">${icon}<span>${escapeHtml(label)}</span></div>`;
}

function renderClose(data) {
    const wrap = el('close-readiness-content');
    if (!wrap) return;
    const c = data.closeChecklist;
    wrap.innerHTML = [
        checkRow('Transactions reviewed', c.transactions_reviewed),
        checkRow('Missing receipts resolved', c.missing_receipts_resolved),
        checkRow('Bills reviewed', c.bills_reviewed),
        checkRow('Categories mapped to accounts', c.categories_mapped),
        checkRow('Bank imports reviewed', c.bank_imports_reviewed)
    ].join('');
}
