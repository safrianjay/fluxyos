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
let currentBudget = { monthly: 0, used: 0, usedPct: 0, remaining: 0 };
let dashboardPeriodMode = 'this_month';
let dashboardRangeStart = getMonthStartKey();
let dashboardRangeEnd = getMonthEndKey();
let dashboardDatePicker = null;
let attentionItemsCache = { all: [], needs_review: [], my_records: [] };
let currentAttentionTab = 'all';
let aiSummaryRequestSeq = 0;
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

        currentBudget = overview.budget || { monthly: 0, used: 0, usedPct: 0, remaining: 0 };
        cashflowBuckets = buildCashflowBuckets(
            overview.chartTransactions || [],
            dashboardRangeStart,
            dashboardRangeEnd,
            currentBudget
        );
        cashFlowBuckets = overview.cashFlow || [];
        updateBudgetCaption();

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
    updateKPI('kpi-bank-cash', 'Rp 0');
    updateKPI('kpi-payables', 'Rp 0');
    updateKPI('kpi-revenue-change', 'Loading...');
    updateKPI('kpi-opex-change', 'Loading...');
    updateKPI('kpi-margin-status', 'Loading...');
    updateKPI('kpi-cash-pressure-sub', 'Loading...');
    updateKPI('kpi-bank-cash-sub', 'Loading...');
    updateKPI('kpi-bank-cash-outlook', 'Rp 0');
    updateKPI('kpi-bank-cash-coverage', 'Not available');
    updateKPI('kpi-opex-budget-used', '0%');
    updateKPI('kpi-opex-budget-total', 'Rp 0');
    updateKPI('kpi-payables-sub', 'Loading...');
    setBudgetBar(0);
    setPressureMeter(0, 'low');
    setHtml('needs-attention-content', '<div class="overview-card-loading">Loading action items...</div>');
    setHtml('payables-by-category-content', '<div class="overview-card-loading">Loading payables...</div>');
    setHtml('upcoming-obligations-content', '<div class="overview-card-loading">Loading upcoming obligations...</div>');
    setHtml('report-readiness-content', '<div class="overview-card-loading">Loading report readiness...</div>');
    setHtml('ai-business-summary-content', getAiBusinessSummaryLoadingHtml());
    aiSummaryRequestSeq += 1;
    updateKPI('attention-total-count', '0');
    updateKPI('attention-needs-review-count', '0');
    clearMetricSparklines();
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
    updateKPI('kpi-bank-cash', 'Rp 0');
    updateKPI('kpi-payables', 'Rp 0');
    updateKPI('kpi-revenue-change', 'No data');
    updateKPI('kpi-opex-change', 'Budget not set');
    updateKPI('kpi-margin-status', 'No revenue data');
    updateKPI('kpi-cash-pressure-sub', 'No data');
    updateKPI('kpi-bank-cash-sub', 'No bank data connected');
    updateKPI('kpi-bank-cash-outlook', 'Rp 0');
    updateKPI('kpi-bank-cash-coverage', 'Not available');
    updateKPI('kpi-opex-budget-used', '0%');
    updateKPI('kpi-opex-budget-total', 'Rp 0');
    updateKPI('kpi-payables-sub', 'No records found');
    setBudgetBar(0);
    setPressureMeter(0, 'low');
    const errorHtml = '<div class="overview-empty-copy">Overview data could not be loaded. Please refresh and try again.</div>';
    setHtml('needs-attention-content', errorHtml);
    setHtml('payables-by-category-content', errorHtml);
    setHtml('upcoming-obligations-content', errorHtml);
    setHtml('report-readiness-content', errorHtml);
    setHtml('ai-business-summary-content', errorHtml);
    clearMetricSparklines();
    const status = document.getElementById('report-readiness-status');
    if (status) {
        status.textContent = 'Unavailable';
        status.className = 'status-badge';
    }
}

function renderSummaryBoard(overview) {
    const p = overview.performance || {};
    const rp = overview.receivablesPayables || {};
    const actions = overview.actionItems || {};
    const margin = safeNumber(p.grossMargin);

    updateKPI('kpi-revenue', formatIDR(p.revenue));
    updateKPI('kpi-margin', `${formatNumber(margin, 1)}%`);
    updateKPI('kpi-payables', formatIDR(rp.payablesTotal));

    renderKpiComparison('kpi-revenue-change', p.revenueChangePct, 'revenue');
    renderMarginStatus(margin, p.marginChangePct);
    renderMetricArrow('kpi-revenue-arrow', p.revenueChangePct, 'revenue');
    renderMetricArrow('kpi-margin-arrow', p.marginChangePct, 'revenue');

    renderPayablesSub(rp, actions);

    const bar = document.getElementById('kpi-margin-bar');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, margin))}%`;

    renderMetricSparkline(
        'kpi-revenue-sparkline',
        cashflowBuckets.map(bucket => Number(bucket.revenue) || 0),
        'revenue'
    );

    renderBankCashCell(overview.bankCash || {}, rp);
    renderOpexBudgetCell(p, currentBudget);
    renderCashPressureCell(overview.cashPressure || {});
}

function renderBankCashCell(bankCash, rp) {
    const balance = safeNumber(bankCash.balance);
    const accountsSynced = safeNumber(bankCash.accountsSynced);
    const thirtyDayOutlook = safeNumber(bankCash.thirtyDayOutlook);
    const payablesTotal = safeNumber(rp.payablesTotal);

    updateKPI('kpi-bank-cash', formatIDR(balance));
    const sub = document.getElementById('kpi-bank-cash-sub');
    if (sub) {
        if (accountsSynced > 0) {
            sub.textContent = `${accountsSynced} bank account${accountsSynced === 1 ? '' : 's'} synced`;
            sub.className = 'metric-sub is-good';
        } else {
            sub.textContent = 'No bank data connected';
            sub.className = 'metric-sub';
        }
    }
    updateKPI('kpi-bank-cash-outlook', formatSignedIDR(thirtyDayOutlook));

    const coverageEl = document.getElementById('kpi-bank-cash-coverage');
    if (coverageEl) {
        if (balance > 0 && payablesTotal > 0) {
            coverageEl.textContent = `${(balance / payablesTotal).toFixed(1)}x payables`;
        } else {
            coverageEl.textContent = 'Not available';
        }
    }
}

function renderOpexBudgetCell(performance, budget) {
    const opex = safeNumber(performance.opex);
    const monthly = safeNumber(budget.monthly);
    const usedPct = safeNumber(budget.usedPct);
    const remaining = safeNumber(budget.remaining);

    updateKPI('kpi-opex', formatIDR(opex));

    const sub = document.getElementById('kpi-opex-change');
    if (sub) {
        if (monthly > 0) {
            sub.textContent = `${formatIDR(remaining)} remaining`;
            sub.className = usedPct > 100 ? 'metric-sub is-bad' : (usedPct > 70 ? 'metric-sub is-warn' : 'metric-sub is-good');
        } else {
            sub.textContent = 'Budget not set';
            sub.className = 'metric-sub';
        }
    }

    updateKPI('kpi-opex-budget-used', monthly > 0 ? `${usedPct.toFixed(1)}%` : '0%');
    updateKPI('kpi-opex-budget-total', monthly > 0 ? formatIDR(monthly) : 'Rp 0');
    setBudgetBar(monthly > 0 ? usedPct : 0);
}

function setBudgetBar(usedPct) {
    const bar = document.getElementById('kpi-opex-budget-bar');
    if (!bar) return;
    const clamped = Math.max(0, Math.min(100, safeNumber(usedPct)));
    bar.style.width = `${clamped}%`;
    bar.className = `metric-progress-fill ${usedPct > 100 ? 'is-bad' : (usedPct > 70 ? 'is-warn' : 'is-good')}`;
}

function renderCashPressureCell(cashPressure) {
    const outlook = safeNumber(cashPressure.outlook);
    const risk = String(cashPressure.riskLevel || 'low');
    const payablesDueSoon = safeNumber(cashPressure.payablesDueSoon);

    updateKPI('kpi-cash-pressure', formatSignedIDR(outlook));

    const sub = document.getElementById('kpi-cash-pressure-sub');
    if (sub) {
        const labels = { critical: 'Critical', high: 'High pressure', watch: 'Watch', low: 'Low pressure' };
        sub.textContent = labels[risk] || 'Low pressure';
        const tone = risk === 'critical' || risk === 'high' ? 'is-bad' : (risk === 'watch' ? 'is-warn' : 'is-good');
        sub.className = `metric-sub ${tone}`;
    }

    let meterPct = 0;
    if (risk === 'critical') meterPct = 100;
    else if (risk === 'high') meterPct = 85;
    else if (risk === 'watch') meterPct = 55;
    else if (payablesDueSoon > 0 && outlook < payablesDueSoon * 2) meterPct = 25;
    setPressureMeter(meterPct, risk);
}

function setPressureMeter(pct, risk) {
    const meter = document.getElementById('kpi-cash-pressure-meter');
    if (!meter) return;
    const clamped = Math.max(0, Math.min(100, safeNumber(pct)));
    meter.style.width = `${clamped}%`;
    const tone = risk === 'critical' || risk === 'high' ? 'is-bad' : (risk === 'watch' ? 'is-warn' : 'is-good');
    meter.className = `metric-pressure-fill ${tone}`;
}

function renderPayablesSub(rp, actions) {
    const sub = document.getElementById('kpi-payables-sub');
    if (!sub) return;
    const overdue = Number(actions.overdueBills || 0);
    const count = Number(rp.payableCount || 0);
    if (overdue > 0) {
        sub.textContent = `${overdue} overdue bill${overdue === 1 ? '' : 's'}`;
        sub.className = 'metric-sub is-bad';
    } else if (count === 0) {
        sub.textContent = 'No records expected out.';
        sub.className = 'metric-sub';
    } else {
        sub.textContent = `${count} record${count === 1 ? '' : 's'} expected out.`;
        sub.className = 'metric-sub';
    }
}

function updateBudgetCaption() {
    const caption = document.getElementById('cashflow-budget-caption');
    if (!caption) return;
    const monthly = safeNumber(currentBudget.monthly);
    const usedPct = safeNumber(currentBudget.usedPct);
    caption.textContent = monthly > 0 ? `(${usedPct.toFixed(0)}% this period)` : '(Budget not set)';
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
        : `${Math.abs(value).toFixed(1)}% vs previous period`;
    el.className = `metric-sub ${direction === 'Flat' ? 'is-neutral' : (isGood ? 'is-good' : 'is-bad')}`;
}

function renderMarginStatus(margin, marginChange) {
    const label = margin <= 0
        ? (margin === 0 ? 'No revenue data' : 'Negative')
        : (margin >= 50 ? 'Healthy' : (margin >= 20 ? 'Tight' : 'Negative'));
    const suffix = marginChange === null || marginChange === undefined || !Number.isFinite(Number(marginChange))
        ? ' - No previous period data'
        : ` - ${Number(marginChange) >= 0 ? '↑' : '↓'} ${Math.abs(Number(marginChange)).toFixed(1)} pts`;
    updateKPI('kpi-margin-status', `${label}${suffix}`);
}

function renderMetricArrow(id, change, type) {
    const el = document.getElementById(id);
    if (!el) return;
    if (change === null || change === undefined || !Number.isFinite(Number(change))) {
        el.textContent = '';
        el.removeAttribute('aria-label');
        el.className = 'metric-arrow';
        return;
    }
    const value = Number(change);
    if (Math.abs(value) < 0.1) {
        el.textContent = '';
        el.removeAttribute('aria-label');
        el.className = 'metric-arrow';
        return;
    }
    const isUp = value > 0;
    const isGood = type === 'opex' ? !isUp : isUp;
    el.textContent = isUp ? '↑' : '↓';
    el.setAttribute('aria-label', isUp ? 'Trend up' : 'Trend down');
    el.className = `metric-arrow ${isGood ? 'is-good' : 'is-bad'}`;
}

function renderMetricSparkline(id, values, tone = 'revenue') {
    const svg = document.getElementById(id);
    if (!svg) return;
    const series = Array.isArray(values)
        ? values.map(value => Number(value) || 0)
        : [];
    if (series.length === 0) {
        svg.innerHTML = '';
        return;
    }
    const width = 300;
    const height = 72;
    const paddingX = 3;
    const paddingY = 7;
    const minVal = tone === 'pressure' ? Math.min(...series, 0) : 0;
    const maxVal = Math.max(...series, 0);
    const range = (maxVal - minVal) || 1;
    const stepX = series.length > 1 ? (width - paddingX * 2) / (series.length - 1) : 0;
    const toY = (val) => height - paddingY - ((val - minVal) / range) * (height - paddingY * 2);
    const points = series.map((val, i) => ({
        x: paddingX + i * stepX,
        y: toY(val)
    }));
    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const lastValue = series[series.length - 1];
    const palette = {
        revenue: { stroke: '#22C55E', fill: 'rgba(34,197,94,0.12)' },
        pressure: lastValue < 0
            ? { stroke: '#EF4444', fill: 'rgba(239,68,68,0.12)' }
            : { stroke: '#22C55E', fill: 'rgba(34,197,94,0.12)' },
        opex: { stroke: '#9CA3AF', fill: 'rgba(156,163,175,0.14)' }
    };
    const colors = palette[tone] || palette.revenue;
    const areaPath = points.length
        ? `M${points[0].x.toFixed(1)},${height - paddingY} ${linePath.replace('M', 'L')} L${points[points.length - 1].x.toFixed(1)},${height - paddingY} Z`
        : '';
    svg.innerHTML = `
        <path d="${areaPath}" fill="${colors.fill}" stroke="none"></path>
        <path d="${linePath}" fill="none" stroke="${colors.stroke}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path>
    `;
}

function clearMetricSparklines() {
    const svg = document.getElementById('kpi-revenue-sparkline');
    if (svg) svg.innerHTML = '';
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
                    <span class="chart-tooltip-swatch" style="background:#16A34A"></span>
                    <span class="chart-tooltip-label">Cash In</span>
                    <span class="chart-tooltip-value">${formatIDR(Number(barEl.dataset.cashIn || 0))}</span>
                </div>
                <div class="chart-tooltip-row">
                    <span class="chart-tooltip-swatch" style="background:#EF4444"></span>
                    <span class="chart-tooltip-label">Cash Out</span>
                    <span class="chart-tooltip-value">${formatIDR(Number(barEl.dataset.cashOut || 0))}</span>
                </div>
                <div class="chart-tooltip-row">
                    <span class="chart-tooltip-swatch" style="background:#111827"></span>
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

const ATTENTION_ICONS = {
    overdue: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2.5 1.75 16.5h16.5L10 2.5Z"/><path d="M10 8v3.5"/><path d="M10 14.25h.01"/></svg>',
    missing_receipt: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 2.5h7.5L15.5 5.5V17a.5.5 0 0 1-.78.42l-1.47-.97-1.5 1-1.5-1-1.5 1-1.5-1-1.47.97A.5.5 0 0 1 5 17V2.5Z"/><path d="M8 8h4"/><path d="M8 11h2.5"/></svg>',
    opex_spike: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 13.5 7 9l3 3 5-5.5"/><path d="M11.5 6.5h4v4"/></svg>',
    bill_due_soon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.75" y="4" width="14.5" height="13" rx="2"/><path d="M2.75 8h14.5"/><path d="M6.5 2.5v3"/><path d="M13.5 2.5v3"/><path d="M10 11v2l1.5 1"/></svg>',
    renewal: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 10a6.5 6.5 0 0 1 11.1-4.6l1.9 1.9"/><path d="M16.5 3.5v4h-4"/><path d="M16.5 10a6.5 6.5 0 0 1-11.1 4.6L3.5 12.7"/><path d="M3.5 16.5v-4h4"/></svg>'
};

function buildAttentionItems(overview) {
    const p = overview.performance || {};
    const actions = overview.actionItems || {};
    const items = [];
    if (actions.overdueBills) {
        items.push({
            kind: 'overdue',
            iconKind: 'danger',
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
                    <div class="queue-icon queue-icon-${item.iconKind}">${ATTENTION_ICONS[item.kind] || ''}</div>
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

async function renderAiBusinessSummary(overview) {
    const requestSeq = ++aiSummaryRequestSeq;
    const periodStart = overview.period?.startDate || dashboardRangeStart;
    const periodEnd = overview.period?.endDate || dashboardRangeEnd;
    updateKPI('ai-summary-period', overview.period?.label || 'Selected period');
    setHtml('ai-business-summary-content', getAiBusinessSummaryLoadingHtml());

    try {
        const user = auth.currentUser;
        if (!user) throw new Error('No signed-in user available for AI summary.');
        const token = await user.getIdToken();
        const response = await fetch('/api/v1/brain/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
                message: 'Summarize what happened in my business finance for this selected period. Focus on revenue, OpEx, gross margin, cash pressure, overdue bills, receivables, payables, data quality, and what I should do first.',
                page_context: 'overview_summary',
                period: {
                    type: 'custom',
                    start_date: periodStart,
                    end_date: periodEnd,
                },
                finance_snapshot: buildAiBusinessSummarySnapshot(overview),
            }),
        });
        const data = await response.json().catch(() => ({}));
        if (requestSeq !== aiSummaryRequestSeq) return;
        if (!response.ok || data.success === false || !data.answer) {
            throw new Error(data?.error?.message || data?.message || 'AI summary unavailable.');
        }
        renderAiBusinessSummaryAnswer(data.answer, overview);
    } catch (error) {
        if (requestSeq !== aiSummaryRequestSeq) return;
        renderAiBusinessSummaryFallback(overview);
    }
}

function getAiBusinessSummaryLoadingHtml() {
    return `
        <div class="brain-loading" role="status" aria-label="Fluxy AI is analyzing this period">
            <span class="brain-loading-icon" aria-hidden="true">
                <span class="brain-loading-core"></span>
                <span class="brain-loading-ring"></span>
                <span class="brain-loading-ring brain-loading-ring-alt"></span>
                <span class="brain-loading-node brain-loading-node-one"></span>
                <span class="brain-loading-node brain-loading-node-two"></span>
                <span class="brain-loading-node brain-loading-node-three"></span>
                <span class="brain-loading-scan"></span>
            </span>
        </div>
    `;
}

function buildAiBusinessSummarySnapshot(overview = {}) {
    const sourceStatus = overview.sourceStatus || {};
    const transactions = normalizeAiBusinessSummarySnapshotRecords(
        overview.aiSnapshot?.transactions || overview.chartTransactions || [],
        1000
    );
    const bills = normalizeAiBusinessSummarySnapshotRecords(
        overview.aiSnapshot?.bills || overview.upcoming?.bills || [],
        500
    );
    const subscriptions = normalizeAiBusinessSummarySnapshotRecords(
        overview.aiSnapshot?.subscriptions || overview.upcoming?.subscriptions || [],
        500
    );
    return {
        transactions,
        bills,
        subscriptions,
        meta: {
            source: 'dashboard_overview_client_snapshot',
            generated_at: new Date().toISOString(),
            counts: {
                transactions: transactions.length,
                bills: bills.length,
                subscriptions: subscriptions.length,
            },
            reads: {
                transactions: buildAiBusinessSummarySnapshotRead(sourceStatus.transactions),
                bills: buildAiBusinessSummarySnapshotRead(sourceStatus.bills),
                subscriptions: buildAiBusinessSummarySnapshotRead(sourceStatus.subscriptions),
            },
        },
    };
}

function buildAiBusinessSummarySnapshotRead(status) {
    if (status === 'error') return { success: false, error: 'read_failed' };
    return { success: true, error: null };
}

function normalizeAiBusinessSummarySnapshotRecords(records = [], limit = 1000) {
    return records.slice(0, limit).map(record => ({
        id: String(record.id || ''),
        vendor_name: String(record.vendor_name || record.name || record.label || 'Unnamed record'),
        name: record.name ? String(record.name) : undefined,
        category: String(record.category || 'Uncategorized'),
        type: String(record.type || 'unknown'),
        status: String(record.status || 'Unknown'),
        amount: Number(record.amount) || 0,
        timestamp: serializeAiBusinessSummarySnapshotDate(record.timestamp),
        due_date: serializeAiBusinessSummarySnapshotDate(record.due_date),
        renewal_date: serializeAiBusinessSummarySnapshotDate(record.renewal_date),
    }));
}

function serializeAiBusinessSummarySnapshotDate(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (typeof value.toDate === 'function') {
        try {
            const date = value.toDate();
            return Number.isNaN(date.getTime()) ? null : date.toISOString();
        } catch {
            return null;
        }
    }
    if (Number.isFinite(value.seconds)) return new Date(value.seconds * 1000).toISOString();
    if (Number.isFinite(value._seconds)) return new Date(value._seconds * 1000).toISOString();
    return null;
}

function renderAiBusinessSummaryFallback(overview) {
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

function renderAiBusinessSummaryAnswer(answer, overview) {
    updateKPI('ai-summary-period', answer.period?.label || overview.period?.label || 'Selected period');
    const risk = pickAiInsight(answer.insights || []);
    const actionItem = pickAiAction(answer.recommended_actions || []);
    const limitation = (answer.limitations || []).find(item => typeof item === 'string' && item.trim());
    setHtml('ai-business-summary-content', `
        <div class="brain-message">
            ${escapeHtml(answer.direct_answer || 'Not enough data for a grounded summary yet.')}
        </div>
        <div class="brain-block">
            <div class="brain-block-label">Main risk</div>
            <div class="brain-block-copy">${escapeHtml(risk?.description || risk?.title || 'No urgent finance risk detected from available records.')}</div>
        </div>
        <div class="brain-block">
            <div class="brain-block-label">Recommended action</div>
            <div class="brain-block-copy">${escapeHtml(actionItem ? `${actionItem.title}: ${actionItem.description}` : 'Keep reviewing new records as they come in.')}</div>
        </div>
        ${limitation ? `<p class="overview-limitation">${escapeHtml(limitation)}</p>` : ''}
    `);
}

function pickAiInsight(insights = []) {
    const severityRank = { critical: 3, warning: 2, info: 1 };
    return [...insights]
        .filter(item => item && (item.title || item.description))
        .sort((a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0))[0] || null;
}

function pickAiAction(actions = []) {
    const priorityRank = { high: 3, medium: 2, low: 1 };
    return [...actions]
        .filter(item => item && (item.title || item.description))
        .sort((a, b) => (priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0))[0] || null;
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

function buildCashflowBuckets(txs, startKey, endKey, budget = { monthly: 0 }) {
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
            buckets.push({ start: bucketStart, end: bucketEnd, label: formatBucketLabel(bucketStart, bucketEnd, bucketType), revenue: 0, spend: 0, budgetUsedPct: 0 });
            const next = parseDayKey(cursor);
            next.setMonth(next.getMonth() + 1);
            cursor = getMonthStartKey(next);
        }
    } else {
        let cursor = startKey;
        while (cursor <= endKey) {
            const bucketEnd = addDays(cursor, bucketStep - 1) > endKey ? endKey : addDays(cursor, bucketStep - 1);
            buckets.push({ start: cursor, end: bucketEnd, label: formatBucketLabel(cursor, bucketEnd, bucketType), revenue: 0, spend: 0, budgetUsedPct: 0 });
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

    const monthlyBudget = safeNumber(budget?.monthly);
    if (monthlyBudget > 0) {
        const periodDays = rangeDays;
        buckets.forEach(bucket => {
            const bucketDays = getRangeDays(bucket.start, bucket.end);
            const bucketBudget = monthlyBudget * (bucketDays / Math.max(periodDays, 1));
            bucket.budgetUsedPct = bucketBudget > 0
                ? Math.min((bucket.spend / bucketBudget) * 100, 150)
                : 0;
        });
    }

    if (!buckets.length) {
        buckets.push({ start: startKey, end: endKey, label: formatBucketLabel(startKey, endKey, 'day'), revenue: 0, spend: 0, budgetUsedPct: 0 });
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
                        <div class="cashflow-bar-group" data-chart-bar data-label="${escapeHtml(item.label)}" data-revenue="${item.revenue}" data-spend="${item.spend}" data-budget-used="${safeNumber(item.budgetUsedPct)}">
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
    const budgetUsedValues = cashflowBuckets.map(item => Math.min(safeNumber(item.budgetUsedPct), 100));
    const maxValue = Math.max(...revenueValues, ...spendValues, 1);
    const revenuePoints = buildLinePoints(revenueValues, maxValue, width, height, paddingX, paddingY);
    const spendPoints = buildLinePoints(spendValues, maxValue, width, height, paddingX, paddingY);
    const budgetPoints = currentBudget.monthly > 0
        ? buildLinePoints(budgetUsedValues, 100, width, height, paddingX, paddingY)
        : [];
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
                ${budgetPoints.length ? `<polyline class="cashflow-line cashflow-line-budget" points="${toPolyline(budgetPoints)}"></polyline>` : ''}
                ${revenuePoints.map(point => `<circle class="cashflow-point cashflow-point-revenue" cx="${point.x}" cy="${point.y}" r="4"></circle>`).join('')}
                ${spendPoints.map(point => `<circle class="cashflow-point cashflow-point-spend" cx="${point.x}" cy="${point.y}" r="4"></circle>`).join('')}
            </svg>
            <div class="cashflow-line-hover-zones">
                ${cashflowBuckets.map((item, index) => `
                    <div class="cashflow-line-hover-zone" data-chart-bar data-label="${escapeHtml(item.label)}" data-revenue="${item.revenue}" data-spend="${item.spend}" data-budget-used="${safeNumber(item.budgetUsedPct)}" style="left:${(index / Math.max(cashflowBuckets.length - 1, 1)) * 100}%"></div>
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
        buildTooltip: barEl => {
            const budgetUsed = Number(barEl.dataset.budgetUsed || 0);
            const budgetRow = currentBudget.monthly > 0
                ? `<div class="chart-tooltip-row">
                       <span class="chart-tooltip-swatch" style="background:#F97316"></span>
                       <span class="chart-tooltip-label">Budget used</span>
                       <span class="chart-tooltip-value">${budgetUsed.toFixed(0)}%</span>
                   </div>`
                : '';
            return `
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
                ${budgetRow}
            `;
        }
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

function mountMetricInfoTooltips() {
    const buttons = document.querySelectorAll('.metric-info[data-tooltip]');
    if (!buttons.length) return;

    let tooltip = document.querySelector('.metric-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'metric-tooltip';
        tooltip.setAttribute('role', 'tooltip');
        document.body.appendChild(tooltip);
    }

    const hideTooltip = () => {
        tooltip.classList.remove('is-visible');
    };

    const showTooltip = (button) => {
        const copy = button.dataset.tooltip || '';
        if (!copy) return;
        tooltip.textContent = copy;
        tooltip.classList.add('is-visible');

        const buttonBox = button.getBoundingClientRect();
        const tooltipBox = tooltip.getBoundingClientRect();
        const margin = 12;
        const preferredLeft = buttonBox.left + buttonBox.width / 2 - tooltipBox.width / 2;
        const left = Math.max(margin, Math.min(preferredLeft, window.innerWidth - tooltipBox.width - margin));
        let top = buttonBox.bottom + 8;
        if (top + tooltipBox.height > window.innerHeight - margin) {
            top = Math.max(margin, buttonBox.top - tooltipBox.height - 8);
        }
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    };

    buttons.forEach(button => {
        button.addEventListener('mouseenter', () => showTooltip(button));
        button.addEventListener('focus', () => showTooltip(button));
        button.addEventListener('mouseleave', hideTooltip);
        button.addEventListener('blur', hideTooltip);
    });

    window.addEventListener('scroll', hideTooltip, true);
    window.addEventListener('resize', hideTooltip);
}

mountMetricInfoTooltips();
mountDashboardPeriodControls();

// Auth state is handled by the page-level script in dashboard.html.
// Do not add another onAuthStateChanged here; it causes loadDashboard() to run twice.
