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
    rowsById: {},
    drawerOpen: false
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

const SOURCE_LINKS = {
    transactions: '/ledger',
    bills: '/bill',
    subscriptions: '/subscription',
    bank_statement_imports: '/integration'
};
const SOURCE_LABEL = {
    transactions: 'Ledger',
    bills: 'Bills',
    subscriptions: 'Subscriptions',
    bank_statement_imports: 'Bank import'
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
    return `Rp ${Math.abs(Math.round(value)).toLocaleString('id-ID')}`;
}

// Signed display: negatives wrapped in parentheses, e.g. (Rp 4.750.000).
function signedRupiah(n) {
    const value = Number(n) || 0;
    const text = formatRupiah(value) || 'Rp 0';
    return value < 0 ? `(${text})` : text;
}

function formatDate(dayKey) {
    if (!dayKey) return '—';
    const parts = String(dayKey).split('-').map(Number);
    if (parts.length !== 3) return dayKey;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && state.drawerOpen) closeDrawer();
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
    closeDrawer();
    show('accounting-loading');
    hide('accounting-error');
    hide('accounting-empty');
    hide('accounting-content');

    try {
        const data = await state.ds.getIncomeStatementPreview(state.user.uid, {
            start: state.startKey,
            end: state.endKey
        });
        state.data = data;
        hide('accounting-loading');

        if (!data.hasData) {
            show('accounting-empty');
            state.loading = false;
            return;
        }
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
    el('kpi-revenue-value').textContent = formatRupiah(s.revenue) || 'Rp 0';
    el('kpi-gross-value').textContent = signedRupiah(s.gross_profit);
    el('kpi-gross-sub').textContent = `${s.gross_margin_pct}% gross margin`;
    el('kpi-opex-value').textContent = formatRupiah(s.operating_expenses) || 'Rp 0';
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
        map[row.id] = row;
        (row.children || []).forEach(child => { map[child.id] = child; });
    });
    state.rowsById = map;
}

function amountCell(value, kind) {
    const v = Number(value) || 0;
    if (kind === 'cost') {
        if (v === 0) return { text: 'Rp 0', cls: 'is-zero' };
        return { text: `(${formatRupiah(v)})`, cls: 'is-neg' };
    }
    if (v < 0) return { text: `(${formatRupiah(v)})`, cls: 'is-neg' };
    if (v === 0) return { text: 'Rp 0', cls: 'is-zero' };
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
    if (c === 0) text = 'Rp 0';
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
        return `<span class="acct-is-status-text" style="font-weight:600;">${escapeHtml(row.status)}</span>`;
    }
    if (isChild) {
        return `<span class="acct-is-status-text acct-tone-${tone}">${escapeHtml(row.status)}</span>`;
    }
    return `<span class="acct-pill ${TONE_PILL[tone] || TONE_PILL.neutral}">${escapeHtml(row.status)}</span>`;
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
    return `
        <tr class="acct-is-row ${levelClass}" data-row-id="${escapeHtml(row.id)}"${parentAttr} tabindex="0" role="button" aria-label="Inspect ${escapeHtml(row.label)}">
            <td class="acct-is-line">${chevron}<span>${escapeHtml(row.label)}</span></td>
            <td class="acct-is-num ${cur.cls}">${cur.text}</td>
            <td class="acct-is-num ${prev.cls}">${prev.text}</td>
            <td class="acct-is-num acct-tone-${ch.tone}">${ch.text}</td>
            <td class="acct-is-num acct-tone-${ch.pctTone}">${ch.pctText}</td>
            <td class="acct-is-status">${statusCellHtml(row, isChild)}</td>
        </tr>`;
}

function rowGroupHtml(row) {
    if (row.level === 'group') {
        const children = (row.children || []).map(c => rowTr(c, true, row.id)).join('');
        return rowTr(row, false) + children;
    }
    return rowTr(row, false);
}

function incomeEmptyInline() {
    return `
        <div style="padding:48px 24px;text-align:center;">
            <div class="fluxy-section-title" style="margin-bottom:6px;">No income statement data for this period</div>
            <p class="fluxy-meta" style="max-width:420px;margin:0 auto 18px;">Add transactions, bills, or revenue records first. FluxyOS will use them to build an income statement preview.</p>
            <button type="button" class="acct-btn acct-btn-primary" data-add-tx style="margin:0 auto;">Add transaction</button>
        </div>`;
}

function renderIncomeStatement(data) {
    const wrap = el('income-statement-table');
    if (!wrap) return;

    if (!data.hasIncomeData) {
        wrap.innerHTML = incomeEmptyInline();
        wrap.querySelector('[data-add-tx]')?.addEventListener('click', () => {
            if (typeof window.showAddTransactionModal === 'function') {
                window.showAddTransactionModal({ title: 'Add Transaction', submitLabel: 'Add Transaction', context: 'transaction' });
            } else {
                window.location.href = '/ledger';
            }
        });
        return;
    }

    const curLabel = data.period.label;
    const prevLabel = data.comparison_period.label;
    const body = (data.rows || []).map(rowGroupHtml).join('');
    wrap.innerHTML = `
        <table class="acct-is-table">
            <thead>
                <tr>
                    <th class="acct-is-th-line">Line item</th>
                    <th class="acct-is-th-num">${escapeHtml(curLabel)}</th>
                    <th class="acct-is-th-num">${escapeHtml(prevLabel)}</th>
                    <th class="acct-is-th-num">Change</th>
                    <th class="acct-is-th-num">Change %</th>
                    <th class="acct-is-th-status">Status</th>
                </tr>
            </thead>
            <tbody>${body}</tbody>
        </table>`;

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
        const open = () => openDrawer(tr.getAttribute('data-row-id'));
        tr.addEventListener('click', open);
        tr.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
    });
}

// --- related-records drawer ---
function ensureDrawer() {
    let overlay = el('acct-drawer-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'acct-drawer-overlay';
    overlay.className = 'acct-drawer-overlay';
    overlay.innerHTML = `
        <aside class="acct-drawer" role="dialog" aria-modal="true" aria-labelledby="acct-drawer-title">
            <div class="acct-drawer-head">
                <div style="min-width:0;">
                    <span class="fluxy-meta" style="text-transform:uppercase;letter-spacing:0.06em;">Related records</span>
                    <h2 id="acct-drawer-title" class="fluxy-section-title" style="margin-top:2px;"></h2>
                </div>
                <button type="button" class="acct-drawer-close" id="acct-drawer-close" aria-label="Close panel">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18"/></svg>
                </button>
            </div>
            <div class="acct-drawer-body" id="acct-drawer-body"></div>
        </aside>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDrawer(); });
    overlay.querySelector('#acct-drawer-close').addEventListener('click', () => closeDrawer());
    return overlay;
}

function suggestedAction(row) {
    if (row.level === 'subtotal' || row.level === 'total') {
        return 'This is a calculated row — adjust the contributing line items to change it.';
    }
    const tone = row.status_tone;
    if (tone === 'danger') return 'Open the Cleanup tab to attach receipts and fix categories on these records.';
    if (tone === 'warning') return 'Open the Account Mapping tab to map these categories to accounting accounts.';
    if (row.status === 'No records') return 'No records fall under this line for the selected period.';
    return 'No action needed — these records look review-ready.';
}

function recordCardHtml(rec) {
    const link = SOURCE_LINKS[rec.source_collection];
    const sourceLabel = SOURCE_LABEL[rec.source_collection] || rec.source_collection;
    const statusTone = rec.status === 'Missing Receipt' ? 'danger' : 'neutral';
    const metaParts = [formatDate(rec.date), rec.category || 'Uncategorized', rec.type || '—']
        .map(escapeHtml).join(' · ');
    return `
        <div class="acct-rec-card">
            <div style="flex:1;min-width:0;">
                <div class="fluxy-body-strong" style="color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(rec.vendor_name)}</div>
                <div class="fluxy-meta">${metaParts}</div>
                <div class="fluxy-meta" style="margin-top:2px;display:flex;gap:8px;align-items:center;">
                    <span class="acct-tone-${statusTone}">${escapeHtml(rec.status)}</span>
                    ${link ? `<a href="${link}" class="acct-rec-link">${escapeHtml(sourceLabel)} →</a>` : `<span>${escapeHtml(sourceLabel)}</span>`}
                </div>
            </div>
            <div class="acct-mono fluxy-body-strong" style="color:#111827;white-space:nowrap;">${formatRupiah(rec.amount) || 'Rp 0'}</div>
        </div>`;
}

function openDrawer(rowId) {
    const row = state.rowsById[rowId];
    const data = state.data;
    if (!row || !data) return;
    const overlay = ensureDrawer();

    el('acct-drawer-title').textContent = row.label;

    const records = (data.related_records_index && data.related_records_index[rowId]) || [];
    const ch = changeDisplay(row);
    const curLabel = data.period.label;
    const prevLabel = data.comparison_period.label;

    const summaryHtml = `
        <div class="acct-drawer-grid">
            <div><span class="fluxy-meta">${escapeHtml(curLabel)}</span><span class="acct-mono fluxy-body-strong">${amountCell(row.current_amount, row.kind).text}</span></div>
            <div><span class="fluxy-meta">${escapeHtml(prevLabel)}</span><span class="acct-mono fluxy-body-strong">${amountCell(row.previous_amount, row.kind).text}</span></div>
            <div><span class="fluxy-meta">Change</span><span class="acct-mono fluxy-body-strong acct-tone-${ch.tone}">${ch.text} · ${ch.pctText}</span></div>
            <div><span class="fluxy-meta">Status</span><span>${statusCellHtml(row, row.level === 'child')}</span></div>
        </div>`;

    const noteHtml = row.note
        ? `<p class="fluxy-meta acct-drawer-note">${escapeHtml(row.note)}</p>`
        : '';

    const actionHtml = `
        <div class="acct-drawer-action">
            <span class="fluxy-meta" style="text-transform:uppercase;letter-spacing:0.06em;">Suggested action</span>
            <p class="fluxy-body" style="color:#374151;margin-top:2px;">${escapeHtml(suggestedAction(row))}</p>
        </div>`;

    let recordsHtml;
    if (!records.length) {
        recordsHtml = `
            <div class="acct-drawer-empty">
                <div class="fluxy-body-strong" style="color:#111827;margin-bottom:4px;">No related records found for this line item.</div>
                <div class="fluxy-meta">${row.level === 'subtotal' || row.level === 'total'
                    ? 'This row is calculated from the line items above.'
                    : 'Nothing in the ledger maps to this line for the selected period.'}</div>
            </div>`;
    } else {
        recordsHtml = `
            <div class="fluxy-meta" style="text-transform:uppercase;letter-spacing:0.06em;margin:18px 0 8px;">${records.length} related record${records.length === 1 ? '' : 's'}</div>
            <div class="acct-rec-list">${records.map(recordCardHtml).join('')}</div>`;
    }

    el('acct-drawer-body').innerHTML = summaryHtml + noteHtml + actionHtml + recordsHtml;

    overlay.classList.add('is-open');
    lockScroll(true);
    state.drawerOpen = true;
}

function closeDrawer() {
    const overlay = el('acct-drawer-overlay');
    if (overlay) overlay.classList.remove('is-open');
    lockScroll(false);
    state.drawerOpen = false;
}

// The app body carries Tailwind `overflow-hidden`; the real scroll container is
// the inner `.flex-1.overflow-y-auto` region, so lock that (plus body, for safety).
function lockScroll(locked) {
    const scroller = document.querySelector('main .overflow-y-auto');
    if (scroller) scroller.style.overflow = locked ? 'hidden' : '';
    document.body.style.overflow = locked ? 'hidden' : '';
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
