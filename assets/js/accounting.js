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
    invoices: '/invoices',
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
    state.kernel = { loadedPeriod: null, coa: [], journals: [], trial: null, period: null };

    // Idempotent: seed the Chart of Accounts so the ledger views and posting
    // engine have accounts to reference. Best-effort — a viewer without write
    // access simply reads whatever already exists. loadKernel() awaits this so the
    // first ledger read never races an empty (un-seeded) chart.
    state.seedPromise = ds.seedChartOfAccounts(user.uid).catch(() => {});

    mountPicker();
    wireStaticControls();
    load();
}

// The accounting period these ledger views scope to: the month of the selected
// start day (accounting periods are monthly 'YYYY-MM').
function currentPeriodKey() {
    return String(state.startKey || getMonthStartKey()).slice(0, 7);
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

    el('ledger-account-select')?.addEventListener('change', (e) => renderGeneralLedger(e.target.value));
    el('close-period-btn')?.addEventListener('click', () => onClosePeriod());
    el('reopen-period-btn')?.addEventListener('click', () => onReopenPeriod());
    el('journals-new-manual')?.addEventListener('click', () => { window.location.href = 'accounting-journal-new.html'; });
    el('journals-post-pending')?.addEventListener('click', () => onPostPending());
}

// Imported entries (CSV / bank statements) post their journals via a sweep rather
// than inline. Surface the backlog + a one-click post action.
function renderPendingBanner() {
    const banner = el('journals-pending');
    if (!banner) return;
    const n = Number(state.kernel.pending) || 0;
    banner.classList.toggle('hidden', n <= 0);
    if (n > 0 && el('journals-pending-count')) el('journals-pending-count').textContent = String(n);
}

async function onPostPending() {
    const btn = el('journals-post-pending');
    if (btn) { btn.disabled = true; btn.textContent = 'Posting…'; }
    try {
        const res = await state.ds.postPendingJournals(state.user.uid);
        const parts = [`Posted ${res.posted}`];
        if (res.excluded) parts.push(`${res.excluded} skipped (non-posting)`);
        if (res.skippedClosed) parts.push(`${res.skippedClosed} in closed periods`);
        window.showToast?.(parts.join(' · '), 'success');
        await loadKernel(true);
    } catch (err) {
        console.error('Post pending failed:', err);
        await window.showAlertDialog?.({ title: 'Could not post pending entries', body: escapeHtml(err.message || 'Please try again.'), tone: 'danger' });
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Post pending entries'; }
    }
}

function openFluxyAI() {
    if (typeof window.toggleFluxyAI === 'function') window.toggleFluxyAI(true);
    else window.showToast?.('Fluxy AI is still loading. Try again in a moment.', 'info');
}

const KERNEL_TABS = new Set(['journals', 'ledger', 'trial', 'coa']);

function setTab(tab) {
    if (!tab) return;
    state.activeTab = tab;
    document.querySelectorAll('[data-acct-tab]').forEach(btn => {
        btn.classList.toggle('is-active', btn.getAttribute('data-acct-tab') === tab);
    });
    document.querySelectorAll('[data-acct-panel]').forEach(panel => {
        panel.classList.toggle('hidden', panel.getAttribute('data-acct-panel') !== tab);
    });
    // Ledger views read the new accounting collections lazily — only when their
    // tab is first opened for the active period, so the page load stays light.
    if (KERNEL_TABS.has(tab)) loadKernel();
}

// Fetch CoA + journals + trial balance for the active period and render the four
// accounting-workspace panels. Cached per period; a period change clears it.
async function loadKernel(force = false) {
    const pk = currentPeriodKey();
    if (!force && state.kernel.loadedPeriod === pk) return;
    state.kernel.loadedPeriod = pk; // claim early to avoid duplicate fetches
    try {
        await state.seedPromise; // ensure the chart exists before the first read
        const [coa, journals, trial, period, pending] = await Promise.all([
            state.ds.getChartOfAccounts(state.user.uid),
            state.ds.listJournals(state.user.uid, { periodKey: pk, includeDrafts: true }),
            state.ds.getTrialBalance(state.user.uid, { periodKey: pk }),
            state.ds.getPeriod(state.user.uid, pk),
            state.ds.countPendingPostings(state.user.uid).catch(() => 0)
        ]);
        state.kernel = { loadedPeriod: pk, coa, journals, trial, period, pending };
        renderJournals();
        renderPendingBanner();
        renderTrialBalance();
        renderChartOfAccounts();
        renderLedgerSelector();
        renderClosePanel();
    } catch (err) {
        console.error('Accounting kernel load failed:', err);
        state.kernel.loadedPeriod = null; // allow a retry on next tab open
    }
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
    // Deep-link transactions to the specific record so the Ledger opens it
    // regardless of its month; other sources keep their plain page link.
    const href = (link && item.source_collection === 'transactions' && item.source_id)
        ? `${link}?record=${encodeURIComponent(item.source_id)}`
        : link;
    const amount = formatRupiah(item.amount);
    const meta = [item.vendor_name, amount].filter(Boolean).map(escapeHtml).join(' · ');
    const action = href
        ? `<a href="${escapeHtml(href)}" class="acct-btn acct-btn-secondary" style="text-decoration:none;">Open</a>`
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

// =====================================================================
// ACCOUNTING WORKSPACE — ledger read surfaces (Phase 2)
// Journal Register, General Ledger, Trial Balance, Chart of Accounts, and
// the working period-close panel. Data comes from the accounting kernel
// (db-service getChartOfAccounts / listJournals / getTrialBalance /
// getGeneralLedger / getPeriod / closePeriod).
// =====================================================================

const RULE_LABELS = {
    'TXN-EXP-CASH': 'Expense paid', 'TXN-INC-CASH': 'Income received', 'TXN-OPEX-CASH': 'Fee / tax paid',
    'TXN-ACCRUE-AR': 'Accrued receivable', 'TXN-ACCRUE-AP': 'Accrued payable',
    'BILL-ACCRUE': 'Bill accrued', 'BILL-PAY': 'Bill paid', 'SUB-ACCRUE': 'Subscription accrued',
    'INV-ISSUE': 'Invoice issued', 'INV-PAY': 'Invoice paid', 'OPENING': 'Opening balance', 'CLOSE': 'Period close'
};
function prettyRule(id) {
    if (!id) return 'Journal';
    if (String(id).startsWith('REVERSAL')) return 'Reversal';
    return RULE_LABELS[id] || id;
}
function srcLabel(j) {
    const s = j.source || {};
    const c = String(s.collection || '').replace(/s$/, '');
    return `${c || 'source'} ${String(s.id || '').slice(0, 6)}`;
}
function tableShell(cols, bodyRows) {
    const head = cols.map(c => `<th${c.money ? ' class="fluxy-table-money"' : ''}>${escapeHtml(c.label)}</th>`).join('');
    return `<table class="fluxy-table"><thead><tr class="fluxy-table-header">${head}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}
function emptyState(title, desc) {
    return `<div class="fluxy-table-empty"><div class="fluxy-table-empty-title">${escapeHtml(title)}</div><div class="fluxy-table-empty-description">${escapeHtml(desc)}</div></div>`;
}

// Deep link to a journal's source document, using the app-wide /<page>?record=<id>
// contract every list page consumes.
function sourceDeepLink(source) {
    if (!source || !source.collection || !source.id) return '';
    const base = SOURCE_LINKS[source.collection];
    if (!base) return '';
    // Invoices open by ?invoice=<id>; every other list page consumes ?record=<id>.
    const param = source.collection === 'invoices' ? 'invoice' : 'record';
    return `${base}?${param}=${encodeURIComponent(source.id)}`;
}

// Deep link to the Journal Detail page (the central accounting drill-down hub).
function journalDetailLink(id) { return `accounting-journal.html?id=${encodeURIComponent(id)}`; }
// Drafts open the manual-journal editor to resume editing.
function journalDraftLink(id) { return `accounting-journal-new.html?draft=${encodeURIComponent(id)}`; }

// "21 Jun" posting date from posted_at (or created_at for drafts), Asia/Jakarta.
function journalDate(j) {
    const t = j.posted_at || j.created_at;
    const ms = t && typeof t.toMillis === 'function' ? t.toMillis()
        : (t && typeof t.seconds === 'number' ? t.seconds * 1000 : null);
    if (!ms) return j.status === 'draft' ? 'Not posted' : (j.period_key || '');
    return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Jakarta' });
}

// [semanticClass, label] for the status badge.
function journalStatusBadge(j) {
    if (j.status === 'draft') return ['fluxy-status-neutral', 'Draft'];
    if (j.reversed_by_journal_id) return ['fluxy-status-warning', 'Reversed'];
    if (j.status === 'reversal' || String(j.posting_rule_id || '').startsWith('REVERSAL')) return ['fluxy-status-info', 'Reversal'];
    if (!j.is_balanced) return ['fluxy-status-danger', 'Check'];
    return ['fluxy-status-success', 'Posted'];
}

function journalTypeOf(j) { return j.journal_type || (j.posting_rule_id === 'MANUAL' ? 'manual' : 'system'); }

function journalSourceText(j) {
    if (j.source_number) return j.source_number;
    if (j.source && j.source.collection) return `${String(j.source.collection).replace(/s$/, '')} · ${String(j.source.id).slice(0, 8)}`;
    return journalTypeOf(j) === 'manual' ? 'Manual' : '—';
}

// Active register filters (period comes from the page-level date picker).
const journalFilters = { search: '', status: '', type: '', source: '', account: '' };

function applyJournalFilters(rows) {
    return (rows || []).filter(j => {
        if (journalFilters.status && (j.status || 'posted') !== journalFilters.status) return false;
        if (journalFilters.type && journalTypeOf(j) !== journalFilters.type) return false;
        if (journalFilters.source) {
            const sc = (j.source && j.source.collection) || 'manual';
            if (journalFilters.source === 'manual' ? sc !== 'manual' : sc !== journalFilters.source) return false;
        }
        if (journalFilters.account && !(j.lines || []).some(l => l.account_code === journalFilters.account)) return false;
        if (journalFilters.search) {
            const q = journalFilters.search.toLowerCase();
            const hay = [j.journal_number, j.description, j.memo, j.source_number, prettyRule(j.posting_rule_id)];
            if (!hay.some(v => String(v || '').toLowerCase().includes(q))) return false;
        }
        return true;
    });
}

// Can the current member create manual journals? (UX gate; rules are the boundary.)
function canManualJournal() {
    const ws = (typeof window !== 'undefined') ? window.FluxyWorkspace : null;
    if (ws && typeof ws.can === 'function' && ws.role) return ws.can('journals.manual');
    return true; // solo/owner or unresolved workspace — rules still enforce
}

// Populate the account filter + bind toolbar controls once.
function wireJournalToolbar() {
    const toolbar = el('journals-toolbar');
    if (!toolbar) return;
    const newBtn = el('journals-new-manual');
    if (newBtn) newBtn.classList.toggle('hidden', !canManualJournal());
    if (toolbar.dataset.wired) { syncJournalAccountFilter(); return; }
    toolbar.dataset.wired = '1';
    syncJournalAccountFilter();
    const bind = (id, key, evt) => el(id)?.addEventListener(evt, (e) => { journalFilters[key] = e.target.value.trim(); renderJournals(); });
    bind('journals-filter-search', 'search', 'input');
    bind('journals-filter-status', 'status', 'change');
    bind('journals-filter-type', 'type', 'change');
    bind('journals-filter-source', 'source', 'change');
    bind('journals-filter-account', 'account', 'change');
    el('journals-filter-clear')?.addEventListener('click', () => {
        Object.keys(journalFilters).forEach(k => { journalFilters[k] = ''; });
        ['journals-filter-search', 'journals-filter-status', 'journals-filter-type', 'journals-filter-source', 'journals-filter-account']
            .forEach(id => { const n = el(id); if (n) n.value = ''; });
        renderJournals();
    });
}

// Fill the account <select> from the chart of accounts (after coa loads).
function syncJournalAccountFilter() {
    const sel = el('journals-filter-account');
    if (!sel || sel.dataset.filled === String((state.kernel.coa || []).length)) return;
    const cur = sel.value;
    const opts = (state.kernel.coa || []).map(a => `<option value="${escapeHtml(a.code)}">${escapeHtml(a.code)} · ${escapeHtml(a.name)}</option>`).join('');
    sel.innerHTML = `<option value="">All accounts</option>${opts}`;
    sel.value = cur;
    sel.dataset.filled = String((state.kernel.coa || []).length);
}

function renderJournals() {
    const wrap = el('journals-content');
    if (!wrap) return;
    if (el('journals-period')) el('journals-period').textContent = currentPeriodKey();
    wireJournalToolbar();
    const all = state.kernel.journals || [];
    const rows = applyJournalFilters(all);
    if (!all.length) {
        wrap.innerHTML = emptyState('No journals this period', 'Create a transaction, bill, or invoice — the engine posts its journal automatically. Use New manual journal for adjustments.');
        return;
    }
    if (!rows.length) {
        wrap.innerHTML = emptyState('No matching journals', 'No journals match the current filters. Clear filters to see all entries for this period.');
        return;
    }
    const body = rows.map(j => {
        const isDraft = j.status === 'draft';
        const href = isDraft ? journalDraftLink(j.id) : journalDetailLink(j.id);
        const [badgeClass, badgeLabel] = journalStatusBadge(j);
        const number = j.journal_number || (isDraft ? 'Draft — not numbered' : '—');
        return `<tr class="fluxy-table-row fluxy-table-row-clickable" data-href="${href}" tabindex="0">
            <td class="fluxy-table-cell"><div class="fluxy-table-cell-primary">${escapeHtml(journalDate(j))}</div><div class="fluxy-table-cell-meta">${escapeHtml(j.period_key || '')}</div></td>
            <td class="fluxy-table-cell"><div class="fluxy-table-cell-primary">${escapeHtml(number)}</div><div class="fluxy-table-cell-meta">${escapeHtml(journalTypeOf(j) === 'manual' ? 'Manual' : 'System')}</div></td>
            <td class="fluxy-table-cell"><div class="fluxy-table-cell-meta">${escapeHtml(journalSourceText(j))}</div></td>
            <td class="fluxy-table-cell"><div class="fluxy-table-cell-meta">${escapeHtml(j.description || prettyRule(j.posting_rule_id))}</div></td>
            <td class="fluxy-table-cell fluxy-table-money">${formatRupiah(j.total_debit)}</td>
            <td class="fluxy-table-cell"><span class="fluxy-table-status ${badgeClass}">${badgeLabel}</span></td>
            <td class="fluxy-table-cell fluxy-table-money"><a class="acct-link" href="${href}">${isDraft ? 'Edit' : 'View'} →</a></td>
        </tr>`;
    }).join('');
    wrap.innerHTML = tableShell([
        { label: 'Date' }, { label: 'Journal #' }, { label: 'Source' }, { label: 'Description' },
        { label: 'Amount', money: true }, { label: 'Status' }, { label: 'Actions', money: true }
    ], body);
    wireRowNavigation(wrap);
}

// Delegate row clicks/Enter to navigate to a row's data-href (deep link).
function wireRowNavigation(wrap) {
    if (!wrap || wrap.dataset.navWired) return;
    wrap.dataset.navWired = '1';
    const go = (target) => {
        const row = target.closest('tr[data-href]');
        if (row) window.location.href = row.getAttribute('data-href');
    };
    wrap.addEventListener('click', (e) => go(e.target));
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e.target); });
}

function renderTrialBalance() {
    const wrap = el('trial-content');
    if (!wrap) return;
    if (el('trial-period')) el('trial-period').textContent = currentPeriodKey();
    const tb = state.kernel.trial || { rows: [], totalDebit: 0, totalCredit: 0, balanced: true };
    const flag = el('trial-balance-flag');
    if (flag) {
        flag.textContent = tb.balanced ? 'In balance' : 'Out of balance';
        flag.className = 'acct-pill ' + (tb.balanced ? 'acct-pill-ready' : 'acct-pill-needs');
    }
    if (!tb.rows.length) {
        wrap.innerHTML = emptyState('No postings this period', 'The trial balance fills in as journals post.');
        return;
    }
    const body = tb.rows.map(r => `<tr class="fluxy-table-row fluxy-table-row-clickable" data-account="${escapeHtml(r.account_code)}" tabindex="0">
        <td class="fluxy-table-cell"><div class="fluxy-table-cell-primary">${escapeHtml(r.account_code)} · ${escapeHtml(r.account_name)}</div><div class="fluxy-table-cell-meta">${escapeHtml(r.account_type)}</div></td>
        <td class="fluxy-table-cell fluxy-table-money">${r.debit_amount ? formatRupiah(r.debit_amount) : '—'}</td>
        <td class="fluxy-table-cell fluxy-table-money">${r.credit_amount ? formatRupiah(r.credit_amount) : '—'}</td>
    </tr>`).join('');
    const totals = `<tr class="fluxy-table-row fluxy-table-row-total">
        <td class="fluxy-table-cell">Total</td>
        <td class="fluxy-table-cell fluxy-table-money">${formatRupiah(tb.totalDebit)}</td>
        <td class="fluxy-table-cell fluxy-table-money">${formatRupiah(tb.totalCredit)}</td>
    </tr>`;
    wrap.innerHTML = tableShell([{ label: 'Account' }, { label: 'Debit', money: true }, { label: 'Credit', money: true }], body + totals);
    wireTrialDrilldown(wrap);
}

// Trial Balance rows drill into the General Ledger for that account (TB → GL →
// Journal Detail → source). Avoids the trial balance being a dead-end table.
function wireTrialDrilldown(wrap) {
    if (!wrap || wrap.dataset.drillWired) return;
    wrap.dataset.drillWired = '1';
    const go = (target) => {
        const row = target.closest('tr[data-account]');
        if (row) drillToLedger(row.getAttribute('data-account'));
    };
    wrap.addEventListener('click', (e) => go(e.target));
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e.target); });
}

function drillToLedger(accountCode) {
    if (!accountCode) return;
    setTab('ledger');
    const sel = el('ledger-account-select');
    if (sel) sel.value = accountCode;
    renderGeneralLedger(accountCode);
}

function renderChartOfAccounts() {
    const wrap = el('coa-content');
    if (!wrap) return;
    const coa = state.kernel.coa || [];
    if (!coa.length) {
        wrap.innerHTML = emptyState('Chart of Accounts not seeded yet', 'Open this page with edit access to seed the Indonesian SMB starter chart.');
        return;
    }
    const body = coa.map(a => `<tr class="fluxy-table-row">
        <td class="fluxy-table-cell"><span class="fluxy-table-cell-primary">${escapeHtml(a.code)}</span></td>
        <td class="fluxy-table-cell">${escapeHtml(a.name)}</td>
        <td class="fluxy-table-cell"><span class="fluxy-table-cell-meta">${escapeHtml(a.type)}</span></td>
        <td class="fluxy-table-cell"><span class="fluxy-table-cell-meta">${escapeHtml(a.normal_balance)}</span></td>
        <td class="fluxy-table-cell">${a.is_active !== false ? '<span class="fluxy-table-status fluxy-status-success">Active</span>' : '<span class="fluxy-table-status fluxy-status-neutral">Archived</span>'}</td>
    </tr>`).join('');
    wrap.innerHTML = tableShell([{ label: 'Code' }, { label: 'Account' }, { label: 'Type' }, { label: 'Normal' }, { label: 'Status' }], body);
}

const GL_ALL = '__all__';

function renderLedgerSelector() {
    const sel = el('ledger-account-select');
    if (!sel) return;
    const coa = state.kernel.coa || [];
    const prev = sel.value;
    const opts = coa.map(a => `<option value="${escapeHtml(a.code)}">${escapeHtml(a.code)} · ${escapeHtml(a.name)}</option>`).join('');
    sel.innerHTML = `<option value="${GL_ALL}">All accounts</option>${opts}`;
    // Default to the first real account; keep "All accounts" if it was selected.
    const pick = (prev === GL_ALL || coa.find(a => a.code === prev)) ? prev : (coa[0] ? coa[0].code : '');
    sel.value = pick;
    renderGeneralLedger(pick);
}

// Bumped on every GL render request so a slower in-flight fetch (e.g. the initial
// single-account load) can't clobber a newer selection like "All accounts".
let glRenderSeq = 0;

async function renderGeneralLedger(accountCode) {
    const wrap = el('ledger-content');
    if (!wrap) return;
    const token = ++glRenderSeq;
    if (accountCode === GL_ALL) return renderGeneralLedgerAll(wrap, token);
    if (!accountCode) {
        wrap.innerHTML = emptyState('Pick an account', 'Choose an account to see its ledger activity.');
        return;
    }
    wrap.innerHTML = '<div class="fluxy-table-loading-cell">Loading…</div>';
    try {
        const gl = await state.ds.getGeneralLedger(state.user.uid, accountCode, { periodKey: currentPeriodKey() });
        if (token !== glRenderSeq) return; // superseded by a newer selection
        if (!gl.entries.length) {
            wrap.innerHTML = emptyState('No activity', 'This account has no postings in the selected period.');
            return;
        }
        const body = gl.entries.map(e => `<tr class="fluxy-table-row${e.journal_id ? ' fluxy-table-row-clickable' : ''}"${e.journal_id ? ` data-href="${journalDetailLink(e.journal_id)}" tabindex="0"` : ''}>
            <td class="fluxy-table-cell"><div class="fluxy-table-cell-primary">${escapeHtml(prettyRule(e.posting_rule_id))}</div><div class="fluxy-table-cell-meta">${escapeHtml(e.memo || e.period_key || '')}</div></td>
            <td class="fluxy-table-cell fluxy-table-money">${e.debit ? formatRupiah(e.debit) : '—'}</td>
            <td class="fluxy-table-cell fluxy-table-money">${e.credit ? formatRupiah(e.credit) : '—'}</td>
            <td class="fluxy-table-cell fluxy-table-money">${signedRupiah(e.running_balance)}</td>
        </tr>`).join('');
        const closing = `<tr class="fluxy-table-row fluxy-table-row-total">
            <td class="fluxy-table-cell">Closing balance</td><td class="fluxy-table-cell fluxy-table-money">—</td><td class="fluxy-table-cell fluxy-table-money">—</td>
            <td class="fluxy-table-cell fluxy-table-money">${signedRupiah(gl.closing)}</td></tr>`;
        wrap.innerHTML = tableShell([{ label: 'Entry' }, { label: 'Debit', money: true }, { label: 'Credit', money: true }, { label: 'Running', money: true }], body + closing);
        wireRowNavigation(wrap);
    } catch (err) {
        console.error('General ledger load failed:', err);
        wrap.innerHTML = emptyState('Could not load ledger', 'Please try again.');
    }
}

// "All accounts" view: every account with activity rendered as its own ledger
// section (header + entries + running balance + closing). Built from one journals
// fetch; rows still drill into Journal Detail.
async function renderGeneralLedgerAll(wrap, token) {
    if (token == null) token = ++glRenderSeq;
    wrap.innerHTML = '<div class="fluxy-table-loading-cell">Loading…</div>';
    try {
        const accounts = await state.ds.getGeneralLedgerAll(state.user.uid, { periodKey: currentPeriodKey() });
        if (token !== glRenderSeq) return; // superseded by a newer selection
        if (!accounts.length) {
            wrap.innerHTML = emptyState('No activity', 'No accounts have postings in the selected period.');
            return;
        }
        const sections = accounts.map(acct => {
            const body = acct.entries.map(e => `<tr class="fluxy-table-row${e.journal_id ? ' fluxy-table-row-clickable' : ''}"${e.journal_id ? ` data-href="${journalDetailLink(e.journal_id)}" tabindex="0"` : ''}>
                <td class="fluxy-table-cell"><div class="fluxy-table-cell-primary">${escapeHtml(prettyRule(e.posting_rule_id))}</div><div class="fluxy-table-cell-meta">${escapeHtml(e.memo || e.period_key || '')}</div></td>
                <td class="fluxy-table-cell fluxy-table-money">${e.debit ? formatRupiah(e.debit) : '—'}</td>
                <td class="fluxy-table-cell fluxy-table-money">${e.credit ? formatRupiah(e.credit) : '—'}</td>
                <td class="fluxy-table-cell fluxy-table-money">${signedRupiah(e.running_balance)}</td>
            </tr>`).join('');
            const closing = `<tr class="fluxy-table-row fluxy-table-row-total">
                <td class="fluxy-table-cell">Closing balance</td><td class="fluxy-table-cell fluxy-table-money">—</td><td class="fluxy-table-cell fluxy-table-money">—</td>
                <td class="fluxy-table-cell fluxy-table-money">${signedRupiah(acct.closing)}</td></tr>`;
            return `<div class="acct-gl-section">
                <button type="button" class="acct-gl-section-head" data-gl-account="${escapeHtml(acct.account_code)}" title="Open just this account">
                    <span><strong>${escapeHtml(acct.account_code)}</strong> · ${escapeHtml(acct.account_name)}</span>
                    <span class="acct-gl-section-type">${escapeHtml(acct.account_type)}</span>
                </button>
                ${tableShell([{ label: 'Entry' }, { label: 'Debit', money: true }, { label: 'Credit', money: true }, { label: 'Running', money: true }], body + closing)}
            </div>`;
        }).join('');
        wrap.innerHTML = sections;
        wireRowNavigation(wrap);
        // A section header narrows the view to that single account.
        if (!wrap.dataset.glHeadWired) {
            wrap.dataset.glHeadWired = '1';
            wrap.addEventListener('click', (e) => {
                const head = e.target.closest('.acct-gl-section-head');
                if (!head) return;
                const code = head.getAttribute('data-gl-account');
                const sel = el('ledger-account-select');
                if (sel) sel.value = code;
                renderGeneralLedger(code);
            });
        }
    } catch (err) {
        console.error('General ledger (all) load failed:', err);
        wrap.innerHTML = emptyState('Could not load ledger', 'Please try again.');
    }
}

function renderClosePanel() {
    const pk = currentPeriodKey();
    if (el('close-period-label')) el('close-period-label').textContent = pk;
    const status = el('close-status');
    const btn = el('close-period-btn');
    if (!status || !btn) return;
    const period = state.kernel.period || { status: 'open' };
    const tb = state.kernel.trial || { balanced: true, rows: [] };
    const reopenBtn = el('reopen-period-btn');
    // Reopen is owner/admin only (mirrors the firestore.rules gate).
    const canReopen = !!(window.FluxyWorkspace && typeof window.FluxyWorkspace.can === 'function'
        ? window.FluxyWorkspace.can('period.lock')
        : false);
    if (period.status === 'closed' || period.status === 'locked') {
        status.innerHTML = `<span class="fluxy-table-status fluxy-status-neutral">Period ${escapeHtml(period.status)}</span>`;
        btn.classList.add('hidden');
        if (reopenBtn) reopenBtn.classList.toggle('hidden', !canReopen);
        return;
    }
    btn.classList.remove('hidden');
    if (reopenBtn) reopenBtn.classList.add('hidden');
    if (!tb.rows.length) {
        status.innerHTML = '<span class="fluxy-table-status fluxy-status-neutral">No postings to close</span>';
        btn.disabled = true;
        btn.textContent = 'Close period';
        return;
    }
    if (!tb.balanced) {
        status.innerHTML = '<span class="fluxy-table-status fluxy-status-danger">Trial balance is out of balance</span>';
        btn.disabled = true;
        btn.textContent = 'Close period';
        return;
    }
    status.innerHTML = '<span class="fluxy-table-status fluxy-status-success">Trial balance is in balance</span>';
    btn.disabled = false;
    btn.textContent = 'Close period';
}

async function onClosePeriod() {
    const pk = currentPeriodKey();
    const ok = await window.showConfirmDialog?.({
        title: `Close ${pk}?`,
        body: 'This posts a closing journal that rolls net income into <strong>Retained Earnings</strong> and locks the period. New postings to this period will be blocked.',
        confirmLabel: 'Close period',
        cancelLabel: 'Cancel',
        tone: 'default'
    });
    if (ok === false) return;
    const btn = el('close-period-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Closing…'; }
    try {
        const res = await state.ds.closePeriod(state.user.uid, pk);
        window.showToast?.(`Closed ${pk}. Net ${signedRupiah(res.net)} posted to Retained Earnings.`, 'success');
        await loadKernel(true);
    } catch (err) {
        console.error('Close period failed:', err);
        await window.showAlertDialog?.({ title: 'Could not close period', body: escapeHtml(err.message || 'Please try again.'), tone: 'danger' });
        renderClosePanel();
    }
}

async function onReopenPeriod() {
    const pk = currentPeriodKey();
    const ok = await window.showConfirmDialog?.({
        title: `Reopen ${pk}?`,
        body: 'This reverses the closing journal (backing net income out of <strong>Retained Earnings</strong>) and unlocks the period so it accepts new postings. The reversal stays on the audit trail.',
        confirmLabel: 'Reopen period',
        cancelLabel: 'Cancel',
        tone: 'default'
    });
    if (ok === false) return;
    const btn = el('reopen-period-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Reopening…'; }
    try {
        const res = await state.ds.reopenPeriod(state.user.uid, pk);
        window.showToast?.(`Reopened ${pk}.${res.reversed_close_journals ? ' Closing entry reversed.' : ''}`, 'success');
        await loadKernel(true);
    } catch (err) {
        console.error('Reopen period failed:', err);
        await window.showAlertDialog?.({ title: 'Could not reopen period', body: escapeHtml(err.message || 'Please try again.'), tone: 'danger' });
        renderClosePanel();
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Reopen period'; }
    }
}
