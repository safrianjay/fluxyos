// Balance Sheet page controller - Phase 1 Management View.
// Uses existing user-scoped FluxyOS records through DataService. No formal
// chart of accounts, journal entries, retained earnings, or equity logic.

const state = {
    ds: null,
    user: null,
    asOfKey: getDayKey(),
    cadence: 'monthly',
    compareMode: 'previous_period',
    sectionFilter: 'all',
    sourceFilter: 'all',
    expanded: new Set(['assets', 'liabilities', 'cash_bank']),
    loading: false,
    report: null,
    rowsById: {},
    drawerOpen: false,
    exportInProgress: false,
    picker: null
};

const ROW_LABELS = {
    cash_bank: 'Cash & Bank',
    accounts_receivable: 'Accounts Receivable',
    accounts_payable: 'Accounts Payable',
    pending_payables: 'Pending Payables'
};

const SOURCE_LABELS = {
    bank_accounts: 'Bank accounts',
    transactions: 'Transactions',
    bills: 'Bills'
};
const UNAVAILABLE = '\u2014';

function el(id) { return document.getElementById(id); }

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getDayKey(date = new Date()) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

function parseDayKey(dayKey) {
    if (typeof dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return new Date();
    const [year, month, day] = dayKey.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function addMonths(date, delta) {
    return new Date(date.getFullYear(), date.getMonth() + delta, date.getDate());
}

function monthEnd(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function quarterEnd(date) {
    const quarterEndMonth = Math.floor(date.getMonth() / 3) * 3 + 2;
    return new Date(date.getFullYear(), quarterEndMonth + 1, 0);
}

function yearEnd(date) {
    return new Date(date.getFullYear(), 11, 31);
}

function clampToToday(date) {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return date > today ? today : date;
}

function resolveAsOfDate() {
    const selected = parseDayKey(state.asOfKey);
    let resolved = selected;
    if (state.cadence === 'monthly') resolved = monthEnd(selected);
    else if (state.cadence === 'quarterly') resolved = quarterEnd(selected);
    else if (state.cadence === 'yearly') resolved = yearEnd(selected);
    resolved.setHours(23, 59, 59, 999);
    return clampToToday(resolved);
}

function resolveCompareDate(asOfDate) {
    if (state.compareMode === 'none') return null;
    let compare = null;
    if (state.compareMode === 'previous_month') {
        compare = monthEnd(new Date(asOfDate.getFullYear(), asOfDate.getMonth() - 1, 1));
    } else if (state.compareMode === 'previous_quarter') {
        compare = quarterEnd(new Date(asOfDate.getFullYear(), asOfDate.getMonth() - 3, 1));
    } else if (state.compareMode === 'previous_year') {
        compare = new Date(asOfDate);
        compare.setFullYear(compare.getFullYear() - 1);
        if (state.cadence === 'yearly') compare = yearEnd(compare);
    } else if (state.cadence === 'quarterly') {
        compare = quarterEnd(new Date(asOfDate.getFullYear(), asOfDate.getMonth() - 3, 1));
    } else if (state.cadence === 'yearly') {
        compare = yearEnd(new Date(asOfDate.getFullYear() - 1, 0, 1));
    } else {
        compare = monthEnd(new Date(asOfDate.getFullYear(), asOfDate.getMonth() - 1, 1));
    }
    compare.setHours(23, 59, 59, 999);
    return compare;
}

function formatDate(dayKey) {
    const date = parseDayKey(dayKey);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatRupiah(value) {
    if (value === null || value === undefined) return UNAVAILABLE;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return UNAVAILABLE;
    const text = `Rp${Math.abs(Math.round(numeric)).toLocaleString('id-ID')}`;
    return numeric < 0 ? `(${text})` : text;
}

function formatChange(value) {
    if (value === null || value === undefined) return UNAVAILABLE;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return UNAVAILABLE;
    if (numeric > 0) return `+${formatRupiah(numeric)}`;
    return formatRupiah(numeric);
}

function rawAmount(value) {
    if (value === null || value === undefined || value === '') return '';
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric) : '';
}

function show(id) { el(id)?.classList.remove('hidden'); }
function hide(id) { el(id)?.classList.add('hidden'); }

export function initBalanceSheetPage({ ds, user }) {
    state.ds = ds;
    state.user = user;
    mountPicker();
    wireControls();
    loadReport();
}

function mountPicker() {
    if (!window.FluxyDateRangePicker?.mount) return;
    state.picker = window.FluxyDateRangePicker.mount('#bs-as-of-picker', {
        mode: 'single',
        start: state.asOfKey,
        end: state.asOfKey,
        defaultStart: state.asOfKey,
        defaultEnd: state.asOfKey,
        maxDate: getDayKey(),
        onChange: ({ start }) => {
            state.asOfKey = start;
            loadReport();
        }
    });
}

function wireControls() {
    el('bs-cadence-select')?.addEventListener('change', event => {
        state.cadence = event.target.value;
        loadReport();
    });
    el('bs-compare-select')?.addEventListener('change', event => {
        state.compareMode = event.target.value;
        loadReport();
    });
    el('bs-section-filter')?.addEventListener('change', event => {
        state.sectionFilter = event.target.value;
        loadReport();
    });
    el('bs-source-filter')?.addEventListener('change', event => {
        state.sourceFilter = event.target.value;
        loadReport();
    });
    el('bs-expand-btn')?.addEventListener('click', toggleAllRows);
    el('bs-export-btn')?.addEventListener('click', exportCsv);
    el('bs-print-btn')?.addEventListener('click', () => window.print());
    el('bs-drawer-overlay')?.addEventListener('click', closeDrawer);
    el('bs-drawer-close-btn')?.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && state.drawerOpen) closeDrawer();
    });
}

async function loadReport() {
    if (!state.user || state.loading) return;
    state.loading = true;
    hide('bs-error-banner');
    closeDrawer();
    el('bs-report-panel')?.classList.add('bs-report-loading');
    setExportEnabled(false, 'Loading report...');

    const asOfDate = resolveAsOfDate();
    const compareAsOfDate = resolveCompareDate(asOfDate);
    try {
        const report = await state.ds.getBalanceSheetReport(state.user.uid, {
            asOfDate,
            compareAsOfDate,
            cadence: state.cadence,
            filters: {
                section: state.sectionFilter,
                source: state.sourceFilter
            }
        });
        state.report = report;
        renderReport();
    } catch (error) {
        console.error('Balance Sheet failed:', error);
        el('bs-error-banner').textContent = 'Unable to load the Balance Sheet. Please refresh or try again.';
        show('bs-error-banner');
        state.report = null;
        renderEmptyTable();
    } finally {
        state.loading = false;
        el('bs-report-panel')?.classList.remove('bs-report-loading');
    }
}

function renderReport() {
    const report = state.report;
    if (!report) return;
    state.rowsById = {};
    report.sections.forEach(section => {
        state.rowsById[section.id] = { ...section, rowType: 'section' };
        section.rows.forEach(row => {
            state.rowsById[row.id] = { ...row, rowType: 'row', sectionId: section.id };
            (row.children || []).forEach(child => {
                state.rowsById[child.id] = { ...child, rowType: 'child', parentId: row.id, sectionId: section.id };
            });
        });
    });

    el('bs-current-header').textContent = `As of ${formatDate(report.as_of_date)}`;
    el('bs-compare-header').textContent = report.compare_as_of_date ? formatDate(report.compare_as_of_date) : 'Comparison';
    el('bs-report-subtitle').textContent = report.compare_as_of_date
        ? `As of ${formatDate(report.as_of_date)} compared with ${formatDate(report.compare_as_of_date)}`
        : `As of ${formatDate(report.as_of_date)}`;
    el('bs-generated-label').textContent = `Generated ${new Date(report.generated_at).toLocaleString('en-US')}`;
    el('bs-scope-summary').textContent = scopeText(report);

    renderWarnings(report.warnings || []);
    renderTable(report);

    const hasUsableData = hasData(report);
    el('bs-empty-banner')?.classList.toggle('hidden', hasUsableData);
    setExportEnabled(hasUsableData && !state.exportInProgress, hasUsableData ? 'Ready to export current view.' : 'Export disabled until source data exists.');
}

function scopeText(report) {
    const sourceLabel = SOURCE_LABELS[state.sourceFilter] || 'All sources';
    const sectionLabel = state.sectionFilter === 'all' ? 'Assets and liabilities' : (state.sectionFilter === 'assets' ? 'Assets only' : 'Liabilities only');
    const compare = report.compare_as_of_date ? `Comparison: ${formatDate(report.compare_as_of_date)}.` : 'No comparison selected.';
    return `${sectionLabel}. ${sourceLabel}. ${compare}`;
}

function renderWarnings(warnings) {
    const panel = el('bs-warnings-panel');
    const list = el('bs-warnings-list');
    if (!panel || !list) return;
    if (!warnings.length) {
        panel.classList.add('hidden');
        list.innerHTML = '';
        return;
    }
    panel.classList.remove('hidden');
    list.innerHTML = warnings.map(warning => `
        <div class="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <p class="text-[14px] text-amber-800">${escapeHtml(warning.message)}</p>
            ${warning.action_href ? `<a href="${escapeHtml(warning.action_href)}" class="text-[12px] font-semibold text-gray-900 hover:text-[#EA580C]">${escapeHtml(warning.action_label || 'Review')}</a>` : ''}
        </div>
    `).join('');
}

function renderTable(report) {
    const body = el('bs-table-body');
    if (!body) return;
    const rows = [];
    report.sections.forEach(section => {
        rows.push(sectionRow(section));
        if (state.expanded.has(section.id)) {
            section.rows.forEach(row => {
                rows.push(reportRow(row, section.id));
                if (state.expanded.has(row.id)) {
                    (row.children || []).forEach(child => rows.push(childRow(child)));
                }
            });
            rows.push(totalRow(section));
        }
    });
    rows.push(netPositionRow(report));
    body.innerHTML = rows.join('');

    body.querySelectorAll('[data-toggle-row]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            const id = button.getAttribute('data-toggle-row');
            if (!id) return;
            if (state.expanded.has(id)) state.expanded.delete(id);
            else state.expanded.add(id);
            renderTable(state.report);
        });
    });
    body.querySelectorAll('[data-open-row]').forEach(row => {
        row.addEventListener('click', () => openDrawer(row.getAttribute('data-open-row')));
    });
    updateExpandButton();
}

function sectionRow(section) {
    const expanded = state.expanded.has(section.id);
    return `
        <tr class="bs-section-row">
            <td class="px-4 sm:px-5 py-3 font-semibold text-gray-900">
                <button type="button" class="bs-row-button mr-2" data-toggle-row="${escapeHtml(section.id)}" aria-expanded="${expanded}">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.25" d="m6 9 6 6 6-6"></path></svg>
                </button>
                ${escapeHtml(section.label)}
            </td>
            <td class="px-4 py-3 text-right bs-mono font-semibold">${formatRupiah(section.total)}</td>
            <td class="px-4 py-3 text-right bs-mono text-gray-600">${formatRupiah(section.compare_total)}</td>
            <td class="px-4 sm:px-5 py-3 text-right bs-mono text-gray-600">${formatChange(section.change)}</td>
        </tr>
    `;
}

function reportRow(row) {
    const hasChildren = Array.isArray(row.children) && row.children.length > 0;
    const expanded = state.expanded.has(row.id);
    const clickable = ['cash_bank', 'accounts_receivable', 'accounts_payable', 'pending_payables'].includes(row.id);
    return `
        <tr class="${clickable ? 'bs-row-clickable cursor-pointer' : ''}" ${clickable ? `data-open-row="${escapeHtml(row.id)}"` : ''}>
            <td class="px-4 sm:px-5 py-3 text-gray-800">
                <span class="inline-flex items-center">
                    ${hasChildren ? `
                        <button type="button" class="bs-row-button mr-2" data-toggle-row="${escapeHtml(row.id)}" aria-expanded="${expanded}">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.25" d="m6 9 6 6 6-6"></path></svg>
                        </button>
                    ` : '<span class="inline-block w-[30px]"></span>'}
                    <span class="text-gray-400 bs-mono text-[12px] mr-2">${escapeHtml(row.code || '')}</span>
                    <span class="font-medium">${escapeHtml(row.label)}</span>
                </span>
                <span class="ml-2 text-[12px] text-gray-400">${row.record_count} record${row.record_count === 1 ? '' : 's'}</span>
            </td>
            <td class="px-4 py-3 text-right bs-mono">${formatRupiah(row.total)}</td>
            <td class="px-4 py-3 text-right bs-mono text-gray-600">${formatRupiah(row.compare_total)}</td>
            <td class="px-4 sm:px-5 py-3 text-right bs-mono text-gray-600">${formatChange(row.change)}</td>
        </tr>
    `;
}

function childRow(row) {
    return `
        <tr class="bg-white">
            <td class="px-4 sm:px-5 py-3 text-gray-600">
                <span class="inline-block w-[58px]"></span>
                <span>${escapeHtml(row.label)}</span>
            </td>
            <td class="px-4 py-3 text-right bs-mono text-gray-700">${formatRupiah(row.total)}</td>
            <td class="px-4 py-3 text-right bs-mono text-gray-500">${formatRupiah(row.compare_total)}</td>
            <td class="px-4 sm:px-5 py-3 text-right bs-mono text-gray-500">${formatChange(row.change)}</td>
        </tr>
    `;
}

function totalRow(section) {
    return `
        <tr class="bs-total-row">
            <td class="px-4 sm:px-5 py-3 font-semibold text-gray-900 border-t border-gray-200">Total ${escapeHtml(section.label)}</td>
            <td class="px-4 py-3 text-right bs-mono font-semibold border-t border-gray-200">${formatRupiah(section.total)}</td>
            <td class="px-4 py-3 text-right bs-mono font-semibold text-gray-700 border-t border-gray-200">${formatRupiah(section.compare_total)}</td>
            <td class="px-4 sm:px-5 py-3 text-right bs-mono font-semibold text-gray-700 border-t border-gray-200">${formatChange(section.change)}</td>
        </tr>
    `;
}

function netPositionRow(report) {
    const value = report.totals.net_position;
    const compare = report.totals.compare_net_position;
    return `
        <tr class="bg-gray-900 text-white">
            <td class="px-4 sm:px-5 py-4 font-semibold">Net Position</td>
            <td class="px-4 py-4 text-right bs-mono font-semibold">${formatRupiah(value)}</td>
            <td class="px-4 py-4 text-right bs-mono text-gray-200">${formatRupiah(compare)}</td>
            <td class="px-4 sm:px-5 py-4 text-right bs-mono text-gray-200">${formatChange(compare === null ? null : value - compare)}</td>
        </tr>
    `;
}

function renderEmptyTable() {
    const body = el('bs-table-body');
    if (body) body.innerHTML = '<tr><td colspan="4" class="px-5 py-10 text-center text-[14px] text-gray-500">No Balance Sheet data available.</td></tr>';
    setExportEnabled(false, 'Export disabled until source data exists.');
}

function hasData(report) {
    const c = report?.coverage || {};
    return ['bank_accounts_count', 'receivable_transaction_count', 'unpaid_bill_count', 'payable_transaction_count']
        .some(key => Number(c[key] || 0) > 0);
}

function toggleAllRows() {
    const allOpen = state.expanded.has('assets') && state.expanded.has('liabilities') && state.expanded.has('cash_bank');
    state.expanded = allOpen ? new Set() : new Set(['assets', 'liabilities', 'cash_bank']);
    if (state.report) renderTable(state.report);
}

function updateExpandButton() {
    const button = el('bs-expand-btn');
    if (!button) return;
    const allOpen = state.expanded.has('assets') && state.expanded.has('liabilities') && state.expanded.has('cash_bank');
    button.textContent = allOpen ? 'Collapse all' : 'Expand all';
}

function setExportEnabled(enabled, message) {
    const exportBtn = el('bs-export-btn');
    const printBtn = el('bs-print-btn');
    if (exportBtn) exportBtn.disabled = !enabled;
    if (printBtn) printBtn.disabled = state.loading;
    const status = el('bs-export-status');
    if (status) status.textContent = message || '';
}

function openDrawer(rowId) {
    const row = state.rowsById[rowId];
    const records = state.report?.related_records_index?.[rowId] || [];
    if (!row) return;
    el('bs-drawer-title').textContent = row.label || ROW_LABELS[rowId] || 'Details';
    el('bs-drawer-meta').textContent = `As of ${formatDate(state.report.as_of_date)}`;
    el('bs-drawer-total').textContent = formatRupiah(row.total);
    el('bs-drawer-count').textContent = `${records.length}`;
    el('bs-drawer-source').textContent = SOURCE_LABELS[row.source] || row.source || 'Source';
    el('bs-drawer-records').innerHTML = renderDrawerRecords(rowId, records);
    document.body.classList.add('bs-drawer-open');
    document.body.style.overflow = 'hidden';
    state.drawerOpen = true;
}

function closeDrawer() {
    document.body.classList.remove('bs-drawer-open');
    document.body.style.overflow = '';
    state.drawerOpen = false;
}

function renderDrawerRecords(rowId, records) {
    if (!records.length) {
        return '<div class="px-4 py-6 text-[14px] text-gray-500">No related records for this row.</div>';
    }
    if (rowId === 'cash_bank') {
        return drawerTable(['Account', 'Bank', 'Balance', 'As of', 'Source', 'Status'], records.map(r => [
            r.account_name || 'Bank account',
            r.bank_name || 'Bank',
            formatRupiah(r.latest_balance),
            r.latest_balance_at ? formatDate(r.latest_balance_at) : UNAVAILABLE,
            r.source_type || 'manual',
            r.status || 'active'
        ]));
    }
    if (rowId === 'accounts_payable') {
        return drawerTable(['Vendor', 'Amount', 'Due date', 'Payment', 'Category'], records.map(r => [
            r.vendor_name || 'Bill',
            formatRupiah(r.amount),
            r.due_date ? formatDate(r.due_date) : UNAVAILABLE,
            r.payment_status || 'unpaid',
            r.category || UNAVAILABLE
        ]));
    }
    return drawerTable(['Vendor', 'Amount', 'Category', 'Status', 'Date'], records.map(r => [
        r.vendor_name || 'Transaction',
        formatRupiah(r.amount),
        r.category || UNAVAILABLE,
        r.status || UNAVAILABLE,
        r.timestamp ? formatDate(r.timestamp) : UNAVAILABLE
    ]));
}

function drawerTable(headers, rows) {
    return `
        <table class="w-full min-w-[560px] text-[14px]">
            <thead class="bg-gray-50 text-[12px] text-gray-500">
                <tr>${headers.map(header => `<th class="px-3 py-2 text-left font-semibold">${escapeHtml(header)}</th>`).join('')}</tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
                ${rows.map(row => `<tr>${row.map((cell, index) => `<td class="px-3 py-2 ${index === 1 ? 'bs-mono text-right' : ''}">${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}
            </tbody>
        </table>
    `;
}

async function exportCsv() {
    if (state.exportInProgress || !state.report || !hasData(state.report)) return;
    const confirmed = await confirmExport();
    if (!confirmed) return;
    state.exportInProgress = true;
    setExportEnabled(false, 'Logging export...');
    try {
        const report = state.report;
        const recordCounts = report.coverage || {};
        const exportRef = await state.ds.addReportExport(state.user.uid, {
            report_type: 'balance_sheet',
            period_start: report.as_of_date,
            period_end: report.as_of_date,
            formats: ['csv'],
            status: 'generated',
            included_sections: report.sections.map(section => section.id).concat(['net_position']),
            record_counts: recordCounts,
            warning_counts: { balance_sheet_warnings: (report.warnings || []).length },
            limitations: ['Management view based on FluxyOS records. Not a posted double-entry accounting statement.'],
            report_scope: {
                mode: 'balance_sheet',
                cadence: state.cadence,
                comparison_mode: state.compareMode,
                current_period: { as_of_date: report.as_of_date },
                comparison_period: report.compare_as_of_date ? { as_of_date: report.compare_as_of_date } : null
            }
        });
        await state.ds.createExportAuditLog(state.user.uid, {
            target_id: exportRef.id,
            after: {
                report_type: 'balance_sheet',
                as_of_date: report.as_of_date,
                compare_as_of_date: report.compare_as_of_date,
                formats: ['csv'],
                record_counts: recordCounts,
                warning_counts: { balance_sheet_warnings: (report.warnings || []).length }
            },
            reason: 'Balance Sheet CSV export confirmed',
            source: 'dashboard'
        });
        downloadFile(filenameFor(report), buildCsv(report));
        window.showToast?.('Balance Sheet CSV exported and logged.', 'success');
    } catch (error) {
        console.error('Balance Sheet export failed:', error);
        window.showToast?.('Could not export Balance Sheet. Please try again.', 'error');
    } finally {
        state.exportInProgress = false;
        renderReport();
    }
}

async function confirmExport() {
    if (window.showConfirmDialog) {
        return await window.showConfirmDialog({
            title: 'Export Balance Sheet CSV?',
            body: 'This will log an export action and download the current Balance Sheet view as a CSV with raw IDR amounts.',
            confirmLabel: 'Export CSV',
            cancelLabel: 'Cancel',
            tone: 'default'
        });
    }
    return await pageLocalConfirm();
}

function pageLocalConfirm() {
    return new Promise(resolve => {
        const wrap = document.createElement('div');
        wrap.className = 'fixed inset-0 z-[9999] grid place-items-center bg-[rgba(11,15,25,0.5)] px-4';
        wrap.innerHTML = `
            <div class="w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-xl p-5">
                <h3 class="text-[20px] font-semibold text-gray-900">Export Balance Sheet CSV?</h3>
                <p class="mt-2 text-[14px] text-gray-600 leading-relaxed">This will log an export action and download the current Balance Sheet view as a CSV with raw IDR amounts.</p>
                <div class="mt-5 flex justify-end gap-3">
                    <button type="button" data-cancel class="px-4 py-2 bg-white border border-gray-200 rounded-lg text-[14px] font-medium text-gray-700">Cancel</button>
                    <button type="button" data-confirm class="px-4 py-2 bg-gray-900 text-white rounded-lg text-[14px] font-semibold">Export CSV</button>
                </div>
            </div>
        `;
        const done = value => {
            document.removeEventListener('keydown', onKey);
            wrap.remove();
            resolve(value);
        };
        const onKey = event => {
            if (event.key === 'Escape') done(false);
            if (event.key === 'Enter') done(true);
        };
        wrap.querySelector('[data-cancel]').addEventListener('click', () => done(false));
        wrap.querySelector('[data-confirm]').addEventListener('click', () => done(true));
        wrap.addEventListener('click', event => {
            if (event.target === wrap) done(false);
        });
        document.addEventListener('keydown', onKey);
        document.body.appendChild(wrap);
        wrap.querySelector('[data-confirm]').focus();
    });
}

function buildCsv(report) {
    const headers = ['Account Code', 'Account Name', 'Section', 'Current Amount', 'Comparison Amount', 'Change', 'Source', 'Record Count'];
    const rows = [];
    report.sections.forEach(section => {
        section.rows.forEach(row => {
            rows.push(csvRow(row.code, row.label, section.label, row.total, row.compare_total, row.change, row.source, row.record_count));
            (row.children || []).forEach(child => {
                rows.push(csvRow(child.code, child.label, section.label, child.total, child.compare_total, child.change, child.source, child.record_count));
            });
        });
        rows.push(csvRow('', `Total ${section.label}`, section.label, section.total, section.compare_total, section.change, 'calculated', ''));
    });
    rows.push(csvRow('', 'Net Position', 'Net Position', report.totals.net_position, report.totals.compare_net_position, report.totals.compare_net_position === null ? null : report.totals.net_position - report.totals.compare_net_position, 'calculated', ''));
    return [headers, ...rows].map(values => values.map(csvCell).join(',')).join('\n');
}

function csvRow(code, label, section, current, comparison, change, source, count) {
    return [code, label, section, rawAmount(current), rawAmount(comparison), rawAmount(change), source, count];
}

function csvCell(value) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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

function filenameFor(report) {
    const compare = report.compare_as_of_date ? `_vs_${report.compare_as_of_date.replace(/-/g, '_')}` : '';
    return `balance_sheet_${report.as_of_date.replace(/-/g, '_')}${compare}.csv`;
}
