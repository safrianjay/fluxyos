// Balance Sheet Records drilldown page.
// Read-only detail surface for a single Balance Sheet line. Mirrors the
// Accounting Records subpage: it lists the supporting source records behind a
// line item and every record links back to where it lives (Ledger, Bills, or
// Cash & Bank settings) using the universal record-centric deep-link, so a
// record is located + highlighted on its source page regardless of period.

const PAGE_SIZE = 10;

// The four Balance Sheet lines that have inspectable source records, mapped to
// the collection they come from and the page that owns those records.
const ROW_CONFIG = {
    cash_bank: {
        label: 'Cash & Bank',
        source: 'bank_accounts',
        sourceLabel: 'Bank accounts',
        // Bank balances are not date-scoped transactions; they live in settings.
        route: () => '/settings-cash',
        actionLabel: 'View in Cash Accounts'
    },
    accounts_receivable: {
        label: 'Accounts Receivable',
        source: 'transactions',
        sourceLabel: 'Transactions',
        route: id => `/ledger?record=${encodeURIComponent(id)}`,
        actionLabel: 'View in Ledger'
    },
    accounts_payable: {
        label: 'Accounts Payable',
        source: 'bills',
        sourceLabel: 'Bills',
        route: id => `/bill?record=${encodeURIComponent(id)}`,
        actionLabel: 'View Bill'
    },
    pending_payables: {
        label: 'Pending Payables',
        source: 'transactions',
        sourceLabel: 'Transactions',
        route: id => `/ledger?record=${encodeURIComponent(id)}`,
        actionLabel: 'View in Ledger'
    }
};

const state = {
    ds: null,
    user: null,
    rowId: 'cash_bank',
    asOf: null,
    cadence: 'monthly',
    config: null,
    row: null,
    asOfLabel: '',
    records: [],
    filters: { search: '', sort: 'amount_desc' },
    page: 1
};

function el(id) { return document.getElementById(id); }
function show(id) { el(id)?.classList.remove('hidden'); }
function hide(id) { el(id)?.classList.add('hidden'); }

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatRupiah(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'Rp0';
    return `Rp${Math.abs(Math.round(n)).toLocaleString('id-ID')}`;
}

// Records arrive as raw Firestore docs, so values may be Timestamps, Dates, or
// day-key strings. Normalize to a Date (or null) for both display and sorting.
function toDate(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') {
        const d = value.toDate();
        return Number.isNaN(d.getTime()) ? null : d;
    }
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        const [y, m, d] = value.slice(0, 10).split('-').map(Number);
        const date = new Date(y, m - 1, d);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}

function formatDate(value) {
    const date = toDate(value);
    if (!date) return 'No date';
    return date.toLocaleDateString((window.FluxyI18n?.locale?.() || 'en-US'), { month: 'short', day: 'numeric', year: 'numeric' });
}

function titleCase(value) {
    return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function readParams() {
    const q = new URLSearchParams(window.location.search);
    const rowId = q.get('row') || '';
    const asof = q.get('asof') || '';
    const cadence = q.get('cadence') || 'monthly';
    state.rowId = ROW_CONFIG[rowId] ? rowId : 'cash_bank';
    state.config = ROW_CONFIG[state.rowId];
    state.cadence = ['monthly', 'quarterly', 'yearly'].includes(cadence) ? cadence : 'monthly';
    state.asOf = /^\d{4}-\d{2}-\d{2}$/.test(asof) ? new Date(asof.split('-')[0], Number(asof.split('-')[1]) - 1, Number(asof.split('-')[2])) : new Date();
}

// Flatten one raw record into the uniform shape the table renders + sorts on.
function normalizeRecord(record, config) {
    const id = record.id;
    if (config.source === 'bank_accounts') {
        return {
            id,
            name: record.account_name || record.bank_name || 'Bank account',
            detail: record.bank_name || 'Bank',
            status: titleCase(record.status || 'active'),
            amount: Number(record.latest_balance) || 0,
            date: toDate(record.latest_balance_at),
            href: config.route(id),
            actionLabel: config.actionLabel,
            sourceLabel: config.sourceLabel
        };
    }
    if (config.source === 'bills') {
        return {
            id,
            name: record.vendor_name || record.merchant_name || 'Bill',
            detail: record.category || 'Uncategorized',
            status: titleCase(record.payment_status || 'unpaid'),
            amount: Number(record.amount) || 0,
            date: toDate(record.due_date) || toDate(record.timestamp),
            href: config.route(id),
            actionLabel: config.actionLabel,
            sourceLabel: config.sourceLabel
        };
    }
    // transactions (accounts_receivable, pending_payables)
    return {
        id,
        name: record.vendor_name || record.merchant_name || 'Transaction',
        detail: record.category || 'Uncategorized',
        status: titleCase(record.status || 'completed'),
        amount: Number(record.amount) || 0,
        date: toDate(record.timestamp),
        href: config.route(id),
        actionLabel: config.actionLabel,
        sourceLabel: config.sourceLabel
    };
}

export function initBalanceSheetRecordsPage({ ds, user }) {
    state.ds = ds;
    state.user = user;
    readParams();
    wireControls();
    loadRecords();
}

function wireControls() {
    const toBalanceSheet = () => { window.location.href = '/balance-sheet'; };
    el('bsr-back')?.addEventListener('click', toBalanceSheet);
    el('bsr-empty-back')?.addEventListener('click', toBalanceSheet);
    el('bsr-retry')?.addEventListener('click', () => loadRecords());
    el('bsr-ask-ai')?.addEventListener('click', () => {
        if (typeof window.toggleFluxyAI === 'function') window.toggleFluxyAI(true);
        else window.showToast?.('Fluxy AI is still loading. Try again in a moment.', 'info');
    });

    const bind = (id, key) => {
        const node = el(id);
        if (!node) return;
        const handler = event => {
            state.filters[key] = event.target.value;
            state.page = 1;
            renderTable();
        };
        node.addEventListener('input', handler);
        node.addEventListener('change', handler);
    };
    bind('bsr-search', 'search');
    bind('bsr-sort', 'sort');

    el('bsr-prev')?.addEventListener('click', () => {
        if (state.page <= 1) return;
        state.page -= 1;
        renderTable();
    });
    el('bsr-next')?.addEventListener('click', () => {
        const totalPages = Math.max(1, Math.ceil(filteredRecords().length / PAGE_SIZE));
        if (state.page >= totalPages) return;
        state.page += 1;
        renderTable();
    });

    // Whole-row navigation: locating the record on its source page is the
    // primary action (the source page then opens the detail drawer).
    el('bsr-body')?.addEventListener('click', event => {
        const row = event.target.closest('tr[data-href]');
        if (!row) return;
        window.location.href = row.getAttribute('data-href');
    });
}

async function loadRecords() {
    hide('bsr-content');
    hide('bsr-error');
    show('bsr-loading');
    try {
        const report = await state.ds.getBalanceSheetReport(state.user.uid, {
            asOfDate: state.asOf,
            cadence: state.cadence
        });
        const allRows = (report.sections || []).flatMap(section => section.rows || []);
        state.row = allRows.find(r => r.id === state.rowId)
            || { id: state.rowId, label: state.config.label, total: 0, record_count: 0 };
        state.asOfLabel = formatDate(report.as_of_date);
        const rawRecords = (report.related_records_index && report.related_records_index[state.rowId]) || [];
        state.records = rawRecords.map(record => normalizeRecord(record, state.config));
        state.page = 1;
        hide('bsr-loading');
        renderReport();
        show('bsr-content');
    } catch (err) {
        console.error('Balance Sheet related records failed:', err);
        hide('bsr-loading');
        show('bsr-error');
    }
}

function renderReport() {
    const label = state.config.label;
    el('bsr-crumb-label').textContent = label;
    el('bsr-title').textContent = `${label} records`;
    el('bsr-subtitle').textContent = `Source records behind the ${label} line, as of ${state.asOfLabel}.`;
    document.title = `FluxyOS | ${label} Records`;
    renderSummary();
    renderNote();
    renderHead();
    renderTable();
}

function renderSummary() {
    const cards = [
        { label: 'Line total', value: formatRupiah(state.row.total), sub: `As of ${state.asOfLabel}` },
        { label: 'Records', value: String(state.records.length), sub: state.config.sourceLabel },
        { label: 'Source', value: state.config.sourceLabel, sub: state.config.label },
        { label: 'As of date', value: state.asOfLabel, sub: titleCase(state.cadence) }
    ];
    el('bsr-summary').innerHTML = cards.map(card => `
        <article class="acct-card acct-kpi">
            <span class="fluxy-kpi-label">${escapeHtml(card.label)}</span>
            <span class="acct-kpi-value acct-mono">${escapeHtml(card.value)}</span>
            <span class="fluxy-meta">${escapeHtml(card.sub)}</span>
        </article>
    `).join('');
}

function renderNote() {
    const isBank = state.config.source === 'bank_accounts';
    const body = isBank
        ? 'Cash & bank balances are point-in-time snapshots. Open one to review or update it in Cash &amp; Bank settings.'
        : 'Every record below is fully traceable. Open one to jump to its source page — the date range snaps to the record’s own period and the row is located and highlighted automatically.';
    el('bsr-note').innerHTML = `
        <span class="fluxy-kpi-label">How to use this</span>
        <h2 class="fluxy-card-title" style="margin-top:4px;color:#111827;">Drill down to the source record</h2>
        <p class="fluxy-body" style="color:#4B5563;margin-top:4px;">${body}</p>
    `;
}

function renderHead() {
    const dateHeader = state.config.source === 'bank_accounts' ? 'As of' : 'Date';
    const amountHeader = state.config.source === 'bank_accounts' ? 'Balance' : 'Amount';
    el('bsr-table-head').innerHTML = `
        <th>${dateHeader}</th>
        <th>Name</th>
        <th>Source</th>
        <th>Detail</th>
        <th>Status</th>
        <th class="fluxy-table-money">${amountHeader}</th>
        <th class="fluxy-table-action">Action</th>
    `;
}

function filteredRecords() {
    const q = state.filters.search.trim().toLowerCase();
    let records = state.records.filter(record => {
        if (!q) return true;
        return [record.name, record.detail, record.status, record.sourceLabel, String(record.amount)]
            .some(field => String(field || '').toLowerCase().includes(q));
    });
    records = records.slice().sort((a, b) => {
        if (state.filters.sort === 'amount_desc') return Math.abs(b.amount) - Math.abs(a.amount);
        if (state.filters.sort === 'amount_asc') return Math.abs(a.amount) - Math.abs(b.amount);
        const left = a.date ? a.date.getTime() : 0;
        const right = b.date ? b.date.getTime() : 0;
        return state.filters.sort === 'oldest' ? left - right : right - left;
    });
    return records;
}

function renderTable() {
    const body = el('bsr-body');
    const empty = el('bsr-empty');
    const tableWrap = el('bsr-table-wrap');
    if (!body) return;

    const records = filteredRecords();
    const total = records.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    const startIndex = (state.page - 1) * PAGE_SIZE;
    const pageRecords = records.slice(startIndex, startIndex + PAGE_SIZE);

    const hasAny = state.records.length > 0;
    const hasFilter = Boolean(state.filters.search.trim());

    if (!pageRecords.length) {
        tableWrap.classList.add('hidden');
        empty.classList.remove('hidden');
        el('bsr-empty-title').textContent = hasAny && hasFilter ? 'No records match your search' : 'No supporting records found';
        el('bsr-empty-body').textContent = hasAny && hasFilter
            ? 'Try clearing the search to inspect more records.'
            : 'This Balance Sheet line has no source records as of the selected date.';
    } else {
        empty.classList.add('hidden');
        tableWrap.classList.remove('hidden');
        body.innerHTML = pageRecords.map(record => `
            <tr class="fluxy-table-row fluxy-table-row-clickable" data-href="${escapeHtml(record.href)}">
                <td class="fluxy-table-cell">${escapeHtml(formatDate(record.date))}</td>
                <td class="fluxy-table-cell"><span class="fluxy-table-cell-primary">${escapeHtml(record.name)}</span></td>
                <td class="fluxy-table-cell"><span class="fluxy-table-status fluxy-status-info">${escapeHtml(record.sourceLabel)}</span></td>
                <td class="fluxy-table-cell">${escapeHtml(record.detail)}</td>
                <td class="fluxy-table-cell">${escapeHtml(record.status)}</td>
                <td class="fluxy-table-cell fluxy-table-money acct-mono">${escapeHtml(formatRupiah(record.amount))}</td>
                <td class="fluxy-table-cell fluxy-table-action"><a class="acct-records-link fluxy-table-action" href="${escapeHtml(record.href)}">${escapeHtml(record.actionLabel)}</a></td>
            </tr>
        `).join('');
    }

    const from = total === 0 ? 0 : startIndex + 1;
    const to = Math.min(startIndex + PAGE_SIZE, total);
    el('bsr-page-summary').textContent = total === 0
        ? 'Showing 0 records'
        : `Showing ${from}-${to} of ${total} record${total === 1 ? '' : 's'}`;
    el('bsr-prev').disabled = state.page <= 1;
    el('bsr-next').disabled = state.page >= totalPages;
}
