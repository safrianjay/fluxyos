// Reports & Exports — controlled finance export workflow.
//
// Flow: choose period → check readiness → preview → confirm export → audit log.
// Reads are user-scoped (users/{uid}/...). Audit logs never store full export
// row data; only metadata (record counts, period, warning counts).
//
// TODO(verified-user-gate): swap `isUserVerified` for a real flag once a
// `users/{uid}/settings/account.verification_status` (or equivalent) field
// exists. For now, authenticated users default to export-enabled.

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import DataService from './db-service.js';
import { applyToPage } from './onboarding-gate.js';

const firebaseConfig = {
    apiKey: "AIzaSyDNynZIawmUQkTAVv71r4r9Sg661XvHVsA",
    authDomain: "fluxyos.firebaseapp.com",
    projectId: "fluxyos",
    storageBucket: "fluxyos.firebasestorage.app",
    messagingSenderId: "1084252368929",
    appId: "1:1084252368929:web:da73dc0db83fe592c7f360"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const ds = new DataService(app);

const REPORT_TYPES = {
    monthly_report_pack: { label: 'Monthly Report Pack', files: ['profit_loss', 'expense_breakdown', 'bills_payables', 'subscriptions', 'ledger_export', 'data_quality'] },
    profit_loss:        { label: 'Profit & Loss',       files: ['profit_loss'] },
    expense_breakdown:  { label: 'Expense Breakdown',   files: ['expense_breakdown'] },
    bills_payables:     { label: 'Bills & Payables',    files: ['bills_payables'] },
    subscriptions:      { label: 'Subscriptions',       files: ['subscriptions'] },
    ledger_export:      { label: 'Ledger Export',       files: ['ledger_export'] },
    data_quality:       { label: 'Data Quality',        files: ['data_quality'] }
};

const reportsState = {
    user: null,
    isUserVerified: true,
    selectedPeriod: { start: monthStartKey(), end: monthEndKey() },
    selectedReportType: 'monthly_report_pack',
    selectedSources: ['transactions', 'bills', 'subscriptions'],
    sourceData: { transactions: [], bills: [], subscriptions: [] },
    derived: null,
    recentExports: [],
    loading: false,
    previewOpen: false,
    previewReportType: null,
    exportInProgress: false,
    error: null
};

// ---------- Date helpers ----------

function dayKey(date = new Date()) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

function parseDay(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function monthStartKey(date = new Date()) {
    return dayKey(new Date(date.getFullYear(), date.getMonth(), 1));
}

function monthEndKey(date = new Date()) {
    return dayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

function formatRupiah(n) {
    const value = Number(n || 0);
    return `Rp ${Math.abs(value).toLocaleString('id-ID')}`;
}

function periodFilenameSlug(period) {
    const start = parseDay(period.start);
    const end = parseDay(period.end);
    if (!start || !end) return 'period';
    const sameMonth = start.getDate() === 1 &&
        end.getDate() === new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate() &&
        start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    if (sameMonth) return `${start.getFullYear()}_${String(start.getMonth() + 1).padStart(2, '0')}`;
    return `${period.start.replace(/-/g, '_')}_to_${period.end.replace(/-/g, '_')}`;
}

function periodLabel(period) {
    const start = parseDay(period.start);
    const end = parseDay(period.end);
    if (!start || !end) return '—';
    const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const sameMonth = start.getDate() === 1 &&
        end.getDate() === new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate() &&
        start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    if (sameMonth) return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (period.start === period.end) return fmt(start);
    return `${fmt(start)} – ${fmt(end)}`;
}

function timestampToDate(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    if (value instanceof Date) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isoFromDayKey(key) {
    const d = parseDay(key);
    return d ? d.toISOString() : null;
}

// ---------- Escape / DOM helpers ----------

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function el(id) { return document.getElementById(id); }

// ---------- Derived data / calculations ----------

const REVENUE_TYPES = new Set(['income', 'revenue', 'refund', 'pending_receivable']);
const OPEX_TYPES = new Set(['expense', 'fee', 'tax', 'pending_payable']);

function calculateDerived(sourceData) {
    const txs = sourceData.transactions || [];
    const bills = sourceData.bills || [];
    const subs = sourceData.subscriptions || [];

    let revenue = 0;
    let opex = 0;
    txs.forEach(tx => {
        const type = String(tx.type || '').toLowerCase();
        const amount = Number(tx.amount || 0);
        if (REVENUE_TYPES.has(type)) revenue += amount;
        else if (OPEX_TYPES.has(type)) opex += Math.abs(amount);
    });

    const grossMargin = revenue > 0 ? ((revenue - opex) / revenue) * 100 : 0;
    const netResult = revenue - opex;

    const missingReceipts = txs.filter(t => t.status === 'Missing Receipt').length;
    const billsWithoutDueDate = bills.filter(b => !b.due_date).length;
    const subsWithoutRenewal = subs.filter(s => !s.renewal_date).length;
    const billsWithDueDate = bills.length - billsWithoutDueDate;

    const totalRecords = txs.length + bills.length + subs.length;
    const ledgerCompleteness = txs.length === 0
        ? null
        : Math.round(((txs.length - missingReceipts) / txs.length) * 100);
    const receiptCoverage = txs.length === 0
        ? null
        : Math.round(((txs.length - missingReceipts) / txs.length) * 100);
    const billsWithDueDatePct = bills.length === 0
        ? null
        : Math.round((billsWithDueDate / bills.length) * 100);

    let readinessScore = null;
    if (totalRecords > 0) {
        let score = 100;
        score -= missingReceipts * 4;
        score -= billsWithoutDueDate * 6;
        score -= subsWithoutRenewal * 6;
        readinessScore = Math.max(0, Math.min(100, score));
    }

    return {
        revenue,
        opex,
        grossMargin,
        netResult,
        recordCounts: {
            transactions: txs.length,
            bills: bills.length,
            subscriptions: subs.length
        },
        warningCounts: {
            missing_receipts: missingReceipts,
            missing_due_dates: billsWithoutDueDate,
            missing_renewal_dates: subsWithoutRenewal
        },
        readinessScore,
        ledgerCompleteness,
        receiptCoverage,
        billsWithDueDatePct,
        totalRecords
    };
}

function readinessLabel(score) {
    if (score === null || score === undefined) return 'Not enough data';
    if (score >= 90) return 'Ready';
    if (score >= 70) return 'Ready with warnings';
    return 'Needs cleanup';
}

// ---------- Data loading ----------

async function loadReportData() {
    if (!reportsState.user) return;
    reportsState.loading = true;
    reportsState.error = null;
    renderLoadingStates();
    const { start, end } = reportsState.selectedPeriod;
    try {
        const [transactions, bills, subscriptions, exports] = await Promise.all([
            ds.getTransactionsForPeriod(reportsState.user.uid, start, end),
            ds.getBillsForPeriod(reportsState.user.uid, start, end),
            ds.getSubscriptionsForPeriod(reportsState.user.uid, start, end),
            ds.getRecentExportLogs(reportsState.user.uid, 5)
        ]);
        reportsState.sourceData = { transactions, bills, subscriptions };
        reportsState.derived = calculateDerived(reportsState.sourceData);
        reportsState.recentExports = exports;
    } catch (err) {
        reportsState.error = 'Unable to load report data. Please refresh or try again.';
        reportsState.sourceData = { transactions: [], bills: [], subscriptions: [] };
        reportsState.derived = calculateDerived(reportsState.sourceData);
        reportsState.recentExports = [];
    } finally {
        reportsState.loading = false;
        renderAll();
    }
}

// ---------- Rendering ----------

function renderLoadingStates() {
    const label = el('reports-period-label');
    if (label) label.textContent = periodLabel(reportsState.selectedPeriod);
}

function renderAll() {
    if (reportsState.error) renderError(reportsState.error);
    else clearError();
    renderReadiness();
    renderDataCoverage();
    renderNeedsCleanup();
    renderRecommendedOutput();
    renderRecentExports();
    renderEmptyShellIfNeeded();
}

function renderError(message) {
    const box = el('reports-error-banner');
    if (!box) return;
    box.classList.remove('hidden');
    box.textContent = message;
}

function clearError() {
    el('reports-error-banner')?.classList.add('hidden');
}

function renderReadiness() {
    const d = reportsState.derived;
    const scoreEl = el('readiness-score');
    const labelEl = el('readiness-label');
    if (!d || d.totalRecords === 0) {
        if (scoreEl) scoreEl.textContent = '—';
        if (labelEl) labelEl.textContent = 'Not enough data to score readiness.';
    } else {
        if (scoreEl) scoreEl.textContent = `${d.readinessScore}%`;
        if (labelEl) labelEl.textContent = readinessLabel(d.readinessScore) + '. ' +
            (d.warningCounts.missing_receipts ? `Receipt coverage needs cleanup before accountant handoff.` : 'Data coverage looks healthy.');
    }
    setBar('bar-ledger', d?.ledgerCompleteness);
    setBar('bar-receipt', d?.receiptCoverage);
    setBar('bar-bills', d?.billsWithDueDatePct);
}

function setBar(prefix, pct) {
    const valueEl = el(`${prefix}-value`);
    const fillEl = el(`${prefix}-fill`);
    const wrapEl = el(`${prefix}-wrap`);
    if (pct === null || pct === undefined) {
        if (valueEl) valueEl.textContent = '—';
        if (fillEl) fillEl.style.width = '0%';
        if (wrapEl) wrapEl.classList.remove('bar-good', 'bar-warn');
        return;
    }
    if (valueEl) valueEl.textContent = `${pct}%`;
    if (fillEl) fillEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (wrapEl) {
        wrapEl.classList.toggle('bar-good', pct >= 85);
        wrapEl.classList.toggle('bar-warn', pct < 70);
    }
}

function renderDataCoverage() {
    const d = reportsState.derived;
    const txs = d?.recordCounts.transactions ?? 0;
    const bills = d?.recordCounts.bills ?? 0;
    const subs = d?.recordCounts.subscriptions ?? 0;
    el('coverage-transactions').textContent = String(txs);
    el('coverage-bills').textContent = String(bills);
    el('coverage-subscriptions').textContent = String(subs);
    el('coverage-revenue-sync').textContent = 'Not connected';
}

function renderNeedsCleanup() {
    const d = reportsState.derived;
    el('cleanup-missing-receipts').textContent = String(d?.warningCounts.missing_receipts ?? 0);
    el('cleanup-missing-due-dates').textContent = String(d?.warningCounts.missing_due_dates ?? 0);
    el('cleanup-missing-renewals').textContent = String(d?.warningCounts.missing_renewal_dates ?? 0);
}

function renderRecommendedOutput() {
    const d = reportsState.derived;
    const warningTotal = (d?.warningCounts.missing_receipts ?? 0) +
        (d?.warningCounts.missing_due_dates ?? 0) +
        (d?.warningCounts.missing_renewal_dates ?? 0);
    const warnEl = el('recommended-warnings-tag');
    if (warnEl) {
        if (warningTotal === 0) {
            warnEl.classList.add('hidden');
        } else {
            warnEl.classList.remove('hidden');
            warnEl.textContent = `${warningTotal} data warning${warningTotal === 1 ? '' : 's'}`;
        }
    }
    const statusTag = el('recommended-status-tag');
    if (statusTag) {
        if (reportsState.isUserVerified) {
            statusTag.textContent = 'Export ready';
            statusTag.classList.remove('tag-lock');
            statusTag.classList.add('tag-good');
        } else {
            statusTag.textContent = 'Preview only · Export locked';
            statusTag.classList.add('tag-lock');
            statusTag.classList.remove('tag-good');
        }
    }
}

function renderRecentExports() {
    const container = el('recent-exports-list');
    if (!container) return;
    const logs = reportsState.recentExports || [];
    if (logs.length === 0) {
        container.innerHTML = `<div class="recent-empty">No exports yet. Confirmed exports will appear here.</div>`;
        return;
    }
    container.innerHTML = logs.map(log => {
        const after = log.after || {};
        const type = after.report_type || 'export';
        const label = REPORT_TYPES[type]?.label || type;
        const period = (after.period_start && after.period_end)
            ? periodLabel({ start: after.period_start.slice(0, 10), end: after.period_end.slice(0, 10) })
            : '—';
        const created = timestampToDate(log.created_at);
        const when = created ? created.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
        return `
            <div class="audit-row">
                <div>
                    <strong>${escapeHtml(label)}</strong>
                    <span>${escapeHtml(period)}${when ? ' · ' + escapeHtml(when) : ''}</span>
                </div>
                <span class="tag tag-good">Done</span>
            </div>`;
    }).join('');
}

function renderEmptyShellIfNeeded() {
    const total = reportsState.derived?.totalRecords ?? 0;
    const banner = el('reports-empty-banner');
    if (!banner) return;
    banner.classList.toggle('hidden', total > 0);
}

// ---------- Preview drawer ----------

function openReportPreview(reportType) {
    if (!REPORT_TYPES[reportType]) return;
    reportsState.previewReportType = reportType;
    reportsState.previewOpen = true;
    document.body.classList.add('reports-drawer-open');
    renderPreviewDrawer();
}

function closeReportPreview() {
    reportsState.previewOpen = false;
    document.body.classList.remove('reports-drawer-open');
}

function renderPreviewDrawer() {
    const type = reportsState.previewReportType;
    const meta = REPORT_TYPES[type];
    if (!meta) return;
    el('drawer-title').textContent = `Preview: ${meta.label}`;
    el('drawer-period').textContent = periodLabel(reportsState.selectedPeriod);

    const d = reportsState.derived;
    const totalRecords = d?.totalRecords ?? 0;

    // Financial summary (only meaningful for P&L and monthly pack)
    const showFinancials = type === 'monthly_report_pack' || type === 'profit_loss';
    const finBox = el('drawer-financial');
    finBox.classList.toggle('hidden', !showFinancials);
    if (showFinancials) {
        el('drawer-revenue').textContent = formatRupiah(d?.revenue || 0);
        el('drawer-opex').textContent = formatRupiah(d?.opex || 0);
        const margin = d?.grossMargin;
        el('drawer-margin').textContent = (margin === null || margin === undefined || !isFinite(margin) || (d?.revenue || 0) === 0)
            ? 'Not available'
            : `${margin.toFixed(1)}%`;
        el('drawer-net').textContent = formatRupiah(d?.netResult || 0);
    }

    // Included sources
    const sourcesBox = el('drawer-sources');
    const sourceStatus = (count) => count > 0
        ? `<span class="tag tag-good">Included</span>`
        : `<span class="tag tag-lock">No records</span>`;
    sourcesBox.innerHTML = `
        <div class="file-row"><div><strong>Transactions</strong><span>${d?.recordCounts.transactions ?? 0} records in selected period</span></div>${sourceStatus(d?.recordCounts.transactions ?? 0)}</div>
        <div class="file-row"><div><strong>Bills</strong><span>${d?.recordCounts.bills ?? 0} records in selected period</span></div>${sourceStatus(d?.recordCounts.bills ?? 0)}</div>
        <div class="file-row"><div><strong>Subscriptions</strong><span>${d?.recordCounts.subscriptions ?? 0} records in selected period</span></div>${sourceStatus(d?.recordCounts.subscriptions ?? 0)}</div>
        <div class="file-row"><div><strong>Revenue Sync</strong><span>No connected source available</span></div><span class="tag tag-lock">Excluded</span></div>
    `;

    // Generated files
    const slug = periodFilenameSlug(reportsState.selectedPeriod);
    const filesBox = el('drawer-files');
    filesBox.innerHTML = meta.files.map(f => `
        <div class="file-row">
            <div><strong>${escapeHtml(f)}_${slug}.csv</strong><span>${escapeHtml(fileDescription(f))}</span></div>
            <span class="tag">CSV</span>
        </div>`).join('');

    // Warnings
    const warningsBox = el('drawer-warnings');
    const w = d?.warningCounts || {};
    const warningRows = [];
    if (w.missing_receipts) warningRows.push(`${w.missing_receipts} transaction${w.missing_receipts === 1 ? '' : 's'} missing receipts`);
    if (w.missing_due_dates) warningRows.push(`${w.missing_due_dates} bill${w.missing_due_dates === 1 ? '' : 's'} without due date`);
    if (w.missing_renewal_dates) warningRows.push(`${w.missing_renewal_dates} subscription${w.missing_renewal_dates === 1 ? '' : 's'} without renewal date`);
    if (warningRows.length === 0) {
        warningsBox.parentElement.classList.add('hidden');
    } else {
        warningsBox.parentElement.classList.remove('hidden');
        warningsBox.innerHTML = warningRows.map(r => `<div class="warning-row">${escapeHtml(r)}</div>`).join('');
    }

    // Confirm button gating
    const confirmBtn = el('drawer-confirm-btn');
    const lockReason = el('drawer-lock-reason');
    const blocked = totalRecords === 0 || !reportsState.isUserVerified || reportsState.exportInProgress;
    confirmBtn.disabled = blocked;
    if (totalRecords === 0) {
        lockReason.textContent = 'No records in the selected period. Add data first to enable export.';
        lockReason.classList.remove('hidden');
    } else if (!reportsState.isUserVerified) {
        lockReason.textContent = 'Export is available after verification.';
        lockReason.classList.remove('hidden');
    } else {
        lockReason.classList.add('hidden');
    }
}

function fileDescription(file) {
    return {
        profit_loss: 'Revenue, OpEx, margin, net result',
        expense_breakdown: 'Spend grouped by category and vendor',
        bills_payables: 'Vendors, amounts, due dates, status',
        subscriptions: 'Recurring vendor and renewal dates',
        ledger_export: 'Raw ledger rows for accountant review',
        data_quality: 'Missing receipts and incomplete records'
    }[file] || 'CSV export';
}

// ---------- Export confirm & CSV generation ----------

async function confirmExport() {
    if (reportsState.exportInProgress) return;
    const type = reportsState.previewReportType;
    if (!type || !reportsState.user) return;
    if (!reportsState.isUserVerified) {
        window.showToast?.('Export is available after verification.', 'info');
        return;
    }
    const d = reportsState.derived;
    if (!d || d.totalRecords === 0) {
        window.showToast?.('No records to export for this period.', 'info');
        return;
    }

    reportsState.exportInProgress = true;
    const confirmBtn = el('drawer-confirm-btn');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.dataset.originalLabel = confirmBtn.textContent;
        confirmBtn.textContent = 'Exporting…';
    }

    try {
        // 1. Build files in memory first so a render error blocks the audit log.
        const meta = REPORT_TYPES[type];
        const slug = periodFilenameSlug(reportsState.selectedPeriod);
        const files = meta.files.map(fileKey => ({
            filename: `${fileKey}_${slug}.csv`,
            content: buildCsv(fileKey)
        }));

        // 2. Write audit log BEFORE triggering downloads. If logging fails,
        //    do not deliver files — keeps export history trustworthy.
        const auditPayload = {
            target_id: `${type}_${Date.now()}`,
            after: {
                report_type: type,
                period_start: isoFromDayKey(reportsState.selectedPeriod.start),
                period_end: isoFromDayKey(reportsState.selectedPeriod.end),
                formats: ['csv'],
                included_sources: ['transactions', 'bills', 'subscriptions'],
                record_counts: { ...d.recordCounts },
                warning_counts: { ...d.warningCounts }
            },
            source: 'dashboard'
        };
        await ds.createExportAuditLog(reportsState.user.uid, auditPayload);

        // 3. Download files (sequential, small delay to play nice with browsers).
        for (let i = 0; i < files.length; i++) {
            downloadCsv(files[i].filename, files[i].content);
            if (i < files.length - 1) await new Promise(r => setTimeout(r, 250));
        }

        window.showToast?.('Export confirmed. Audit log created.', 'success');
        closeReportPreview();

        // 4. Refresh recent exports list.
        reportsState.recentExports = await ds.getRecentExportLogs(reportsState.user.uid, 5);
        renderRecentExports();
    } catch (err) {
        window.showToast?.('Export failed. No file was downloaded.', 'error');
    } finally {
        reportsState.exportInProgress = false;
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = confirmBtn.dataset.originalLabel || 'Confirm export & log action';
        }
    }
}

function downloadCsv(filename, content) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function csvCell(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
}

function csvRow(cells) {
    return cells.map(csvCell).join(',');
}

function txDateString(record) {
    const d = timestampToDate(record.timestamp);
    return d ? dayKey(d) : '';
}

function dueDateString(record) {
    const d = timestampToDate(record.due_date);
    return d ? dayKey(d) : '';
}

function renewalDateString(record) {
    const d = timestampToDate(record.renewal_date);
    return d ? dayKey(d) : '';
}

function buildCsv(fileKey) {
    const period = reportsState.selectedPeriod;
    const d = reportsState.derived;
    switch (fileKey) {
        case 'profit_loss': {
            const rows = [];
            rows.push(csvRow(['Report', 'Profit & Loss']));
            rows.push(csvRow(['Period Start', period.start]));
            rows.push(csvRow(['Period End', period.end]));
            rows.push(csvRow(['Generated At', new Date().toISOString()]));
            rows.push('');
            rows.push(csvRow(['Metric', 'Amount']));
            rows.push(csvRow(['Revenue', d?.revenue ?? 0]));
            rows.push(csvRow(['OpEx', d?.opex ?? 0]));
            const margin = (d?.revenue || 0) > 0 ? (d.grossMargin).toFixed(1) : 0;
            rows.push(csvRow(['Gross Margin %', margin]));
            rows.push(csvRow(['Net Result', d?.netResult ?? 0]));
            return rows.join('\n');
        }
        case 'expense_breakdown': {
            const rows = [csvRow(['Category', 'Vendor', 'Amount', 'Record Count'])];
            const txs = reportsState.sourceData.transactions || [];
            const subs = reportsState.sourceData.subscriptions || [];
            const expenseRecords = [
                ...txs.filter(t => OPEX_TYPES.has(String(t.type || '').toLowerCase())),
                ...subs.map(s => ({ ...s, type: 'expense' }))
            ];
            const grouped = new Map();
            expenseRecords.forEach(r => {
                const key = `${r.category || 'Uncategorized'}||${r.vendor_name || 'Unknown vendor'}`;
                const entry = grouped.get(key) || { category: r.category || 'Uncategorized', vendor: r.vendor_name || 'Unknown vendor', amount: 0, count: 0 };
                entry.amount += Math.abs(Number(r.amount || 0));
                entry.count += 1;
                grouped.set(key, entry);
            });
            Array.from(grouped.values())
                .sort((a, b) => b.amount - a.amount)
                .forEach(e => rows.push(csvRow([e.category, e.vendor, e.amount, e.count])));
            return rows.join('\n');
        }
        case 'bills_payables': {
            const rows = [csvRow(['Vendor', 'Category', 'Amount', 'Type', 'Status', 'Due Date', 'Record ID'])];
            (reportsState.sourceData.bills || []).forEach(b => {
                rows.push(csvRow([
                    b.vendor_name || '',
                    b.category || '',
                    Number(b.amount || 0),
                    b.type || '',
                    b.status || '',
                    dueDateString(b),
                    b.id || ''
                ]));
            });
            return rows.join('\n');
        }
        case 'subscriptions': {
            const rows = [csvRow(['Vendor', 'Category', 'Amount', 'Status', 'Renewal Date', 'Record ID'])];
            (reportsState.sourceData.subscriptions || []).forEach(s => {
                rows.push(csvRow([
                    s.vendor_name || s.name || '',
                    s.category || '',
                    Number(s.amount || 0),
                    s.status || 'Active',
                    renewalDateString(s),
                    s.id || ''
                ]));
            });
            return rows.join('\n');
        }
        case 'ledger_export': {
            const rows = [csvRow(['Date', 'Source', 'Vendor', 'Category', 'Type', 'Amount', 'Status', 'Record ID'])];
            (reportsState.sourceData.transactions || []).forEach(t => {
                rows.push(csvRow([
                    txDateString(t),
                    'transactions',
                    t.vendor_name || '',
                    t.category || '',
                    t.type || '',
                    Number(t.amount || 0),
                    t.status || '',
                    t.id || ''
                ]));
            });
            return rows.join('\n');
        }
        case 'data_quality': {
            const rows = [csvRow(['Source', 'Record ID', 'Vendor', 'Issue Type', 'Field', 'Severity'])];
            (reportsState.sourceData.transactions || [])
                .filter(t => t.status === 'Missing Receipt')
                .forEach(t => rows.push(csvRow(['transactions', t.id || '', t.vendor_name || '', 'Missing Receipt', 'receipt_url', 'warning'])));
            (reportsState.sourceData.bills || [])
                .filter(b => !b.due_date)
                .forEach(b => rows.push(csvRow(['bills', b.id || '', b.vendor_name || '', 'Missing Due Date', 'due_date', 'warning'])));
            (reportsState.sourceData.subscriptions || [])
                .filter(s => !s.renewal_date)
                .forEach(s => rows.push(csvRow(['subscriptions', s.id || '', s.vendor_name || s.name || '', 'Missing Renewal Date', 'renewal_date', 'warning'])));
            return rows.join('\n');
        }
        default:
            return '';
    }
}

// ---------- Event wiring ----------

function bindEvents() {
    // Topbar Generate report → opens preview for the currently selected package
    el('topbar-generate-btn')?.addEventListener('click', () => {
        openReportPreview(reportsState.selectedReportType || 'monthly_report_pack');
    });

    // Recommended primary
    el('recommended-generate-btn')?.addEventListener('click', () => openReportPreview('monthly_report_pack'));
    el('recommended-fix-btn')?.addEventListener('click', () => {
        const target = el('panel-needs-cleanup');
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Individual report row preview buttons
    document.querySelectorAll('[data-preview-report]').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.getAttribute('data-preview-report');
            openReportPreview(type);
        });
    });

    // Filter Apply
    el('filter-apply-btn')?.addEventListener('click', () => {
        const reportSelect = el('filter-report-type');
        const sourcesSelect = el('filter-data-source');
        if (reportSelect) reportsState.selectedReportType = reportSelect.value;
        if (sourcesSelect) {
            const map = {
                'all': ['transactions', 'bills', 'subscriptions'],
                'transactions': ['transactions'],
                'bills': ['bills'],
                'subscriptions': ['subscriptions']
            };
            reportsState.selectedSources = map[sourcesSelect.value] || ['transactions', 'bills', 'subscriptions'];
        }
        loadReportData();
    });

    // Drawer close
    el('drawer-close-btn')?.addEventListener('click', closeReportPreview);
    el('drawer-cancel-btn')?.addEventListener('click', closeReportPreview);
    el('drawer-overlay')?.addEventListener('click', closeReportPreview);
    el('drawer-confirm-btn')?.addEventListener('click', confirmExport);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && reportsState.previewOpen) closeReportPreview();
    });

    // Date picker mount
    if (window.FluxyDateRangePicker?.mount) {
        window.FluxyDateRangePicker.mount('#reports-date-range-picker', {
            start: reportsState.selectedPeriod.start,
            end: reportsState.selectedPeriod.end,
            onChange: ({ start, end }) => {
                reportsState.selectedPeriod = { start, end };
                loadReportData();
            }
        });
    }

    // Empty-state quick actions
    el('empty-add-transaction')?.addEventListener('click', () => {
        window.showAddTransactionModal?.({
            title: 'Add Transaction',
            submitLabel: 'Add Transaction',
            context: 'transaction'
        });
    });
    el('empty-add-bill')?.addEventListener('click', () => {
        window.showAddTransactionModal?.({
            title: 'Add Bill',
            submitLabel: 'Save Bill',
            defaultCategory: 'Operations',
            context: 'bill'
        });
    });
}

// ---------- Boot ----------

function initReportsPage(user) {
    reportsState.user = user;
    bindEvents();
    renderAll();
    loadReportData();
}

let authCheckTimeout = setTimeout(() => {
    window.location.replace('/login');
}, 2000);

onAuthStateChanged(auth, async (user) => {
    if (user) {
        clearTimeout(authCheckTimeout);
        const gated = await applyToPage(user, { pageKey: 'reports' });
        if (gated) {
            sessionStorage.removeItem('fluxy_pending_tour');
            return;
        }
        initReportsPage(user);
    } else {
        window.location.replace('/login');
    }
});
