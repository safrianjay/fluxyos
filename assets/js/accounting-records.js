// Accounting Records drilldown page.
// Read-only detail surface for Income Statement source rows. P&L amounts stay
// transaction-backed in DataService; Bills and Subscriptions appear as
// supporting context only.

const PAGE_SIZE = 10;

const state = {
    ds: null,
    user: null,
    report: null,
    page: 1,
    filters: {
        search: '',
        status: 'all',
        type: 'all',
        source: 'all',
        sort: 'newest'
    }
};

function el(id) { return document.getElementById(id); }

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getDayKey(date = new Date()) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

function getMonthStartKey(date = new Date()) {
    return getDayKey(new Date(date.getFullYear(), date.getMonth(), 1));
}

function getMonthEndKey(date = new Date()) {
    return getDayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

function parseDayKey(dayKey) {
    if (typeof dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
    const [year, month, day] = dayKey.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
}

function resolvePeriodParam(value) {
    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}$/.test(raw)) {
        const [year, month] = raw.split('-').map(Number);
        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0);
        return { start: getDayKey(start), end: getDayKey(end) };
    }
    if (/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const [start, end] = raw.split('..');
        if (parseDayKey(start) && parseDayKey(end)) return { start, end };
    }
    return { start: getMonthStartKey(), end: getMonthEndKey() };
}

function readQueryParams() {
    const search = new URLSearchParams(window.location.search);
    return {
        section: search.get('section') || 'revenue',
        parent: search.get('parent') || '',
        category: search.get('category') || '',
        type: search.get('type') || '',
        compare: search.get('compare') || 'previous_period',
        period: resolvePeriodParam(search.get('period'))
    };
}

function formatRupiah(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'Rp 0';
    return `Rp ${Math.abs(Math.round(n)).toLocaleString('id-ID')}`;
}

function formatSignedRupiah(value) {
    const n = Number(value) || 0;
    const text = formatRupiah(n);
    if (n < 0) return `(${text})`;
    if (n > 0) return `+${text}`;
    return text;
}

function formatPercent(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
    const n = Number(value);
    return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function formatDate(dayKey) {
    const date = parseDayKey(dayKey);
    if (!date) return 'No date';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function titleCaseToken(value) {
    return String(value || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

function show(id) { el(id)?.classList.remove('hidden'); }
function hide(id) { el(id)?.classList.add('hidden'); }

export function initAccountingRecordsPage({ ds, user }) {
    state.ds = ds;
    state.user = user;
    wireControls();
    loadRecords();
}

function wireControls() {
    el('acct-records-back')?.addEventListener('click', () => { window.location.href = '/accounting'; });
    el('acct-records-empty-back')?.addEventListener('click', () => { window.location.href = '/accounting'; });
    el('acct-records-retry')?.addEventListener('click', () => loadRecords());
    el('acct-records-ask-ai')?.addEventListener('click', () => {
        if (typeof window.toggleFluxyAI === 'function') window.toggleFluxyAI(true);
        else window.showToast?.('Fluxy AI is still loading. Try again in a moment.', 'info');
    });

    const bind = (id, key) => {
        const node = el(id);
        if (!node) return;
        node.addEventListener('input', event => {
            state.filters[key] = event.target.value;
            state.page = 1;
            renderTable();
        });
        node.addEventListener('change', event => {
            state.filters[key] = event.target.value;
            state.page = 1;
            renderTable();
        });
    };
    bind('acct-records-search', 'search');
    bind('acct-records-status', 'status');
    bind('acct-records-type', 'type');
    bind('acct-records-source', 'source');
    bind('acct-records-sort', 'sort');

    el('acct-records-prev')?.addEventListener('click', () => {
        if (state.page <= 1) return;
        state.page -= 1;
        renderTable();
    });
    el('acct-records-next')?.addEventListener('click', () => {
        const totalPages = Math.max(1, Math.ceil(filteredRecords().length / PAGE_SIZE));
        if (state.page >= totalPages) return;
        state.page += 1;
        renderTable();
    });
}

async function loadRecords() {
    hide('acct-records-content');
    hide('acct-records-error');
    show('acct-records-loading');
    try {
        state.report = await state.ds.getIncomeStatementRelatedRecords(state.user.uid, readQueryParams());
        state.page = 1;
        hide('acct-records-loading');
        renderReport();
        show('acct-records-content');
    } catch (err) {
        console.error('Accounting related records failed:', err);
        hide('acct-records-loading');
        show('acct-records-error');
    }
}

function renderReport() {
    const report = state.report;
    if (!report) return;

    el('acct-records-crumb-label').textContent = report.label;
    el('acct-records-title').textContent = `${report.label} records`;
    el('acct-records-subtitle').textContent = `Records behind this Income Statement line for ${report.period.label}.`;

    renderSummaryCards(report);
    renderSuggestedAction(report);
    renderTable();
}

function renderSummaryCards(report) {
    const summary = report.summary || {};
    const cards = [
        { label: 'Current period', value: formatRupiah(summary.current_amount), sub: report.period.label },
        { label: 'Previous period', value: formatRupiah(summary.previous_amount), sub: report.comparison_period.label },
        { label: 'Change', value: formatSignedRupiah(summary.change_amount), sub: formatPercent(summary.change_pct) },
        { label: 'Status', value: summary.status_label || 'No records', sub: `${summary.cleanup_count || 0} cleanup item${summary.cleanup_count === 1 ? '' : 's'}` }
    ];
    el('acct-records-summary').innerHTML = cards.map(card => `
        <article class="acct-card acct-kpi">
            <span class="fluxy-kpi-label">${escapeHtml(card.label)}</span>
            <span class="acct-kpi-value acct-mono">${escapeHtml(card.value)}</span>
            <span class="fluxy-meta">${escapeHtml(card.sub)}</span>
        </article>
    `).join('');
}

function renderSuggestedAction(report) {
    const action = report.suggested_action || {};
    const supportingCount = Number(report.summary?.supporting_record_count || 0);
    const limitation = supportingCount > 0
        ? '<p class="fluxy-meta" style="margin-top:6px;">Bills and subscriptions are supporting context. Statement amounts remain transaction-backed.</p>'
        : '';
    el('acct-records-note').innerHTML = `
        <span class="fluxy-kpi-label">Suggested action</span>
        <h2 class="fluxy-card-title" style="margin-top:4px;color:#111827;">${escapeHtml(action.title || 'Review source records')}</h2>
        <p class="fluxy-body" style="color:#4B5563;margin-top:4px;">${escapeHtml(action.body || 'Use the table to inspect records for this line item.')}</p>
        ${limitation}
    `;
}

function filteredRecords() {
    const records = state.report?.records || [];
    const q = state.filters.search.trim().toLowerCase();
    const status = state.filters.status;
    const type = state.filters.type;
    const source = state.filters.source;

    const filtered = records.filter(record => {
        if (source !== 'all' && record.source_collection !== source) return false;
        if (type !== 'all' && String(record.type || '').toLowerCase() !== type) return false;
        if (status !== 'all' && record.status_filter !== status) return false;
        if (!q) return true;
        const haystack = [
            record.vendor_name,
            record.description,
            record.category,
            record.type,
            record.status,
            record.source_label,
            String(record.amount || '')
        ].join(' ').toLowerCase();
        return haystack.includes(q);
    });

    return filtered.sort((a, b) => {
        if (state.filters.sort === 'amount_desc') return Number(b.amount || 0) - Number(a.amount || 0);
        if (state.filters.sort === 'amount_asc') return Number(a.amount || 0) - Number(b.amount || 0);
        const left = parseDayKey(a.date)?.getTime() || 0;
        const right = parseDayKey(b.date)?.getTime() || 0;
        return state.filters.sort === 'oldest' ? left - right : right - left;
    });
}

function statusPillClass(record) {
    if (record.status_filter === 'missing_receipt') return 'acct-pill-needs';
    const status = String(record.status || '').toLowerCase();
    if (status === 'paid' || status === 'active' || status === 'completed') return 'acct-pill-ready';
    if (status.includes('due')) return 'acct-pill-almost';
    return 'acct-pill-planned';
}

function sourceBadgeClass(source) {
    if (source === 'transactions') return 'acct-pill-suggested';
    if (source === 'bills') return 'acct-pill-planned';
    return 'acct-pill-saved';
}

function actionLabel(source) {
    if (source === 'bills') return 'View Bill';
    if (source === 'subscriptions') return 'View Subscription';
    return 'View in Ledger';
}

function renderTable() {
    const body = el('acct-records-body');
    const empty = el('acct-records-empty');
    const tableWrap = el('acct-records-table-wrap');
    const records = filteredRecords();
    const total = records.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    const startIndex = (state.page - 1) * PAGE_SIZE;
    const pageRecords = records.slice(startIndex, startIndex + PAGE_SIZE);

    const hasAnyRecords = (state.report?.records || []).length > 0;
    const hasFilters = Boolean(state.filters.search.trim())
        || state.filters.status !== 'all'
        || state.filters.type !== 'all'
        || state.filters.source !== 'all';

    if (!pageRecords.length) {
        tableWrap.classList.add('hidden');
        empty.classList.remove('hidden');
        el('acct-records-empty-title').textContent = hasAnyRecords && hasFilters
            ? 'No records match your filters'
            : 'No related records found';
        el('acct-records-empty-body').textContent = hasAnyRecords && hasFilters
            ? 'Try clearing search or filters to inspect more records.'
            : 'This Income Statement line has no source records for the selected period.';
    } else {
        empty.classList.add('hidden');
        tableWrap.classList.remove('hidden');
        body.innerHTML = pageRecords.map(record => `
            <tr>
                <td>${escapeHtml(formatDate(record.date))}</td>
                <td>
                    <div class="acct-records-primary">${escapeHtml(record.vendor_name || 'Record')}</div>
                    ${record.description ? `<div class="fluxy-meta">${escapeHtml(record.description)}</div>` : ''}
                </td>
                <td><span class="acct-pill ${sourceBadgeClass(record.source_collection)}">${escapeHtml(record.source_label || titleCaseToken(record.source_collection))}</span></td>
                <td>${escapeHtml(record.category || 'Uncategorized')}</td>
                <td>${escapeHtml(titleCaseToken(record.type || 'expense'))}</td>
                <td><span class="acct-pill ${statusPillClass(record)}">${escapeHtml(record.status || 'Completed')}</span></td>
                <td class="acct-records-amount acct-mono">${escapeHtml(formatRupiah(record.amount))}</td>
                <td><a class="acct-records-link" href="${escapeHtml(record.source_route || '/accounting')}">${escapeHtml(actionLabel(record.source_collection))}</a></td>
            </tr>
        `).join('');
    }

    const from = total === 0 ? 0 : startIndex + 1;
    const to = Math.min(startIndex + PAGE_SIZE, total);
    el('acct-records-page-summary').textContent = total === 0
        ? 'Showing 0 records'
        : `Showing ${from}-${to} of ${total} record${total === 1 ? '' : 's'}`;
    el('acct-records-prev').disabled = state.page <= 1;
    el('acct-records-next').disabled = state.page >= totalPages;
}
