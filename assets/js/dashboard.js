import DataService from './db-service.js';
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyDNynZIawmUQkTAVv71r4r9Sg661XvHVsA",
    authDomain: "fluxyos.firebaseapp.com",
    projectId: "fluxyos",
    storageBucket: "fluxyos.firebasestorage.app",
    messagingSenderId: "1084252368929",
    appId: "1:1084252368929:web:da73dc0db83fe592c7f360",
    measurementId: "G-ZN7J6DRD2L"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const ds = new DataService(app);

let cashflowChartType = 'bar';
let cashflowBuckets = [];
let dashboardPeriodMode = 'this_month';
let dashboardRangeStart = getMonthStartKey();
let dashboardRangeEnd = getMonthEndKey();
let dashboardDatePicker = null;
window.FluxyDashboardRange = { start: dashboardRangeStart, end: dashboardRangeEnd };

window.loadDashboard = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const period = resolveDashboardPeriod(dashboardPeriodMode);
    dashboardRangeStart = period.start;
    dashboardRangeEnd = period.end;
    window.FluxyDashboardRange = { start: dashboardRangeStart, end: dashboardRangeEnd };
    renderOverviewLoadingState();

    try {
        const overview = await ds.getDashboardOverview(user.uid, {
            startDate: dashboardRangeStart,
            endDate: dashboardRangeEnd,
            label: period.label,
            mode: dashboardPeriodMode
        });

        renderKpiCards(overview);
        cashflowBuckets = buildCashflowBuckets(overview.chartTransactions || [], dashboardRangeStart, dashboardRangeEnd);
        renderCashflowChart();
        attachCashflowChartToggle();
        renderCashPressureSnapshot(overview);
        renderReceivablesPayables(overview);
        renderNeedsAttention(overview);
        renderUpcomingObligations(overview);
        renderAiBusinessSummary(overview);
        renderLedgerPreview(overview.ledgerPreview || []);
    } catch (error) {
        renderOverviewErrorState();
    }
};

function mountDashboardPeriodControls() {
    document.querySelectorAll('[data-dashboard-period]').forEach(button => {
        button.addEventListener('click', () => {
            dashboardPeriodMode = button.dataset.dashboardPeriod || 'this_month';
            updatePeriodControlState();
            const period = resolveDashboardPeriod(dashboardPeriodMode);
            dashboardRangeStart = period.start;
            dashboardRangeEnd = period.end;
            dashboardDatePicker?.setRange(dashboardRangeStart, dashboardRangeEnd);
            window.loadDashboard();
        });
    });

    dashboardDatePicker = window.FluxyDateRangePicker?.mount('#dashboard-date-range-picker', {
        start: dashboardRangeStart,
        end: dashboardRangeEnd,
        onChange: ({ start, end }) => {
            dashboardPeriodMode = 'custom';
            dashboardRangeStart = start;
            dashboardRangeEnd = end;
            updatePeriodControlState();
            window.loadDashboard();
        }
    });

    document.getElementById('dashboard-export-route')?.addEventListener('click', () => {
        window.location.href = '/reports';
    });
    document.getElementById('brain-chat-submit')?.addEventListener('click', () => window.toggleFluxyAI?.());
    document.getElementById('brain-chat-input')?.addEventListener('keydown', event => {
        if (event.key === 'Enter') window.toggleFluxyAI?.();
    });
    updatePeriodControlState();
}

function updatePeriodControlState() {
    document.querySelectorAll('[data-dashboard-period]').forEach(button => {
        button.classList.toggle('is-active', button.dataset.dashboardPeriod === dashboardPeriodMode);
    });
    const picker = document.getElementById('dashboard-date-range-picker');
    if (picker) picker.style.display = dashboardPeriodMode === 'custom' ? '' : 'none';
}

function resolveDashboardPeriod(mode) {
    const today = new Date();
    if (mode === 'last_month') {
        const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        return {
            label: 'Last month',
            start: getMonthStartKey(lastMonth),
            end: getMonthEndKey(lastMonth)
        };
    }
    if (mode === 'year_to_date') {
        return {
            label: 'Year to date',
            start: getDayKey(new Date(today.getFullYear(), 0, 1)),
            end: getDayKey(today)
        };
    }
    if (mode === 'custom') {
        return {
            label: formatRangeLabel(dashboardRangeStart, dashboardRangeEnd),
            start: dashboardRangeStart,
            end: dashboardRangeEnd
        };
    }
    return {
        label: 'This month',
        start: getMonthStartKey(today),
        end: getDayKey(today)
    };
}

function renderOverviewLoadingState() {
    updateKPI('kpi-revenue', 'Loading...');
    updateKPI('kpi-opex', 'Loading...');
    updateKPI('kpi-margin', '0%');
    updateKPI('kpi-action-count', '...');
    updateKPI('kpi-revenue-change', 'Loading...');
    updateKPI('kpi-opex-change', 'Loading...');
    updateKPI('kpi-margin-status', 'Loading...');
    updateKPI('kpi-action-details', 'Checking records...');
    setHtml('cash-pressure-content', '<div class="overview-card-loading">Loading cash pressure...</div>');
    setHtml('receivables-payables-content', '<div class="overview-card-loading">Loading expected money in and out...</div>');
    setHtml('needs-attention-content', '<div class="overview-card-loading">Loading action items...</div>');
    setHtml('upcoming-obligations-content', '<div class="overview-card-loading">Loading upcoming obligations...</div>');
    setHtml('ai-business-summary-content', '<div class="overview-card-loading">Loading grounded summary...</div>');
}

function renderKpiCards(overview) {
    const p = overview.performance || {};
    const actions = overview.actionItems || {};
    const margin = safeNumber(p.grossMargin);
    const actionTotal = Number(actions.total || 0);

    updateKPI('kpi-revenue', formatIDR(p.revenue));
    updateKPI('kpi-opex', formatIDR(p.opex));
    updateKPI('kpi-margin', `${formatNumber(margin, 1)}%`);
    updateKPI('kpi-action-count', actionTotal === 1 ? '1 Item' : `${actionTotal} Items`);
    renderKpiComparison('kpi-revenue-change', p.revenueChangePct, 'revenue');
    renderKpiComparison('kpi-opex-change', p.opexChangePct, 'opex');
    renderMarginStatus(margin, p.marginChangePct);
    renderNeedsActionKpi(actions);

    const bar = document.getElementById('kpi-margin-bar');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, margin))}%`;
}

function renderKpiComparison(id, change, type) {
    const el = document.getElementById(id);
    if (!el) return;
    if (change === null || change === undefined || !Number.isFinite(Number(change))) {
        el.textContent = 'No previous period data';
        el.className = 'text-[11px] text-gray-400 mt-1';
        return;
    }
    const value = Number(change);
    const direction = Math.abs(value) < 0.1 ? 'Flat' : (value > 0 ? 'Up' : 'Down');
    const isGood = type === 'opex' ? value <= 0 : value >= 0;
    el.textContent = direction === 'Flat'
        ? 'Flat vs previous period'
        : `${direction} ${Math.abs(value).toFixed(1)}% vs previous period`;
    el.className = `text-[11px] mt-1 font-bold ${direction === 'Flat' ? 'text-gray-400' : (isGood ? 'text-emerald-600' : 'text-red-500')}`;
}

function renderMarginStatus(margin, marginChange) {
    const label = margin <= 0
        ? (margin === 0 ? 'No revenue data' : 'Negative')
        : (margin >= 50 ? 'Healthy' : (margin >= 20 ? 'Tight' : 'Negative'));
    const suffix = marginChange === null || marginChange === undefined || !Number.isFinite(Number(marginChange))
        ? ' - No previous period data'
        : ` - ${Number(marginChange) >= 0 ? 'Up' : 'Down'} ${Math.abs(Number(marginChange)).toFixed(1)} pts`;
    updateKPI('kpi-margin-status', `${label}${suffix}`);
}

function renderNeedsActionKpi(actions) {
    const details = [];
    if (actions.missingReceipts) details.push(`${actions.missingReceipts} Missing Receipt${actions.missingReceipts === 1 ? '' : 's'}`);
    if (actions.overdueBills) details.push(`${actions.overdueBills} Overdue Bill${actions.overdueBills === 1 ? '' : 's'}`);
    if (actions.billsDueSoon) details.push(`${actions.billsDueSoon} Due Soon`);
    if (actions.renewalsSoon) details.push(`${actions.renewalsSoon} Renewal${actions.renewalsSoon === 1 ? '' : 's'}`);
    if (actions.highOpexIncrease) details.push('OpEx spike');

    const detailsEl = document.getElementById('kpi-action-details');
    const link = document.getElementById('kpi-action-link');
    if (detailsEl) detailsEl.textContent = details.length ? details.slice(0, 2).join(' - ') : 'Records look clean';
    if (!link) return;
    link.classList.toggle('hidden', !details.length);
    link.onclick = event => {
        event.preventDefault();
        document.getElementById('overview-needs-attention')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
}

function renderCashPressureSnapshot(overview) {
    const c = overview.cashPressure || {};
    const risk = String(c.riskLevel || 'low');
    const pill = document.getElementById('cash-pressure-risk');
    if (pill) {
        pill.textContent = risk === 'high' ? 'High' : (risk === 'watch' ? 'Watch' : 'Low');
        pill.className = `overview-risk-pill is-${risk}`;
    }
    const limitations = renderLimitations(overview.limitations);
    setHtml('cash-pressure-content', `
        <div class="overview-metric-grid overview-metric-grid-three">
            <div class="overview-metric-tile">
                <span>Upcoming obligations</span>
                <strong>${formatIDR(c.upcomingObligations)}</strong>
            </div>
            <div class="overview-metric-tile">
                <span>Expected incoming</span>
                <strong>${formatIDR(c.expectedIncoming)}</strong>
            </div>
            <div class="overview-metric-tile is-emphasis">
                <span>Net pressure</span>
                <strong class="${safeNumber(c.netPressure) < 0 ? 'text-red-600' : 'text-emerald-600'}">${formatSignedIDR(c.netPressure)}</strong>
            </div>
        </div>
        <p class="overview-inline-note">${escapeHtml(c.limitation || '')}</p>
        ${limitations}
        <div class="overview-link-row">
            <a href="/bill">View Bills</a>
            <a href="/subscription">View Subscriptions</a>
            <button type="button" data-ask-fluxy>Ask Fluxy AI</button>
        </div>
    `);
    document.querySelector('[data-ask-fluxy]')?.addEventListener('click', () => window.toggleFluxyAI?.());
}

function renderReceivablesPayables(overview) {
    const rp = overview.receivablesPayables || {};
    const hasReceivables = Number(rp.receivableCount || 0) > 0;
    const hasPayables = Number(rp.payableCount || 0) > 0;
    const emptyCopy = !hasReceivables && !hasPayables
        ? '<p class="overview-inline-note">No pending receivables or upcoming payables found.</p>'
        : '';
    setHtml('receivables-payables-content', `
        <div class="overview-metric-grid overview-metric-grid-three">
            <div class="overview-metric-tile">
                <span>Receivables</span>
                <strong>${formatIDR(rp.receivablesTotal)}</strong>
                <small>${rp.receivableCount || 0} record${rp.receivableCount === 1 ? '' : 's'}</small>
            </div>
            <div class="overview-metric-tile">
                <span>Payables</span>
                <strong>${formatIDR(rp.payablesTotal)}</strong>
                <small>${rp.payableCount || 0} record${rp.payableCount === 1 ? '' : 's'}</small>
            </div>
            <div class="overview-metric-tile is-emphasis">
                <span>Net expected</span>
                <strong class="${safeNumber(rp.netExpected) < 0 ? 'text-red-600' : 'text-emerald-600'}">${formatSignedIDR(rp.netExpected)}</strong>
                <small>Selected period</small>
            </div>
        </div>
        ${emptyCopy}
        <div class="overview-link-row">
            <a href="/ledger">Review Ledger</a>
            <a href="/bill">Review Bills</a>
        </div>
    `);
}

function renderNeedsAttention(overview) {
    const items = buildAttentionItems(overview);
    if (!items.length) {
        setHtml('needs-attention-content', '<div class="overview-empty-copy">No urgent finance actions right now.</div>');
        return;
    }
    setHtml('needs-attention-content', `
        <div class="overview-attention-list">
            ${items.slice(0, 5).map(item => `
                <a class="overview-attention-item" href="${item.href}">
                    <div class="overview-row-main">
                        <strong>${escapeHtml(item.title)}</strong>
                        <p>${escapeHtml(item.description)}</p>
                    </div>
                    <span class="overview-action-link">${escapeHtml(item.action)}</span>
                </a>
            `).join('')}
        </div>
    `);
}

function buildAttentionItems(overview) {
    const p = overview.performance || {};
    const actions = overview.actionItems || {};
    const items = [];
    if (actions.overdueBills) {
        items.push({
            title: `${actions.overdueBills} overdue bill${actions.overdueBills === 1 ? '' : 's'}`,
            description: 'Overdue obligations can create vendor and cash pressure.',
            action: 'Open Bills',
            href: '/bill'
        });
    }
    if (actions.missingReceipts) {
        items.push({
            title: `${actions.missingReceipts} missing receipt${actions.missingReceipts === 1 ? '' : 's'}`,
            description: 'Missing receipts reduce confidence in reports and tax-ready records.',
            action: 'Open Ledger',
            href: '/ledger?search=Missing%20Receipt'
        });
    }
    if (actions.highOpexIncrease) {
        items.push({
            title: `OpEx up ${Math.abs(Number(p.opexChangePct)).toFixed(1)}%`,
            description: 'Spending rose meaningfully against the previous period.',
            action: 'Review Ledger',
            href: '/ledger'
        });
    }
    if (actions.billsDueSoon) {
        items.push({
            title: `${actions.billsDueSoon} bill${actions.billsDueSoon === 1 ? '' : 's'} due soon`,
            description: 'Upcoming bills should be checked before new spend is approved.',
            action: 'Open Bills',
            href: '/bill'
        });
    }
    if (actions.renewalsSoon) {
        items.push({
            title: `${actions.renewalsSoon} renewal${actions.renewalsSoon === 1 ? '' : 's'} soon`,
            description: 'Subscription renewals may affect recurring spend.',
            action: 'Open Subscriptions',
            href: '/subscription'
        });
    }
    if (overview.limitations?.length) {
        items.push({
            title: 'Partial data loaded',
            description: overview.limitations[0],
            action: 'Refresh',
            href: '/dashboard'
        });
    }
    return items;
}

function renderUpcomingObligations(overview) {
    const bills = overview.upcoming?.bills || [];
    const subscriptions = overview.upcoming?.subscriptions || [];
    const rows = [
        ...bills.map(bill => ({ type: 'Bill', href: '/bill', dateField: 'due_date', record: bill })),
        ...subscriptions.map(sub => ({ type: 'Renewal', href: '/subscription', dateField: 'renewal_date', record: sub }))
    ].slice(0, 5);

    if (!rows.length) {
        setHtml('upcoming-obligations-content', '<div class="overview-empty-copy">No upcoming bills or renewals.</div>');
        return;
    }

    setHtml('upcoming-obligations-content', `
        <div class="overview-upcoming-list">
            ${rows.map(row => `
                <a class="overview-upcoming-item" href="${row.href}">
                    <div class="overview-row-main">
                        <span>${escapeHtml(row.type)}</span>
                        <strong>${escapeHtml(row.record.vendor_name || row.record.name || 'Untitled record')}</strong>
                        <small>${escapeHtml(formatRecordDate(row.record, row.dateField) || (row.type === 'Bill' ? 'No due date' : 'No renewal date'))}</small>
                    </div>
                    <div class="overview-row-side">
                        <strong>${formatIDR(row.record.amount)}</strong>
                        <small>${escapeHtml(row.record.status || 'Scheduled')}</small>
                    </div>
                </a>
            `).join('')}
        </div>
    `);
}

function renderAiBusinessSummary(overview) {
    const insights = overview.insights || {};
    updateKPI('ai-summary-period', overview.period?.label || 'Selected period insight');
    setHtml('ai-business-summary-content', `
        <div class="overview-ai-note">
            <p>${escapeHtml(insights.summary || 'Not enough data for a grounded summary yet.')}</p>
        </div>
        <div class="overview-ai-fact">
            <span>Main risk</span>
            <strong>${escapeHtml(insights.mainRisk || 'No urgent finance risk detected from available records.')}</strong>
        </div>
        <div class="overview-ai-fact">
            <span>Recommended action</span>
            <strong>${escapeHtml(insights.recommendedAction || 'Keep reviewing new records as they come in.')}</strong>
        </div>
        ${(insights.limitations || []).length ? `<p class="overview-limitation">${escapeHtml(insights.limitations[0])}</p>` : ''}
        <button type="button" class="overview-ai-cta" data-ask-fluxy-summary>Ask Fluxy AI about this period</button>
    `);
    document.querySelector('[data-ask-fluxy-summary]')?.addEventListener('click', () => window.toggleFluxyAI?.());
}

function renderOverviewErrorState() {
    updateKPI('kpi-revenue', 'Rp 0');
    updateKPI('kpi-opex', 'Rp 0');
    updateKPI('kpi-margin', '0%');
    updateKPI('kpi-action-count', '0 Items');
    updateKPI('kpi-revenue-change', 'No previous period data');
    updateKPI('kpi-opex-change', 'No previous period data');
    updateKPI('kpi-margin-status', 'No revenue data');
    updateKPI('kpi-action-details', 'Records could not be loaded');
    const errorHtml = '<div class="overview-empty-copy">Overview data could not be loaded. Please refresh and try again.</div>';
    setHtml('cash-pressure-content', errorHtml);
    setHtml('receivables-payables-content', errorHtml);
    setHtml('needs-attention-content', errorHtml);
    setHtml('upcoming-obligations-content', errorHtml);
    setHtml('ai-business-summary-content', errorHtml);
    renderLedgerPreview([]);
}

function renderLedgerPreview(transactions) {
    const tableContainer = document.getElementById('ledger-table-container');
    const emptyContainer = document.getElementById('ledger-empty-state');
    const footer = document.getElementById('ledger-footer');

    if (!transactions.length) {
        tableContainer?.classList.add('hidden');
        footer?.classList.add('hidden');
        if (emptyContainer) {
            emptyContainer.classList.remove('hidden');
            window.renderEmptyState('ledger-empty-state', {
                title: 'No transactions found for this period',
                description: 'Try another period or log your first expense or revenue record.',
                buttonText: 'Log First Transaction',
                onAction: () => window.showAddTransactionModal()
            });
        }
        return;
    }

    tableContainer?.classList.remove('hidden');
    footer?.classList.remove('hidden');
    emptyContainer?.classList.add('hidden');
    renderLedgerRows(transactions);
}

function updateKPI(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function setHtml(id, html) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('overview-card-loading', 'overview-empty-copy');
    el.classList.add('overview-section-content');
    el.innerHTML = html;
}

function isPositiveTransaction(tx) {
    return ['revenue', 'income', 'refund', 'pending_receivable'].includes(String(tx.type || '').toLowerCase());
}

function isSpendTransaction(tx) {
    return ['expense', 'fee', 'tax', 'pending_payable'].includes(String(tx.type || '').toLowerCase());
}

function getTxDate(tx) {
    return getRecordDate(tx, 'timestamp');
}

function getRecordDate(record, fieldName) {
    const value = record?.[fieldName];
    if (value && typeof value.toDate === 'function') return value.toDate();
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}

function getDayKey(date = new Date()) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

function parseDayKey(dayKey) {
    const [year, month, day] = dayKey.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function addDays(dayKey, delta) {
    const date = parseDayKey(dayKey);
    date.setDate(date.getDate() + delta);
    return getDayKey(date);
}

function getMonthStartKey(date = new Date()) {
    return getDayKey(new Date(date.getFullYear(), date.getMonth(), 1));
}

function getMonthEndKey(date = new Date()) {
    return getDayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

function getRangeDays(startKey, endKey) {
    return Math.max(1, Math.round((parseDayKey(endKey) - parseDayKey(startKey)) / 86400000) + 1);
}

function formatRangeLabel(startKey, endKey) {
    const start = parseDayKey(startKey);
    const end = parseDayKey(endKey);
    if (startKey === endKey) {
        return start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function formatBucketLabel(startKey, endKey, bucketType) {
    const start = parseDayKey(startKey);
    const end = parseDayKey(endKey);
    if (bucketType === 'month') return start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    if (startKey === endKey) return start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
        return `${start.toLocaleDateString('en-US', { month: 'short' })} ${start.getDate()}-${end.getDate()}`;
    }
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}-${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function buildCashflowBuckets(txs, startKey, endKey) {
    const rangeDays = getRangeDays(startKey, endKey);
    const bucketType = rangeDays <= 14 ? 'day' : (rangeDays > 93 ? 'month' : 'week');
    const bucketStep = bucketType === 'day' ? 1 : 7;
    const buckets = [];

    if (bucketType === 'month') {
        let cursor = getMonthStartKey(parseDayKey(startKey));
        while (cursor <= endKey) {
            const monthEnd = getMonthEndKey(parseDayKey(cursor));
            const bucketStart = cursor < startKey ? startKey : cursor;
            const bucketEnd = monthEnd > endKey ? endKey : monthEnd;
            buckets.push({ start: bucketStart, end: bucketEnd, label: formatBucketLabel(bucketStart, bucketEnd, bucketType), revenue: 0, spend: 0 });
            const next = parseDayKey(cursor);
            next.setMonth(next.getMonth() + 1);
            cursor = getMonthStartKey(next);
        }
    } else {
        let cursor = startKey;
        while (cursor <= endKey) {
            const bucketEnd = addDays(cursor, bucketStep - 1) > endKey ? endKey : addDays(cursor, bucketStep - 1);
            buckets.push({ start: cursor, end: bucketEnd, label: formatBucketLabel(cursor, bucketEnd, bucketType), revenue: 0, spend: 0 });
            cursor = addDays(bucketEnd, 1);
        }
    }

    txs.forEach(tx => {
        const date = getTxDate(tx);
        if (!date) return;
        const dayKey = getDayKey(date);
        if (dayKey < startKey || dayKey > endKey) return;
        const bucket = buckets.find(item => dayKey >= item.start && dayKey <= item.end);
        if (!bucket) return;
        const amount = Math.abs(Number(tx.amount) || 0);
        if (isPositiveTransaction(tx)) bucket.revenue += amount;
        else if (isSpendTransaction(tx)) bucket.spend += amount;
    });

    if (!buckets.length) {
        buckets.push({ start: startKey, end: endKey, label: formatBucketLabel(startKey, endKey, 'day'), revenue: 0, spend: 0 });
    }
    return buckets;
}

function formatIDR(value) {
    return `Rp ${Math.round(Math.abs(Number(value) || 0)).toLocaleString('id-ID')}`;
}

function formatSignedIDR(value) {
    const n = Number(value) || 0;
    if (n === 0) return 'Rp 0';
    return `${n < 0 ? '-' : '+'}${formatIDR(n)}`;
}

function formatCompactIDR(value) {
    return formatIDR(value);
}

function formatNumber(value, digits = 1) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(digits) : (0).toFixed(digits);
}

function safeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function renderCashflowChart() {
    const chart = document.getElementById('cashflow-chart');
    if (!chart) return;
    if (cashflowChartType === 'line') renderCashflowLineChart(chart);
    else renderCashflowBarChart(chart);
}

function renderCashflowBarChart(chart) {
    const maxValue = Math.max(...cashflowBuckets.map(item => Math.max(item.revenue, item.spend)), 1);
    chart.innerHTML = `
        <div class="cashflow-chart-stage" data-cashflow-bar-stage>
            <div class="cashflow-axis">
                <div><span>${formatCompactIDR(maxValue)}</span></div>
                <div><span>${formatCompactIDR(maxValue / 2)}</span></div>
                <div><span>Rp 0</span></div>
            </div>
            <div class="cashflow-bars">
                ${cashflowBuckets.map(item => {
                    const revenueHeight = Math.max((item.revenue / maxValue) * 100, item.revenue > 0 ? 4 : 0);
                    const spendHeight = Math.max((item.spend / maxValue) * 100, item.spend > 0 ? 4 : 0);
                    return `
                        <div class="cashflow-bar-group" data-chart-bar data-label="${escapeHtml(item.label)}" data-revenue="${item.revenue}" data-spend="${item.spend}">
                            <div class="cashflow-bar cashflow-bar-revenue" style="height: ${revenueHeight}%"></div>
                            <div class="cashflow-bar cashflow-bar-spend" style="height: ${spendHeight}%"></div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
        <div class="cashflow-labels">
            ${cashflowBuckets.map(item => `<span>${escapeHtml(item.label)}</span>`).join('')}
        </div>
    `;
    attachCashflowHover(chart.querySelector('[data-cashflow-bar-stage]'), '#4ADE80', '#D1D5DB');
}

function buildLinePoints(values, maxValue, width, height, paddingX, paddingY) {
    if (values.length === 1) {
        const y = height - paddingY - ((values[0] / maxValue) * (height - paddingY * 2));
        return [{ x: width / 2, y }];
    }
    return values.map((value, index) => {
        const x = paddingX + (index / Math.max(values.length - 1, 1)) * (width - paddingX * 2);
        const y = height - paddingY - ((value / maxValue) * (height - paddingY * 2));
        return { x, y };
    });
}

function renderCashflowLineChart(chart) {
    const width = 900;
    const height = 280;
    const paddingX = 86;
    const paddingY = 28;
    const revenueValues = cashflowBuckets.map(item => item.revenue);
    const spendValues = cashflowBuckets.map(item => item.spend);
    const maxValue = Math.max(...revenueValues, ...spendValues, 1);
    const revenuePoints = buildLinePoints(revenueValues, maxValue, width, height, paddingX, paddingY);
    const spendPoints = buildLinePoints(spendValues, maxValue, width, height, paddingX, paddingY);
    const toPolyline = points => points.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');

    chart.innerHTML = `
        <div class="cashflow-line-stage" data-cashflow-line-stage>
            <div class="cashflow-axis">
                <div><span>${formatCompactIDR(maxValue)}</span></div>
                <div><span>${formatCompactIDR(maxValue / 2)}</span></div>
                <div><span>Rp 0</span></div>
            </div>
            <svg class="cashflow-line-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cash flow line chart">
                <polyline class="cashflow-line cashflow-line-revenue" points="${toPolyline(revenuePoints)}"></polyline>
                <polyline class="cashflow-line cashflow-line-spend" points="${toPolyline(spendPoints)}"></polyline>
                ${revenuePoints.map(point => `<circle class="cashflow-point cashflow-point-revenue" cx="${point.x}" cy="${point.y}" r="4"></circle>`).join('')}
                ${spendPoints.map(point => `<circle class="cashflow-point cashflow-point-spend" cx="${point.x}" cy="${point.y}" r="4"></circle>`).join('')}
            </svg>
            <div class="cashflow-line-hover-zones">
                ${cashflowBuckets.map((item, index) => `
                    <div class="cashflow-line-hover-zone" data-chart-bar data-label="${escapeHtml(item.label)}" data-revenue="${item.revenue}" data-spend="${item.spend}" style="left:${(index / Math.max(cashflowBuckets.length - 1, 1)) * 100}%"></div>
                `).join('')}
            </div>
        </div>
        <div class="cashflow-labels">
            ${cashflowBuckets.map(item => `<span>${escapeHtml(item.label)}</span>`).join('')}
        </div>
    `;
    attachCashflowHover(chart.querySelector('[data-cashflow-line-stage]'), '#22C55E', '#9CA3AF');
}

function attachCashflowHover(stage, revenueColor, spendColor) {
    if (!stage || !window.attachChartHover) return;
    window.attachChartHover(stage, {
        bars: '[data-chart-bar]',
        orientation: 'vertical',
        buildTooltip: barEl => `
            <div class="chart-tooltip-header">${escapeHtml(barEl.dataset.label)}</div>
            <div class="chart-tooltip-row">
                <span class="chart-tooltip-swatch" style="background:${revenueColor}"></span>
                <span class="chart-tooltip-label">Revenue</span>
                <span class="chart-tooltip-value">${formatIDR(Number(barEl.dataset.revenue || 0))}</span>
            </div>
            <div class="chart-tooltip-row">
                <span class="chart-tooltip-swatch" style="background:${spendColor}"></span>
                <span class="chart-tooltip-label">Spend</span>
                <span class="chart-tooltip-value">${formatIDR(Number(barEl.dataset.spend || 0))}</span>
            </div>
        `
    });
}

function attachCashflowChartToggle() {
    document.querySelectorAll('[data-cashflow-chart-type]').forEach(button => {
        button.onclick = () => {
            cashflowChartType = button.dataset.cashflowChartType || 'bar';
            document.querySelectorAll('[data-cashflow-chart-type]').forEach(toggle => {
                toggle.classList.toggle('is-active', toggle === button);
            });
            renderCashflowChart();
        };
    });
}

function renderLedgerRows(txs) {
    const body = document.getElementById('ledger-body');
    if (!body) return;
    body.innerHTML = txs.map(tx => `
        <tr class="border-b border-gray-50 hover:bg-gray-50/50 transition-colors group">
            <td class="px-5 py-3.5">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded bg-gray-100 flex items-center justify-center text-[12px] shadow-sm">
                        ${escapeHtml(tx.icon || '')}
                    </div>
                    <div>
                        <p class="font-bold text-gray-900">${escapeHtml(tx.vendor_name || 'Untitled transaction')}</p>
                        <p class="text-[11px] text-gray-500">${escapeHtml(formatRecordDate(tx, 'timestamp') || 'Date unavailable')}</p>
                    </div>
                </div>
            </td>
            <td class="px-5 py-3.5">
                <span class="${isPositiveTransaction(tx) ? 'bg-gray-100 text-gray-600' : 'bg-[#FFEDD5] text-[#C2410C]'} px-2 py-0.5 rounded text-[11px] font-bold">
                    ${escapeHtml(tx.category || 'Uncategorized')}
                </span>
            </td>
            <td class="px-5 py-3.5 text-gray-600 text-[12px] font-medium">${escapeHtml(tx.entity || 'Main Entity')}</td>
            <td class="px-5 py-3.5 text-right font-mono font-bold ${isPositiveTransaction(tx) ? 'text-green-600' : 'text-gray-900'}">
                ${isPositiveTransaction(tx) ? '+' : ''}${formatIDR(tx.amount)}
            </td>
            <td class="px-5 py-3.5 text-right">
                <span class="inline-flex items-center gap-1.5 ${tx.status === 'Missing Receipt' ? 'text-red-500 bg-red-50 px-2 py-1 rounded text-[10px]' : 'text-green-600 text-[11px]'} font-bold">
                    ${escapeHtml(tx.status || 'Completed')}
                </span>
            </td>
        </tr>
    `).join('');
}

function formatRecordDate(record, fieldName) {
    const date = getRecordDate(record, fieldName);
    return date ? date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

function renderLimitations(limitations = []) {
    if (!limitations.length) return '';
    return `<p class="overview-limitation">${escapeHtml(limitations[0])}</p>`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

mountDashboardPeriodControls();

// Auth state is handled by the page-level script in dashboard.html.
// Do not add another onAuthStateChanged here; it causes loadDashboard() to run twice.
