// Accounting Center page controller — Phase 1.
// Renders accounting readiness, cleanup queue, account mapping preview, and
// close-readiness from existing user-scoped records. Read-only except for the
// saved account-mapping flow. No journal posting, no period close, no AI writes.
// All data access goes through DataService.

const state = {
    ds: null,
    user: null,
    startKey: null,
    endKey: null,
    picker: null,
    activeTab: 'overview',
    loading: false,
    data: null
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

const AI_PROMPTS = [
    'Can I close this month?',
    'What needs cleanup before reporting?',
    'Which records are not accounting-ready?',
    'Which categories are unmapped?',
    'Why is my readiness score low?'
];

const BAND_META = {
    ready:         { label: 'Ready for review', pill: 'acct-pill-ready', ring: '#16A34A' },
    almost:        { label: 'Almost ready',     pill: 'acct-pill-almost', ring: '#EA580C' },
    needs_cleanup: { label: 'Needs cleanup',    pill: 'acct-pill-needs', ring: '#EF4444' },
    no_data:       { label: 'No data',          pill: 'acct-pill-planned', ring: '#94A3B8' }
};

const CLOSE_META = {
    ready_to_close: { label: 'Ready to close', pill: 'acct-pill-ready' },
    needs_cleanup:  { label: 'Needs cleanup',  pill: 'acct-pill-almost' },
    open:           { label: 'Open',           pill: 'acct-pill-planned' },
    no_data:        { label: 'No data',        pill: 'acct-pill-planned' }
};

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
    return `Rp ${Math.abs(Math.round(value)).toLocaleString('id-ID')}`;
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
    renderAiPrompts();
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
    el('acct-review-cleanup')?.addEventListener('click', () => setTab('cleanup'));

    document.querySelectorAll('[data-acct-tab]').forEach(btn => {
        btn.addEventListener('click', () => setTab(btn.getAttribute('data-acct-tab')));
    });
}

function openFluxyAI() {
    if (typeof window.toggleFluxyAI === 'function') window.toggleFluxyAI(true);
    else window.showToast?.('Fluxy AI is still loading. Try again in a moment.', 'info');
}

function renderAiPrompts() {
    const wrap = el('acct-ai-prompts');
    if (!wrap) return;
    wrap.innerHTML = AI_PROMPTS.map(p =>
        `<button type="button" class="acct-prompt-btn" data-ai-prompt="${escapeHtml(p)}">${escapeHtml(p)}</button>`
    ).join('');
    wrap.querySelectorAll('[data-ai-prompt]').forEach(btn => {
        btn.addEventListener('click', () => openFluxyAI());
    });
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
    hide('accounting-empty');
    hide('accounting-content');

    try {
        const data = await state.ds.getAccountingReadiness(state.user.uid, state.startKey, state.endKey);
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
        console.error('Accounting readiness failed:', err);
        hide('accounting-loading');
        show('accounting-error');
    } finally {
        state.loading = false;
    }
}

// --- render ---
function render(data) {
    renderKpis(data);
    renderLimitations(data);
    renderPriority(data);
    renderBreakdown(data);
    renderCleanup(data);
    renderMapping(data);
    renderClose(data);
    setTab(state.activeTab);
}

function renderKpis(data) {
    const k = data.kpis;
    const band = BAND_META[data.band] || BAND_META.no_data;

    el('kpi-readiness-value').textContent = data.score === null ? '—' : `${data.score}`;
    const ring = el('kpi-readiness-ring');
    if (ring) {
        ring.style.setProperty('--pct', data.score === null ? 0 : data.score);
        ring.style.setProperty('--ring-color', band.ring);
    }
    const bandPill = el('kpi-readiness-band');
    bandPill.textContent = band.label;
    bandPill.className = `acct-pill ${band.pill}`;

    el('kpi-cleanup-value').textContent = `${k.cleanup_items}`;
    el('kpi-reviewed-value').textContent = `${k.records_reviewed}`;
    el('kpi-reviewed-sub').textContent = `of ${k.records_total} records`;
    el('kpi-unmapped-value').textContent = `${k.unmapped_records}`;

    const close = CLOSE_META[k.close_status] || CLOSE_META.open;
    const closePill = el('kpi-close-value');
    closePill.textContent = close.label;
    closePill.className = `acct-pill ${close.pill}`;

    el('tab-cleanup-count').textContent = `${k.cleanup_items}`;
}

function renderLimitations(data) {
    const note = el('accounting-limitations');
    if (!note) return;
    if (data.limitations && data.limitations.length) {
        el('accounting-limitations-text').textContent = data.limitations.join(' ');
        note.classList.remove('hidden');
    } else {
        note.classList.add('hidden');
    }
}

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

function renderPriority(data) {
    const wrap = el('priority-panel-content');
    if (!wrap) return;
    const rank = { high: 0, medium: 1, low: 2 };
    const top = [...data.cleanupItems].sort((a, b) => (rank[a.severity] - rank[b.severity])).slice(0, 3);
    if (!top.length) {
        wrap.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;padding:12px 0;">
                <span class="acct-check-icon acct-check-done">✓</span>
                <div>
                    <div class="fluxy-body-strong" style="color:#111827;">No blockers for this period</div>
                    <div class="fluxy-meta">Your records look review-ready. Check the Close tab to wrap up.</div>
                </div>
            </div>`;
        return;
    }
    wrap.innerHTML = `<div class="acct-table-scroll" style="border:1px solid #F3F4F6;border-radius:10px;">${top.map(cleanupRowHtml).join('')}</div>`;
}

function metricRow(label, value, tone) {
    const color = tone === 'bad' ? '#B91C1C' : tone === 'warn' ? '#B45309' : tone === 'good' ? '#047857' : '#111827';
    return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #F3F4F6;">
            <span class="fluxy-body" style="color:#374151;">${escapeHtml(label)}</span>
            <span class="fluxy-body-strong acct-mono" style="color:${color};">${escapeHtml(value)}</span>
        </div>`;
}

function renderBreakdown(data) {
    const wrap = el('readiness-breakdown-content');
    if (!wrap) return;
    const c = data.counts;
    const rows = [
        metricRow('Transactions in period', `${c.transactions}`, 'neutral'),
        metricRow('Missing receipts', `${c.missing_receipts}`, c.missing_receipts ? 'bad' : 'good'),
        metricRow('Missing categories', `${c.missing_categories}`, c.missing_categories ? 'warn' : 'good'),
        metricRow('Bills in period', `${c.bills}`, 'neutral'),
        metricRow('Bills missing due date', `${c.bills_missing_due_date}`, c.bills_missing_due_date ? 'bad' : 'good'),
        metricRow('Bills missing invoice', `${c.bills_missing_invoice}`, c.bills_missing_invoice ? 'warn' : 'good'),
        metricRow('Unmapped categories', `${c.unmapped_categories}`, c.unmapped_categories ? 'warn' : 'good'),
        metricRow('Subscriptions missing renewal', `${c.subscriptions_missing_renewal}`, c.subscriptions_missing_renewal ? 'warn' : 'good'),
        data.bankSupported
            ? metricRow('Pending bank imports', `${c.bank_imports_pending}`, c.bank_imports_pending ? 'bad' : 'good')
            : metricRow('Pending bank imports', 'No bank statement', 'neutral')
    ];
    wrap.innerHTML = `<div>${rows.join('')}</div>`;
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

function emptyInline(title, body) {
    return `
        <div style="padding:32px 16px;text-align:center;">
            <div class="fluxy-body-strong" style="color:#111827;margin-bottom:4px;">${escapeHtml(title)}</div>
            <div class="fluxy-meta">${escapeHtml(body)}</div>
        </div>`;
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
    const mapping = state.data?.mappingPreview?.[idx];
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
