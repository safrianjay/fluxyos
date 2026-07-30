import { CHART_OF_ACCOUNTS_SEED, SAK_CATEGORIES, validateAccountDraft } from './accounting-engine.js';

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
    activeGroup: 'reports',
    lastTabByGroup: {},
    loading: false,
    data: null,
    statements: null
};

// Display catalog for the mapping <select>, derived from the canonical seed so
// it can never drift from the validation catalog in db-service.js (same filter:
// structural accounts are not mapping targets).
const ACCOUNT_OPTIONS = CHART_OF_ACCOUNTS_SEED
    .filter(a => a.mappable !== false)
    .map(a => ({ code: a.code, name: a.name, type: a.type }));

// Mapping targets = the seed catalog PLUS live user-created accounts, so a custom
// expense/revenue account (added via the New Account drawer) can be chosen as a
// category-mapping target and Transactions/Bills post to it. System/structural
// seed accounts already come from ACCOUNT_OPTIONS; live accounts are non-system,
// active, expense/revenue, and not already present in the seed.
function mappingAccountOptions() {
    const seedCodes = new Set(ACCOUNT_OPTIONS.map(a => a.code));
    const live = (state.kernel?.coa || [])
        .filter(a => a.is_active !== false && a.is_system !== true
            && (a.type === 'expense' || a.type === 'revenue') && !seedCodes.has(a.code))
        .map(a => ({ code: a.code, name: a.name, type: a.type }));
    return [...ACCOUNT_OPTIONS, ...live].sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

// SAK category → account type. One entry per SAK_CATEGORIES value; the create
// drawer derives `type` from the chosen category so code↔type stays consistent.
const SAK_CATEGORY_TYPE = {
    cash_bank: 'asset', accounts_receivable: 'asset', other_current_asset: 'asset',
    inventory: 'asset', fixed_asset: 'asset', accumulated_depreciation: 'asset', other_asset: 'asset',
    accounts_payable: 'liability', other_current_liability: 'liability', long_term_liability: 'liability',
    equity: 'equity', revenue: 'revenue', other_income: 'revenue',
    cogs: 'expense', operating_expense: 'expense', other_expense: 'expense'
};

// First code digit for each account type (FluxyOS 4-digit convention). Expense
// accounts live in the 5xxx-6xxx block; suggestions use 6xxx (operating).
const TYPE_CODE_PREFIX = { asset: '1', liability: '2', equity: '3', revenue: '4', expense: '6' };

// PPN treatments selectable as an account's default tax. Values are the tax-engine
// TAX_CODES; the empty value is "No tax". Labels use the canonical Indonesian tax
// names so they read the same as the Tax Center.
const TAX_OPTIONS = [
    ['', 'No tax'],
    ['PPN_OUT_11', 'PPN Keluaran 11%'],
    ['PPN_IN_11', 'PPN Masukan 11%'],
    ['PPN_ZERO', 'PPN 0%'],
    ['PPN_EXEMPT', 'PPN Dibebaskan']
];
const TAX_OPTION_CODES = new Set(TAX_OPTIONS.map(([code]) => code).filter(Boolean));

// Which tax treatments make sense per account type, so the picker can't offer a
// wrong-direction VAT: output PPN (Keluaran) belongs on sales/revenue, input PPN
// (Masukan) on purchases (asset/expense). Zero/exempt are output-side (zero-rated
// or exempt sales). Liability/equity accounts carry no default VAT → "No tax" only,
// and the field is hidden for them.
const TAX_OPTIONS_BY_TYPE = {
    asset: ['', 'PPN_IN_11'],
    expense: ['', 'PPN_IN_11'],
    revenue: ['', 'PPN_OUT_11', 'PPN_ZERO', 'PPN_EXEMPT'],
    liability: [''],
    equity: ['']
};
function taxAppliesToType(type) {
    return (TAX_OPTIONS_BY_TYPE[type] || ['']).some(Boolean);
}
function taxOptionsHtml(selected = '', type = null) {
    const allowed = type ? (TAX_OPTIONS_BY_TYPE[type] || ['']) : TAX_OPTIONS.map(([c]) => c);
    return TAX_OPTIONS
        .filter(([code]) => allowed.includes(code))
        .map(([code, label]) => `<option value="${escapeHtml(code)}"${code === (selected || '') ? ' selected' : ''}>${escapeHtml(label)}</option>`)
        .join('');
}

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
    state.activeTab = initialTab();
    state.activeGroup = GROUP_OF_TAB[state.activeTab];

    // Idempotent: seed the Chart of Accounts (then the founder-category
    // taxonomy, which maps onto it) so the ledger views and posting engine have
    // accounts to reference. Best-effort — a viewer without write access simply
    // reads whatever already exists. loadKernel() awaits this so the first
    // ledger read never races an empty (un-seeded) chart.
    state.seedPromise = ds.seedChartOfAccounts(user.uid)
        .then(() => ds.seedBusinessCategories(user.uid))
        .catch(() => {});

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
            // Period-scoped lazy tabs must refresh for the new range. Aging is
            // as-of-today, so it is deliberately left cached.
            if (state.kernel) state.kernel.loadedPeriod = null;
            load(); // re-fetches readiness + statements for the new range
            if (KERNEL_TABS.has(state.activeTab)) loadKernel(true);
        }
    });
}

function wireStaticControls() {
    el('acct-ask-ai')?.addEventListener('click', () => openFluxyAI());
    el('acct-retry')?.addEventListener('click', () => load());

    document.querySelectorAll('[data-acct-group]').forEach(btn => {
        btn.addEventListener('click', () => setGroup(btn.getAttribute('data-acct-group')));
    });
    document.querySelectorAll('[data-acct-tab]').forEach(btn => {
        btn.addEventListener('click', () => setTab(btn.getAttribute('data-acct-tab')));
    });
    wireTabKeys('[data-acct-group]', setGroup, 'data-acct-group');
    wireTabKeys('[data-acct-tab]', setTab, 'data-acct-tab');

    el('ledger-account-select')?.addEventListener('change', (e) => renderGeneralLedger(e.target.value));
    el('close-period-btn')?.addEventListener('click', () => onClosePeriod());
    el('reopen-period-btn')?.addEventListener('click', () => onReopenPeriod());
    el('journals-new-manual')?.addEventListener('click', () => { window.location.href = 'accounting-journal-new.html'; });
    el('journals-post-pending')?.addEventListener('click', () => onPostPending());
    el('coa-new-account')?.addEventListener('click', () => openCreateAccountDrawer());
    el('balance-sheet-export')?.addEventListener('click', () => exportBalanceSheet());
    el('post-unposted-btn')?.addEventListener('click', () => onPostUnposted());
}

// Imported entries (CSV / bank statements) post their journals via a sweep rather
// than inline. Surface the backlog + a one-click post action.
function renderPendingBanner() {
    const banner = el('journals-pending');
    if (!banner) return;
    // Two populations reach the ledger via a sweep: queued imports
    // (accounting_status:'pending') and sources that were never queued at all.
    // The banner must surface both, or the Close gate blocks on entries the user
    // has no visible way to post.
    const queued = Number(state.kernel.pending) || 0;
    const never = Number(state.kernel.unposted?.blocking) || 0;
    const n = queued + never;
    banner.classList.toggle('hidden', n <= 0);
    if (n > 0 && el('journals-pending-count')) el('journals-pending-count').textContent = String(n);
}

// Remedy for the Close gate: post sources that never entered the sweep queue.
async function onPostUnposted() {
    const btn = el('post-unposted-btn');
    const blocking = Number(state.kernel.unposted?.blocking) || 0;
    if (!blocking) return;
    const ok = await window.showConfirmDialog?.({
        title: `Post ${blocking} entr${blocking === 1 ? 'y' : 'ies'}?`,
        body: 'This posts double-entry journals for entries in this period that never reached the ledger. Closed periods and invoice payments awaiting issuance are skipped.',
        confirmLabel: 'Post entries', cancelLabel: 'Cancel', tone: 'default'
    });
    if (ok === false) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Posting…'; }
    try {
        const res = await state.ds.postUnpostedSources(state.user.uid, state.startKey, state.endKey);
        const parts = [`Posted ${res.posted}`];
        if (res.skippedClosed) parts.push(`${res.skippedClosed} in closed periods`);
        if (res.skippedNoRule) parts.push(`${res.skippedNoRule} not postable`);
        window.showToast?.(parts.join(' · '), 'success');
        await loadKernel(true);
        load(); // statements + KPI strip must reflect the new journals
    } catch (err) {
        console.error('Post unposted failed:', err);
        await window.showAlertDialog?.({
            title: 'Could not post these entries',
            body: escapeHtml(err.message || 'Please try again.'), tone: 'danger'
        });
        if (btn) { btn.disabled = false; btn.textContent = 'Post unposted entries'; }
    }
}

async function onPostPending() {
    const btn = el('journals-post-pending');
    if (btn) { btn.disabled = true; btn.textContent = 'Posting…'; }
    try {
        const res = await state.ds.postPendingJournals(state.user.uid);
        // Also sweep never-queued sources for the active period — the banner counts
        // them, so the button must clear them too.
        let extra = { posted: 0, skippedClosed: 0 };
        if (Number(state.kernel.unposted?.blocking) > 0) {
            extra = await state.ds.postUnpostedSources(state.user.uid, state.startKey, state.endKey);
        }
        res.posted += extra.posted || 0;
        res.skippedClosed = (res.skippedClosed || 0) + (extra.skippedClosed || 0);
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

const KERNEL_TABS = new Set(['journals', 'ledger', 'trial', 'coa', 'close']);
// Both ledger-statement views come from one getFinancialStatements() fetch.
// Statements load eagerly with the page (the KPI strip reads the same figures),
// so no tab needs a lazy statement fetch.

// Two-level navigation. Groups follow the accounting funnel (report → working
// paper → configuration → close) rather than the order features shipped in.
// Panel ids are unchanged — only the nav layer knows about grouping.
// Full rationale: docs/ACCOUNTING_CENTER_IA.md
const TAB_GROUPS = [
    { id: 'reports', tabs: ['income', 'balance', 'aging'] },
    { id: 'ledger', tabs: ['journals', 'ledger', 'trial'] },
    { id: 'setup', tabs: ['coa', 'mapping', 'vendors'] },
    { id: 'close', tabs: ['close', 'cleanup'] }
];
const GROUP_OF_TAB = TAB_GROUPS.reduce((map, g) => {
    g.tabs.forEach(t => { map[t] = g.id; });
    return map;
}, {});

// Views are linkable (?tab=…) so cross-page drill-downs can land on one directly.
function syncTabUrl(tab) {
    try {
        const url = new URL(window.location.href);
        url.searchParams.set('tab', tab);
        window.history.replaceState({}, '', url);
    } catch { /* history is non-critical */ }
}
function initialTab() {
    try {
        const t = new URL(window.location.href).searchParams.get('tab');
        if (t && GROUP_OF_TAB[t]) return t;
    } catch { /* fall through to default */ }
    return 'income';
}

// Selecting a group returns to the view last used inside it, defaulting to first.
function setGroup(group) {
    const g = TAB_GROUPS.find(x => x.id === group);
    if (!g) return;
    setTab(state.lastTabByGroup[group] || g.tabs[0]);
}

function setTab(tab, { updateUrl = true } = {}) {
    const group = GROUP_OF_TAB[tab];
    if (!group) return;
    state.activeTab = tab;
    state.activeGroup = group;
    state.lastTabByGroup[group] = tab;

    document.querySelectorAll('[data-acct-group]').forEach(btn => {
        const on = btn.getAttribute('data-acct-group') === group;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    // The child row shows only the active group's views.
    document.querySelectorAll('[data-acct-tab]').forEach(btn => {
        const inGroup = btn.getAttribute('data-acct-parent') === group;
        btn.toggleAttribute('hidden', !inGroup);
        const on = inGroup && btn.getAttribute('data-acct-tab') === tab;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('[data-acct-panel]').forEach(panel => {
        panel.classList.toggle('hidden', panel.getAttribute('data-acct-panel') !== tab);
    });

    // Ledger views read the new accounting collections lazily — only when their
    // tab is first opened for the active period, so the page load stays light.
    if (KERNEL_TABS.has(tab)) loadKernel();
    // Aging is as-of-today (not period-scoped) and loads lazily on first open.
    if (tab === 'aging') loadAging();
    // Vendor master loads lazily on first open.
    if (tab === 'vendors') renderVendors();

    if (updateUrl) syncTabUrl(tab);
}

// Arrow-key traversal within a nav row, skipping hidden (out-of-group) buttons.
function wireTabKeys(selector, onPick, attr) {
    document.querySelectorAll(selector).forEach(btn => {
        btn.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            const row = Array.from(document.querySelectorAll(selector)).filter(b => !b.hasAttribute('hidden'));
            const i = row.indexOf(btn);
            if (i < 0) return;
            const next = row[(i + (e.key === 'ArrowRight' ? 1 : -1) + row.length) % row.length];
            next.focus();
            onPick(next.getAttribute(attr));
        });
    });
}

// --- Vendors tab (Part A): named vendors with a default account / currency /
// terms. New bills & transactions for a vendor pre-fill its default account. ---
const VENDOR_TERMS_LABEL = { due_on_receipt: 'Due on receipt', due_in_7_days: 'Net 7', due_in_14_days: 'Net 14', due_in_30_days: 'Net 30' };

async function renderVendors() {
    const accSel = el('vendor-account-select');
    if (accSel && !accSel.dataset.filled) {
        accSel.innerHTML = `<option value="">No default</option>` + mappingAccountOptions()
            .map(o => `<option value="${o.code}">${escapeHtml(o.code)} · ${escapeHtml(o.name)}</option>`).join('');
        accSel.dataset.filled = '1';
    }
    const saveBtn = el('vendor-save-btn');
    if (saveBtn && !saveBtn.dataset.wired) {
        saveBtn.addEventListener('click', handleSaveVendor);
        el('vendor-cancel-btn')?.addEventListener('click', resetVendorForm);
        saveBtn.dataset.wired = '1';
    }
    const listEl = el('vendors-list');
    if (!listEl) return;
    let vendors = [];
    try { vendors = await state.ds.getVendors(state.user.uid); } catch (_) { vendors = []; }
    if (!vendors.length) {
        listEl.innerHTML = emptyInline('No vendors yet', 'Add one above to save its default account, currency, and terms.');
        return;
    }
    listEl.innerHTML = `<div style="min-width:620px;">` + vendors.map(v => {
        const acct = v.default_account_code ? `${escapeHtml(v.default_account_code)} · ${escapeHtml(v.default_account_name || '')}` : 'No default account';
        const terms = VENDOR_TERMS_LABEL[v.payment_terms] || '—';
        return `
        <div class="acct-row">
            <div style="flex:1;min-width:160px;">
                <div class="fluxy-body-strong" style="color:#111827;">${escapeHtml(v.name)}</div>
                <div class="fluxy-meta">${acct} · ${escapeHtml(v.default_currency || 'IDR')} · ${escapeHtml(terms)}${v.npwp ? ' · NPWP ' + escapeHtml(v.npwp) : ''}</div>
            </div>
            <button type="button" class="acct-btn acct-btn-secondary" data-vendor-edit="${escapeHtml(v.id)}">Edit</button>
            <button type="button" class="acct-btn acct-btn-ghost" data-vendor-archive="${escapeHtml(v.id)}">Archive</button>
        </div>`;
    }).join('') + `</div>`;
    listEl.querySelectorAll('[data-vendor-edit]').forEach(btn => {
        btn.addEventListener('click', () => startEditVendor(btn.getAttribute('data-vendor-edit'), vendors));
    });
    listEl.querySelectorAll('[data-vendor-archive]').forEach(btn => {
        btn.addEventListener('click', () => handleArchiveVendor(btn.getAttribute('data-vendor-archive'), vendors));
    });
}

function resetVendorForm() {
    el('vendor-edit-id').value = '';
    el('vendor-name-input').value = '';
    if (el('vendor-account-select')) el('vendor-account-select').value = '';
    if (el('vendor-currency-select')) el('vendor-currency-select').value = 'IDR';
    if (el('vendor-terms-select')) el('vendor-terms-select').value = '';
    el('vendor-npwp-input').value = '';
    el('vendor-save-btn').textContent = 'Save vendor';
    el('vendor-cancel-btn')?.classList.add('hidden');
}

function startEditVendor(id, vendors) {
    const v = (vendors || []).find(x => x.id === id);
    if (!v) return;
    el('vendor-edit-id').value = v.id;
    el('vendor-name-input').value = v.name || '';
    if (el('vendor-account-select')) el('vendor-account-select').value = v.default_account_code || '';
    if (el('vendor-currency-select')) el('vendor-currency-select').value = v.default_currency || 'IDR';
    if (el('vendor-terms-select')) el('vendor-terms-select').value = v.payment_terms || '';
    el('vendor-npwp-input').value = v.npwp || '';
    el('vendor-save-btn').textContent = 'Update vendor';
    el('vendor-cancel-btn')?.classList.remove('hidden');
    el('vendor-name-input').focus();
}

async function handleSaveVendor() {
    const id = el('vendor-edit-id').value;
    const name = (el('vendor-name-input')?.value || '').trim();
    if (!name) { window.showToast?.('Vendor name is required.', 'error'); return; }
    const data = {
        name,
        default_account_code: el('vendor-account-select')?.value || null,
        default_currency: el('vendor-currency-select')?.value || 'IDR',
        payment_terms: el('vendor-terms-select')?.value || null,
        npwp: (el('vendor-npwp-input')?.value || '').trim() || null
    };
    const btn = el('vendor-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = id ? 'Updating…' : 'Saving…'; }
    try {
        if (id) await state.ds.updateVendor(state.user.uid, id, data);
        else await state.ds.addVendor(state.user.uid, data);
        window.showToast?.(id ? 'Vendor updated.' : 'Vendor saved.', 'success');
        resetVendorForm();
        await renderVendors();
    } catch (err) {
        console.error('Save vendor failed:', err);
        window.showToast?.(err?.message || 'Could not save the vendor. Try again.', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = el('vendor-edit-id').value ? 'Update vendor' : 'Save vendor'; }
    }
}

async function handleArchiveVendor(id, vendors) {
    const v = (vendors || []).find(x => x.id === id);
    const confirmed = await window.showConfirmDialog?.({
        title: 'Archive vendor?',
        body: `<strong>${escapeHtml(v?.name || 'This vendor')}</strong> will be hidden and stop pre-filling its default account.`,
        confirmLabel: 'Archive', cancelLabel: 'Cancel', tone: 'danger'
    });
    if (confirmed === false) return;
    try {
        await state.ds.archiveVendor(state.user.uid, id);
        window.showToast?.('Vendor archived.', 'success');
        await renderVendors();
    } catch (err) {
        console.error('Archive vendor failed:', err);
        window.showToast?.('Could not archive the vendor. Try again.', 'error');
    }
}

// --- Financial statements: ledger-derived Income Statement + Balance Sheet ---
// Both read ledger_balances (the Trial Balance's source), so they can never
// disagree with it. Loaded eagerly with the page because the KPI strip reads the
// same figures. See docs/ACCOUNTING_CENTER_IA.md.

// Column header for a period-key window: "Jul 2026", or "Feb 2026–Apr 2026".
function periodColumnLabel(startPk, endPk) {
    const loc = window.FluxyI18n?.locale?.() || 'en-US';
    const asDate = (pk) => new Date(Number(String(pk).slice(0, 4)), Number(String(pk).slice(5, 7)) - 1, 1);
    const fmt = (pk) => asDate(pk).toLocaleDateString(loc, { month: 'short', year: 'numeric' });
    if (!startPk || !endPk) return 'Period';
    return startPk === endPk ? fmt(startPk) : `${fmt(startPk)}–${fmt(endPk)}`;
}

function renderStatements(report) {
    const incWrap = el('income-statement-content');
    const balWrap = el('balance-sheet-content');
    const label = el('income-statement-period');
    if (label) label.textContent = periodColumnLabel(report.period.start, report.period.end);
    renderStmtIncome(incWrap, report);
    renderStmtBalance(balWrap, report.balanceSheet);
}

function statementsError() {
    const fail = emptyState('Could not load statements', 'Reload the page or try again in a moment.');
    const incWrap = el('income-statement-content');
    const balWrap = el('balance-sheet-content');
    if (incWrap) incWrap.innerHTML = fail;
    if (balWrap) balWrap.innerHTML = fail;
}

// Joins current and comparison lines by account code. Accounts with activity only
// in the comparison window still appear (at Rp0) so a line that went to zero is
// visible rather than silently dropped.
function mergeStatementLines(current = [], prior = []) {
    const priorBy = {};
    prior.forEach((l) => { priorBy[l.code] = l.amount; });
    const seen = new Set();
    const out = current.map((l) => {
        seen.add(l.code);
        return { ...l, prior: priorBy[l.code] || 0 };
    });
    prior.forEach((l) => {
        if (!seen.has(l.code)) out.push({ ...l, amount: 0, prior: l.amount });
    });
    return out.sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

function changeCells(current, prior, kind) {
    const change_amount = (Number(current) || 0) - (Number(prior) || 0);
    const change_pct = prior !== 0 ? (change_amount / Math.abs(prior)) * 100 : null;
    const d = changeDisplay({ change_amount, change_pct, kind });
    return `<td class="fluxy-table-cell fluxy-table-money acct-tone-${d.tone}">${escapeHtml(d.text)}</td>
        <td class="fluxy-table-cell fluxy-table-money acct-tone-${d.pctTone}">${escapeHtml(d.pctText)}</td>`;
}

// An account line traces to its ledger activity; subtotals do not (they have no
// single source-record list — see the dashboard table standard).
function stmtLineRow(line, kind) {
    return `<tr class="fluxy-table-row acct-row-link" data-stmt-account="${escapeHtml(line.code)}" tabindex="0" role="link">
        <td class="fluxy-table-cell" style="padding-left:24px;"><span class="fluxy-table-cell-meta">${escapeHtml(line.code)}</span> ${escapeHtml(line.name)}</td>
        <td class="fluxy-table-cell fluxy-table-money">${escapeHtml(signedRupiah(line.amount))}</td>
        <td class="fluxy-table-cell fluxy-table-money">${escapeHtml(signedRupiah(line.prior))}</td>
        ${changeCells(line.amount, line.prior, kind)}
    </tr>`;
}
// Income Statement subtotal: compared like a line, but never clickable.
function isSubtotalRow(label, amount, prior, kind, { strong = false } = {}) {
    const wrapText = (t) => (strong ? `<strong>${t}</strong>` : t);
    return `<tr class="fluxy-table-row" style="border-top:1px solid #e5e7eb;">
        <td class="fluxy-table-cell">${wrapText(escapeHtml(label))}</td>
        <td class="fluxy-table-cell fluxy-table-money">${wrapText(escapeHtml(signedRupiah(amount)))}</td>
        <td class="fluxy-table-cell fluxy-table-money">${wrapText(escapeHtml(signedRupiah(prior)))}</td>
        ${changeCells(amount, prior, kind)}
    </tr>`;
}
// Balance Sheet rows stay two-column: the statement is cumulative, so a
// period-over-period movement column would misrepresent it.
function bsLineRow(line) {
    return `<tr class="fluxy-table-row acct-row-link" data-stmt-account="${escapeHtml(line.code)}" tabindex="0" role="link">
        <td class="fluxy-table-cell" style="padding-left:24px;"><span class="fluxy-table-cell-meta">${escapeHtml(line.code)}</span> ${escapeHtml(line.name)}</td>
        <td class="fluxy-table-cell fluxy-table-money">${escapeHtml(signedRupiah(line.amount))}</td>
    </tr>`;
}
function bsSubtotalRow(label, amount, { strong = false } = {}) {
    const val = strong ? `<strong>${escapeHtml(signedRupiah(amount))}</strong>` : escapeHtml(signedRupiah(amount));
    const lbl = strong ? `<strong>${escapeHtml(label)}</strong>` : escapeHtml(label);
    return `<tr class="fluxy-table-row" style="border-top:1px solid #e5e7eb;">
        <td class="fluxy-table-cell">${lbl}</td>
        <td class="fluxy-table-cell fluxy-table-money">${val}</td>
    </tr>`;
}
function stmtGroupHeader(label, colspan = 2) {
    return `<tr class="fluxy-table-row"><td class="fluxy-table-cell" colspan="${colspan}"><span class="fluxy-table-cell-primary" style="text-transform:uppercase;letter-spacing:0.06em;font-size:12px;color:#6b7280;">${escapeHtml(label)}</span></td></tr>`;
}

function renderStmtIncome(wrap, report) {
    if (!wrap) return;
    const is = report?.incomeStatement;
    if (!is || !is.hasData) {
        wrap.innerHTML = emptyState('No ledger activity for this period', 'Post transactions, bills, or invoices — they appear here once journals exist for the selected period.');
        return;
    }
    const prev = report.comparisonIncomeStatement || {};
    const section = (curLines, priorLines, kind) =>
        mergeStatementLines(curLines, priorLines).map(l => stmtLineRow(l, kind)).join('');

    const parts = [];
    parts.push(stmtGroupHeader('Revenue', 5));
    parts.push(section(is.revenue, prev.revenue, 'revenue'));
    parts.push(isSubtotalRow('Total revenue', is.totalRevenue, prev.totalRevenue || 0, 'revenue'));
    if (is.cogs.length || (prev.cogs || []).length) {
        parts.push(stmtGroupHeader('Cost of goods sold', 5));
        parts.push(section(is.cogs, prev.cogs, 'cost'));
        parts.push(isSubtotalRow('Gross profit', is.grossProfit, prev.grossProfit || 0, 'revenue', { strong: true }));
    }
    parts.push(stmtGroupHeader('Operating expenses', 5));
    parts.push(section(is.operatingExpenses, prev.operatingExpenses, 'cost'));
    parts.push(isSubtotalRow('Total operating expenses', is.totalOpEx, prev.totalOpEx || 0, 'cost'));
    parts.push(isSubtotalRow('Operating income', is.operatingIncome, prev.operatingIncome || 0, 'revenue', { strong: true }));
    if (is.otherIncome.length || is.otherExpense.length || (prev.otherIncome || []).length || (prev.otherExpense || []).length) {
        parts.push(stmtGroupHeader('Other income & expenses', 5));
        parts.push(section(is.otherIncome, prev.otherIncome, 'revenue'));
        // Other expenses display negative, so their comparison must flip too.
        const flip = (rows) => (rows || []).map(l => ({ ...l, amount: -l.amount }));
        parts.push(section(flip(is.otherExpense), flip(prev.otherExpense), 'cost'));
    }
    parts.push(isSubtotalRow('Net income', is.netIncome, prev.netIncome || 0, 'revenue', { strong: true }));

    const cols = [
        { label: 'Line item' },
        { label: periodColumnLabel(report.period.start, report.period.end), money: true },
        { label: periodColumnLabel(report.comparisonPeriod?.start, report.comparisonPeriod?.end), money: true },
        { label: 'Change', money: true },
        { label: 'Change %', money: true }
    ];
    wrap.innerHTML = tableShell(cols, parts.join(''));
    bindStatementDrilldown(wrap);
}

function renderStmtBalance(wrap, bs) {
    if (!wrap) return;
    if (!bs || !bs.hasData) {
        wrap.innerHTML = emptyState('No ledger position yet', 'The balance sheet appears once journals have posted.');
        return;
    }
    const parts = [];
    parts.push(stmtGroupHeader('Assets'));
    bs.assets.forEach(l => parts.push(bsLineRow(l)));
    parts.push(bsSubtotalRow('Total assets', bs.totalAssets, { strong: true }));
    parts.push(stmtGroupHeader('Liabilities'));
    if (bs.liabilities.length) bs.liabilities.forEach(l => parts.push(bsLineRow(l)));
    parts.push(bsSubtotalRow('Total liabilities', bs.totalLiabilities));
    parts.push(stmtGroupHeader('Equity'));
    bs.equity.forEach(l => parts.push(bsLineRow(l)));
    parts.push(bsSubtotalRow('Total equity', bs.totalEquity));
    parts.push(bsSubtotalRow('Total liabilities & equity', bs.liabilitiesPlusEquity, { strong: true }));
    wrap.innerHTML = tableShell([{ label: 'Account' }, { label: 'Amount', money: true }], parts.join(''));
    bindStatementDrilldown(wrap);

    const tie = el('balance-sheet-tieout');
    if (tie) {
        tie.innerHTML = bs.balanced
            ? `<span class="fluxy-table-status fluxy-status-success">Balanced ✓</span>`
            : `<span class="fluxy-table-status fluxy-status-danger">Out of balance by ${escapeHtml(signedRupiah(bs.tieOutDelta))}</span>`;
    }
}

// --- Balance Sheet CSV export ------------------------------------------------
// Ported from the retired /balance-sheet page so the capability is not lost, but
// sourced from the ledger statement. Like every export in the product it is
// confirmed, metered through report_exports, and audit-logged.

function csvEscape(value) {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadFile(filename, content) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function balanceSheetCsv(bs, period) {
    const rows = [['Section', 'Account code', 'Account', 'Amount (IDR)']];
    const push = (section, lines) => (lines || []).forEach(l => rows.push([section, l.code, l.name, l.amount]));
    push('Assets', bs.assets);
    rows.push(['Assets', '', 'Total assets', bs.totalAssets]);
    push('Liabilities', bs.liabilities);
    rows.push(['Liabilities', '', 'Total liabilities', bs.totalLiabilities]);
    push('Equity', bs.equity);
    rows.push(['Equity', '', 'Total equity', bs.totalEquity]);
    rows.push(['', '', 'Total liabilities & equity', bs.liabilitiesPlusEquity]);
    rows.push(['', '', 'Tie-out delta', bs.tieOutDelta]);
    rows.push(['', '', 'As of period', period.end]);
    return rows.map(r => r.map(csvEscape).join(',')).join('\n');
}

async function exportBalanceSheet() {
    const report = state.statements;
    const bs = report?.balanceSheet;
    if (!bs || !bs.hasData) {
        window.showToast?.('No balance sheet to export for this period.', 'info');
        return;
    }
    const btn = el('balance-sheet-export');
    if (state.exportInProgress) return;

    const confirmed = await window.showConfirmDialog?.({
        title: 'Export Balance Sheet CSV?',
        body: 'This logs an export action and downloads the ledger-derived Balance Sheet with raw IDR amounts.',
        confirmLabel: 'Export CSV', cancelLabel: 'Cancel', tone: 'default'
    });
    if (confirmed === false) return;

    state.exportInProgress = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Exporting…'; }
    try {
        const meta = {
            report_type: 'balance_sheet',
            period_start: report.period.start,
            period_end: report.period.end,
            formats: ['csv'],
            status: 'generated',
            included_sections: ['assets', 'liabilities', 'equity'],
            warning_counts: { tie_out_delta: bs.tieOutDelta || 0 },
            limitations: bs.balanced
                ? ['Ledger-derived double-entry statement; ties to the trial balance.']
                : ['Ledger-derived statement is OUT OF BALANCE — ledger_balances drift; repair with scripts/reconcile-ledger-balances.js.'],
            report_scope: { mode: 'balance_sheet', source: 'ledger_balances', current_period: { ...report.period } }
        };
        const ref = await state.ds.addReportExport(state.user.uid, meta);
        await state.ds.createExportAuditLog(state.user.uid, {
            target_id: ref.id,
            after: { report_type: 'balance_sheet', period: report.period, formats: ['csv'], balanced: bs.balanced },
            reason: 'Balance Sheet CSV export confirmed',
            source: 'dashboard'
        });
        downloadFile(`balance_sheet_${report.period.end}.csv`, balanceSheetCsv(bs, report.period));
        window.showToast?.('Balance Sheet CSV exported and logged.', 'success');
    } catch (err) {
        console.error('Balance Sheet export failed:', err);
        window.showToast?.('Could not export the Balance Sheet. Try again.', 'error');
    } finally {
        state.exportInProgress = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Export CSV'; }
    }
}

// Statement line → that account's General Ledger activity → Journal Detail →
// source record. Replaces the preview's /accounting-records deep link: the ledger
// path traces to posted journals rather than to raw transactions.
function bindStatementDrilldown(wrap) {
    wrap.querySelectorAll('[data-stmt-account]').forEach((row) => {
        const go = () => drillToLedger(row.getAttribute('data-stmt-account'));
        row.addEventListener('click', go);
        row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
        });
    });
}

// --- A/R + A/P Aging tab (as-of today; sources tie to the Balance Sheet) ---

async function loadAging(force = false) {
    if (state.agingLoaded && !force) return;
    state.agingLoaded = true; // claim early to avoid duplicate fetches
    const rWrap = el('aging-receivables-content');
    const pWrap = el('aging-payables-content');
    if (rWrap) rWrap.innerHTML = '<div class="fluxy-table-loading-cell">Loading…</div>';
    if (pWrap) pWrap.innerHTML = '<div class="fluxy-table-loading-cell">Loading…</div>';
    try {
        const report = await state.ds.getAgingReport(state.user.uid);
        renderAgingSection(rWrap, report.receivables, {
            empty: ['No open receivables', 'Finalized invoices and accrued receivables appear here until they are paid.'],
            link: (row) => row.kind === 'invoice' ? `/invoices?invoice=${encodeURIComponent(row.id)}` : `/ledger?record=${encodeURIComponent(row.id)}`,
            fxNote: report.fxInvoiceCount
        });
        renderAgingSection(pWrap, report.payables, {
            empty: ['No open payables', 'Unpaid bills and accrued payables appear here until they are settled.'],
            link: (row) => row.kind === 'bill' ? `/bill?record=${encodeURIComponent(row.id)}` : `/ledger?record=${encodeURIComponent(row.id)}`,
            fxNote: 0
        });
    } catch (err) {
        console.error('Aging load failed:', err);
        state.agingLoaded = false; // allow retry on next tab open
        const fail = emptyState('Could not load aging', 'Reload the page or try again in a moment.');
        if (rWrap) rWrap.innerHTML = fail;
        if (pWrap) pWrap.innerHTML = fail;
    }
}

function agingKindLabel(kind) {
    return kind === 'invoice' ? 'Invoice' : kind === 'bill' ? 'Bill' : 'Accrual';
}

function renderAgingSection(wrap, aging, { empty, link, fxNote }) {
    if (!wrap) return;
    if (!aging || !aging.rows.length) {
        wrap.innerHTML = emptyState(empty[0], empty[1]);
        return;
    }
    const summary = `
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 px-5 pt-4 pb-2">
            ${aging.buckets.map(b => `
                <div class="rounded-xl border ${b.id === 'current' ? 'border-gray-200 bg-gray-50/60' : b.amount > 0 ? 'border-amber-200 bg-amber-50/60' : 'border-gray-200 bg-gray-50/60'} px-3 py-2.5">
                    <p class="text-[12px] font-semibold text-gray-500">${escapeHtml(b.label)}</p>
                    <p class="mt-1 text-[14px] font-semibold tabular-nums ${b.amount > 0 && b.id !== 'current' ? 'text-amber-700' : 'text-gray-900'}">${escapeHtml(formatRupiah(b.amount) || 'Rp0')}</p>
                    <p class="text-[12px] text-gray-400">${b.count} item${b.count === 1 ? '' : 's'}</p>
                </div>`).join('')}
        </div>`;
    const body = aging.rows.map(row => {
        const overdue = row.daysOverdue > 0;
        const dueText = row.no_due_date
            ? 'No due date — aged from record date'
            : (overdue ? `${row.daysOverdue} day${row.daysOverdue === 1 ? '' : 's'} overdue` : 'Not yet due');
        return `<tr class="fluxy-table-row fluxy-table-row-clickable" data-href="${escapeHtml(link(row))}" tabindex="0">
            <td class="fluxy-table-cell"><div class="fluxy-table-cell-primary">${escapeHtml(row.label)}</div><div class="fluxy-table-cell-meta">${escapeHtml(agingKindLabel(row.kind))}${row.ref ? ` · ${escapeHtml(row.ref)}` : ''}</div></td>
            <td class="fluxy-table-cell"><span class="fluxy-table-cell-meta ${overdue ? 'text-amber-700' : ''}">${escapeHtml(dueText)}</span></td>
            <td class="fluxy-table-cell fluxy-table-money">${escapeHtml(formatRupiah(row.amount) || 'Rp0')}</td>
        </tr>`;
    }).join('');
    const totalRow = `<tr class="fluxy-table-row">
        <td class="fluxy-table-cell"><span class="fluxy-table-cell-primary">Total outstanding</span></td>
        <td class="fluxy-table-cell"><span class="fluxy-table-cell-meta">${aging.count} item${aging.count === 1 ? '' : 's'}</span></td>
        <td class="fluxy-table-cell fluxy-table-money"><strong>${escapeHtml(formatRupiah(aging.total) || 'Rp0')}</strong></td>
    </tr>`;
    const fxLine = fxNote > 0
        ? `<p class="px-5 pb-4 text-[12px] text-gray-500">${fxNote} foreign-currency invoice${fxNote === 1 ? '' : 's'} excluded from IDR totals.</p>`
        : '';
    wrap.innerHTML = summary
        + tableShell([{ label: 'Item' }, { label: 'Status' }, { label: 'Amount', money: true }], body + totalRow)
        + fxLine;
    bindAgingRowNav(wrap);
}

function bindAgingRowNav(wrap) {
    const go = (target) => {
        const row = target.closest('tr[data-href]');
        if (row) window.location.href = row.getAttribute('data-href');
    };
    wrap.addEventListener('click', (e) => go(e.target));
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e.target); });
}

// Fetch CoA + journals + trial balance for the active period and render the four
// accounting-workspace panels. Cached per period; a period change clears it.
async function loadKernel(force = false) {
    const pk = currentPeriodKey();
    if (!force && state.kernel.loadedPeriod === pk) return;
    state.kernel.loadedPeriod = pk; // claim early to avoid duplicate fetches
    try {
        await state.seedPromise; // ensure the chart exists before the first read
        const [coa, journals, trial, period, pending, unposted] = await Promise.all([
            state.ds.getChartOfAccounts(state.user.uid),
            state.ds.listJournals(state.user.uid, { periodKey: pk, includeDrafts: true }),
            state.ds.getTrialBalance(state.user.uid, { periodKey: pk }),
            state.ds.getPeriod(state.user.uid, pk),
            state.ds.countPendingPostings(state.user.uid).catch(() => 0),
            // Never-queued sources are invisible to countPendingPostings — this is
            // what actually proves the ledger is complete for the period.
            state.ds.countUnpostedSources(state.user.uid, state.startKey, state.endKey)
                .catch(() => ({ blocking: 0, deferred: 0, total: 0 }))
        ]);
        state.kernel = { loadedPeriod: pk, coa, journals, trial, period, pending, unposted };
        renderJournals();
        renderPendingBanner();
        renderTrialBalance();
        renderChartOfAccounts();
        renderLedgerSelector();
        renderClosePanel();
        renderCloseChecklist(); // refresh with the kernel gates now that they loaded
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
        // The preview is now the readiness/confidence source only — the KPI strip
        // and every statement read the ledger, so they cannot disagree with the
        // Trial Balance. See docs/ACCOUNTING_CENTER_IA.md Phase 2.
        const [data, statements] = await Promise.all([
            state.ds.getIncomeStatementPreview(state.user.uid, { start: state.startKey, end: state.endKey }),
            state.ds.getFinancialStatements(state.user.uid, {
                startPeriod: String(state.startKey || '').slice(0, 7),
                endPeriod: String(state.endKey || '').slice(0, 7)
            })
        ]);
        state.data = data;
        state.statements = statements;
        hide('accounting-loading');

        // Always render the full layout — KPI strip, tabs, and tables. When the
        // period has no records, the KPIs read Rp0 and each table/section shows
        // its own inline empty state (see renderStmtIncome / renderCleanup /
        // renderMapping). This keeps the page explorable instead of collapsing to
        // a single centered "no data" card.
        render(data);
        show('accounting-content');
    } catch (err) {
        console.error('Accounting Center load failed:', err);
        hide('accounting-loading');
        show('accounting-error');
    } finally {
        state.loading = false;
    }
}

// --- render ---
function render(data) {
    renderKpis(data);
    if (state.statements) renderStatements(state.statements);
    else statementsError();

    const readiness = data.readiness;
    if (readiness) {
        renderCleanup(readiness);
        renderMapping(readiness);
        renderKeywordRules();
        renderCloseChecklist();
        // Cleanup is pre-close work: the count shows on its own view and rolls up
        // to the Close group so the backlog is visible from any section.
        const outstanding = readiness.cleanupItems.length;
        el('tab-cleanup-count').textContent = `${outstanding}`;
        const groupBadge = el('tab-close-count');
        if (groupBadge) {
            groupBadge.textContent = `${outstanding}`;
            groupBadge.classList.toggle('hidden', outstanding === 0);
        }
    }
    setTab(state.activeTab);
}

function renderKpis(data) {
    // Figures come from the ledger-derived Income Statement, so the strip always
    // matches the statement below it and the Trial Balance.
    const is = state.statements?.incomeStatement;
    // statements-engine returns margins as FRACTIONS (0.42), and null when there
    // is no revenue to divide by — hence the ×100 and the N/A branch.
    const marginText = (v, label) => (v === null || v === undefined || !Number.isFinite(Number(v)))
        ? `N/A ${label}`
        : `${Math.round(Number(v) * 1000) / 10}% ${label}`;
    el('kpi-revenue-value').textContent = formatRupiah(is?.totalRevenue || 0) || 'Rp0';
    el('kpi-gross-value').textContent = signedRupiah(is?.grossProfit || 0);
    el('kpi-gross-sub').textContent = marginText(is?.grossMarginPct, 'gross margin');
    el('kpi-opex-value').textContent = formatRupiah(is?.totalOpEx || 0) || 'Rp0';
    el('kpi-net-value').textContent = signedRupiah(is?.netIncome || 0);
    el('kpi-net-sub').textContent = marginText(is?.netMarginPct, 'net margin');

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
        const options = mappingAccountOptions().map(opt =>
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
    const account = mappingAccountOptions().find(a => a.code === code);
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

// --- Keyword rules (Phase 3b): when a vendor/description contains a keyword,
// pre-fill this account in the entry drawer (suggestion only). ---------------
let keywordMatchTxns = null; // cached recent transactions for the "matches N" preview
async function loadKeywordMatchTxns() {
    if (keywordMatchTxns) return keywordMatchTxns;
    try { keywordMatchTxns = await state.ds.getTransactions(state.user.uid, 50); } catch (_) { keywordMatchTxns = []; }
    return keywordMatchTxns || [];
}
async function updateKeywordMatchPreview() {
    const out = el('kw-rule-match');
    if (!out) return;
    const kw = (el('kw-rule-input')?.value || '').trim().toLowerCase();
    if (!kw) { out.classList.add('hidden'); out.textContent = ''; return; }
    const txns = await loadKeywordMatchTxns();
    const n = txns.filter(t => String(t.vendor_name || '').toLowerCase().includes(kw)).length;
    out.textContent = `Matches ${n} of your last ${txns.length} transactions.`;
    out.classList.remove('hidden');
}
function resetKeywordForm() {
    if (el('kw-rule-input')) el('kw-rule-input').value = '';
    if (el('kw-rule-account')) el('kw-rule-account').value = el('kw-rule-account').options[0]?.value || '';
    if (el('kw-rule-edit-original')) el('kw-rule-edit-original').value = '';
    if (el('kw-rule-add')) el('kw-rule-add').textContent = 'Add rule';
    el('kw-rule-cancel')?.classList.add('hidden');
    updateKeywordMatchPreview();
}
function startEditKeywordRule(keyword, accountCode) {
    if (el('kw-rule-input')) el('kw-rule-input').value = keyword;
    if (el('kw-rule-account')) el('kw-rule-account').value = accountCode;
    if (el('kw-rule-edit-original')) el('kw-rule-edit-original').value = keyword;
    if (el('kw-rule-add')) el('kw-rule-add').textContent = 'Update rule';
    el('kw-rule-cancel')?.classList.remove('hidden');
    el('kw-rule-input')?.focus();
    updateKeywordMatchPreview();
}

async function renderKeywordRules() {
    const accSel = el('kw-rule-account');
    if (accSel && !accSel.dataset.filled) {
        accSel.innerHTML = mappingAccountOptions()
            .map(o => `<option value="${o.code}">${escapeHtml(o.code)} · ${escapeHtml(o.name)}</option>`).join('');
        accSel.dataset.filled = '1';
    }
    const addBtn = el('kw-rule-add');
    if (addBtn && !addBtn.dataset.wired) {
        addBtn.addEventListener('click', handleSaveKeywordRule);
        el('kw-rule-cancel')?.addEventListener('click', resetKeywordForm);
        el('kw-rule-input')?.addEventListener('input', updateKeywordMatchPreview);
        addBtn.dataset.wired = '1';
    }
    const listEl = el('keyword-rules-list');
    if (!listEl) return;
    let rules = [];
    try { rules = await state.ds.listKeywordAccountRules(state.user.uid); } catch (_) { rules = []; }
    if (!rules.length) {
        listEl.innerHTML = emptyInline('No keyword rules yet', 'Add one above to auto-suggest an account when a keyword appears.');
        return;
    }
    listEl.innerHTML = `<div style="min-width:560px;">` + rules.map(r => `
        <div class="acct-row">
            <div style="flex:1;min-width:140px;">
                <div class="fluxy-body-strong" style="color:#111827;">"${escapeHtml(r.keyword)}"</div>
                <div class="fluxy-meta">contains → ${escapeHtml(r.account.code)} · ${escapeHtml(r.account.name)}</div>
            </div>
            <button type="button" class="acct-btn acct-btn-secondary" data-kw-edit="${escapeHtml(r.keyword)}" data-kw-account="${escapeHtml(r.account.code)}">Edit</button>
            <button type="button" class="acct-btn acct-btn-ghost" data-kw-remove="${escapeHtml(r.keyword)}">Remove</button>
        </div>`).join('') + `</div>`;
    listEl.querySelectorAll('[data-kw-edit]').forEach(btn => {
        btn.addEventListener('click', () => startEditKeywordRule(btn.getAttribute('data-kw-edit'), btn.getAttribute('data-kw-account')));
    });
    listEl.querySelectorAll('[data-kw-remove]').forEach(btn => {
        btn.addEventListener('click', () => handleArchiveKeywordRule(btn.getAttribute('data-kw-remove')));
    });
}

async function handleSaveKeywordRule() {
    const keyword = (el('kw-rule-input')?.value || '').trim();
    const account_code = el('kw-rule-account')?.value || '';
    const original = (el('kw-rule-edit-original')?.value || '').trim();
    if (!keyword) { window.showToast?.('Enter a keyword to match.', 'error'); return; }
    if (!account_code) { window.showToast?.('Choose an account.', 'error'); return; }
    const btn = el('kw-rule-add');
    if (btn) { btn.disabled = true; btn.textContent = original ? 'Updating…' : 'Adding…'; }
    try {
        await state.ds.saveKeywordAccountRule(state.user.uid, { keyword, account_code });
        // Editing to a NEW keyword text creates a new doc — retire the old one.
        if (original && original.toLowerCase() !== keyword.toLowerCase()) {
            await state.ds.archiveKeywordAccountRule(state.user.uid, original);
        }
        window.showToast?.(original ? 'Keyword rule updated.' : 'Keyword rule saved.', 'success');
        resetKeywordForm();
        await renderKeywordRules();
    } catch (err) {
        console.error('Save keyword rule failed:', err);
        window.showToast?.(err?.message || 'Could not save the rule. Try again.', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = (el('kw-rule-edit-original')?.value ? 'Update rule' : 'Add rule'); }
    }
}

async function handleArchiveKeywordRule(keyword) {
    const confirmed = await window.showConfirmDialog?.({
        title: 'Remove keyword rule?',
        body: `The rule for <strong>"${escapeHtml(keyword)}"</strong> will no longer pre-fill an account.`,
        confirmLabel: 'Remove', cancelLabel: 'Cancel', tone: 'danger'
    });
    if (confirmed === false) return;
    try {
        await state.ds.archiveKeywordAccountRule(state.user.uid, keyword);
        window.showToast?.('Keyword rule removed.', 'success');
        await renderKeywordRules();
    } catch (err) {
        console.error('Archive keyword rule failed:', err);
        window.showToast?.('Could not remove the rule. Try again.', 'error');
    }
}

function checkRow(label, done, hint) {
    const icon = done
        ? `<span class="acct-check-icon acct-check-done">✓</span>`
        : `<span class="acct-check-icon acct-check-pending">!</span>`;
    const hintHtml = hint ? `<span class="fluxy-meta" style="margin-left:auto;padding-left:12px;">${escapeHtml(hint)}</span>` : '';
    return `<div class="acct-check" style="display:flex;align-items:center;">${icon}<span>${escapeHtml(label)}</span>${hintHtml}</div>`;
}

// Kernel-aware close readiness checklist. Merges the transaction-cleanup signals
// (from the readiness preview) with the accounting-kernel gates the actual close
// depends on — all entries posted to the ledger, and a balanced trial balance —
// so the checklist reflects what really blocks a clean close, not just data
// hygiene. Rendered from both load() (readiness) and loadKernel() (kernel), so it
// refreshes as each data source arrives.
function renderCloseChecklist() {
    const wrap = el('close-readiness-content');
    if (!wrap) return;
    const c = state.data?.readiness?.closeChecklist;
    const kernel = state.kernel || {};
    const rows = [];

    // Kernel gates first — these directly determine whether close can proceed.
    if (kernel.loadedPeriod === currentPeriodKey()) {
        const pending = Number(kernel.pending) || 0;
        // "Posted" must mean the ledger is complete, not merely that the sweep
        // queue is empty — a never-queued source has no 'pending' status and used
        // to pass this gate silently. See countUnpostedSources.
        const un = kernel.unposted || { blocking: 0, deferred: 0 };
        const blocking = Number(un.blocking) || 0;
        const deferred = Number(un.deferred) || 0;
        const hint = blocking > 0
            ? `${blocking} not posted${pending > 0 ? ` (${pending} queued)` : ''}`
            : (pending > 0 ? `${pending} pending` : 'Up to date');
        rows.push(checkRow('All entries posted to the ledger', pending === 0 && blocking === 0, hint));
        if (deferred > 0) {
            rows.push(checkRow('Invoice payments awaiting issuance posting', false,
                `${deferred} deferred — does not block close`));
        }
        const tb = kernel.trial;
        if (tb) {
            rows.push(checkRow('Trial balance is in balance', !!tb.balanced,
                tb.balanced ? 'Balanced' : 'Out of balance'));
        }
        const period = kernel.period;
        if (period && (period.status === 'closed' || period.status === 'locked')) {
            rows.push(checkRow(`Period is ${period.status}`, true, 'Done'));
        }
    }

    // Transaction-cleanup signals from the readiness preview.
    if (c) {
        rows.push(checkRow('Transactions reviewed', c.transactions_reviewed));
        rows.push(checkRow('Missing receipts resolved', c.missing_receipts_resolved));
        rows.push(checkRow('Bills reviewed', c.bills_reviewed));
        rows.push(checkRow('Categories mapped to accounts', c.categories_mapped));
        rows.push(checkRow('Bank imports reviewed', c.bank_imports_reviewed));
    }

    wrap.innerHTML = rows.length
        ? rows.join('')
        : '<p class="fluxy-meta">Loading close readiness…</p>';
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
    return new Date(ms).toLocaleDateString((window.FluxyI18n?.locale?.() || 'en-GB'), { day: '2-digit', month: 'short', timeZone: 'Asia/Jakarta' });
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

// Human labels for the SAK classification enum (kebab values on the docs).
const SAK_LABELS = {
    cash_bank: 'Cash & Bank', accounts_receivable: 'Receivable', other_current_asset: 'Other Current Asset',
    inventory: 'Inventory', fixed_asset: 'Fixed Asset', accumulated_depreciation: 'Accum. Depreciation',
    other_asset: 'Other Asset', accounts_payable: 'Payable', other_current_liability: 'Other Current Liability',
    long_term_liability: 'Long-term Liability', equity: 'Equity', revenue: 'Revenue',
    other_income: 'Other Income', cogs: 'COGS', operating_expense: 'Operating Expense', other_expense: 'Other Expense'
};

function renderChartOfAccounts() {
    const wrap = el('coa-content');
    if (!wrap) return;
    const coa = state.kernel.coa || [];
    if (!coa.length) {
        wrap.innerHTML = emptyState('Chart of Accounts not seeded yet', 'Open this page with edit access to seed the Indonesian SMB starter chart.');
        return;
    }
    const canManage = !!window.FluxyWorkspace?.can?.('accounting.post');
    el('coa-new-account')?.classList.toggle('hidden', !canManage);
    const body = coa.map(a => {
        const child = !!a.parent_code;
        const active = a.is_active !== false;
        const systemBadge = a.is_system ? ' <span class="fluxy-table-cell-meta" title="System accounts cannot be edited or archived.">🔒 System</span>' : '';
        const action = canManage && !a.is_system
            ? `<button type="button" class="acct-kebab-btn" data-coa-kebab="${escapeHtml(a.code)}" data-coa-active="${active ? '1' : '0'}" aria-haspopup="menu" aria-expanded="false" aria-label="Account actions" title="Account actions">${KEBAB_SVG}</button>`
            : '';
        return `<tr class="fluxy-table-row">
        <td class="fluxy-table-cell"><span class="fluxy-table-cell-primary"${child ? ' style="padding-left:16px;"' : ''}>${child ? '└ ' : ''}${escapeHtml(a.code)}</span></td>
        <td class="fluxy-table-cell"><a class="acct-link" href="${accountDetailLink(a.code)}" title="Open account ledger">${escapeHtml(a.name)}</a>${systemBadge}</td>
        <td class="fluxy-table-cell"><span class="fluxy-table-cell-meta">${escapeHtml(SAK_LABELS[a.sak_category] || a.sak_category || '—')}</span></td>
        <td class="fluxy-table-cell"><span class="fluxy-table-cell-meta">${escapeHtml(a.type)}</span></td>
        <td class="fluxy-table-cell"><span class="fluxy-table-cell-meta">${escapeHtml(a.normal_balance)}</span></td>
        <td class="fluxy-table-cell">${active ? '<span class="fluxy-table-status fluxy-status-success">Active</span>' : '<span class="fluxy-table-status fluxy-status-neutral">Archived</span>'}</td>
        <td class="fluxy-table-cell" style="text-align:right;">${action}</td>
    </tr>`;
    }).join('');
    wrap.innerHTML = tableShell(
        [{ label: 'Code' }, { label: 'Account' }, { label: 'SAK Category' }, { label: 'Type' }, { label: 'Normal' }, { label: 'Status' }, { label: 'Action' }],
        body
    );
    wrap.querySelectorAll('[data-coa-kebab]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleCoaMenu(btn, btn.getAttribute('data-coa-kebab'), btn.getAttribute('data-coa-active') === '1');
        });
    });
}

// --- CoA row action menu (kebab) -------------------------------------------
// The menu is portaled to <body> so the table's overflow (fluxy-table-scroll)
// never clips it, and positioned under the kebab button.
const KEBAB_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>';
let coaMenuEl = null;
let coaMenuBtn = null;

function closeCoaMenu() {
    if (coaMenuBtn) coaMenuBtn.setAttribute('aria-expanded', 'false');
    if (coaMenuEl) { coaMenuEl.remove(); coaMenuEl = null; }
    coaMenuBtn = null;
    document.removeEventListener('click', onCoaMenuOutside, true);
    document.removeEventListener('keydown', onCoaMenuKey, true);
    window.removeEventListener('resize', closeCoaMenu);
    window.removeEventListener('scroll', closeCoaMenu, true);
}
function onCoaMenuOutside(e) {
    if (coaMenuEl && !coaMenuEl.contains(e.target) && !e.target.closest('[data-coa-kebab]')) closeCoaMenu();
}
function onCoaMenuKey(e) { if (e.key === 'Escape') { closeCoaMenu(); coaMenuBtn?.focus?.(); } }

function toggleCoaMenu(btn, code, active) {
    if (coaMenuBtn === btn) { closeCoaMenu(); return; }
    closeCoaMenu();
    const menu = document.createElement('div');
    menu.className = 'acct-kebab-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `
        ${active ? '<button type="button" class="acct-kebab-item" role="menuitem" data-menu-edit>Edit</button>' : ''}
        <button type="button" class="acct-kebab-item${active ? ' danger' : ''}" role="menuitem" data-menu-toggle>${active ? 'Archive' : 'Reactivate'}</button>`;
    document.body.appendChild(menu);

    const r = btn.getBoundingClientRect();
    const menuW = menu.offsetWidth || 168;
    let left = Math.max(8, r.right - menuW);
    menu.style.top = `${Math.round(r.bottom + 4 + window.scrollY)}px`;
    menu.style.left = `${Math.round(left + window.scrollX)}px`;

    menu.querySelector('[data-menu-edit]')?.addEventListener('click', () => { closeCoaMenu(); handleCoaEdit(code); });
    menu.querySelector('[data-menu-toggle]')?.addEventListener('click', () => { closeCoaMenu(); handleCoaToggle(code, active); });

    coaMenuEl = menu;
    coaMenuBtn = btn;
    btn.setAttribute('aria-expanded', 'true');
    if (typeof window.translateDashboardPage === 'function') window.translateDashboardPage();
    setTimeout(() => {
        document.addEventListener('click', onCoaMenuOutside, true);
        document.addEventListener('keydown', onCoaMenuKey, true);
        window.addEventListener('resize', closeCoaMenu);
        window.addEventListener('scroll', closeCoaMenu, true);
        menu.querySelector('.acct-kebab-item')?.focus?.();
    }, 0);
}

// Open the edit drawer for a user-created account. Structural fields lock when the
// account already has posted activity (checked live via _accountInUse).
async function handleCoaEdit(code) {
    const account = (state.kernel.coa || []).find(a => a.code === code);
    if (!account) return;
    if (account.is_system) { window.showToast?.('System accounts cannot be edited.', 'error'); return; }
    let inUse = false;
    try { inUse = await state.ds._accountInUse(state.user.uid, code); } catch (_) { inUse = false; }
    openAccountDrawer(account, inUse);
}

function accountDetailLink(code) {
    return `/accounting-account?code=${encodeURIComponent(code)}`;
}

// ===================================================================
// New Account drawer — create a custom Chart of Accounts entry.
// Writes through DataService.saveAccount (create path already validates,
// audit-logs, sets is_system:false + derived normal_balance). The form derives
// `type` from the chosen SAK category so code↔type stays consistent, then
// re-validates with the shared validateAccountDraft before submit.
// ===================================================================

// SAK categories grouped into <optgroup>s by the type they map to. In edit mode,
// `restrictType` limits options to the account's own type (type is immutable), and
// `selected` pre-selects the current category.
function categoryOptionsHtml({ restrictType = null, selected = '' } = {}) {
    const groups = [
        ['Assets', 'asset'], ['Liabilities', 'liability'], ['Equity', 'equity'],
        ['Revenue', 'revenue'], ['Expenses', 'expense']
    ];
    return groups
        .filter(([, type]) => !restrictType || type === restrictType)
        .map(([label, type]) => {
            const opts = SAK_CATEGORIES
                .filter(c => SAK_CATEGORY_TYPE[c] === type)
                .map(c => `<option value="${c}"${c === selected ? ' selected' : ''}>${escapeHtml(SAK_LABELS[c] || c)}</option>`)
                .join('');
            return `<optgroup label="${escapeHtml(label)}">${opts}</optgroup>`;
        }).join('');
}

// Next free 4-digit code in the type's block. Custom accounts start at <prefix>900
// (below the seed's structural codes) and step by 10 so they read as a set.
function suggestAccountCode(type) {
    const prefix = TYPE_CODE_PREFIX[type] || '6';
    const used = new Set((state.kernel?.coa || []).map(a => String(a.code)));
    for (let n = parseInt(`${prefix}900`, 10); n <= parseInt(`${prefix}999`, 10); n += 10) {
        if (!used.has(String(n))) return String(n);
    }
    for (let n = parseInt(`${prefix}000`, 10); n <= parseInt(`${prefix}999`, 10); n += 1) {
        if (!used.has(String(n))) return String(n);
    }
    return '';
}

// Active accounts of the same type — candidate parents. The leading-digit rule is
// enforced by validateAccountDraft on submit; this just keeps the list relevant.
function parentOptionsHtml(type, excludeCode) {
    const parents = (state.kernel?.coa || [])
        .filter(a => a.type === type && a.is_active !== false && a.code !== excludeCode)
        .sort((a, b) => String(a.code).localeCompare(String(b.code)));
    if (!parents.length) return '<option value="">No eligible parent accounts</option>';
    return '<option value="">— None —</option>' + parents
        .map(a => `<option value="${escapeHtml(a.code)}">${escapeHtml(a.code)} · ${escapeHtml(a.name)}</option>`)
        .join('');
}

function caEl(id) { return document.getElementById(id); }
function caType() { return SAK_CATEGORY_TYPE[caEl('ca-category')?.value] || 'expense'; }

function refreshCaDerived() {
    const type = caType();
    const codeInput = caEl('ca-code');
    // Create mode only: auto-suggest a code (unless the user hand-edited it).
    // In edit mode the code is immutable, so never touch it.
    if (state.caMode !== 'edit' && codeInput && codeInput.dataset.autofill !== '0') {
        codeInput.value = suggestAccountCode(type);
    }
    const parentSel = caEl('ca-parent');
    if (parentSel) {
        const keep = parentSel.value;
        const selfCode = codeInput?.value || state.caAccount?.code || '';
        parentSel.innerHTML = parentOptionsHtml(type, selfCode);
        // Preserve a still-valid parent selection across a category change.
        const want = keep || (state.caMode === 'edit' ? (state.caAccount?.parent_code || '') : '');
        if (want && parentSel.querySelector(`option[value="${CSS.escape(want)}"]`)) parentSel.value = want;
    }
    refreshCaTax(type);
}

// Rebuild the Tax options for the current account type and hide the field for
// types that carry no VAT (liability/equity). Preserves a still-valid selection.
function refreshCaTax(type) {
    const sel = caEl('ca-tax');
    const field = caEl('ca-tax-field');
    if (!sel || !field) return;
    field.classList.toggle('hidden', !taxAppliesToType(type));
    const keep = sel.value;
    sel.innerHTML = taxOptionsHtml(keep, type);
    if (!Array.from(sel.options).some(o => o.value === keep)) sel.value = '';
}

function openCreateAccountDrawer() { openAccountDrawer(null, false); }

// One drawer for create and edit. `account` null → create; otherwise edit mode
// pre-fills the fields. `inUse` (posted activity) locks the structural fields
// (category, parent) in edit mode — the DAL enforces the same rule.
function openAccountDrawer(account = null, inUse = false) {
    if (window.FluxyWorkspace && typeof window.FluxyWorkspace.can === 'function'
        && !window.FluxyWorkspace.can('accounting.post')) {
        window.showToast?.('You do not have permission to manage accounts.', 'error');
        return;
    }
    document.getElementById('ca-drawer-root')?.remove();

    const isEdit = !!account;
    const lockStructural = isEdit && inUse;
    state.caMode = isEdit ? 'edit' : 'create';
    state.caAccount = account;
    state.caInUse = inUse;

    const hasParent = isEdit && !!account.parent_code;
    const structuralHint = lockStructural
        ? 'Locked — this account has posted activity, so its category and parent cannot change. You can still rename it.'
        : 'Determines the account type and where it appears in your reports.';

    const html = `
    <div id="ca-drawer-root" class="fluxy-drawer-root">
        <div id="ca-drawer-overlay" class="fluxy-drawer-overlay opacity-0 transition-opacity duration-300 ease-out"></div>
        <div id="ca-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="ca-drawer-title" class="fluxy-drawer-panel fluxy-drawer-panel--md translate-x-full">
            <div class="fluxy-drawer-header">
                <div>
                    <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">Chart of Accounts</p>
                    <h2 id="ca-drawer-title" class="fluxy-drawer-title">${isEdit ? 'Edit Account' : 'New Account'}</h2>
                    <p class="fluxy-drawer-desc">${isEdit
                        ? 'Update this account. Structural fields lock once it has posted activity.'
                        : 'Add a custom account to your chart. It becomes available in manual journals, account mapping, and reports.'}</p>
                </div>
                <button type="button" id="ca-close" class="fluxy-drawer-close" aria-label="Close">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
            <form id="ca-form" class="flex flex-1 flex-col overflow-hidden">
                <div class="fluxy-drawer-body">
                    <section class="fluxy-drawer-section">
                        <h3 class="fluxy-drawer-section-title">Account information</h3>
                        <div class="fluxy-drawer-field">
                            <label for="ca-category" class="fluxy-drawer-label">Account category</label>
                            <select id="ca-category" class="fluxy-drawer-select"${lockStructural ? ' disabled' : ''}>${categoryOptionsHtml({ restrictType: isEdit ? account.type : null, selected: isEdit ? account.sak_category : '' })}</select>
                            <p class="fluxy-drawer-hint">${structuralHint}</p>
                        </div>
                        <div class="fluxy-drawer-field-grid">
                            <div class="fluxy-drawer-field">
                                <label for="ca-code" class="fluxy-drawer-label">Account code</label>
                                <input type="text" id="ca-code" inputmode="numeric" maxlength="4" placeholder="e.g. 6900" value="${isEdit ? escapeHtml(account.code) : ''}"${isEdit ? ' disabled' : ''} class="fluxy-drawer-input tabular-nums">
                                <p class="fluxy-drawer-hint">${isEdit ? 'The account code cannot be changed.' : '4 digits (1000–9999). The first digit must match the category type.'}</p>
                            </div>
                            <div class="fluxy-drawer-field">
                                <label for="ca-name" class="fluxy-drawer-label">Account name</label>
                                <input type="text" id="ca-name" maxlength="120" required placeholder="e.g. Consulting Revenue" value="${isEdit ? escapeHtml(account.name || '') : ''}" class="fluxy-drawer-input">
                            </div>
                        </div>
                        <div class="fluxy-drawer-field${isEdit && !taxAppliesToType(account.type) ? ' hidden' : ''}" id="ca-tax-field">
                            <label for="ca-tax" class="fluxy-drawer-label">Tax <span class="text-gray-400 font-normal">(optional)</span></label>
                            <select id="ca-tax" class="fluxy-drawer-select">${taxOptionsHtml(isEdit ? account.tax_code : '', isEdit ? account.type : 'asset')}</select>
                            <p class="fluxy-drawer-hint">Default PPN treatment recorded on this account. Choose "No tax" to leave it unset.</p>
                        </div>
                    </section>

                    <section class="fluxy-drawer-section">
                        <h3 class="fluxy-drawer-section-title">Hierarchy & notes</h3>
                        <label class="flex items-center gap-2 text-[14px] text-gray-700 cursor-pointer">
                            <input type="checkbox" id="ca-parent-toggle" class="h-4 w-4 rounded border-gray-300"${hasParent ? ' checked' : ''}${lockStructural ? ' disabled' : ''}>
                            <span>Set this account as part of another account</span>
                        </label>
                        <div id="ca-parent-field" class="fluxy-drawer-field${hasParent ? '' : ' hidden'}" style="margin-top:12px;">
                            <label for="ca-parent" class="fluxy-drawer-label">Parent account</label>
                            <select id="ca-parent" class="fluxy-drawer-select"${lockStructural ? ' disabled' : ''}></select>
                            <p class="fluxy-drawer-hint">Must be an active account of the same type and code range.</p>
                        </div>
                        <div class="fluxy-drawer-field" style="margin-top:12px;">
                            <label for="ca-description" class="fluxy-drawer-label">Description <span class="text-gray-400 font-normal">(optional)</span></label>
                            <textarea id="ca-description" maxlength="255" rows="2" placeholder="Example: Account for employee receivables" class="fluxy-drawer-input">${isEdit ? escapeHtml(account.description || '') : ''}</textarea>
                        </div>
                    </section>

                    <div id="ca-error" class="hidden rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700"></div>
                </div>
                <div class="fluxy-drawer-footer">
                    <button type="button" id="ca-cancel" class="acct-btn acct-btn-secondary">Cancel</button>
                    <button type="submit" id="ca-save" class="acct-btn acct-btn-primary">${isEdit ? 'Save changes' : 'Save account'}</button>
                </div>
            </form>
        </div>
    </div>`;

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container.firstElementChild);
    document.body.classList.add('overflow-hidden');

    const panel = caEl('ca-drawer-panel');
    const overlay = caEl('ca-drawer-overlay');
    window.requestAnimationFrame(() => {
        panel?.classList.remove('translate-x-full');
        overlay?.classList.remove('opacity-0');
    });

    // Wire interactions.
    caEl('ca-close')?.addEventListener('click', closeCreateAccountDrawer);
    caEl('ca-cancel')?.addEventListener('click', closeCreateAccountDrawer);
    overlay?.addEventListener('click', closeCreateAccountDrawer);
    caEl('ca-category')?.addEventListener('change', refreshCaDerived);
    caEl('ca-code')?.addEventListener('input', (e) => { e.target.dataset.autofill = '0'; });
    caEl('ca-parent-toggle')?.addEventListener('change', (e) => {
        caEl('ca-parent-field')?.classList.toggle('hidden', !e.target.checked);
        if (e.target.checked) refreshCaDerived();
    });
    caEl('ca-form')?.addEventListener('submit', (e) => { e.preventDefault(); submitAccount(); });

    refreshCaDerived();

    state.caDispose = window.FluxyDrawer?.mountBehavior?.(panel, {
        closeOnEscape: true,
        closeOnOverlay: false, // overlay click already wired above
        onClose: closeCreateAccountDrawer,
        overlayEl: overlay
    });

    if (typeof window.translateDashboardPage === 'function') window.translateDashboardPage();
}

function closeCreateAccountDrawer() {
    const root = caEl('ca-drawer-root');
    if (!root) return;
    caEl('ca-drawer-panel')?.classList.add('translate-x-full');
    caEl('ca-drawer-overlay')?.classList.add('opacity-0');
    document.body.classList.remove('overflow-hidden');
    if (typeof state.caDispose === 'function') { state.caDispose(); state.caDispose = null; }
    setTimeout(() => root.remove(), 300);
}

function showCaError(msg) {
    const box = caEl('ca-error');
    if (!box) return;
    if (!msg) { box.classList.add('hidden'); box.textContent = ''; return; }
    box.classList.remove('hidden');
    box.textContent = msg;
}

async function submitAccount() {
    const isEdit = state.caMode === 'edit';
    const type = isEdit ? state.caAccount.type : caType();
    const code = isEdit ? String(state.caAccount.code) : String(caEl('ca-code')?.value || '').trim();
    const name = String(caEl('ca-name')?.value || '').trim();
    const taxCode = TAX_OPTION_CODES.has(caEl('ca-tax')?.value) ? caEl('ca-tax').value : '';
    const sakCategory = caEl('ca-category')?.value || '';
    const parentCode = caEl('ca-parent-toggle')?.checked ? String(caEl('ca-parent')?.value || '').trim() : '';
    const description = String(caEl('ca-description')?.value || '').trim();

    // Create only: reject a duplicate code before touching Firestore (the DAL also
    // guards with { create: true }). In edit mode the code is immutable.
    if (!isEdit && (state.kernel?.coa || []).some(a => String(a.code) === code)) {
        showCaError('Account code already exists.');
        return;
    }
    const parent = parentCode ? (state.kernel?.coa || []).find(a => String(a.code) === parentCode) : null;
    const draft = { code, type, name, name_id: null, sak_category: sakCategory, parent_code: parentCode || null };
    const check = validateAccountDraft(draft, { parent: parent || null });
    if (!check.ok) { showCaError(check.errors.join(' ')); return; }
    showCaError('');

    const saveBtn = caEl('ca-save');
    const savingLabel = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
    try {
        const data = {
            code, name,
            sak_category: sakCategory, parent_code: parentCode || null,
            description: description || null, tax_code: taxCode || null
        };
        if (isEdit) {
            await state.ds.saveAccount(state.user.uid, data);
            window.showToast?.('Account updated.', 'success');
        } else {
            await state.ds.saveAccount(state.user.uid, { ...data, type }, { create: true });
            window.showToast?.('Account created.', 'success');
        }
        closeCreateAccountDrawer();
        await loadKernel(true);
    } catch (err) {
        console.error('Save account failed:', err);
        showCaError(err?.message || 'Could not save the account. Try again.');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = savingLabel || (isEdit ? 'Save changes' : 'Save account'); }
    }
}

async function handleCoaToggle(code, isActive) {
    const account = (state.kernel.coa || []).find(a => a.code === code);
    if (!account) return;
    const confirmed = await window.showConfirmDialog?.({
        title: isActive ? 'Archive this account?' : 'Reactivate this account?',
        body: isActive
            ? `<strong>${escapeHtml(code)} ${escapeHtml(account.name)}</strong> will be hidden from account pickers. Its posted history stays in the ledger and trial balance.`
            : `<strong>${escapeHtml(code)} ${escapeHtml(account.name)}</strong> will be available in account pickers again.`,
        confirmLabel: isActive ? 'Archive' : 'Reactivate',
        cancelLabel: 'Cancel',
        tone: isActive ? 'danger' : 'default'
    });
    if (confirmed === false) return;
    try {
        if (isActive) await state.ds.archiveAccount(state.user.uid, code);
        else await state.ds.reactivateAccount(state.user.uid, code);
        window.showToast?.(isActive ? 'Account archived.' : 'Account reactivated.', 'success');
        await loadKernel(true);
    } catch (err) {
        console.error('CoA toggle failed:', err);
        window.showToast?.(err?.message || 'Could not update the account. Try again.', 'error');
    }
}

const GL_ALL = '__all__';

function renderLedgerSelector() {
    const sel = el('ledger-account-select');
    if (!sel) return;
    // Archived accounts drop out of the picker; their history still shows in
    // the trial balance (which reads ledger_balances, not this list).
    const coa = (state.kernel.coa || []).filter(a => a.is_active !== false);
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
    const reopeningBtn = el('reopen-period-btn');
    const loading = !state.kernel.period || state.kernel.loadedPeriod !== currentPeriodKey();
    if (loading) {
        status.innerHTML = `<span class="fluxy-table-status fluxy-status-neutral">Loading period status…</span>`;
        btn.classList.remove('hidden');
        btn.disabled = true;
        btn.textContent = 'Loading...';
        if (reopeningBtn) reopeningBtn.classList.add('hidden');
        return;
    }
    const period = state.kernel.period || { status: 'open' };
    const tb = state.kernel.trial || { balanced: true, rows: [] };
    const reopenBtn = reopeningBtn;
    // Reopen is owner/admin only (mirrors the firestore.rules gate).
    const canReopen = !!(window.FluxyWorkspace && typeof window.FluxyWorkspace.can === 'function'
        ? window.FluxyWorkspace.can('period.lock')
        : false);
    if (period.status === 'closed' || period.status === 'locked') {
        const label = period.status === 'locked' ? 'Locked period' : 'Closed period';
        status.innerHTML = `<span class="fluxy-table-status fluxy-status-neutral">${escapeHtml(label)}</span>`;
        btn.classList.add('hidden');
        if (reopenBtn) {
            reopenBtn.classList.remove('acct-btn-secondary');
            reopenBtn.classList.add('acct-btn-primary');
            reopenBtn.classList.toggle('hidden', !canReopen);
        }
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
    // A balanced trial balance only proves the journals that EXIST foot. It says
    // nothing about sources that never posted — closing over those locks in
    // incomplete books.
    const blocking = Number(state.kernel.unposted?.blocking) || 0;
    const postBtn = el('post-unposted-btn');
    if (blocking > 0) {
        status.innerHTML = `<span class="fluxy-table-status fluxy-status-danger">${blocking} entr${blocking === 1 ? 'y is' : 'ies are'} not posted to the ledger</span>`;
        btn.disabled = true;
        btn.textContent = 'Close period';
        btn.title = 'Post every entry for this period before closing it.';
        // The gate is only fair if it is actionable — these sources carry no
        // 'pending' flag, so the Journals sweep button cannot reach them.
        if (postBtn && canManualJournal()) {
            postBtn.classList.remove('hidden');
            postBtn.disabled = false;
            postBtn.textContent = `Post ${blocking} unposted entr${blocking === 1 ? 'y' : 'ies'}`;
        }
        return;
    }
    if (postBtn) postBtn.classList.add('hidden');
    btn.removeAttribute('title');
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
        state.kernel.period = { status: 'closed' };
        renderClosePanel();
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
        confirmLabel: 'Reopen this period',
        cancelLabel: 'Cancel',
        tone: 'default'
    });
    if (ok === false) return;
    const btn = el('reopen-period-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Reopening…'; }
    try {
        const res = await state.ds.reopenPeriod(state.user.uid, pk);
        window.showToast?.(`Reopened ${pk}.${res.reversed_close_journals ? ' Closing entry reversed.' : ''}`, 'success');
        state.kernel.period = { status: 'open' };
        renderClosePanel();
        await loadKernel(true);
    } catch (err) {
        console.error('Reopen period failed:', err);
        await window.showAlertDialog?.({ title: 'Could not reopen period', body: escapeHtml(err.message || 'Please try again.'), tone: 'danger' });
        renderClosePanel();
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Reopen this period'; }
    }
}
