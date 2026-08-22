// FluxyOS — Account Detail page
//
// Single-account ledger view opened from Accounting Center -> Chart of Accounts.
// The page reads the existing journal stream through DataService.getAccountDetail
// and keeps drill-downs pointed at Journal Detail / source records.

const PAGE_SIZE = 25;

const SAK_LABELS = {
    cash_bank: 'Cash & Bank', accounts_receivable: 'Receivable', other_current_asset: 'Other Current Asset',
    inventory: 'Inventory', fixed_asset: 'Fixed Asset', accumulated_depreciation: 'Accum. Depreciation',
    other_asset: 'Other Asset', accounts_payable: 'Payable', other_current_liability: 'Other Current Liability',
    long_term_liability: 'Long-term Liability', equity: 'Equity', revenue: 'Revenue',
    other_income: 'Other Income', cogs: 'COGS', operating_expense: 'Operating Expense', other_expense: 'Other Expense'
};

// PPN treatment codes → display label (matches the New Account drawer / Tax Center).
const TAX_LABELS = {
    PPN_OUT_11: 'PPN Keluaran 11%', PPN_IN_11: 'PPN Masukan 11%',
    PPN_ZERO: 'PPN 0%', PPN_EXEMPT: 'PPN Dibebaskan'
};

const SOURCE_OPTIONS = [
    ['manual', 'Manual journals'],
    ['transactions', 'Transactions'],
    ['bills', 'Bills'],
    ['invoices', 'Invoices'],
    ['subscriptions', 'Subscriptions'],
    ['bank_statement_imports', 'Bank transactions'],
    ['periods', 'Period close']
];

function el(id) { return document.getElementById(id); }

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function translate(text) {
    if (typeof window.tDashboard === 'function') return window.tDashboard(text);
    return text;
}

function formatRupiah(n) {
    const value = Number(n);
    if (!Number.isFinite(value)) return window.FluxyMoney.formatBase(0);
    return window.FluxyMoney.formatBase(Math.abs(Math.round(value)));
}

function signedRupiah(n) {
    const value = Number(n) || 0;
    const text = formatRupiah(value);
    return value < 0 ? `(${text})` : text;
}

function tsMillis(t) {
    if (!t) return null;
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t.seconds === 'number') return t.seconds * 1000;
    if (t instanceof Date) return t.getTime();
    return null;
}

function fmtDate(t) {
    const ms = tsMillis(t);
    if (!ms) return '-';
    return new Date(ms).toLocaleDateString((window.FluxyI18n?.locale?.() || 'en-GB'), {
        day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta'
    });
}

function todayInputValue() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

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

function journalDetailLink(id) { return id ? `accounting-journal.html?id=${encodeURIComponent(id)}` : ''; }

const state = {
    ds: null,
    user: null,
    code: '',
    detail: null,
    filters: { search: '', startDate: '', endDate: '', source: '' },
    page: 1
};

export function initAccountingAccountPage({ ds, user }) {
    state.ds = ds;
    state.user = user;
    state.code = String(new URLSearchParams(window.location.search).get('code') || '').trim();

    el('account-ask-ai')?.addEventListener('click', () => {
        if (typeof window.toggleFluxyAI === 'function') window.toggleFluxyAI(true);
        else window.showToast?.(translate('Fluxy AI is still loading. Try again in a moment.'), 'info');
    });
    el('account-export')?.addEventListener('click', exportCsv);
    el('account-retry')?.addEventListener('click', () => loadAccount());
    el('account-filter-apply')?.addEventListener('click', applyFilters);
    el('account-filter-clear')?.addEventListener('click', clearFilters);
    el('account-prev')?.addEventListener('click', () => changePage(-1));
    el('account-next')?.addEventListener('click', () => changePage(1));

    const end = el('account-filter-end');
    if (end) end.max = todayInputValue();
    const start = el('account-filter-start');
    if (start) start.max = todayInputValue();

    loadAccount();
}

async function loadAccount() {
    if (!state.code) return showError(translate('No account was specified in the link.'));
    setLoading(true);
    try {
        const detail = await state.ds.getAccountDetail(state.user.uid, state.code, state.filters);
        if (!detail) return showError(translate('This account could not be found.'));
        state.detail = detail;
        state.page = 1;
        render();
    } catch (err) {
        console.error('Account detail load failed:', err);
        showError(translate('Check your connection and try again.'));
    }
}

function setLoading(loading) {
    el('account-loading')?.classList.toggle('hidden', !loading);
    el('account-error')?.classList.add('hidden');
    el('account-content')?.classList.toggle('hidden', loading);
}

function showError(msg) {
    el('account-loading')?.classList.add('hidden');
    el('account-content')?.classList.add('hidden');
    const error = el('account-error');
    if (error) {
        error.classList.remove('hidden');
        const body = el('account-error-body');
        if (body) body.textContent = msg;
    }
}

function applyFilters() {
    state.filters = {
        search: el('account-filter-search')?.value.trim() || '',
        startDate: el('account-filter-start')?.value || '',
        endDate: el('account-filter-end')?.value || '',
        source: el('account-filter-source')?.value || ''
    };
    loadAccount();
}

function clearFilters() {
    ['account-filter-search', 'account-filter-start', 'account-filter-end', 'account-filter-source'].forEach((id) => {
        const node = el(id);
        if (node) node.value = '';
    });
    state.filters = { search: '', startDate: '', endDate: '', source: '' };
    loadAccount();
}

function changePage(delta) {
    const total = Math.max(1, Math.ceil((state.detail?.entries?.length || 0) / PAGE_SIZE));
    state.page = Math.min(total, Math.max(1, state.page + delta));
    renderEntries();
}

function metaItem(label, value) {
    return `<div class="acct-jr-meta-item"><div class="acct-jr-meta-label">${escapeHtml(translate(label))}</div><div class="acct-jr-meta-value">${value}</div></div>`;
}

function statusBadge(account) {
    if (account.is_active === false) return '<span class="fluxy-table-status fluxy-status-neutral">Archived</span>';
    if (account.is_locked) return '<span class="fluxy-table-status fluxy-status-warning">Locked</span>';
    return '<span class="fluxy-table-status fluxy-status-success">Active</span>';
}

function render() {
    setLoading(false); // reveal content, hide the skeleton loader + any prior error
    const detail = state.detail;
    const account = detail.account;
    const codeName = `${account.code} ${account.name || ''}`.trim();
    document.title = `FluxyOS | ${codeName}`;
    const title = el('account-title');
    if (title) title.textContent = codeName;
    const subtitle = el('account-subtitle');
    if (subtitle) subtitle.textContent = translate('Single-account ledger with source drill-down.');
    const exportBtn = el('account-export');
    if (exportBtn) exportBtn.disabled = !detail.entries.length;

    // Breadcrumb renders above the filter section (design rule), not inside the
    // detail body that follows it.
    const crumb = el('account-breadcrumb');
    if (crumb) crumb.innerHTML = `
        <a href="/accounting">${escapeHtml(translate('Accounting Center'))}</a><span>/</span>
        <a href="/accounting">${escapeHtml(translate('Chart of Accounts'))}</a><span>/</span>
        <span style="color:#374151;font-weight:500;">${escapeHtml(codeName)}</span>`;

    el('account-detail-body').innerHTML = `
        <section class="acct-card" style="padding:24px;margin-bottom:20px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
                <div style="min-width:0;">
                    <h1 class="fluxy-section-title" style="font-size:24px;color:#0B0F19;">${escapeHtml(codeName)}</h1>
                    <p class="fluxy-body" style="color:#6B7280;margin-top:4px;">${escapeHtml(translate(SAK_LABELS[account.sak_category] || account.sak_category || 'Unclassified'))}</p>
                </div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    ${statusBadge(account)}
                    ${account.is_system ? '<span class="acct-pill acct-pill-planned">System</span>' : '<span class="acct-pill acct-pill-suggested">User-created</span>'}
                </div>
            </div>
            <div class="acct-jr-meta-grid">
                ${metaItem('Account code', escapeHtml(account.code))}
                ${metaItem('Account name', escapeHtml(account.name || '-'))}
                ${metaItem('Category', escapeHtml(translate(SAK_LABELS[account.sak_category] || account.sak_category || '-')))}
                ${metaItem('Parent account', escapeHtml(account.parent_code || '-'))}
                ${metaItem('Opening balance', escapeHtml(signedRupiah(account.opening_balance || 0)))}
                ${metaItem('Current balance', escapeHtml(signedRupiah(account.current_balance || 0)))}
                ${metaItem('Type', escapeHtml(translate(account.type || '-')))}
                ${metaItem('Normal balance', escapeHtml(translate(account.normal_balance || '-')))}
                ${metaItem('Tax', escapeHtml(TAX_LABELS[account.tax_code] || translate('No tax')))}
            </div>
        </section>

        <section class="acct-card fluxy-table-card">
            <div class="fluxy-table-card-header">
                <div>
                    <h2 class="fluxy-table-title">${escapeHtml(translate('Transaction history'))}</h2>
                    <p class="fluxy-table-subtitle">${escapeHtml(translate('Every posted journal line for this account, with running balance.'))}</p>
                </div>
                <div class="fluxy-table-actions">
                    <span class="acct-pill acct-pill-planned">${escapeHtml(String(detail.entries.length))} ${escapeHtml(translate('entries'))}</span>
                </div>
            </div>
            <div id="account-entries"></div>
        </section>
    `;

    renderEntries();
    if (typeof window.translateDashboardPage === 'function') window.translateDashboardPage();
}

function renderEntries() {
    const detail = state.detail;
    const mount = el('account-entries');
    if (!mount || !detail) return;
    const total = detail.entries.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    const start = (state.page - 1) * PAGE_SIZE;
    const rows = detail.entries.slice(start, start + PAGE_SIZE);

    if (!total) {
        mount.innerHTML = `<div class="acct-records-empty">
            <div class="fluxy-table-empty-title">${escapeHtml(translate('No activity for this account'))}</div>
            <div class="fluxy-table-empty-description">${escapeHtml(translate('Change the filters or date range to inspect more history.'))}</div>
        </div>`;
        updatePager(0, 0, 0);
        return;
    }

    const body = rows.map((entry) => {
        const journalHref = journalDetailLink(entry.journal_id);
        const sourceLink = entry.source_href
            ? `<a class="acct-records-link" href="${escapeHtml(entry.source_href)}">${escapeHtml(translate('Source'))}</a>`
            : '';
        return `<tr class="fluxy-table-row fluxy-table-row-clickable" data-href="${escapeHtml(journalHref)}" tabindex="0">
            <td class="fluxy-table-cell"><div class="fluxy-table-cell-primary">${escapeHtml(fmtDate(entry.date))}</div><div class="fluxy-table-cell-meta">${escapeHtml(entry.period_key || '')}</div></td>
            <td class="fluxy-table-cell"><div class="fluxy-table-cell-primary">${escapeHtml(entry.description || entry.memo || entry.posting_rule_id || '-')}</div><div class="fluxy-table-cell-meta">${escapeHtml(entry.journal_number || entry.posting_rule_id || '')}</div></td>
            <td class="fluxy-table-cell"><div class="fluxy-table-cell-primary">${escapeHtml(entry.reference_number || '-')}</div>${sourceLink ? `<div class="fluxy-table-cell-meta">${sourceLink}</div>` : ''}</td>
            <td class="fluxy-table-cell"><span class="fluxy-table-cell-meta">${escapeHtml(translate(entry.source_module_label || 'Manual journal'))}</span></td>
            <td class="fluxy-table-cell fluxy-table-money">${entry.debit ? formatRupiah(entry.debit) : '-'}</td>
            <td class="fluxy-table-cell fluxy-table-money">${entry.credit ? formatRupiah(entry.credit) : '-'}</td>
            <td class="fluxy-table-cell fluxy-table-money">${signedRupiah(entry.running_balance)}</td>
            <td class="fluxy-table-cell"><span class="fluxy-table-status ${entry.status === 'draft' ? 'fluxy-status-neutral' : 'fluxy-status-success'}">${escapeHtml(translate(entry.status || 'posted'))}</span></td>
        </tr>`;
    }).join('');

    mount.innerHTML = `<div class="fluxy-table-scroll">
        <table class="fluxy-table">
            <thead><tr class="fluxy-table-header">
                <th>${escapeHtml(translate('Date'))}</th>
                <th>${escapeHtml(translate('Description'))}</th>
                <th>${escapeHtml(translate('Reference'))}</th>
                <th>${escapeHtml(translate('Source module'))}</th>
                <th class="fluxy-table-money">${escapeHtml(translate('Debit'))}</th>
                <th class="fluxy-table-money">${escapeHtml(translate('Credit'))}</th>
                <th class="fluxy-table-money">${escapeHtml(translate('Running balance'))}</th>
                <th>${escapeHtml(translate('Status'))}</th>
            </tr></thead>
            <tbody>${body}</tbody>
        </table>
    </div>`;
    wireRowNavigation(mount);
    updatePager(start + 1, Math.min(start + PAGE_SIZE, total), total);
}

function wireRowNavigation(wrap) {
    if (!wrap || wrap.dataset.navWired) return;
    wrap.dataset.navWired = '1';
    const go = (target) => {
        if (target.closest('a,button,input,select')) return;
        const row = target.closest('tr[data-href]');
        const href = row?.getAttribute('data-href');
        if (href) window.location.href = href;
    };
    wrap.addEventListener('click', (event) => go(event.target));
    wrap.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') go(event.target);
    });
}

function updatePager(from, to, total) {
    const label = el('account-page-label');
    if (label) label.textContent = total ? `${from}-${to} of ${total}` : '0 of 0';
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const prev = el('account-prev');
    const next = el('account-next');
    if (prev) prev.disabled = state.page <= 1;
    if (next) next.disabled = state.page >= pages;
}

function exportCsv() {
    const detail = state.detail;
    if (!detail?.entries?.length) {
        window.showToast?.(translate('No account activity to export.'), 'info');
        return;
    }
    const headers = ['Date', 'Description', 'Reference', 'Source module', 'Debit', 'Credit', 'Running balance', 'Status', 'Journal ID', 'Source ID'];
    const rows = detail.entries.map((entry) => [
        fmtDate(entry.date), entry.description || entry.memo || entry.posting_rule_id || '',
        entry.reference_number || '', entry.source_module_label || '', entry.debit || 0,
        entry.credit || 0, entry.running_balance || 0, entry.status || '',
        entry.journal_id || '', entry.source_id || ''
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
    const range = [state.filters.startDate || 'all', state.filters.endDate || 'all'].join('_to_');
    downloadFile(`account_activity_${state.code}_${range}.csv`, csv);
    window.showToast?.(translate('Account activity exported.'), 'success');
}

export function accountSourceOptionsHtml() {
    return SOURCE_OPTIONS.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(translate(label))}</option>`).join('');
}
