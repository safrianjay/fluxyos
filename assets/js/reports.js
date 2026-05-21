// Reports & Exports — controlled finance export workflow.
//
// Flow: choose period → check readiness → preview → Open Full Report or
// Confirm Export → write report_exports + export.create audit log.
// All reads/writes stay under users/{uid}/...; audit logs and report_exports
// never store row-level financial data or CSV content.
//
// TODO(verified-user-gate): swap `isUserVerified` for a real flag once a
// `users/{uid}/settings/account.verification_status` (or equivalent) field
// exists. For now, authenticated users default to export-enabled.

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import DataService from './db-service.js';
import { applyToPage } from './onboarding-gate.js';
import {
    buildMonthlyReportPack,
    buildCsvBundle,
    downloadFile,
    periodLabel,
    formatRupiah,
    formatPercent,
    timestampToDate,
    isoFromDayKey,
    dayKey,
    periodFilenameSlug,
    resolveReportScope,
    REPORT_PERIOD_MODES,
    COMPARISON_MODES
} from './report-builder.js';

const REPORT_PREVIEW_STORAGE_KEY = 'fluxyos_report_preview';

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

function monthStartKey(date = new Date()) { return dayKey(new Date(date.getFullYear(), date.getMonth(), 1)); }
function monthEndKey(date = new Date()) { return dayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0)); }

const reportsState = {
    user: null,
    userDisplayName: '',
    businessName: '',
    isUserVerified: true,
    // Scope controls (drive resolveReportScope).
    reportPeriodMode: 'monthly',
    comparisonMode: 'none',
    customRange: { start: monthStartKey(), end: monthEndKey() },
    // Resolved scope (rebuilt on every loadReportData).
    scope: null,
    selectedReportType: 'monthly_report_pack',
    sourceData: { transactions: [], bills: [], subscriptions: [] },
    comparisonSourceData: { transactions: [], bills: [], subscriptions: [] },
    pack: null,
    recentExports: [],
    loading: false,
    previewOpen: false,
    previewReportType: null,
    exportInProgress: false,
    error: null
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function el(id) { return document.getElementById(id); }

// ---------- Data loading ----------

async function loadBusinessName() {
    try {
        const settings = await ds.getUserSettings(reportsState.user.uid);
        reportsState.businessName = settings?.company?.business_name || '';
    } catch {
        reportsState.businessName = '';
    }
}

function resolveCurrentScope() {
    return resolveReportScope({
        reportPeriodMode: reportsState.reportPeriodMode,
        comparisonMode: reportsState.comparisonMode,
        selectedStartDate: reportsState.customRange.start,
        selectedEndDate: reportsState.customRange.end,
        today: new Date()
    });
}

async function loadReportData() {
    if (!reportsState.user) return;
    reportsState.loading = true;
    reportsState.error = null;
    const scope = resolveCurrentScope();
    reportsState.scope = scope;
    const current = scope.current_period;
    const comparison = scope.comparison_period;
    try {
        const [transactions, bills, subscriptions, prevTx, prevBills, prevSubs, recentExports] = await Promise.all([
            ds.getTransactionsForPeriod(reportsState.user.uid, current.start_date, current.end_date),
            ds.getBillsForPeriod(reportsState.user.uid, current.start_date, current.end_date),
            ds.getSubscriptionsForPeriod(reportsState.user.uid, current.start_date, current.end_date),
            comparison
                ? ds.getTransactionsForPeriod(reportsState.user.uid, comparison.start_date, comparison.end_date)
                : Promise.resolve(null),
            comparison
                ? ds.getBillsForPeriod(reportsState.user.uid, comparison.start_date, comparison.end_date).catch(() => [])
                : Promise.resolve(null),
            comparison
                ? ds.getSubscriptionsForPeriod(reportsState.user.uid, comparison.start_date, comparison.end_date).catch(() => [])
                : Promise.resolve(null),
            ds.getRecentReportExports(reportsState.user.uid, 5).catch(() => [])
        ]);
        reportsState.sourceData = { transactions, bills, subscriptions };
        reportsState.comparisonSourceData = comparison
            ? { transactions: prevTx || [], bills: prevBills || [], subscriptions: prevSubs || [] }
            : { transactions: [], bills: [], subscriptions: [] };
        reportsState.pack = buildMonthlyReportPack({
            userId: reportsState.user.uid,
            userDisplayName: reportsState.userDisplayName,
            businessName: reportsState.businessName,
            scope,
            transactions,
            bills,
            subscriptions,
            previousPeriodTransactions: comparison ? (prevTx || []) : null,
            previousPeriodBills: comparison ? (prevBills || []) : null,
            previousPeriodSubscriptions: comparison ? (prevSubs || []) : null,
            recurringRevenue: null
        });
        reportsState.recentExports = recentExports;
    } catch (err) {
        reportsState.error = 'Unable to load report data. Please refresh or try again.';
        reportsState.sourceData = { transactions: [], bills: [], subscriptions: [] };
        reportsState.comparisonSourceData = { transactions: [], bills: [], subscriptions: [] };
        reportsState.pack = buildMonthlyReportPack({
            userId: reportsState.user.uid,
            userDisplayName: reportsState.userDisplayName,
            businessName: reportsState.businessName,
            scope,
            transactions: [],
            bills: [],
            subscriptions: [],
            previousPeriodTransactions: comparison ? [] : null,
            previousPeriodBills: comparison ? [] : null,
            previousPeriodSubscriptions: comparison ? [] : null,
            recurringRevenue: null
        });
        reportsState.recentExports = [];
    } finally {
        reportsState.loading = false;
        renderAll();
    }
}

function comparisonModeLabel(mode) {
    return {
        none: 'None',
        previous_period: 'Previous period',
        same_period_last_year: 'Same period last year',
        previous_year_to_date: 'Previous year to date'
    }[mode] || mode;
}

function reportPeriodLabel(mode) {
    return {
        monthly: 'This month',
        last_month: 'Last month',
        quarter_to_date: 'Quarter to date',
        year_to_date: 'Year to date',
        custom: 'Custom range'
    }[mode] || mode;
}

function periodHumanRange(period) {
    if (!period) return '—';
    const start = period.start_date || period.start;
    const end = period.end_date || period.end;
    return periodLabel({ start, end });
}

// ---------- Rendering ----------

function renderAll() {
    if (reportsState.error) renderError(reportsState.error);
    else clearError();
    renderScopeSummary();
    renderReadiness();
    renderDataCoverage();
    renderNeedsCleanup();
    renderRecommendedOutput();
    renderRecentExports();
    renderEmptyShellIfNeeded();
}

function renderScopeSummary() {
    const target = el('filter-scope-summary');
    if (!target) return;
    const scope = reportsState.scope;
    if (!scope) { target.textContent = ''; return; }
    const cur = scope.current_period;
    const parts = [`Current: ${cur.label} (${periodHumanRange(cur)})`];
    if (scope.comparison_period) {
        parts.push(`Comparison: ${scope.comparison_period.label} (${periodHumanRange(scope.comparison_period)})`);
    } else if (scope.comparison_mode === 'none') {
        // No comparison line.
    } else {
        parts.push('Comparison: unavailable for this period');
    }
    target.textContent = parts.join(' · ');
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
    const pack = reportsState.pack;
    const total = (pack?.record_counts.transactions ?? 0) + (pack?.record_counts.bills ?? 0) + (pack?.record_counts.subscriptions ?? 0);
    const confidence = pack?.report_confidence_method;
    const scoreEl = el('readiness-score');
    const labelEl = el('readiness-label');
    if (!pack || total === 0) {
        if (scoreEl) scoreEl.textContent = '—';
        if (labelEl) labelEl.textContent = 'Not enough data to score readiness.';
    } else {
        if (scoreEl) scoreEl.textContent = `${confidence.score}%`;
        if (labelEl) labelEl.textContent = `${confidence.label}. ${pack.warning_total ? 'Receipt and date coverage need review before external handoff.' : 'Data coverage looks healthy.'}`;
    }
    setBar('bar-ledger', confidence?.ledgerCompleteness);
    setBar('bar-receipt', confidence?.receiptCoverage);
    setBar('bar-bills', confidence?.dueDateCompleteness);
    setBar('bar-predict', predictabilityBarValue(pack));
    setBar('bar-comparison', comparisonReadinessValue(pack));
}

function comparisonReadinessValue(pack) {
    if (!pack || !pack.report_scope) return null;
    const mode = pack.report_scope.comparison_mode;
    if (mode === 'none') return null;
    // YoY uses yoy_comparison + monthly_trend_comparison.
    if (mode === 'previous_year_to_date' || mode === 'same_period_last_year') {
        const yoy = pack.yoy_comparison;
        const trend = pack.monthly_trend_comparison;
        if (!yoy || yoy.status === 'unavailable') return 0;
        if (yoy.status === 'partial') return 60;
        if (trend && trend.status === 'partial') return 75;
        return 95;
    }
    // Previous-period falls back to the existing period_comparison status.
    const pc = pack.period_comparison;
    if (!pc || pc.status === 'unavailable') return 0;
    if (pc.status === 'partial') return 60;
    return 95;
}

function predictabilityBarValue(pack) {
    if (!pack) return null;
    const fp = pack.finance_predictability;
    const comp = pack.period_comparison;
    let score = 0;
    let denom = 0;
    if (fp.monthly_revenue_run_rate > 0) { score += 50; denom += 50; }
    if (comp.status === 'available') { score += 30; denom += 30; }
    if (pack.profit_loss.opex > 0) { score += 20; denom += 20; }
    if (denom === 0) return null;
    return Math.round((score / 100) * 100);
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
    const pack = reportsState.pack;
    el('coverage-transactions').textContent = String(pack?.record_counts.transactions ?? 0);
    el('coverage-bills').textContent = String(pack?.record_counts.bills ?? 0);
    el('coverage-subscriptions').textContent = String(pack?.record_counts.subscriptions ?? 0);
    el('coverage-revenue-sync').textContent = 'Not connected';

    const currentTotal = (pack?.record_counts.transactions ?? 0) + (pack?.record_counts.bills ?? 0) + (pack?.record_counts.subscriptions ?? 0);
    const currentRecordsEl = el('coverage-current-period-records');
    if (currentRecordsEl) currentRecordsEl.textContent = String(currentTotal);

    const comparisonRecordsEl = el('coverage-comparison-period-records');
    if (comparisonRecordsEl) {
        if (!pack?.report_scope?.comparison_period) {
            comparisonRecordsEl.textContent = 'No comparison';
        } else {
            const comp = reportsState.comparisonSourceData;
            const total = (comp?.transactions?.length ?? 0) + (comp?.bills?.length ?? 0) + (comp?.subscriptions?.length ?? 0);
            comparisonRecordsEl.textContent = total === 0 ? 'No records' : String(total);
        }
    }

    const previousCategoriesEl = el('coverage-previous-categories');
    if (previousCategoriesEl) {
        const comp = reportsState.comparisonSourceData;
        const cats = new Set((comp?.transactions || []).map(t => t.category).filter(Boolean));
        if (!pack?.report_scope?.comparison_period) previousCategoriesEl.textContent = '—';
        else if (cats.size === 0) previousCategoriesEl.textContent = 'None';
        else previousCategoriesEl.textContent = `${cats.size} categor${cats.size === 1 ? 'y' : 'ies'}`;
    }

    const prevEl = el('coverage-previous-period');
    if (prevEl) {
        const mode = pack?.report_scope?.comparison_mode;
        if (mode === 'none' || !pack?.report_scope?.comparison_period) prevEl.textContent = 'No comparison';
        else if (mode === 'previous_year_to_date' || mode === 'same_period_last_year') prevEl.textContent = pack?.yoy_comparison?.status === 'available' ? 'Available' : (pack?.yoy_comparison?.status === 'partial' ? 'Partial' : 'Unavailable');
        else prevEl.textContent = pack?.period_comparison?.status === 'available' ? 'Available' : 'Unavailable';
    }

    const recurringEl = el('coverage-recurring');
    if (recurringEl) recurringEl.textContent = pack?.finance_predictability.arr.status === 'unavailable' ? 'Unclassified' : 'Partial';
    const predictEl = el('coverage-predictability');
    if (predictEl) predictEl.textContent = pack ? (pack.finance_predictability.status === 'available' ? 'Available' : (pack.finance_predictability.status === 'partial' ? 'Partial' : 'Unavailable')) : '—';
    const bankEl = el('coverage-bank-balance');
    if (bankEl) bankEl.textContent = 'Not connected';
}

function renderNeedsCleanup() {
    const pack = reportsState.pack;
    el('cleanup-missing-receipts').textContent = String(pack?.warning_counts.missing_receipts ?? 0);
    el('cleanup-missing-due-dates').textContent = String(pack?.warning_counts.bills_without_due_date ?? 0);
    el('cleanup-missing-renewals').textContent = String(pack?.warning_counts.subscriptions_without_renewal ?? 0);
}

function renderRecommendedOutput() {
    const pack = reportsState.pack;
    const warningTotal = pack?.warning_total ?? 0;
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
    // Dynamic card title + description driven by scope.
    const titleEl = el('recommended-title');
    const descEl = el('recommended-description');
    if (!pack || !titleEl || !descEl) return;
    const scope = pack.report_scope;
    if (scope.comparison_mode === 'previous_year_to_date' || scope.comparison_mode === 'same_period_last_year') {
        titleEl.textContent = (scope.mode === 'year_to_date' || scope.mode === 'quarter_to_date')
            ? 'YTD Year-on-Year Financial Report'
            : 'Year-on-Year Financial Report';
        descEl.textContent = `One controlled export containing current vs comparison P&L, monthly trend comparison, finance predictability, expense breakdown, and data quality notes.`;
    } else if (scope.mode === 'year_to_date') {
        titleEl.textContent = 'Year-to-Date Financial Report';
        descEl.textContent = `One controlled export from ${scope.current_period.label} covering P&L, monthly trend, expense breakdown, payables, ledger rows, and data quality notes.`;
    } else if (scope.mode === 'quarter_to_date') {
        titleEl.textContent = 'Quarter-to-Date Financial Report';
        descEl.textContent = `Quarter-to-date export covering P&L, monthly trend, expense breakdown, payables, ledger rows, and data quality notes.`;
    } else {
        titleEl.textContent = 'Monthly Report Pack';
        descEl.textContent = 'One controlled export containing P&L, expense breakdown, payables, subscriptions, ledger rows, and data quality notes for the selected period.';
    }

    // Compact at-a-glance facts on the orange card.
    const sectionsCount = (pack.sections_availability || []).filter(s => s.status !== 'unavailable').length;
    const filesCount = (pack.source_files || []).length;
    const factSections = el('recommended-fact-sections');
    const factFiles = el('recommended-fact-files');
    const factFormat = el('recommended-fact-format');
    if (factSections) factSections.innerHTML = `<strong class="text-gray-900 font-semibold">${sectionsCount}</strong> sections`;
    if (factFiles) factFiles.innerHTML = `<strong class="text-gray-900 font-semibold">${filesCount}</strong> source file${filesCount === 1 ? '' : 's'}`;
    if (factFormat) factFormat.textContent = 'PDF + CSV';
}

function renderRecentExports() {
    const container = el('recent-exports-list');
    if (!container) return;
    const exports = reportsState.recentExports || [];
    if (exports.length === 0) {
        container.innerHTML = `<div class="recent-empty">No exports yet. Confirmed exports will appear here.</div>`;
        return;
    }
    container.innerHTML = exports.map(record => {
        const type = record.report_type || 'monthly_report_pack';
        const label = record.report_scope?.current_period?.label
            ? scopeBasedLabel(record.report_scope)
            : (REPORT_TYPES[type]?.label || type);
        const period = record.report_scope?.current_period?.label
            ? record.report_scope.current_period.label
            : ((record.period_start && record.period_end)
                ? periodLabel({ start: String(record.period_start).slice(0, 10), end: String(record.period_end).slice(0, 10) })
                : '—');
        const created = timestampToDate(record.created_at);
        const when = created ? created.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
        const formats = (record.formats || []).map(f => f === 'pdf_print' ? 'PDF' : (f === 'csv_bundle' ? 'CSV' : f)).join(' + ') || 'CSV';
        const warnings = (record.warning_counts ? Object.values(record.warning_counts).reduce((a, b) => a + Number(b || 0), 0) : 0);
        return `
            <div class="audit-row">
                <div>
                    <strong>${escapeHtml(label)}</strong>
                    <span>${escapeHtml(period)} · ${escapeHtml(formats)}${warnings ? ' · ' + warnings + ' warning' + (warnings === 1 ? '' : 's') : ''}${when ? ' · ' + escapeHtml(when) : ''}</span>
                </div>
                <span class="tag tag-good">Generated</span>
            </div>`;
    }).join('');
}

function scopeBasedLabel(scope) {
    if (!scope) return 'Monthly Report Pack';
    if (scope.comparison_mode === 'previous_year_to_date' || scope.comparison_mode === 'same_period_last_year') {
        return scope.mode === 'year_to_date' || scope.mode === 'quarter_to_date'
            ? 'YTD Year-on-Year Financial Report'
            : 'Year-on-Year Financial Report';
    }
    if (scope.mode === 'year_to_date') return 'Year-to-Date Financial Report';
    if (scope.mode === 'quarter_to_date') return 'Quarter-to-Date Financial Report';
    return 'Monthly Report Pack';
}

function renderEmptyShellIfNeeded() {
    const pack = reportsState.pack;
    const total = pack ? (pack.record_counts.transactions + pack.record_counts.bills + pack.record_counts.subscriptions) : 0;
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
    const pack = reportsState.pack;
    if (!meta || !pack) return;
    const scope = pack.report_scope;
    const drawerTitle = type === 'monthly_report_pack'
        ? `Preview: ${pack.report_identity.report_title}`
        : `Preview: ${meta.label}`;
    el('drawer-title').textContent = drawerTitle;
    el('drawer-period').textContent = `${scope.current_period.label} (${periodHumanRange(scope.current_period)})`;
    const compWrap = el('drawer-comparison-period-wrap');
    const compModeWrap = el('drawer-comparison-mode-wrap');
    if (scope.comparison_period && type === 'monthly_report_pack') {
        compWrap.classList.remove('hidden');
        el('drawer-comparison-period').textContent = `${scope.comparison_period.label} (${periodHumanRange(scope.comparison_period)})`;
        compModeWrap.classList.remove('hidden');
        el('drawer-comparison-mode').textContent = comparisonModeLabel(scope.comparison_mode);
    } else {
        compWrap.classList.add('hidden');
        compModeWrap.classList.add('hidden');
    }

    const totalRecords = pack.record_counts.transactions + pack.record_counts.bills + pack.record_counts.subscriptions;

    // Financial summary
    const showFinancials = type === 'monthly_report_pack' || type === 'profit_loss';
    const finBox = el('drawer-financial');
    finBox.classList.toggle('hidden', !showFinancials);
    if (showFinancials) {
        el('drawer-revenue').textContent = formatRupiah(pack.profit_loss.revenue);
        el('drawer-opex').textContent = formatRupiah(pack.profit_loss.opex);
        el('drawer-margin').textContent = pack.profit_loss.revenue === 0 ? 'Not available' : formatPercent(pack.profit_loss.grossMargin);
        el('drawer-net').textContent = formatRupiah(pack.profit_loss.netResult);
    }

    // Included sources
    const sourceStatus = (count) => count > 0
        ? `<span class="tag tag-good">Included</span>`
        : `<span class="tag tag-lock">No records</span>`;
    el('drawer-sources').innerHTML = `
        <div class="file-row"><div><strong>Transactions</strong><span>${pack.record_counts.transactions} records in selected period</span></div>${sourceStatus(pack.record_counts.transactions)}</div>
        <div class="file-row"><div><strong>Bills</strong><span>${pack.record_counts.bills} records in selected period</span></div>${sourceStatus(pack.record_counts.bills)}</div>
        <div class="file-row"><div><strong>Subscriptions</strong><span>${pack.record_counts.subscriptions} records in selected period</span></div>${sourceStatus(pack.record_counts.subscriptions)}</div>
        <div class="file-row"><div><strong>Revenue Sync</strong><span>No connected source available</span></div><span class="tag tag-lock">Excluded</span></div>
    `;

    // Report sections availability (monthly pack only)
    const sectionsBox = el('drawer-sections');
    if (sectionsBox) {
        if (type !== 'monthly_report_pack') {
            sectionsBox.parentElement.classList.add('hidden');
        } else {
            sectionsBox.parentElement.classList.remove('hidden');
            sectionsBox.innerHTML = pack.sections_availability.map(s => `
                <div class="file-row">
                    <div>
                        <strong>${escapeHtml(s.label)}</strong>
                        ${s.limitation ? `<span>${escapeHtml(s.limitation)}</span>` : ''}
                    </div>
                    <span class="tag ${s.status === 'available' ? 'tag-good' : (s.status === 'partial' ? 'tag-warn' : 'tag-lock')}">${escapeHtml(s.status.charAt(0).toUpperCase() + s.status.slice(1))}</span>
                </div>`).join('');
        }
    }

    // Predictability summary
    const predictBox = el('drawer-predictability');
    if (predictBox) {
        if (type !== 'monthly_report_pack' || pack.finance_predictability.status === 'unavailable') {
            predictBox.parentElement.classList.add('hidden');
        } else {
            predictBox.parentElement.classList.remove('hidden');
            const fp = pack.finance_predictability;
            predictBox.innerHTML = `
                <div class="preview-metric"><span>Monthly run rate</span><strong>${formatRupiah(fp.monthly_revenue_run_rate)}</strong></div>
                <div class="preview-metric"><span>Annualized run rate</span><strong>${formatRupiah(fp.annualized_revenue_run_rate)}</strong></div>
                <div class="preview-metric"><span>Estimated ARR</span><strong>${fp.arr.status === 'unavailable' ? 'Unavailable' : formatRupiah(fp.arr.value || 0)}</strong></div>
                <div class="preview-metric"><span>Year-end net result</span><strong>${formatRupiah(fp.year_end_net_result_outlook.low)} – ${formatRupiah(fp.year_end_net_result_outlook.high)}</strong></div>
            `;
        }
    }

    // Generated files. Monthly pack uses the scope-aware source_files list
    // (so YTD/YoY filenames are correct); individual reports keep the
    // legacy single-file format.
    const slug = periodFilenameSlug({ start: scope.current_period.start_date, end: scope.current_period.end_date });
    if (type === 'monthly_report_pack') {
        el('drawer-files').innerHTML = (pack.source_files || []).map(filename => `
            <div class="file-row">
                <div><strong>${escapeHtml(filename)}</strong><span>${escapeHtml(fileDescriptionForFilename(filename))}</span></div>
                <span class="tag">CSV</span>
            </div>`).join('');
    } else {
        el('drawer-files').innerHTML = meta.files.map(f => `
            <div class="file-row">
                <div><strong>${escapeHtml(f)}_${slug}.csv</strong><span>${escapeHtml(fileDescription(f))}</span></div>
                <span class="tag">CSV</span>
            </div>`).join('');
    }

    // Warnings
    const warningsBox = el('drawer-warnings');
    const w = pack.warning_counts || {};
    const warningRows = [];
    if (w.missing_receipts) warningRows.push(`${w.missing_receipts} transaction${w.missing_receipts === 1 ? '' : 's'} missing receipts`);
    if (w.bills_without_due_date) warningRows.push(`${w.bills_without_due_date} bill${w.bills_without_due_date === 1 ? '' : 's'} without due date`);
    if (w.subscriptions_without_renewal) warningRows.push(`${w.subscriptions_without_renewal} subscription${w.subscriptions_without_renewal === 1 ? '' : 's'} without renewal date`);
    if (warningRows.length === 0) {
        warningsBox.parentElement.classList.add('hidden');
    } else {
        warningsBox.parentElement.classList.remove('hidden');
        warningsBox.innerHTML = warningRows.map(r => `<div class="warning-row">${escapeHtml(r)}</div>`).join('');
    }

    // Confirm button gating + Open Full Report gating
    const confirmBtn = el('drawer-confirm-btn');
    const openFullBtn = el('drawer-open-full-btn');
    const lockReason = el('drawer-lock-reason');
    const blockedExport = totalRecords === 0 || !reportsState.isUserVerified || reportsState.exportInProgress;
    confirmBtn.disabled = blockedExport;
    if (openFullBtn) {
        // Open Full Report doesn't require verification — preview is allowed.
        openFullBtn.disabled = totalRecords === 0;
    }
    if (totalRecords === 0) {
        lockReason.textContent = 'No records in the selected period. Add data first to enable preview and export.';
        lockReason.classList.remove('hidden');
    } else if (!reportsState.isUserVerified) {
        lockReason.textContent = 'Export is available after verification. You can still open the full report preview.';
        lockReason.classList.remove('hidden');
    } else {
        lockReason.classList.add('hidden');
    }
}

function fileDescription(file) {
    return {
        profit_loss: 'Revenue, OpEx, margin, net result',
        ytd_profit_loss: 'YTD revenue, OpEx, averages, best/worst months',
        yoy_profit_loss: 'YTD year-on-year comparison with deltas',
        monthly_trend: 'Month-by-month revenue, OpEx, net result',
        monthly_trend_yoy: 'Monthly trend aligned vs previous year',
        expense_breakdown: 'Spend grouped by category and vendor',
        bills_payables: 'Vendors, amounts, due dates, status',
        subscriptions: 'Recurring vendor and renewal dates',
        ledger_export: 'Raw ledger rows for accountant review',
        data_quality: 'Missing receipts and incomplete records'
    }[file] || 'CSV export';
}

function fileDescriptionForFilename(filename) {
    if (filename.startsWith('yoy_profit_loss_')) return fileDescription('yoy_profit_loss');
    if (filename.startsWith('monthly_trend_yoy_')) return fileDescription('monthly_trend_yoy');
    if (filename.startsWith('monthly_trend_')) return fileDescription('monthly_trend');
    if (filename.startsWith('ytd_profit_loss_')) return fileDescription('ytd_profit_loss');
    if (filename.startsWith('profit_loss_')) return fileDescription('profit_loss');
    if (filename.startsWith('expense_breakdown_')) return fileDescription('expense_breakdown');
    if (filename.startsWith('bills_payables_')) return fileDescription('bills_payables');
    if (filename.startsWith('subscriptions_')) return fileDescription('subscriptions');
    if (filename.startsWith('ledger_export_')) return fileDescription('ledger_export');
    if (filename.startsWith('data_quality_')) return fileDescription('data_quality');
    return 'CSV export';
}

// ---------- Open Full Report ----------

function openFullReport() {
    const pack = reportsState.pack;
    if (!pack) return;
    const total = pack.record_counts.transactions + pack.record_counts.bills + pack.record_counts.subscriptions;
    if (total === 0) {
        window.showToast?.('No records in selected period.', 'info');
        return;
    }
    try {
        const payload = {
            pack,
            // Pass raw source records so the full report can run CSV bundle
            // without re-fetching from Firestore. Records contain only the
            // fields already shown on this page.
            sourceData: serializableSourceData(reportsState.sourceData),
            userDisplayName: reportsState.userDisplayName,
            businessName: reportsState.businessName
        };
        // New tabs get a fresh sessionStorage, so persist the handoff in
        // localStorage. The viewer reads and clears it once.
        localStorage.setItem(REPORT_PREVIEW_STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
        window.showToast?.('Could not stage report preview. Please retry.', 'error');
        return;
    }
    // Open the tab first so the popup blocker treats it as a direct
    // response to the user gesture, then close the drawer.
    const opened = window.open('/report-preview', '_blank', 'noopener');
    if (!opened) {
        window.showToast?.('Allow popups for FluxyOS, or check your browser settings.', 'info');
    }
    closeReportPreview();
}

function serializableSourceData(source) {
    // Firestore Timestamp objects are not JSON-serializable. Convert to ISO
    // strings while keeping the rest of the record intact.
    const serializeRecord = (r) => {
        const copy = { ...r };
        ['timestamp', 'due_date', 'renewal_date', 'created_at'].forEach(k => {
            const d = timestampToDate(copy[k]);
            if (d) copy[k] = d.toISOString();
            else if (copy[k] === undefined) delete copy[k];
        });
        return copy;
    };
    return {
        transactions: (source.transactions || []).map(serializeRecord),
        bills: (source.bills || []).map(serializeRecord),
        subscriptions: (source.subscriptions || []).map(serializeRecord)
    };
}

// ---------- Confirm export (drawer-driven CSV-only path) ----------

async function confirmExportFromDrawer() {
    if (reportsState.exportInProgress) return;
    const type = reportsState.previewReportType;
    const pack = reportsState.pack;
    if (!type || !reportsState.user || !pack) return;
    if (!reportsState.isUserVerified) {
        window.showToast?.('Export is available after verification.', 'info');
        return;
    }
    const total = pack.record_counts.transactions + pack.record_counts.bills + pack.record_counts.subscriptions;
    if (total === 0) {
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
        const scope = pack.report_scope;
        const allFiles = buildCsvBundle(pack, reportsState.sourceData);
        // For Monthly Report Pack the full scope-aware bundle is delivered.
        // For individual reports, only the matching file is sent.
        const meta = REPORT_TYPES[type];
        const filtered = type === 'monthly_report_pack'
            ? allFiles
            : meta.files.map(key => allFiles.find(f => f.filename.startsWith(`${key}_`))).filter(Boolean);

        // 2. Write report_exports metadata + audit log BEFORE downloads.
        const includedSections = type === 'monthly_report_pack'
            ? pack.sections_availability.filter(s => s.status !== 'unavailable').map(s => s.key)
            : [type];
        const limitations = collectLimitations(pack);

        const exportRef = await ds.addReportExport(reportsState.user.uid, {
            report_type: type,
            report_scope: type === 'monthly_report_pack' ? scope : undefined,
            period_start: isoFromDayKey(scope.current_period.start_date),
            period_end: isoFromDayKey(scope.current_period.end_date),
            formats: ['csv_bundle'],
            status: 'generated',
            included_sections: includedSections,
            record_counts: { ...pack.record_counts },
            warning_counts: { ...pack.warning_counts },
            limitations
        });

        await ds.createExportAuditLog(reportsState.user.uid, {
            target_id: exportRef.id,
            after: {
                report_type: type,
                report_scope: type === 'monthly_report_pack' ? {
                    mode: scope.mode,
                    comparison_mode: scope.comparison_mode,
                    current_period: scope.current_period,
                    comparison_period: scope.comparison_period
                } : null,
                period_start: isoFromDayKey(scope.current_period.start_date),
                period_end: isoFromDayKey(scope.current_period.end_date),
                formats: ['csv_bundle'],
                included_sections: includedSections,
                record_counts: { ...pack.record_counts }
            },
            source: 'dashboard'
        });

        // 3. Download files sequentially.
        for (let i = 0; i < filtered.length; i++) {
            downloadFile(filtered[i].filename, filtered[i].content);
            if (i < filtered.length - 1) await new Promise(r => setTimeout(r, 250));
        }

        window.showToast?.('Export confirmed. Audit log created.', 'success');
        closeReportPreview();

        reportsState.recentExports = await ds.getRecentReportExports(reportsState.user.uid, 5);
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

function collectLimitations(pack) {
    const out = [];
    if (pack.period_comparison.status === 'unavailable') out.push(...pack.period_comparison.limitations);
    if (pack.finance_predictability.status !== 'available') out.push(...pack.finance_predictability.limitations);
    if (pack.warning_total) out.push(`${pack.warning_total} data quality warning(s) at export time`);
    return out;
}

// ---------- Event wiring ----------

function bindEvents() {
    el('topbar-generate-btn')?.addEventListener('click', () => {
        openReportPreview(reportsState.selectedReportType || 'monthly_report_pack');
    });

    el('recommended-generate-btn')?.addEventListener('click', () => openReportPreview('monthly_report_pack'));
    el('recommended-fix-btn')?.addEventListener('click', () => {
        el('panel-needs-cleanup')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    document.querySelectorAll('[data-preview-report]').forEach(btn => {
        btn.addEventListener('click', () => {
            openReportPreview(btn.getAttribute('data-preview-report'));
        });
    });

    el('filter-apply-btn')?.addEventListener('click', async () => {
        const btn = el('filter-apply-btn');
        if (btn?.disabled) return;
        const periodSelect = el('filter-period-mode');
        const comparisonSelect = el('filter-comparison-mode');
        if (periodSelect && REPORT_PERIOD_MODES.includes(periodSelect.value)) reportsState.reportPeriodMode = periodSelect.value;
        if (comparisonSelect && COMPARISON_MODES.includes(comparisonSelect.value)) reportsState.comparisonMode = comparisonSelect.value;

        const originalLabel = btn ? btn.textContent : 'Apply';
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Applying…';
        }
        const summary = el('filter-scope-summary');
        summary?.classList.add('text-gray-900');

        try {
            await loadReportData();
            flashScopeSummary();
            if (btn) {
                btn.textContent = 'Applied ✓';
                setTimeout(() => {
                    btn.disabled = false;
                    btn.textContent = originalLabel;
                }, 1100);
            }
            window.showToast?.('Filter applied to the report.', 'success');
        } catch {
            if (btn) {
                btn.disabled = false;
                btn.textContent = originalLabel;
            }
            window.showToast?.('Could not apply filter. Please retry.', 'error');
        }
    });

    function flashScopeSummary() {
        const summary = el('filter-scope-summary');
        if (!summary) return;
        summary.classList.remove('text-gray-500');
        summary.classList.add('text-gray-900', 'font-medium');
        setTimeout(() => {
            summary.classList.remove('text-gray-900', 'font-medium');
            summary.classList.add('text-gray-500');
        }, 900);
    }

    // The Custom range column only makes sense when the period mode is
    // Custom range. For every other mode, hide the whole column so the
    // resolved scope (driven by the dropdown) is the single source of truth
    // and the strip doesn't clutter.
    function updateCustomRangeVisibility() {
        const wrap = el('filter-custom-range');
        if (!wrap) return;
        const isCustom = reportsState.reportPeriodMode === 'custom';
        wrap.classList.toggle('hidden', !isCustom);
    }
    el('filter-period-mode')?.addEventListener('change', (e) => {
        reportsState.reportPeriodMode = e.target.value;
        updateCustomRangeVisibility();
    });
    el('filter-comparison-mode')?.addEventListener('change', (e) => {
        reportsState.comparisonMode = e.target.value;
    });
    updateCustomRangeVisibility();

    el('drawer-close-btn')?.addEventListener('click', closeReportPreview);
    el('drawer-cancel-btn')?.addEventListener('click', closeReportPreview);
    el('drawer-overlay')?.addEventListener('click', closeReportPreview);
    el('drawer-open-full-btn')?.addEventListener('click', openFullReport);
    el('drawer-confirm-btn')?.addEventListener('click', confirmExportFromDrawer);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && reportsState.previewOpen) closeReportPreview();
    });

    if (window.FluxyDateRangePicker?.mount) {
        window.FluxyDateRangePicker.mount('#reports-date-range-picker', {
            start: reportsState.customRange.start,
            end: reportsState.customRange.end,
            onChange: ({ start, end }) => {
                reportsState.customRange = { start, end };
                // Only auto-reload when we're in custom mode; otherwise the
                // resolved scope ignores the picker until Apply.
                if (reportsState.reportPeriodMode === 'custom') loadReportData();
            }
        });
    }

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

async function initReportsPage(user) {
    reportsState.user = user;
    reportsState.userDisplayName = user.displayName || (user.email ? user.email.split('@')[0] : '');
    bindEvents();
    await loadBusinessName();
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
