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

let cashflowChartType = 'line';
let cashflowBuckets = [];
let cashFlowBuckets = [];
let dashboardPeriodMode = 'this_month';
let dashboardRangeStart = getMonthStartKey();
let dashboardRangeEnd = getMonthEndKey();
let dashboardDatePicker = null;
let attentionItemsCache = { all: [], needs_review: [], my_records: [] };
let currentAttentionTab = 'all';
window.FluxyDashboardRange = { start: dashboardRangeStart, end: dashboardRangeEnd };

window.loadDashboard = async () => {
    const user = auth.currentUser;
    if (!user) return;

    renderGreeting();
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

        cashflowBuckets = buildCashflowBuckets(overview.chartTransactions || [], dashboardRangeStart, dashboardRangeEnd);
        cashFlowBuckets = overview.cashFlow || [];

        renderSummaryBoard(overview);
        renderCashflowChart();
        attachCashflowChartToggle();
        renderCashFlowChart();
        buildAttentionCache(overview);
        renderAttentionQueue();
        renderAiBusinessSummary(overview);
        renderPayablesByCategory(overview);
        renderUpcomingObligations(overview);
        renderReportReadiness(overview);
    } catch (error) {
        renderOverviewErrorState();
    }
};

function renderGreeting() {
    const hour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })).getHours();
    const greeting = hour < 12 ? 'Good morning' : (hour < 18 ? 'Good afternoon' : 'Good evening');
    updateKPI('overview-greeting-text', greeting);
    const user = auth.currentUser;
    const fullName = user?.displayName || '';
    const firstName = fullName ? fullName.split(' ')[0] : 'there';
    updateKPI('overview-user-name', firstName);
}

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

    document.querySelectorAll('[data-attention-tab]').forEach(button => {
        button.addEventListener('click', () => {
            currentAttentionTab = button.dataset.attentionTab || 'all';
            document.querySelectorAll('[data-attention-tab]').forEach(tab => {
                tab.classList.toggle('is-active', tab === button);
            });
            renderAttentionQueue();
        });
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
    updateKPI('kpi-revenue', 'Rp 0');
    updateKPI('kpi-opex', 'Rp 0');
    updateKPI('kpi-margin', '0%');
    updateKPI('kpi-cash-pressure', 'Rp 0');
    updateKPI('kpi-receivables', 'Rp 0');
    updateKPI('kpi-payables', 'Rp 0');
    updateKPI('kpi-revenue-change', 'Loading...');
    updateKPI('kpi-opex-change', 'Loading...');
    updateKPI('kpi-margin-status', 'Loading...');
    updateKPI('kpi-cash-pressure-sub', 'Loading...');
    updateKPI('kpi-receivables-sub', 'Loading...');
    updateKPI('kpi-payables-sub', 'Loading...');
    setHtml('needs-attention-content', '<div class="overview-card-loading">Loading action items...</div>');
    setHtml('payables-by-category-content', '<div class="overview-card-loading">Loading payables...</div>');
    setHtml('upcoming-obligations-content', '<div class="overview-card-loading">Loading upcoming obligations...</div>');
    setHtml('report-readiness-content', '<div class="overview-card-loading">Loading report readiness...</div>');
    setHtml('ai-business-summary-content', '<div class="overview-card-loading">Loading grounded summary...</div>');
    updateKPI('attention-total-count', '0');
    updateKPI('attention-needs-review-count', '0');
    const status = document.getElementById('report-readiness-status');
    if (status) {
        status.textContent = 'Loading';
        status.className = 'status-badge';
    }
}

function renderOverviewErrorState() {
    updateKPI('kpi-revenue', 'Rp 0');
    updateKPI('kpi-opex', 'Rp 0');
    updateKPI('kpi-margin', '0%');
    updateKPI('kpi-cash-pressure', 'Rp 0');
    updateKPI('kpi-receivables', 'Rp 0');
    updateKPI('kpi-payables', 'Rp 0');
    updateKPI('kpi-revenue-change', 'No data');
    updateKPI('kpi-opex-change', 'No data');
    updateKPI('kpi-margin-status', 'No revenue data');
    updateKPI('kpi-cash-pressure-sub', 'No data');
    updateKPI('kpi-receivables-sub', 'No records found');
    updateKPI('kpi-payables-sub', 'No records found');
    const errorHtml = '<div class="overview-empty-copy">Overview data could not be loaded. Please refresh and try again.</div>';
    setHtml('needs-attention-content', errorHtml);
    setHtml('payables-by-category-content', errorHtml);
    setHtml('upcoming-obligations-content', errorHtml);
    setHtml('report-readiness-content', errorHtml);
    setHtml('ai-business-summary-content', errorHtml);
    const sparkline = document.getElementById('kpi-cash-pressure-sparkline');
    if (sparkline) sparkline.innerHTML = '';
    const status = document.getElementById('report-readiness-status');
    if (status) {
        status.textContent = 'Unavailable';
        status.className = 'status-badge';
    }
}

function renderSummaryBoard(overview) {
    const p = overview.performance || {};
    const rp = overview.receivablesPayables || {};
    const c = overview.cashPressure || {};
    const margin = safeNumber(p.grossMargin);

    updateKPI('kpi-revenue', formatIDR(p.revenue));
    updateKPI('kpi-opex', formatIDR(p.opex));
    updateKPI('kpi-margin', `${formatNumber(margin, 1)}%`);
    updateKPI('kpi-cash-pressure', formatSignedIDR(c.netPressure));
    updateKPI('kpi-receivables', formatIDR(rp.receivablesTotal));
    updateKPI('kpi-payables', formatIDR(rp.payablesTotal));

    renderKpiComparison('kpi-revenue-change', p.revenueChangePct, 'revenue');
    renderKpiComparison('kpi-opex-change', p.opexChangePct, 'opex');
    renderMarginStatus(margin, p.marginChangePct);

    renderMetricArrow('kpi-revenue-arrow', p.revenueChangePct, 'revenue');
    renderMetricArrow('kpi-opex-arrow', p.opexChangePct, 'opex');
    renderMetricArrow('kpi-margin-arrow', p.marginChangePct, 'revenue');
    renderMetricArrow('kpi-cash-pressure-arrow', safeNumber(c.netPressure), 'revenue');

    const cashPressureSub = document.getElementById('kpi-cash-pressure-sub');
    if (cashPressureSub) {
        const risk = String(c.riskLevel || 'low');
        const riskLabel = risk === 'high' ? 'High pressure' : (risk === 'watch' ? 'Watch' : 'Low pressure');
        cashPressureSub.textContent = `${riskLabel} - obligations vs incoming`;
    }
    const receivablesSub = document.getElementById('kpi-receivables-sub');
    if (receivablesSub) {
        const n = Number(rp.receivableCount || 0);
        receivablesSub.textContent = n === 0 ? 'No records expected in.' : `${n} record${n === 1 ? '' : 's'} expected in.`;
    }
    const payablesSub = document.getElementById('kpi-payables-sub');
    if (payablesSub) {
        const n = Number(rp.payableCount || 0);
        payablesSub.textContent = n === 0 ? 'No records expected out.' : `${n} record${n === 1 ? '' : 's'} expected out.`;
    }

    const bar = document.getElementById('kpi-margin-bar');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, margin))}%`;

    renderCashPressureSparkline(cashFlowBuckets);
}

function renderKpiComparison(id, change, type) {
    const el = document.getElementById(id);
    if (!el) return;
    if (change === null || change === undefined || !Number.isFinite(Number(change))) {
        el.textContent = 'No previous period data';
        el.className = 'metric-sub';
        return;
    }
    const value = Number(change);
    const direction = Math.abs(value) < 0.1 ? 'Flat' : (value > 0 ? 'Up' : 'Down');
    const isGood = type === 'opex' ? value <= 0 : value >= 0;
    el.textContent = direction === 'Flat'
        ? 'Flat vs previous period'
        : `${direction} ${Math.abs(value).toFixed(1)}% vs previous period`;
    el.className = `metric-sub ${direction === 'Flat' ? 'is-neutral' : (isGood ? 'is-good' : 'is-bad')}`;
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

function renderMetricArrow(id, change, type) {
    const el = document.getElementById(id);
    if (!el) return;
    if (change === null || change === undefined || !Number.isFinite(Number(change))) {
        el.textContent = '';
        el.className = 'metric-arrow';
        return;
    }
    const value = Number(change);
    if (Math.abs(value) < 0.1) {
        el.textContent = '';
        el.className = 'metric-arrow';
        return;
    }
    const isUp = value > 0;
    const isGood = type === 'opex' ? !isUp : isUp;
    el.textContent = isUp ? '^' : 'v';
    el.className = `metric-arrow ${isGood ? 'is-good' : 'is-bad'}`;
}

function renderCashPressureSparkline(buckets) {
    const svg = document.getElementById('kpi-cash-pressure-sparkline');
    if (!svg) return;
    if (!buckets || buckets.length === 0) {
        svg.innerHTML = '';
        return;
    }
    const width = 300;
    const height = 60;
    const paddingX = 4;
    const paddingY = 6;
    const nets = buckets.map(b => Number(b.netCashFlow) || 0);
    const minVal = Math.min(...nets, 0);
    const maxVal = Math.max(...nets, 0);
    const range = (maxVal - minVal) || 1;
    const stepX = nets.length > 1 ? (width - paddingX * 2) / (nets.length - 1) : 0;
    const toY = (val) => height - paddingY - ((val - minVal) / range) * (height - paddingY * 2);
    const points = nets.map((val, i) => ({
        x: paddingX + i * stepX,
        y: toY(val)
    }));
    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const lastNet = nets[nets.length - 1];
    const stroke = lastNet < 0 ? '#ef4444' : '#22c55e';
    const fill = lastNet < 0 ? 'rgba(239,68,68,0.10)' : 'rgba(34,197,94,0.10)';
    const areaPath = points.length
        ? `M${points[0].x.toFixed(1)},${height} ${linePath.replace('M', 'L')} L${points[points.length - 1].x.toFixed(1)},${height} Z`
        : '';
    svg.innerHTML = `
        <path d="${areaPath}" fill="${fill}" stroke="none"></path>
        <path d="${linePath}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
    `;
}

function renderCashFlowChart() {
    const chart = document.getElementById('cash-flow-chart');
    if (!chart) return;
    if (!cashFlowBuckets || cashFlowBuckets.length === 0) {
        chart.innerHTML = '<div class="overview-empty-copy">No cash flow data for this period.</div>';
        return;
    }

    const maxIn = Math.max(...cashFlowBuckets.map(b => Number(b.cashIn) || 0), 1);
    const maxOut = Math.max(...cashFlowBuckets.map(b => Number(b.cashOut) || 0), 1);
    const maxAxis = Math.max(maxIn, maxOut);

    chart.innerHTML = `
        <div class="cash-flow-stage" data-cashflow-stage>
            <div class="cash-flow-axis">
                <div><span>${formatCompactIDR(maxAxis)}</span></div>
                <div><span>${formatCompactIDR(maxAxis / 2)}</span></div>
                <div><span>Rp 0</span></div>
                <div><span>-${formatCompactIDR(maxAxis / 2)}</span></div>
                <div><span>-${formatCompactIDR(maxAxis)}</span></div>
            </div>
            <div class="cash-flow-plot">
                <div class="cash-flow-zero-line"></div>
                <div class="cash-flow-bars">
                    ${cashFlowBuckets.map(item => {
                        const inHeight = (Number(item.cashIn) || 0) / maxAxis * 50;
                        const outHeight = (Number(item.cashOut) || 0) / maxAxis * 50;
                        const net = Number(item.netCashFlow) || 0;
                        const netSide = net >= 0 ? 'pos' : 'neg';
                        const netHeight = Math.abs(net) / maxAxis * 50;
                        return `
                            <div class="cash-flow-month" data-chart-bar
                                data-label="${escapeHtml(item.label)}"
                                data-cash-in="${item.cashIn}"
                                data-cash-out="${item.cashOut}"
                                data-net="${item.netCashFlow}">
                                <span class="cash-bar cash-bar-in" style="height:${inHeight}%"></span>
                                <span class="cash-bar cash-bar-out" style="height:${outHeight}%"></span>
                                <span class="cash-bar cash-bar-net cash-bar-net-${netSide}" style="height:${netHeight}%"></span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
        <div class="cash-flow-labels">
            ${cashFlowBuckets.map(item => `<span>${escapeHtml(item.label)}</span>`).join('')}
        </div>
    `;

    const stage = chart.querySelector('[data-cashflow-stage]');
    if (stage && window.attachChartHover) {
        window.attachChartHover(stage, {
            bars: '[data-chart-bar]',
            orientation: 'vertical',
            buildTooltip: barEl => `
                <div class="chart-tooltip-header">${escapeHtml(barEl.dataset.label)}</div>
                <div class="chart-tooltip-row">
                    <span class="chart-tooltip-swatch" style="background:#d9efdf"></span>
                    <span class="chart-tooltip-label">Cash In</span>
                    <span class="chart-tooltip-value">${formatIDR(Number(barEl.dataset.cashIn || 0))}</span>
                </div>
                <div class="chart-tooltip-row">
                    <span class="chart-tooltip-swatch" style="background:#7f9278"></span>
                    <span class="chart-tooltip-label">Cash Out</span>
                    <span class="chart-tooltip-value">${formatIDR(Number(barEl.dataset.cashOut || 0))}</span>
                </div>
                <div class="chart-tooltip-row">
                    <span class="chart-tooltip-swatch" style="background:#84ef52"></span>
                    <span class="chart-tooltip-label">Net</span>
                    <span class="chart-tooltip-value">${formatSignedIDR(Number(barEl.dataset.net || 0))}</span>
                </div>
            `
        });
    }
}

function buildAttentionCache(overview) {
    const items = buildAttentionItems(overview);
    const needsReview = items.filter(item => ['overdue', 'missing_receipt'].includes(item.kind));
    attentionItemsCache = {
        all: items,
        needs_review: needsReview,
        my_records: []
    };
    updateKPI('attention-total-count', String(items.length));
    updateKPI('attention-needs-review-count', String(needsReview.length));
}

function buildAttentionItems(overview) {
    const p = overview.performance || {};
    const actions = overview.actionItems || {};
    const items = [];
    if (actions.overdueBills) {
        items.push({
            kind: 'overdue',
            iconKind: 'danger',
            icon: '!',
            title: `${actions.overdueBills} overdue bill${actions.overdueBills === 1 ? '' : 's'}`,
            description: 'Overdue obligations can create vendor and cash pressure.',
            action: 'Open Bills',
            href: '/bill'
        });
    }
    if (actions.missingReceipts) {
        items.push({
            kind: 'missing_receipt',
            iconKind: 'warning',
            icon: '!',
            title: `${actions.missingReceipts} missing receipt${actions.missingReceipts === 1 ? '' : 's'}`,
            description: 'Missing receipts reduce confidence in reports and tax-ready records.',
            action: 'Open Ledger',
            href: '/ledger?search=Missing%20Receipt'
        });
    }
    if (actions.highOpexIncrease) {
        items.push({
            kind: 'opex_spike',
            iconKind: 'default',
            icon: '^',
            title: `OpEx up ${Math.abs(Number(p.opexChangePct)).toFixed(1)}%`,
            description: 'Spending rose meaningfully against the previous period.',
            action: 'Review Ledger',
            href: '/ledger'
        });
    }
    if (actions.billsDueSoon) {
        items.push({
            kind: 'bill_due_soon',
            iconKind: 'default',
            icon: 'Due',
            title: `${actions.billsDueSoon} bill${actions.billsDueSoon === 1 ? '' : 's'} due soon`,
            description: 'Upcoming bills should be checked before new spend is approved.',
            action: 'Open Bills',
            href: '/bill'
        });
    }
    if (actions.renewalsSoon) {
        items.push({
            kind: 'renewal',
            iconKind: 'default',
            icon: 'R',
            title: `${actions.renewalsSoon} renewal${actions.renewalsSoon === 1 ? '' : 's'} soon`,
            description: 'Subscription renewals may affect recurring spend.',
            action: 'Open Subscriptions',
            href: '/subscription'
        });
    }
    return items;
}

function renderAttentionQueue() {
    if (currentAttentionTab === 'my_records') {
        setHtml('needs-attention-content', '<div class="overview-empty-copy">Filter by record owner is not yet available.</div>');
        return;
    }
    const items = attentionItemsCache[currentAttentionTab] || [];
    if (!items.length) {
        setHtml('needs-attention-content', '<div class="overview-empty-copy">No items require attention.</div>');
        return;
    }
    setHtml('needs-attention-content', `
        <div class="queue-list">
            ${items.slice(0, 5).map(item => `
                <a class="queue-row" href="${item.href}">
                    <div class="queue-icon queue-icon-${item.iconKind}">${escapeHtml(item.icon)}</div>
                    <div class="queue-row-body">
                        <div class="queue-row-title">${escapeHtml(item.title)}</div>
                        <div class="queue-row-meta">${escapeHtml(item.description)}</div>
                    </div>
                    <span class="queue-row-arrow" aria-hidden="true">&rarr;</span>
                </a>
            `).join('')}
        </div>
    `);
}

function renderAiBusinessSummary(overview) {
    const insights = overview.insights || {};
    updateKPI('ai-summary-period', overview.period?.label || 'Selected period');
    setHtml('ai-business-summary-content', `
        <div class="brain-message">
            ${escapeHtml(insights.summary || 'Not enough data for a grounded summary yet.')}
        </div>
        <div class="brain-block">
            <div class="brain-block-label">Main risk</div>
            <div class="brain-block-copy">${escapeHtml(insights.mainRisk || 'No urgent finance risk detected from available records.')}</div>
        </div>
        <div class="brain-block">
            <div class="brain-block-label">Recommended action</div>
            <div class="brain-block-copy">${escapeHtml(insights.recommendedAction || 'Keep reviewing new records as they come in.')}</div>
        </div>
        ${(insights.limitations || []).length ? `<p class="overview-limitation">${escapeHtml(insights.limitations[0])}</p>` : ''}
    `);
}

function renderPayablesByCategory(overview) {
    const items = overview.payablesByCategory || [];
    if (!items.length) {
        setHtml('payables-by-category-content', '<div class="overview-empty-copy">No upcoming payables in this period.</div>');
        return;
    }
    const total = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    setHtml('payables-by-category-content', `
        <div class="rail-list">
            ${items.map(item => `
                <div class="rail-item">
                    <div class="rail-row">
                        <span class="rail-name">${escapeHtml(item.category)}</span>
                        <span class="rail-amount">${formatIDR(item.amount)}</span>
                    </div>
                    <div class="rail-bar"><span style="width:${Math.max(8, Number(item.percentage) || 0)}%"></span></div>
                </div>
            `).join('')}
        </div>
        <div class="rail-footer">
            <span class="rail-footer-total">Total ${formatIDR(total)}</span>
            <a class="rail-footer-link" href="/bill">View all &rarr;</a>
        </div>
    `);
}

function renderUpcomingObligations(overview) {
    const bills = overview.upcoming?.bills || [];
    const subscriptions = overview.upcoming?.subscriptions || [];
    const rows = [
        ...bills.map(bill => ({ type: 'Bill', href: '/bill', dateField: 'due_date', record: bill })),
        ...subscriptions.map(sub => ({ type: 'Renewal', href: '/subscription', dateField: 'renewal_date', record: sub }))
    ].slice(0, 3);

    if (!rows.length) {
        setHtml('upcoming-obligations-content', '<div class="overview-empty-copy">No upcoming bills or renewals.</div>');
        return;
    }

    setHtml('upcoming-obligations-content', `
        <div class="rail-mini-list">
            ${rows.map(row => `
                <a class="rail-mini-card" href="${row.href}">
                    <div class="rail-mini-body">
                        <div class="rail-mini-title">${escapeHtml(row.record.vendor_name || row.record.name || 'Untitled record')}</div>
                        <div class="rail-mini-sub">${escapeHtml(row.type)} &middot; ${escapeHtml(formatRecordDate(row.record, row.dateField) || 'No date')} &middot; ${formatIDR(row.record.amount)}</div>
                    </div>
                    <span class="rail-mini-arrow" aria-hidden="true">&rsaquo;</span>
                </a>
            `).join('')}
        </div>
        <div class="rail-footer">
            <a class="rail-footer-link" href="/bill">View all &rarr;</a>
        </div>
    `);
}

function renderReportReadiness(overview) {
    const r = overview.reportReadiness || { status: 'Loading', missingReceipts: 0, overdueBills: 0, dataWarnings: [] };
    const status = r.status || 'Loading';
    const badge = document.getElementById('report-readiness-status');
    if (badge) {
        badge.textContent = status;
        const tone = status === 'Ready' ? 'is-ready' : (status === 'Needs review' ? 'is-warning' : (status === 'Not ready' ? 'is-danger' : ''));
        badge.className = `status-badge ${tone}`;
    }
    const dataWarningLabel = (r.dataWarnings && r.dataWarnings[0]) || 'None';
    setHtml('report-readiness-content', `
        <div class="readiness-rows">
            <div class="readiness-row"><span>Missing receipts</span><strong>${Number(r.missingReceipts) || 0}</strong></div>
            <div class="readiness-row"><span>Overdue bills</span><strong>${Number(r.overdueBills) || 0}</strong></div>
            <div class="readiness-row"><span>Data warning</span><strong>${escapeHtml(dataWarningLabel)}</strong></div>
        </div>
    `);
}

function updateKPI(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function setHtml(id, html) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('overview-card-loading', 'overview-empty-copy');
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
    const n = Math.abs(Number(value) || 0);
    if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}K`;
    return `Rp ${Math.round(n)}`;
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

function formatRecordDate(record, fieldName) {
    const date = getRecordDate(record, fieldName);
    return date ? date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

document.addEventListener('click', event => {
    if (event.target.closest('[data-ask-fluxy-summary]') || event.target.closest('[data-ask-fluxy]')) {
        window.toggleFluxyAI?.();
    }
});

mountDashboardPeriodControls();

// Auth state is handled by the page-level script in dashboard.html.
// Do not add another onAuthStateChanged here; it causes loadDashboard() to run twice.
