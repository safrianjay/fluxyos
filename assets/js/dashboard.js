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
let revenueTransactionsCache = [];
let revenueTransactionsStatus = 'loading';
let attentionItemsCache = { all: [], needs_review: [], my_records: [] };
let currentAttentionTab = 'all';
let aiSummaryRequestSeq = 0;
let aiSummaryOverview = null;
let bankSetupDatePicker = null;
let bankSetupSelectedDate = null;
let budgetSetupDatePicker = null;
let budgetSetupSelectedDate = null;
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
        const [overviewResult, revenueResult] = await Promise.allSettled([
            ds.getDashboardOverview(user.uid, {
                startDate: dashboardRangeStart,
                endDate: dashboardRangeEnd,
                label: period.label,
                mode: dashboardPeriodMode
            }),
            ds.getRevenueTransactionsForDashboardStats(user.uid)
        ]);
        if (overviewResult.status !== 'fulfilled') throw overviewResult.reason;
        const overview = overviewResult.value;
        revenueTransactionsCache = revenueResult.status === 'fulfilled' ? revenueResult.value : [];
        revenueTransactionsStatus = revenueResult.status === 'fulfilled' ? 'loaded' : 'error';
        dashboardRangeStart = overview.period?.startDate || dashboardRangeStart;
        dashboardRangeEnd = overview.period?.endDate || dashboardRangeEnd;
        window.FluxyDashboardRange = { start: dashboardRangeStart, end: dashboardRangeEnd };

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
        renderAiBusinessSummaryIdle(overview);
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
            updateDashboardPeriodControlState();
            const period = resolveDashboardPeriod(dashboardPeriodMode);
            dashboardRangeStart = period.start;
            dashboardRangeEnd = period.end;
            if (dashboardPeriodMode !== 'all_time') {
                dashboardDatePicker?.setRange(dashboardRangeStart, dashboardRangeEnd);
            }
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
            updateDashboardPeriodControlState();
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

    updateDashboardPeriodControlState();
}

function updateDashboardPeriodControlState() {
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
    if (mode === 'all_time') {
        return {
            label: 'All time',
            start: '1970-01-01',
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
        end: getMonthEndKey(today)
    };
}

function renderOverviewLoadingState() {
    revenueTransactionsStatus = 'loading';
    updateKPI('kpi-revenue', 'Rp 0');
    updateKPI('kpi-opex', 'Rp 0');
    updateKPI('kpi-margin', '0%');
    updateKPI('kpi-cash-pressure', 'Rp 0');
    updateKPI('kpi-bank-cash', 'Rp 0');
    updateKPI('kpi-payables', 'Rp 0');
    updateKPI('kpi-revenue-change', 'Loading...');
    updateKPI('revenue-scope-label', getRevenuePeriodLabel(dashboardPeriodMode));
    updateKPI('revenue-record-count', 'Loading...');
    updateKPI('revenue-secondary-label', dashboardPeriodMode === 'all_time' ? 'This month' : 'All-time revenue');
    updateKPI('revenue-secondary-value', 'Rp 0');
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
    setHtml('ai-business-summary-content', getAiBusinessSummaryIdleHtml());
    aiSummaryOverview = null;
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
    revenueTransactionsStatus = 'error';
    updateKPI('kpi-revenue', 'Rp 0');
    updateKPI('kpi-opex', 'Rp 0');
    updateKPI('kpi-margin', '0%');
    updateKPI('kpi-cash-pressure', 'Rp 0');
    updateKPI('kpi-bank-cash', 'Rp 0');
    updateKPI('kpi-payables', 'Rp 0');
    updateKPI('kpi-revenue-change', 'No data');
    updateKPI('revenue-record-count', 'Revenue records unavailable');
    updateKPI('revenue-secondary-value', 'Unavailable');
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
    toggleKpiCta('bank-cash-cta', true);
    toggleKpiCta('opex-budget-cta', true);
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

    updateKPI('kpi-margin', `${formatNumber(margin, 1)}%`);
    updateKPI('kpi-payables', formatIDR(rp.payablesTotal));

    renderMarginStatus(margin, p.marginChangePct);
    renderMetricArrow('kpi-margin-arrow', p.marginChangePct, 'revenue');

    renderPayablesSub(rp, actions);

    const bar = document.getElementById('kpi-margin-bar');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, margin))}%`;

    renderRevenueCard();

    renderBankCashCell(overview.bankCash || {}, rp);
    renderOpexBudgetCell(p, currentBudget);
    renderCashPressureCell(overview.cashPressure || {});
}

function renderBankCashCell(bankCash, rp) {
    const balance = safeNumber(bankCash.balance);
    const accountsSynced = safeNumber(bankCash.accountsSynced);
    const thirtyDayOutlook = safeNumber(bankCash.thirtyDayOutlook);
    const payablesTotal = safeNumber(rp.payablesTotal);
    const sourceType = bankCash.sourceType || null;
    const syncedAt = bankCash.syncedAt ? new Date(bankCash.syncedAt) : null;
    const balanceHistory = Array.isArray(bankCash.balanceHistory) ? bankCash.balanceHistory : [];

    updateKPI('kpi-bank-cash', formatIDR(balance));
    const sub = document.getElementById('kpi-bank-cash-sub');
    if (sub) {
        if (accountsSynced === 0) {
            sub.textContent = 'No bank data connected';
            sub.className = 'metric-sub';
        } else if (sourceType === 'manual') {
            sub.textContent = `Manual update${syncedAt ? ' · ' + formatRelativeTimestamp(syncedAt) : ''}`;
            sub.className = 'metric-sub is-good';
        } else {
            sub.textContent = `${accountsSynced} bank account${accountsSynced === 1 ? '' : 's'} synced`;
            sub.className = 'metric-sub is-good';
        }
    }
    updateKPI('kpi-bank-cash-outlook', formatSignedIDR(thirtyDayOutlook));

    const coverageEl = document.getElementById('kpi-bank-cash-coverage');
    if (coverageEl) {
        if (balance > 0 && payablesTotal > 0) {
            const ratio = balance / payablesTotal;
            const safetyLabel = ratio >= 2 ? 'Safe' : (ratio >= 1 ? 'Watch' : 'Tight');
            coverageEl.textContent = `${safetyLabel} · ${ratio.toFixed(1)}x payables`;
        } else {
            coverageEl.textContent = 'Not available';
        }
    }

    toggleKpiCta('bank-cash-cta', accountsSynced === 0);
    const bankSparklineValues = balanceHistory.map(snapshot => safeNumber(snapshot.balance));
    if (bankSparklineValues.length === 1) bankSparklineValues.push(bankSparklineValues[0]);
    renderMetricSparkline(
        'kpi-bank-cash-sparkline',
        bankSparklineValues,
        'revenue'
    );
}

function formatRelativeTimestamp(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    const diff = Math.round((today - target) / 86400000);
    if (diff === 0) return `Today ${date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`;
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return `${diff} days ago`;
    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function toggleKpiCta(id, visible) {
    const cta = document.getElementById(id);
    if (!cta) return;
    cta.hidden = !visible;
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
            sub.textContent = `${formatIDR(remaining)} remaining this month`;
            sub.className = usedPct > 100 ? 'metric-sub is-bad' : (usedPct > 70 ? 'metric-sub is-warn' : 'metric-sub is-good');
        } else {
            sub.textContent = 'Budget not set';
            sub.className = 'metric-sub';
        }
    }

    updateKPI('kpi-opex-budget-used', monthly > 0 ? `${usedPct.toFixed(1)}%` : '0%');
    updateKPI('kpi-opex-budget-total', monthly > 0 ? formatIDR(monthly) : 'Rp 0');
    setBudgetBar(monthly > 0 ? usedPct : 0);
    toggleKpiCta('opex-budget-cta', monthly <= 0);
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
    ['kpi-revenue-sparkline', 'kpi-bank-cash-sparkline'].forEach(id => {
        const svg = document.getElementById(id);
        if (svg) svg.innerHTML = '';
    });
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
    const scaledCashFlowHeight = value => {
        const amount = Math.abs(Number(value) || 0);
        return amount > 0 ? Math.max((amount / maxAxis) * 50, 4) : 0;
    };

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
                        const inHeight = scaledCashFlowHeight(item.cashIn);
                        const outHeight = scaledCashFlowHeight(item.cashOut);
                        const net = Number(item.netCashFlow) || 0;
                        const netSide = net >= 0 ? 'pos' : 'neg';
                        const netHeight = scaledCashFlowHeight(net);
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

function renderAiBusinessSummaryIdle(overview) {
    aiSummaryOverview = overview || null;
    aiSummaryRequestSeq += 1;
    updateKPI('ai-summary-period', overview?.period?.label || 'Selected period');
    setHtml('ai-business-summary-content', getAiBusinessSummaryIdleHtml());
}

function getAiBusinessSummaryIdleHtml() {
    return `
        <button type="button" class="brain-idle" data-generate-ai-summary aria-label="Generate AI business summary for this period">
            <span class="brain-loading-icon brain-loading-icon-idle" aria-hidden="true">
                <span class="brain-loading-core"></span>
                <span class="brain-loading-ring"></span>
                <span class="brain-loading-ring brain-loading-ring-alt"></span>
                <span class="brain-loading-node brain-loading-node-one"></span>
                <span class="brain-loading-node brain-loading-node-two"></span>
                <span class="brain-loading-node brain-loading-node-three"></span>
            </span>
            <span class="brain-idle-label">Generate summary</span>
            <span class="brain-idle-hint">Click the orb to run Fluxy AI for this period</span>
        </button>
    `;
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

function isRevenueType(type) {
    return ['revenue', 'income', 'refund', 'pending_receivable'].includes(String(type || '').toLowerCase());
}

function getRevenuePeriodLabel(periodKey) {
    if (periodKey === 'last_month') return 'Last month';
    if (periodKey === 'year_to_date') return 'Year to date';
    if (periodKey === 'all_time') return 'All time';
    if (periodKey === 'custom') return formatRangeLabel(dashboardRangeStart, dashboardRangeEnd);
    return 'This month';
}

function getRevenuePeriodRange(periodKey, now = new Date()) {
    const end = new Date(now);
    if (periodKey === 'last_month') {
        return {
            start: new Date(end.getFullYear(), end.getMonth() - 1, 1, 0, 0, 0, 0),
            end: new Date(end.getFullYear(), end.getMonth(), 0, 23, 59, 59, 999)
        };
    }
    if (periodKey === 'year_to_date') {
        return {
            start: new Date(end.getFullYear(), 0, 1, 0, 0, 0, 0),
            end
        };
    }
    if (periodKey === 'all_time') return null;
    if (periodKey === 'custom') {
        const start = parseDayKey(dashboardRangeStart);
        const rangeEnd = parseDayKey(dashboardRangeEnd);
        rangeEnd.setHours(23, 59, 59, 999);
        return { start, end: rangeEnd };
    }
    return {
        start: new Date(end.getFullYear(), end.getMonth(), 1, 0, 0, 0, 0),
        end
    };
}

function getPreviousRevenuePeriodRange(periodKey, now = new Date()) {
    const current = getRevenuePeriodRange(periodKey, now);
    if (!current || periodKey === 'all_time') return null;

    const end = current.end;
    if (periodKey === 'year_to_date') {
        const previousYear = end.getFullYear() - 1;
        const maxDay = new Date(previousYear, end.getMonth() + 1, 0).getDate();
        return {
            start: new Date(previousYear, 0, 1, 0, 0, 0, 0),
            end: new Date(
                previousYear,
                end.getMonth(),
                Math.min(end.getDate(), maxDay),
                end.getHours(),
                end.getMinutes(),
                end.getSeconds(),
                end.getMilliseconds()
            )
        };
    }

    if (periodKey === 'last_month') {
        const previousEnd = new Date(current.start);
        previousEnd.setMilliseconds(-1);
        return {
            start: new Date(previousEnd.getFullYear(), previousEnd.getMonth(), 1, 0, 0, 0, 0),
            end: previousEnd
        };
    }

    if (periodKey === 'custom') {
        const rangeDays = Math.max(1, Math.round((current.end - current.start) / 86400000) + 1);
        const previousEnd = new Date(current.start);
        previousEnd.setMilliseconds(-1);
        const previousStart = new Date(previousEnd);
        previousStart.setDate(previousStart.getDate() - (rangeDays - 1));
        previousStart.setHours(0, 0, 0, 0);
        return { start: previousStart, end: previousEnd };
    }

    const previousStart = new Date(end.getFullYear(), end.getMonth() - 1, 1, 0, 0, 0, 0);
    const maxDay = new Date(previousStart.getFullYear(), previousStart.getMonth() + 1, 0).getDate();
    return {
        start: previousStart,
        end: new Date(
            previousStart.getFullYear(),
            previousStart.getMonth(),
            Math.min(end.getDate(), maxDay),
            end.getHours(),
            end.getMinutes(),
            end.getSeconds(),
            end.getMilliseconds()
        )
    };
}

function getRevenueAmount(tx) {
    const amount = Number(tx?.amount);
    return Number.isFinite(amount) ? Math.abs(amount) : 0;
}

function calculateRevenueForRange(transactions = [], range = null) {
    const records = transactions.filter(tx => {
        if (!isRevenueType(tx.type)) return false;
        if (!range) return true;
        const date = getTxDate(tx);
        return date instanceof Date && !Number.isNaN(date.getTime()) && date >= range.start && date <= range.end;
    });
    return {
        amount: records.reduce((sum, tx) => sum + getRevenueAmount(tx), 0),
        count: records.length,
        records
    };
}

function calculateRevenueForPeriod(transactions = [], periodKey = 'this_month') {
    return calculateRevenueForRange(transactions, getRevenuePeriodRange(periodKey));
}

function calculateRevenueChange(current, previous) {
    if (!previous || previous.count === 0 || previous.amount === 0) return null;
    const change = ((current.amount - previous.amount) / Math.abs(previous.amount)) * 100;
    return Number.isFinite(change) ? change : null;
}

function formatRevenueRecordCount(count) {
    const safeCount = Math.max(0, Math.round(Number(count) || 0));
    return `${safeCount} revenue record${safeCount === 1 ? '' : 's'}`;
}

function renderRevenueSparkline(records = [], periodKey = 'this_month') {
    let range = getRevenuePeriodRange(periodKey);
    if (!range) {
        const datedRecords = records
            .map(tx => getTxDate(tx))
            .filter(date => date instanceof Date && !Number.isNaN(date.getTime()));
        const today = new Date();
        range = {
            start: datedRecords.length
                ? new Date(Math.min(...datedRecords.map(date => date.getTime())))
                : new Date(today.getFullYear(), today.getMonth(), 1),
            end: datedRecords.length
                ? new Date(Math.max(today.getTime(), ...datedRecords.map(date => date.getTime())))
                : today
        };
    }
    const buckets = buildCashflowBuckets(records, getDayKey(range.start), getDayKey(range.end), { monthly: 0 });
    renderMetricSparkline(
        'kpi-revenue-sparkline',
        buckets.map(bucket => Number(bucket.revenue) || 0),
        'revenue'
    );
}

function renderRevenueCard() {
    const scopeLabel = getRevenuePeriodLabel(dashboardPeriodMode);
    const secondaryPeriod = dashboardPeriodMode === 'all_time' ? 'this_month' : 'all_time';
    const secondaryLabel = secondaryPeriod === 'this_month' ? 'This month' : 'All-time revenue';

    updateKPI('revenue-scope-label', scopeLabel);
    updateKPI('revenue-secondary-label', secondaryLabel);

    if (revenueTransactionsStatus === 'loading') {
        updateKPI('kpi-revenue', 'Rp 0');
        updateKPI('revenue-record-count', 'Loading...');
        updateKPI('revenue-secondary-value', 'Rp 0');
        updateKPI('kpi-revenue-change', 'Loading...');
        renderMetricArrow('kpi-revenue-arrow', null, 'revenue');
        clearMetricSparklines();
        return;
    }

    if (revenueTransactionsStatus === 'error') {
        updateKPI('kpi-revenue', 'Unavailable');
        updateKPI('revenue-record-count', 'Revenue records unavailable');
        updateKPI('revenue-secondary-value', 'Unavailable');
        updateKPI('kpi-revenue-change', 'Revenue data unavailable');
        renderMetricArrow('kpi-revenue-arrow', null, 'revenue');
        clearMetricSparklines();
        return;
    }

    const selected = calculateRevenueForPeriod(revenueTransactionsCache, dashboardPeriodMode);
    const secondary = calculateRevenueForPeriod(revenueTransactionsCache, secondaryPeriod);
    const previous = calculateRevenueForRange(
        revenueTransactionsCache,
        getPreviousRevenuePeriodRange(dashboardPeriodMode)
    );
    const change = dashboardPeriodMode === 'all_time'
        ? null
        : calculateRevenueChange(selected, previous);

    updateKPI('kpi-revenue', formatIDR(selected.amount));
    updateKPI('revenue-record-count', formatRevenueRecordCount(selected.count));
    updateKPI('revenue-secondary-value', formatIDR(secondary.amount));
    renderKpiComparison('kpi-revenue-change', change, 'revenue');
    renderMetricArrow('kpi-revenue-arrow', change, 'revenue');
    renderRevenueSparkline(selected.records, dashboardPeriodMode);
}

function isPositiveTransaction(tx) {
    return isRevenueType(tx.type);
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

function formatRangeLabel(startKey, endKey) {
    const start = parseDayKey(startKey);
    const end = parseDayKey(endKey);
    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    if (startKey === endKey) return start.toLocaleDateString('en-US', options);
    return `${start.toLocaleDateString('en-US', options)} - ${end.toLocaleDateString('en-US', options)}`;
}

function getRangeDays(startKey, endKey) {
    return Math.max(1, Math.round((parseDayKey(endKey) - parseDayKey(startKey)) / 86400000) + 1);
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
    const hasBudget = safeNumber(currentBudget.monthly) > 0;
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
                    const budgetUsedPct = Math.min(safeNumber(item.budgetUsedPct), 100);
                    const budgetHeight = Math.max(budgetUsedPct, budgetUsedPct > 0 ? 4 : 0);
                    return `
                        <div class="cashflow-bar-group" data-chart-bar data-label="${escapeHtml(item.label)}" data-revenue="${item.revenue}" data-spend="${item.spend}" data-budget-used="${safeNumber(item.budgetUsedPct)}">
                            <div class="cashflow-bar cashflow-bar-revenue" style="height: ${revenueHeight}%"></div>
                            <div class="cashflow-bar cashflow-bar-spend" style="height: ${spendHeight}%"></div>
                            ${hasBudget ? `<div class="cashflow-bar cashflow-bar-budget${budgetUsedPct > 0 ? '' : ' is-empty'}" style="height: ${budgetHeight}%"></div>` : ''}
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
    if (event.target.closest('[data-generate-ai-summary]')) {
        if (aiSummaryOverview) renderAiBusinessSummary(aiSummaryOverview);
        return;
    }
    if (event.target.closest('[data-ask-fluxy-summary]') || event.target.closest('[data-ask-fluxy]')) {
        window.toggleFluxyAI?.();
    }
});

// `mountMetricInfoTooltips` now lives in shared-dashboard.js and uses event
// delegation so dynamically-rendered cards (Budget page, future KPI surfaces)
// get tooltips without extra wiring. Keep the call here so script order doesn't
// matter — the shared module exposes a no-op shim that resolves cleanly.
window.mountMetricInfoTooltips?.();
mountDashboardPeriodControls();
mountFinanceSetupDrawers();

function mountFinanceSetupDrawers() {
    document.querySelectorAll('[data-finance-setup-open]').forEach(button => {
        button.addEventListener('click', event => {
            event.preventDefault();
            const target = button.dataset.financeSetupOpen;
            if (target === 'bank') openBankSetupDrawer();
            else if (target === 'budget') window.location.href = '/budget?create=1';
        });
    });

    document.querySelectorAll('[data-finance-setup-close]').forEach(button => {
        button.addEventListener('click', () => {
            const target = button.dataset.financeSetupClose;
            closeSetupDrawer(target);
        });
    });

    document.querySelectorAll('[data-finance-setup-backdrop]').forEach(backdrop => {
        backdrop.addEventListener('click', () => {
            closeSetupDrawer(backdrop.dataset.financeSetupBackdrop);
        });
    });

    const bankMethodList = document.getElementById('bank-setup-method-list');
    if (bankMethodList) {
        bankMethodList.addEventListener('click', event => {
            const card = event.target.closest('[data-bank-method]');
            if (!card || card.classList.contains('is-disabled')) return;
            const method = card.dataset.bankMethod;
            if (method === 'manual') showBankManualForm();
        });
    }

    const bankBackBtn = document.getElementById('bank-setup-back-btn');
    if (bankBackBtn) {
        bankBackBtn.addEventListener('click', () => showBankMethodStep());
    }

    const bankReviewBackBtn = document.getElementById('bank-setup-review-back-btn');
    if (bankReviewBackBtn) {
        bankReviewBackBtn.addEventListener('click', () => showBankManualForm());
    }

    const bankForm = document.getElementById('bank-setup-form');
    if (bankForm) {
        bankForm.addEventListener('submit', event => {
            event.preventDefault();
            handleBankManualReview();
        });
        const balanceInput = bankForm.querySelector('[name="current_balance"]');
        if (balanceInput) balanceInput.addEventListener('input', () => formatAmountInput(balanceInput));
    }

    const bankConfirmBtn = document.getElementById('bank-setup-confirm-btn');
    if (bankConfirmBtn) bankConfirmBtn.addEventListener('click', handleBankManualSave);

    const budgetForm = document.getElementById('budget-setup-form');
    if (budgetForm) {
        budgetForm.addEventListener('submit', event => {
            event.preventDefault();
            handleBudgetReview();
        });
        const totalInput = budgetForm.querySelector('[name="total_budget"]');
        if (totalInput) totalInput.addEventListener('input', () => formatAmountInput(totalInput));
    }

    const budgetBackBtn = document.getElementById('budget-setup-review-back-btn');
    if (budgetBackBtn) budgetBackBtn.addEventListener('click', () => showBudgetFormStep());

    const budgetConfirmBtn = document.getElementById('budget-setup-confirm-btn');
    if (budgetConfirmBtn) budgetConfirmBtn.addEventListener('click', handleBudgetSave);
}

function openBankSetupDrawer() {
    const drawer = document.getElementById('bank-setup-drawer');
    const backdrop = document.getElementById('bank-setup-backdrop');
    if (!drawer || !backdrop) return;
    backdrop.classList.remove('hidden');
    requestAnimationFrame(() => drawer.classList.remove('translate-x-full'));
    showBankMethodStep();
    mountBankSetupDatePicker();
}

function mountBankSetupDatePicker() {
    if (bankSetupDatePicker || !window.FluxyDateRangePicker) return;
    const today = getDayKey();
    bankSetupSelectedDate = today;
    bankSetupDatePicker = window.FluxyDateRangePicker.mount('#bank-setup-date-picker', {
        mode: 'single',
        start: today,
        end: today,
        defaultStart: today,
        defaultEnd: today,
        maxDate: today,
        onChange: ({ start }) => { bankSetupSelectedDate = start; }
    });
}

function closeSetupDrawer(name) {
    const drawer = document.getElementById(`${name}-setup-drawer`);
    const backdrop = document.getElementById(`${name}-setup-backdrop`);
    if (drawer) drawer.classList.add('translate-x-full');
    if (backdrop) backdrop.classList.add('hidden');
}

function showBankSetupStep(stepName) {
    document.querySelectorAll('#bank-setup-drawer [data-step]').forEach(el => {
        el.classList.toggle('hidden', el.dataset.step !== stepName);
    });
}

function showBankMethodStep() {
    showBankSetupStep('method');
}

function showBankManualForm() {
    showBankSetupStep('form');
    const nameInput = document.querySelector('#bank-setup-form [name="bank_name"]');
    if (nameInput) nameInput.focus();
}

function showBankReviewStep() {
    showBankSetupStep('review');
}

function handleBankManualReview() {
    const form = document.getElementById('bank-setup-form');
    if (!form) return;
    const data = collectBankFormData(form);
    if (!data.bank_name) {
        window.showToast?.('Add the bank name to continue.', 'error');
        return;
    }
    if (!data.account_name) {
        window.showToast?.('Add a nickname for this account.', 'error');
        return;
    }
    if (!(data.current_balance >= 0)) {
        window.showToast?.('Enter the current balance.', 'error');
        return;
    }
    renderBankReview(data);
    showBankReviewStep();
}

function collectBankFormData(form) {
    const fd = new FormData(form);
    const balanceRaw = String(fd.get('current_balance') || '').replace(/\./g, '').replace(/,/g, '');
    const lastFour = String(fd.get('last_four') || '').replace(/\D/g, '').slice(0, 4);
    return {
        bank_name: String(fd.get('bank_name') || '').trim(),
        account_name: String(fd.get('account_name') || '').trim(),
        last_four: lastFour || null,
        current_balance: Math.max(0, Number(balanceRaw) || 0),
        balance_date: bankSetupSelectedDate || null,
        notes: String(fd.get('notes') || '').trim() || null
    };
}

function renderBankReview(data) {
    const container = document.getElementById('bank-setup-review-body');
    if (!container) return;
    const balanceDateLabel = data.balance_date
        ? new Date(data.balance_date + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
        : new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    container.innerHTML = `
        <div class="bank-review-card">
            <div class="bank-review-line"><span>Bank</span><strong>${escapeHtml(data.bank_name)}</strong></div>
            <div class="bank-review-line"><span>Account</span><strong>${escapeHtml(data.account_name)}${data.last_four ? ' · ••' + escapeHtml(data.last_four) : ''}</strong></div>
            <div class="bank-review-line"><span>Balance</span><strong class="tabular-nums">${formatIDR(data.current_balance)}</strong></div>
            <div class="bank-review-line"><span>Balance date</span><strong>${escapeHtml(balanceDateLabel)}</strong></div>
            ${data.notes ? `<div class="bank-review-line"><span>Notes</span><strong>${escapeHtml(data.notes)}</strong></div>` : ''}
        </div>
        <p class="bank-review-note">This will update your Bank Cash Balance and recalculate Cash Pressure.</p>
    `;
    const confirmBtn = document.getElementById('bank-setup-confirm-btn');
    if (confirmBtn) confirmBtn.dataset.payload = JSON.stringify(data);
}

async function handleBankManualSave() {
    const confirmBtn = document.getElementById('bank-setup-confirm-btn');
    if (!confirmBtn) return;
    const payload = JSON.parse(confirmBtn.dataset.payload || '{}');
    if (!payload.bank_name) return;
    const user = auth.currentUser;
    if (!user) {
        window.showToast?.('Sign in to save bank balance.', 'error');
        return;
    }
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Saving...';
    try {
        await ds.addManualBankAccount(user.uid, payload);
        window.showToast?.('Bank balance saved.', 'success');
        closeSetupDrawer('bank');
        resetBankSetupDrawer();
        await window.loadDashboard?.();
    } catch (error) {
        window.showToast?.('Could not save bank balance. Please try again.', 'error');
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Save balance';
    }
}

function resetBankSetupDrawer() {
    const form = document.getElementById('bank-setup-form');
    if (form) form.reset();
    showBankMethodStep();
}

function openBudgetSetupDrawer() {
    const drawer = document.getElementById('budget-setup-drawer');
    const backdrop = document.getElementById('budget-setup-backdrop');
    if (!drawer || !backdrop) return;
    backdrop.classList.remove('hidden');
    requestAnimationFrame(() => drawer.classList.remove('translate-x-full'));
    showBudgetFormStep();
    prefillBudgetForm();
    mountBudgetSetupDatePicker();
}

function mountBudgetSetupDatePicker() {
    if (budgetSetupDatePicker || !window.FluxyDateRangePicker) return;
    const monthStart = getMonthStartKey();
    budgetSetupSelectedDate = monthStart;
    budgetSetupDatePicker = window.FluxyDateRangePicker.mount('#budget-setup-date-picker', {
        mode: 'single',
        start: monthStart,
        end: monthStart,
        defaultStart: monthStart,
        defaultEnd: monthStart,
        onChange: ({ start }) => { budgetSetupSelectedDate = start; }
    });
}

function showBudgetStep(stepName) {
    document.querySelectorAll('#budget-setup-drawer [data-step]').forEach(el => {
        el.classList.toggle('hidden', el.dataset.step !== stepName);
    });
}

function showBudgetFormStep() {
    showBudgetStep('form');
}

function showBudgetReviewStep() {
    showBudgetStep('review');
}

function prefillBudgetForm() {
    const form = document.getElementById('budget-setup-form');
    if (!form) return;
    if (currentBudget?.monthly > 0) {
        const totalInput = form.querySelector('[name="total_budget"]');
        if (totalInput && !totalInput.value) totalInput.value = formatIntegerForInput(currentBudget.monthly);
    }
}

function handleBudgetReview() {
    const form = document.getElementById('budget-setup-form');
    if (!form) return;
    const data = collectBudgetFormData(form);
    if (!(data.total_budget > 0)) {
        window.showToast?.('Enter a budget greater than Rp 0.', 'error');
        return;
    }
    if (!data.start_day) {
        window.showToast?.('Pick a start date.', 'error');
        return;
    }
    renderBudgetReview(data);
    showBudgetReviewStep();
}

function collectBudgetFormData(form) {
    const fd = new FormData(form);
    const totalRaw = String(fd.get('total_budget') || '').replace(/\./g, '').replace(/,/g, '');
    return {
        period_type: String(fd.get('period_type') || 'monthly'),
        start_day: budgetSetupSelectedDate || getMonthStartKey(),
        total_budget: Math.max(0, Number(totalRaw) || 0),
        name: String(fd.get('name') || '').trim() || ''
    };
}

function renderBudgetReview(data) {
    const container = document.getElementById('budget-setup-review-body');
    if (!container) return;
    const [year, month] = data.start_day.split('-').map(Number);
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = computeBudgetPeriodEnd(periodStart, data.period_type);
    const periodLabel = formatBudgetPeriodLabel(periodStart, periodEnd, data.period_type);
    container.innerHTML = `
        <div class="bank-review-card">
            <div class="bank-review-line"><span>Period</span><strong>${escapeHtml(periodLabel)}</strong></div>
            <div class="bank-review-line"><span>Period type</span><strong>${escapeHtml(capitalize(data.period_type))}</strong></div>
            <div class="bank-review-line"><span>Total budget</span><strong class="tabular-nums">${formatIDR(data.total_budget)}</strong></div>
        </div>
        <p class="bank-review-note">This will update OpEx vs Budget and the Budget Used metric on Performance Trend.</p>
    `;
    const confirmBtn = document.getElementById('budget-setup-confirm-btn');
    if (confirmBtn) {
        confirmBtn.dataset.payload = JSON.stringify({
            ...data,
            period_start: periodStart.toISOString(),
            period_end: periodEnd.toISOString(),
            display_name: data.name || `${periodLabel} budget`
        });
    }
}

function computeBudgetPeriodEnd(startDate, periodType) {
    if (periodType === 'quarterly') {
        return new Date(startDate.getFullYear(), startDate.getMonth() + 3, 0, 23, 59, 59);
    }
    if (periodType === 'yearly') {
        return new Date(startDate.getFullYear() + 1, startDate.getMonth(), 0, 23, 59, 59);
    }
    return new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0, 23, 59, 59);
}

function formatBudgetPeriodLabel(start, end, periodType) {
    if (periodType === 'yearly') return `${start.getFullYear()}`;
    if (periodType === 'quarterly') {
        return `${start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
    }
    return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

async function handleBudgetSave() {
    const confirmBtn = document.getElementById('budget-setup-confirm-btn');
    if (!confirmBtn) return;
    const payload = JSON.parse(confirmBtn.dataset.payload || '{}');
    if (!(payload.total_budget > 0)) return;
    const user = auth.currentUser;
    if (!user) {
        window.showToast?.('Sign in to save budget.', 'error');
        return;
    }
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Saving...';
    try {
        await ds.setActiveBudget(user.uid, {
            name: payload.display_name,
            period_type: payload.period_type,
            period_start: payload.period_start,
            period_end: payload.period_end,
            total_budget: payload.total_budget
        });
        window.showToast?.('Budget saved.', 'success');
        closeSetupDrawer('budget');
        await window.loadDashboard?.();
    } catch (error) {
        window.showToast?.('Could not save budget. Please try again.', 'error');
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Save budget';
    }
}

function formatAmountInput(input) {
    if (!input) return;
    const digits = String(input.value || '').replace(/\D/g, '');
    input.value = digits ? Number(digits).toLocaleString('id-ID') : '';
}

function formatIntegerForInput(value) {
    const n = Math.round(Math.max(0, Number(value) || 0));
    return n ? n.toLocaleString('id-ID') : '';
}

function capitalize(value) {
    const text = String(value || '');
    return text ? text[0].toUpperCase() + text.slice(1) : '';
}

// Auth state is handled by the page-level script in dashboard.html.
// Do not add another onAuthStateChanged here; it causes loadDashboard() to run twice.
