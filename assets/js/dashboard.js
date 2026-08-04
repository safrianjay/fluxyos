import DataService from './db-service.js';
import {
    buildBucketFrames,
    buildMetricSeries,
    trimToActivity,
    resolveBucketType,
    renderTrendMetricCard,
    renderDonutCard,
    linkHorizontalScroll,
    formatLevelIDR,
    formatPercentValue,
    tooltipRow
} from './overview-charts.js';
import { calculateExpenseBreakdown } from './report-builder.js';
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyDNynZIawmUQkTAVv71r4r9Sg661XvHVsA",
    authDomain: "fluxyos.com",
    projectId: "fluxyos",
    storageBucket: "fluxyos.firebasestorage.app",
    messagingSenderId: "1084252368929",
    appId: "1:1084252368929:web:da73dc0db83fe592c7f360",
    measurementId: "G-ZN7J6DRD2L"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const ds = new DataService(app);

let cashFlowBuckets = [];
// Cost-of-revenue mapping keys for the Gross profit margin chart. An empty set
// means no cost-of-revenue account is mapped yet, which renders the chart's
// setup state rather than a fabricated 100% margin.
let cogsKeys = new Set();
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
let aiSummaryUsage = null;
// Canonical KPI numbers exactly as rendered on the overview cards. Captured by
// the render functions so the AI Finance Summary narrates the same figures the
// user sees (the backend's own Firestore read can be a different/stale dataset).
let dashboardKpis = {};
let bankSetupDatePicker = null;
let bankSetupSelectedDate = null;
let budgetSetupDatePicker = null;
let budgetSetupSelectedDate = null;
window.FluxyDashboardRange = { start: dashboardRangeStart, end: dashboardRangeEnd };

// Fluxy AI page context — reads the rendered Overview KPIs + current period so
// the AI drawer opens already aware of business health on this dashboard.
window.FluxyAIContext?.register?.(() => {
    const text = (id) => (document.getElementById(id)?.textContent || '').trim();
    const periodLabel = dashboardPeriodMode === 'all_time'
        ? 'All time'
        : (window.FluxyAIContext.periodLabel(dashboardRangeStart, dashboardRangeEnd) || 'This month');
    const summary = [
        { label: 'Period', value: periodLabel },
        { label: 'Revenue', value: text('kpi-revenue') || '—' },
        { label: 'OpEx', value: text('kpi-opex') || '—' },
        { label: 'Net profit', value: text('kpi-net-profit') || '—' },
        { label: 'Gross margin', value: text('kpi-margin') || '—' },
        { label: 'Cash pressure', value: text('kpi-cash-pressure') || '—' },
    ];
    if (currentBudget && currentBudget.monthly > 0) {
        summary.push({
            label: 'Budget used',
            value: `${Math.round(currentBudget.usedPct || 0)}%`,
            status: (currentBudget.usedPct || 0) >= 100 ? 'critical' : (currentBudget.usedPct || 0) >= 85 ? 'warning' : 'good',
        });
    }
    return { pageTitle: 'Business Overview', summary, filters: { period_mode: dashboardPeriodMode }, selectedRecord: null };
});

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
        const [overviewResult, revenueResult, ledgerCashResult, mappingsResult] = await Promise.allSettled([
            ds.getDashboardOverview(user.uid, {
                startDate: dashboardRangeStart,
                endDate: dashboardRangeEnd,
                label: period.label,
                mode: dashboardPeriodMode
            }),
            ds.getRevenueTransactionsForDashboardStats(user.uid),
            ds.getLedgerCashPosition(user.uid),
            ds.getAccountingMappings(user.uid)
        ]);
        if (overviewResult.status !== 'fulfilled') throw overviewResult.reason;
        const overview = overviewResult.value;
        revenueTransactionsCache = revenueResult.status === 'fulfilled' ? revenueResult.value : [];
        revenueTransactionsStatus = revenueResult.status === 'fulfilled' ? 'loaded' : 'error';
        const ledgerCash = ledgerCashResult.status === 'fulfilled'
            ? ledgerCashResult.value
            : { cashIn: 0, cashOut: 0, net: 0, recordCount: 0 };
        dashboardRangeStart = overview.period?.startDate || dashboardRangeStart;
        dashboardRangeEnd = overview.period?.endDate || dashboardRangeEnd;
        window.FluxyDashboardRange = { start: dashboardRangeStart, end: dashboardRangeEnd };

        currentBudget = overview.budget || { monthly: 0, used: 0, usedPct: 0, remaining: 0 };
        cashFlowBuckets = overview.cashFlow || [];
        // Same COGS classification the Accounting Center income statement uses, so
        // the Overview gross margin can never disagree with the statement.
        cogsKeys = mappingsResult.status === 'fulfilled'
            ? ds._incomeStatementCogsKeys(mappingsResult.value || [])
            : new Set();

        renderSummaryBoard(overview, ledgerCash);
        renderOverviewCharts(overview);
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

// Restore the period from the URL (?period&start&end) when arriving from a KPI
// drill-down's "Back to Overview" link, so the dashboard reopens on the same
// range instead of resetting to This Month. Absent/invalid → keep the default.
function applyDashboardPeriodFromUrl() {
    const p = new URLSearchParams(window.location.search);
    const mode = p.get('period');
    if (!['this_month', 'last_month', 'year_to_date', 'all_time', 'custom'].includes(mode)) return;
    if (mode === 'custom') {
        const start = p.get('start');
        const end = p.get('end');
        if (!start || !end) return;
        dashboardPeriodMode = 'custom';
        dashboardRangeStart = start;
        dashboardRangeEnd = end;
    } else {
        dashboardPeriodMode = mode;
        const resolved = resolveDashboardPeriod(mode);
        dashboardRangeStart = resolved.start;
        dashboardRangeEnd = resolved.end;
    }
    window.FluxyDashboardRange = { start: dashboardRangeStart, end: dashboardRangeEnd };
}

function mountDashboardPeriodControls() {
    applyDashboardPeriodFromUrl();
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

    mountKpiDrillNav();
    updateDashboardPeriodControlState();
}

// Revenue / Cash position / OpEx KPI cards drill into dedicated detail pages,
// carrying the current dashboard range so the detail page opens on the same
// period. Clicks on the inner "?" info button or a CTA (bank/budget setup) keep
// their own behavior and must not navigate.
function mountKpiDrillNav() {
    // margin → Revenue (gross margin is revenue-driven); profit → its own
    // detail page; pressure → its own forward-looking page.
    const routes = { revenue: '/revenue-overview', cash: '/cash-position', opex: '/opex-budget', margin: '/revenue-overview', profit: '/net-profit' };
    const staticRoutes = { pressure: '/cash-pressure' };
    const buildUrl = (key) => {
        if (staticRoutes[key]) return staticRoutes[key]; // period range doesn't apply to these
        const base = routes[key];
        if (!base) return null;
        const params = new URLSearchParams();
        params.set('period', dashboardPeriodMode);
        if (dashboardPeriodMode !== 'all_time') {
            params.set('start', dashboardRangeStart);
            params.set('end', dashboardRangeEnd);
        }
        return `${base}?${params.toString()}`;
    };
    const navigate = (card) => {
        const url = buildUrl(card.dataset.kpiNav);
        if (url) window.location.href = url;
    };
    document.querySelectorAll('[data-kpi-nav]').forEach(card => {
        card.addEventListener('click', (event) => {
            if (event.target.closest('button, a')) return; // info "?" + CTAs keep their own action
            navigate(card);
        });
        card.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            if (event.target.closest('button, a')) return;
            event.preventDefault();
            navigate(card);
        });
    });
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
    updateKPI('kpi-revenue', 'Rp0');
    updateKPI('kpi-opex', 'Rp0');
    updateKPI('kpi-margin', '0%');
    updateKPI('kpi-cash-pressure', 'Rp0');
    updateKPI('kpi-bank-cash', 'Rp0');
    updateKPI('kpi-ledger-cash', 'Rp0');
    updateKPI('kpi-ledger-cash-sub', 'Loading...');
    updateKPI('kpi-net-profit', 'Rp0');
    updateKPI('kpi-revenue-change', 'Loading...');
    updateKPI('revenue-scope-label', getRevenuePeriodLabel(dashboardPeriodMode));
    updateKPI('revenue-record-count', 'Loading...');
    updateKPI('revenue-secondary-label', dashboardPeriodMode === 'all_time' ? 'This month' : 'All-time revenue');
    updateKPI('revenue-secondary-value', 'Rp0');
    updateKPI('kpi-opex-change', 'Loading...');
    updateKPI('kpi-margin-status', 'Loading...');
    updateKPI('kpi-cash-pressure-sub', 'Loading...');
    updateKPI('kpi-bank-cash-sub', 'Loading...');
    updateKPI('kpi-bank-cash-outlook', 'Rp0');
    updateKPI('kpi-bank-cash-coverage', 'Not available');
    updateKPI('kpi-opex-budget-used', '0%');
    updateKPI('kpi-opex-budget-total', 'Rp0');
    updateKPI('kpi-net-profit-sub', 'Loading...');
    updateKPI('kpi-net-profit-insight', '');
    setBudgetBar(0);
    setPressureMeter(0, 'low');
    setHtml('needs-attention-content', '<div class="overview-card-loading">Loading action items...</div>');
    setHtml('payables-by-category-content', '<div class="overview-card-loading">Loading payables...</div>');
    setHtml('upcoming-obligations-content', '<div class="overview-card-loading">Loading upcoming obligations...</div>');
    setHtml('report-readiness-content', '<div class="overview-card-loading">Loading report readiness...</div>');
    setHtml('ai-business-summary-content', getAiBusinessSummaryIdleHtml());
    clearOverviewCharts('Loading...');
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
    updateKPI('kpi-revenue', 'Rp0');
    updateKPI('kpi-opex', 'Rp0');
    updateKPI('kpi-margin', '0%');
    updateKPI('kpi-cash-pressure', 'Rp0');
    updateKPI('kpi-bank-cash', 'Rp0');
    updateKPI('kpi-ledger-cash', 'Rp0');
    updateKPI('kpi-ledger-cash-sub', 'No cash transactions yet');
    updateKPI('kpi-net-profit', 'Rp0');
    updateKPI('kpi-revenue-change', 'No data');
    updateKPI('revenue-record-count', 'Revenue records unavailable');
    updateKPI('revenue-secondary-value', 'Unavailable');
    updateKPI('kpi-opex-change', 'Budget not set');
    updateKPI('kpi-margin-status', 'No revenue data');
    updateKPI('kpi-cash-pressure-sub', 'No data');
    updateKPI('kpi-bank-cash-sub', 'No bank data connected');
    updateKPI('kpi-bank-cash-outlook', 'Rp0');
    updateKPI('kpi-bank-cash-coverage', 'Not available');
    updateKPI('kpi-opex-budget-used', '0%');
    updateKPI('kpi-opex-budget-total', 'Rp0');
    updateKPI('kpi-net-profit-sub', 'No records found');
    updateKPI('kpi-net-profit-insight', '');
    renderMetricArrow('kpi-net-profit-arrow', null, 'revenue');
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
    clearOverviewCharts('Chart data could not be loaded.');
    clearMetricSparklines();
    const status = document.getElementById('report-readiness-status');
    if (status) {
        status.textContent = 'Unavailable';
        status.className = 'status-badge';
    }
}

function renderSummaryBoard(overview, ledgerCash = {}) {
    const p = overview.performance || {};
    const rp = overview.receivablesPayables || {};
    const actions = overview.actionItems || {};
    const margin = safeNumber(p.grossMargin);

    updateKPI('kpi-margin', `${formatNumber(margin, 1)}%`);

    dashboardKpis.grossMargin = margin;
    dashboardKpis.payables = safeNumber(rp.payablesTotal);
    dashboardKpis.receivables = safeNumber(rp.receivablesTotal);
    dashboardKpis.overdueCount = safeNumber(actions.overdueBills);
    dashboardKpis.periodLabel = overview.period?.label || 'selected period';

    renderMarginStatus(margin, p.marginChangePct);
    renderMetricArrow('kpi-margin-arrow', p.marginChangePct, 'revenue');

    renderNetProfitCell(p);

    const bar = document.getElementById('kpi-margin-bar');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, margin))}%`;

    renderRevenueCard();

    renderLedgerCashCell(ledgerCash, overview.bankCash || {}, overview.cashPressure || {});
    renderOpexBudgetCell(p, currentBudget);
}

function renderLedgerCashCell(ledgerCash, bankCash, cashPressure) {
    const net = safeNumber(ledgerCash.net);
    const cashIn = safeNumber(ledgerCash.cashIn);
    const cashOut = safeNumber(ledgerCash.cashOut);
    const count = safeNumber(ledgerCash.recordCount);

    const el = document.getElementById('kpi-ledger-cash');
    if (el) el.textContent = formatIDR(net);
    dashboardKpis.cashPosition = net;

    const sub = document.getElementById('kpi-ledger-cash-sub');
    if (sub) {
        if (count === 0) {
            sub.textContent = 'No cash transactions yet';
            sub.className = 'metric-sub';
        } else {
            sub.textContent = `${formatIDR(cashIn)} in · ${formatIDR(cashOut)} out · ${count} record${count === 1 ? '' : 's'}`;
            sub.className = net >= 0 ? 'metric-sub is-good' : 'metric-sub is-bad';
        }
    }

    // Bank running balance = user's last known balance + net of cash transactions after that balance was set
    const anchorMs = bankCash.syncedAt ? new Date(bankCash.syncedAt).getTime() : null;
    let bankAdj = 0;
    if (anchorMs !== null && Array.isArray(ledgerCash._entries)) {
        for (const tx of ledgerCash._entries) {
            if (tx.tsMs > anchorMs) {
                bankAdj += tx.direction === 'in' ? tx.amount : -tx.amount;
            }
        }
    }
    const bankRunning = safeNumber(bankCash.balance) + bankAdj;
    dashboardKpis.bankCash = bankRunning;

    // Append a live data point so the sparkline ends at the current running balance
    const adjustedHistory = [...(bankCash.balanceHistory || [])];
    if (bankAdj !== 0 || adjustedHistory.length === 0) {
        adjustedHistory.push({ at: new Date().toISOString(), balance: bankRunning });
    }
    renderBankCashCell({
        ...bankCash,
        balance: bankRunning,
        thirtyDayOutlook: safeNumber(bankCash.thirtyDayOutlook) + bankAdj,
        balanceHistory: adjustedHistory
    }, {});

    // Recompute cash pressure using the live bank balance
    const cp = cashPressure || {};
    const recvDue = safeNumber(cp.receivablesDueSoon);
    const payDue = safeNumber(cp.payablesDueSoon);
    const overdueCount = safeNumber(cp.overdueCount);
    const newOutlook = bankRunning + recvDue - payDue;
    dashboardKpis.cashPressure = newOutlook;
    let newRisk = 'low';
    if (overdueCount > 0 && (bankRunning + recvDue) < payDue) newRisk = 'critical';
    else if (newOutlook < 0) newRisk = 'high';
    else if (payDue > 0 && newOutlook < payDue) newRisk = 'watch';
    renderCashPressureCell({ ...cp, outlook: newOutlook, riskLevel: newRisk });
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
    // Best-effort, non-blocking: only when accounts exist, check whether linked
    // ledger activity has drifted from the reported balances and surface a
    // "Reconcile with ledger" nudge → Settings → Cash. Never delays the paint.
    if (accountsSynced > 0) maybeShowBankReconcileNudge();
    else toggleBankReconcileNudge(false);
    const bankSparklineValues = balanceHistory.map(snapshot => safeNumber(snapshot.balance));
    if (bankSparklineValues.length === 1) bankSparklineValues.push(bankSparklineValues[0]);
    renderMetricSparkline(
        'kpi-bank-cash-sparkline',
        bankSparklineValues,
        'revenue'
    );
}

// Show a "Reconcile with ledger" nudge on the Bank Cash card when linked
// cash-effective transactions have moved a balance since it was last reported.
// Read-only and fire-and-forget so it never blocks the dashboard; on any
// failure the nudge simply stays hidden.
async function maybeShowBankReconcileNudge() {
    try {
        const user = auth.currentUser;
        if (!user) return;
        const accounts = await ds.getBankAccountsLedgerReconciliation(user.uid);
        const drifted = (accounts || []).filter(a => a.ledger && a.ledger.sinceCount > 0 && !a.ledger.matches);
        toggleBankReconcileNudge(drifted.length > 0);
    } catch (_) {
        toggleBankReconcileNudge(false);
    }
}

function toggleBankReconcileNudge(show) {
    const nudge = document.getElementById('bank-cash-reconcile-nudge');
    if (nudge) nudge.hidden = !show;
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
    dashboardKpis.opex = opex;

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
    updateKPI('kpi-opex-budget-total', monthly > 0 ? formatIDR(monthly) : 'Rp0');
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

// Net profit KPI: the amount, the period-over-period change with a trend arrow,
// and one short sentence naming what actually moved it. Revenue and OpEx come
// from the same performance object, so the card can never disagree with the
// Revenue / OpEx / Gross margin cards beside it.
function renderNetProfitCell(performance) {
    const netProfit = safeNumber(performance.netProfit);
    const changePct = performance.netProfitChangePct;
    const hasComparison = changePct !== null && changePct !== undefined && Number.isFinite(Number(changePct));

    // A level, not a delta — so no leading "+". A loss renders "-Rp…" (and red),
    // the same convention the Net Profit detail page uses.
    updateKPI('kpi-net-profit', netProfit < 0 ? `-${formatIDR(netProfit)}` : formatIDR(netProfit));
    dashboardKpis.netProfit = netProfit;

    const value = document.getElementById('kpi-net-profit');
    if (value) value.className = `metric-value tabular-nums ${netProfit < 0 ? 'is-bad' : ''}`.trim();

    // A loss growing larger is "down" even though the percentage is positive, so
    // the arrow follows the money, not the sign of the ratio.
    const previous = safeNumber(performance.previousNetProfit);
    const direction = hasComparison ? netProfit - previous : null;
    renderMetricArrow('kpi-net-profit-arrow', direction, 'revenue');

    const sub = document.getElementById('kpi-net-profit-sub');
    if (sub) {
        if (!hasComparison) {
            sub.textContent = 'No previous period data';
            sub.className = 'metric-sub';
        } else if (Math.abs(Number(changePct)) < 0.1) {
            sub.textContent = 'Flat vs previous period';
            sub.className = 'metric-sub is-neutral';
        } else {
            sub.textContent = `${Math.abs(Number(changePct)).toFixed(1)}% vs previous period`;
            sub.className = `metric-sub ${direction >= 0 ? 'is-good' : 'is-bad'}`;
        }
    }

    updateKPI('kpi-net-profit-insight', buildNetProfitInsight(performance, netProfit, hasComparison));
}

// One-sentence "why": attribute the swing to the revenue side or the expense
// side when there is a previous period, otherwise state the margin position.
function buildNetProfitInsight(performance, netProfit, hasComparison) {
    const revenue = safeNumber(performance.revenue);
    const opex = safeNumber(performance.opex);
    if (revenue === 0 && opex === 0) return 'No revenue or expenses recorded yet.';

    if (hasComparison) {
        const revenueDelta = revenue - safeNumber(performance.previousRevenue);
        const opexDelta = opex - safeNumber(performance.previousOpex);
        if (Math.abs(revenueDelta) >= Math.abs(opexDelta) && Math.abs(revenueDelta) > 0) {
            return revenueDelta > 0
                ? `Revenue up ${formatIDR(revenueDelta)} drove most of the change.`
                : `Revenue down ${formatIDR(Math.abs(revenueDelta))} drove most of the change.`;
        }
        if (Math.abs(opexDelta) > 0) {
            return opexDelta > 0
                ? `Expenses up ${formatIDR(opexDelta)} drove most of the change.`
                : `Expenses down ${formatIDR(Math.abs(opexDelta))} drove most of the change.`;
        }
    }

    if (netProfit < 0) return `Expenses exceed revenue by ${formatIDR(Math.abs(netProfit))}.`;
    if (revenue > 0) return `${formatIDR(revenue)} revenue against ${formatIDR(opex)} expenses.`;
    return `${formatIDR(opex)} in expenses with no revenue recorded.`;
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

    const trackWidth = cashFlowBuckets.length * CASHFLOW_MIN_BUCKET_PX;
    chart.innerHTML = `
        <div class="cash-flow-stage" data-cashflow-stage>
            <div class="cash-flow-axis">
                <div><span>${formatCompactIDR(maxAxis)}</span></div>
                <div><span>${formatCompactIDR(maxAxis / 2)}</span></div>
                <div><span>Rp0</span></div>
                <div><span>-${formatCompactIDR(maxAxis / 2)}</span></div>
                <div><span>-${formatCompactIDR(maxAxis)}</span></div>
            </div>
            <div class="cash-flow-plot">
                <div class="cash-flow-zero-line"></div>
              <div class="cash-flow-scroll" data-cashflow-cf-scroll>
                <div class="cash-flow-bars" style="width: ${trackWidth}px">
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
        </div>
        <div class="cash-flow-labels-scroll" data-cashflow-cf-labels>
            <div class="cash-flow-labels" style="width: ${trackWidth}px">
                ${cashFlowBuckets.map(item => `<span>${escapeHtml(item.label)}</span>`).join('')}
            </div>
        </div>
    `;
    linkHorizontalScroll(
        chart.querySelector('[data-cashflow-cf-scroll]'),
        chart.querySelector('[data-cashflow-cf-labels]')
    );

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
    const needsReview = items.filter(item => ['overdue', 'missing_receipt', 'future_dated'].includes(item.kind));
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
    renewal: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 10a6.5 6.5 0 0 1 11.1-4.6l1.9 1.9"/><path d="M16.5 3.5v4h-4"/><path d="M16.5 10a6.5 6.5 0 0 1-11.1 4.6L3.5 12.7"/><path d="M3.5 16.5v-4h4"/></svg>',
    future_dated: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.75" y="4" width="14.5" height="13" rx="2"/><path d="M2.75 8h14.5"/><path d="M6.5 2.5v3"/><path d="M13.5 2.5v3"/><path d="M10 10.5v2.25"/><path d="M10 15.25h.01"/></svg>'
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
    // Data-quality: records dated after today. They fall outside every period, so
    // they are silently absent from every KPI — this queue row is the only place
    // the user learns they exist.
    if (actions.futureDatedRecords) {
        const n = Number(actions.futureDatedRecords);
        const dq = overview.dataQuality?.futureDated || {};
        const amount = Number(dq.amount) || 0;
        items.push({
            kind: 'future_dated',
            iconKind: 'warning',
            title: `${n} record${n === 1 ? '' : 's'} dated in the future`,
            description: amount > 0
                ? `${formatIDR(amount)} sits outside every period total until the dates are corrected.`
                : 'These sit outside every period total until the dates are corrected.',
            action: 'Review in Ledger',
            href: '/ledger?flag=future_dated'
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
    const requestSeq = (aiSummaryRequestSeq += 1);
    // Render the orb immediately; then resolve the AI quota and lock the card if
    // it is exhausted. Reading usage server-side means a refresh/new session
    // cannot get a fresh generation once the quota is spent.
    setHtml('ai-business-summary-content', getAiBusinessSummaryIdleHtml());
    const user = auth.currentUser;
    if (!user) return;
    ds.getAiUsage(user.uid).then(usage => {
        if (requestSeq !== aiSummaryRequestSeq) return;
        aiSummaryUsage = usage;
        if (usage?.locked) {
            setHtml('ai-business-summary-content', getAiBusinessSummaryLockedHtml());
        } else {
            setHtml('ai-business-summary-content', getAiBusinessSummaryIdleHtml(usage));
        }
    }).catch(() => { /* leave the orb; backend still enforces on generate */ });
}

function getAiBusinessSummaryIdleHtml(usage) {
    return `
        <button type="button" class="brain-idle" data-generate-ai-summary aria-label="Generate AI finance summary for this period">
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
        ${getAiCreditsLineHtml(usage)}
    `;
}

// Static phrase ("AI Finance generations left") sits in its own text node so the
// i18n MutationObserver translates it; the number stays a separate node.
function getAiCreditsLineHtml(usage) {
    if (!usage || usage.unlimited || usage.unknown || !Number.isFinite(usage.remaining)) return '';
    return `
        <p class="brain-credits">
            <span class="brain-credits-count tabular-nums">${escapeHtml(String(usage.remaining))}</span>
            <span>AI Finance generations left</span>
        </p>
    `;
}

function getAiBusinessSummaryLockedHtml() {
    return `
        <div class="brain-locked" role="status">
            <span class="brain-locked-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-full h-full">
                    <rect x="4.75" y="10.5" width="14.5" height="9.25" rx="2.25" stroke="currentColor" stroke-width="1.6"/>
                    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                    <circle cx="12" cy="15" r="1.4" fill="currentColor"/>
                </svg>
            </span>
            <p class="brain-locked-title">You've reached your AI Finance limit.</p>
            <p class="brain-locked-copy">Your current plan includes a limited number of AI Finance generations. Upgrade or subscribe to continue using AI Finance and unlock more credits.</p>
            <a class="brain-locked-cta" href="settings-billing.html">Upgrade plan</a>
        </div>
    `;
}

async function renderAiBusinessSummary(overview) {
    const requestSeq = ++aiSummaryRequestSeq;
    const periodStart = overview.period?.startDate || dashboardRangeStart;
    const periodEnd = overview.period?.endDate || dashboardRangeEnd;
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
                workspace_id: window.FluxyWorkspace?.id || null,
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
        // Quota exhausted: lock the card instead of falling back to a free answer.
        if (response.status === 402 || ['trial_ai_limit_reached', 'ai_limit_reached'].includes(data?.error?.code)) {
            aiSummaryUsage = { ...(aiSummaryUsage || {}), locked: true, remaining: 0 };
            setHtml('ai-business-summary-content', getAiBusinessSummaryLockedHtml());
            return;
        }
        if (!response.ok || data.success === false || !data.answer) {
            throw new Error(data?.error?.message || data?.message || 'AI summary unavailable.');
        }
        if (data.usage) aiSummaryUsage = data.usage;
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
        bank: buildAiBusinessSummarySnapshotBank(overview.bankCash),
        kpis: {
            period_label: dashboardKpis.periodLabel || overview.period?.label || 'selected period',
            revenue: numberOrNull(dashboardKpis.revenue),
            revenue_records: numberOrNull(dashboardKpis.revenueRecords),
            opex: numberOrNull(dashboardKpis.opex),
            net_profit: numberOrNull(dashboardKpis.netProfit),
            gross_margin: numberOrNull(dashboardKpis.grossMargin),
            cash_position: numberOrNull(dashboardKpis.cashPosition),
            bank_cash: numberOrNull(dashboardKpis.bankCash),
            cash_pressure: numberOrNull(dashboardKpis.cashPressure),
            payables: numberOrNull(dashboardKpis.payables),
            receivables: numberOrNull(dashboardKpis.receivables),
            overdue_count: numberOrNull(dashboardKpis.overdueCount),
        },
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

function numberOrNull(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
}

function buildAiBusinessSummarySnapshotBank(bankCash = {}) {
    const accountsSynced = Number(bankCash?.accountsSynced) || 0;
    const sourceType = bankCash?.sourceType ? String(bankCash.sourceType) : null;
    const connected = accountsSynced > 0 || !!sourceType;
    return {
        connected,
        balance: Number(bankCash?.balance) || 0,
        accounts_synced: accountsSynced,
        source_type: sourceType,
        synced_at: bankCash?.syncedAt ? String(bankCash.syncedAt) : null,
        thirty_day_outlook: Number.isFinite(Number(bankCash?.thirtyDayOutlook)) ? Number(bankCash.thirtyDayOutlook) : null,
    };
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
        ${getAiCreditsLineHtml(aiSummaryUsage)}
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
        ...bills.map(bill => ({ type: 'Bill', base: '/bill', dateField: 'due_date', record: bill })),
        ...subscriptions.map(sub => ({ type: 'Renewal', base: '/subscription', dateField: 'renewal_date', record: sub }))
    ].slice(0, 3);

    if (!rows.length) {
        setHtml('upcoming-obligations-content', '<div class="overview-empty-copy">No upcoming bills or renewals.</div>');
        return;
    }

    // Deep-link each row to its own record — the Bills / Subscriptions pages
    // open that record's detail drawer via ?record=<id> (same contract the KPI
    // drill-down tables use). Falls back to the list page if the id is missing.
    const rowHref = (row) => row.record?.id
        ? `${row.base}?record=${encodeURIComponent(row.record.id)}`
        : row.base;

    setHtml('upcoming-obligations-content', `
        <div class="rail-mini-list">
            ${rows.map(row => `
                <a class="rail-mini-card" href="${rowHref(row)}">
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
    // "All time" is inception-to-DATE: the start is open, but the end is always
    // today. This used to return null, which `calculateRevenueForRange` reads as
    // "no date filter at all" — so future-dated records counted toward the
    // Revenue card while every other KPI (OpEx, Gross margin, Net profit, and the
    // drill-down pages, all of which resolve All Time to `earliest → today`)
    // excluded them. The board then showed two different revenue numbers and
    // Revenue − OpEx no longer reconciled with Net profit.
    if (periodKey === 'all_time') return { start: new Date(0), end };
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
    // All Time now spans from the epoch, so anchor the sparkline to the first
    // real record rather than bucketing from 1970. The end stays clamped at
    // today — it previously used max(today, latest record), which a single
    // future-dated record stretched centuries into the future.
    if (periodKey === 'all_time' || !range) {
        const datedRecords = records
            .map(tx => getTxDate(tx))
            .filter(date => date instanceof Date && !Number.isNaN(date.getTime()));
        const today = new Date();
        range = {
            start: datedRecords.length
                ? new Date(Math.min(...datedRecords.map(date => date.getTime())))
                : new Date(today.getFullYear(), today.getMonth(), 1),
            end: today
        };
    }
    const startKey = getDayKey(range.start);
    const endKey = getDayKey(range.end);
    const frames = buildBucketFrames(startKey, endKey);
    const buckets = trimToActivity(
        buildMetricSeries(records, frames),
        [],
        resolveBucketType(startKey, endKey)
    ).current;
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
        updateKPI('kpi-revenue', 'Rp0');
        updateKPI('revenue-record-count', 'Loading...');
        updateKPI('revenue-secondary-value', 'Rp0');
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
    dashboardKpis.revenue = safeNumber(selected.amount);
    dashboardKpis.revenueRecords = safeNumber(selected.count);
    updateKPI('revenue-record-count', formatRevenueRecordCount(selected.count));
    updateKPI('revenue-secondary-value', formatIDR(secondary.amount));
    renderKpiComparison('kpi-revenue-change', change, 'revenue');
    renderMetricArrow('kpi-revenue-arrow', change, 'revenue');
    renderRevenueSparkline(selected.records, dashboardPeriodMode);
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

function formatIDR(value) {
    return `Rp${Math.round(Math.abs(Number(value) || 0)).toLocaleString('id-ID')}`;
}

function formatSignedIDR(value) {
    const n = Number(value) || 0;
    if (n === 0) return 'Rp0';
    return `${n < 0 ? '-' : '+'}${formatIDR(n)}`;
}

function formatCompactIDR(value) {
    const n = Math.abs(Number(value) || 0);
    if (n >= 1_000_000_000) return `Rp${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000) return `Rp${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `Rp${(n / 1_000).toFixed(0)}K`;
    return `Rp${Math.round(n)}`;
}

function formatNumber(value, digits = 1) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(digits) : (0).toFixed(digits);
}

function safeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

// Minimum horizontal space per bucket. When the buckets need more than the
// chart's visible width (lots of data / long date range), the plot and its
// labels scroll horizontally instead of cramming together.
const CASHFLOW_MIN_BUCKET_PX = 64;

// ---------------------------------------------------------------------------
// Overview financial charts
//
// Six charts off one dataset: Net profit, Total income, Total expenses, Gross
// profit margin, Expense breakdown and Bank accounts. Every headline figure
// comes from overview.performance (the same numbers the KPI strip renders), and
// every series is bucketed from overview.chartTransactions — no second query and
// no independent arithmetic, so a chart can never disagree with its KPI card.
// ---------------------------------------------------------------------------

const CHART_COLORS = {
    income: '#16A34A',       // success green — money in
    incomePrior: '#86EFAC',
    expense: '#EF4444',      // action red — money out
    expensePrior: '#FCA5A5',
    margin: '#3B82F6',       // info blue — a ratio, not a cash direction
    marginPrior: '#93C5FD',
    net: '#3B82F6',
    netNegative: '#DC2626',  // matches .chart-column-current.is-negative
    netPrior: '#C7D2FE'
};

// Last-rendered chart inputs, so a resize can redraw at the new width. Line
// charts bake their viewBox from the measured container width; without this a
// sidebar collapse or a breakpoint change would leave a stretched plot.
let overviewChartState = null;

function renderOverviewCharts(overview) {
    const performance = overview?.performance || {};
    const frames = buildBucketFrames(dashboardRangeStart, dashboardRangeEnd);
    const bucketType = resolveBucketType(dashboardRangeStart, dashboardRangeEnd);
    const isCogs = cogsKeys.size ? (tx => ds._isCogsTransaction(tx, cogsKeys)) : null;

    const currentAll = buildMetricSeries(overview?.chartTransactions || [], frames, isCogs);

    // Prior-period records are dated inside the PREVIOUS window, so they have to
    // be bucketed against that window's own frames — bucketing them against the
    // current frames drops every one of them as out of range and silently draws
    // an empty ghost series. The two windows are equal length, so pairing them by
    // index puts "day 1 vs day 1 of last month" on the same x position.
    const priorTxs = overview?.previousChartTransactions || [];
    const prevStart = overview?.period?.previousStartDate;
    const prevEnd = overview?.period?.previousEndDate;
    let priorAll = [];
    if (priorTxs.length && prevStart && prevEnd) {
        const priorFrames = buildBucketFrames(prevStart, prevEnd);
        const priorSeries = buildMetricSeries(priorTxs, priorFrames, isCogs);
        const zeroBucket = { revenue: 0, expense: 0, cogs: 0, netProfit: 0, grossProfit: 0, grossMarginPct: null };
        // Pad or clip to the current frame count so the two series stay aligned
        // even when a month-length difference shifts the bucket count by one.
        priorAll = frames.map((frame, index) => ({
            ...(priorSeries[index] || zeroBucket),
            label: frame.label
        }));
    }
    const trimmed = trimToActivity(currentAll, priorAll, bucketType);

    overviewChartState = {
        overview,
        buckets: trimmed.current,
        priorBuckets: trimmed.prior,
        performance
    };
    paintOverviewCharts();
}

function paintOverviewCharts() {
    if (!overviewChartState) return;
    const { overview, buckets, priorBuckets, performance } = overviewChartState;
    const hasPrior = priorBuckets.length > 0;
    const priorLabel = 'Prior period';

    // 1. Net profit — a diverging column chart. Net profit goes negative
    // regularly, and a zero-baselined column is the only form that reads a loss
    // honestly (DESIGN_SYSTEM §4b).
    renderTrendMetricCard(document.getElementById('net-profit-card'), {
        shape: 'diverging',
        buckets,
        priorBuckets,
        compact: false,
        valueOf: bucket => bucket.netProfit,
        color: CHART_COLORS.net,
        priorColor: CHART_COLORS.netPrior,
        ariaLabel: 'Net profit by period',
        formatAxis: formatCompactIDR,
        head: {
            value: formatLevelIDR(safeNumber(performance.netProfit)),
            valueLabel: getRangeCaption(),
            priorValue: hasPrior && performance.previousNetProfit !== null && performance.previousNetProfit !== undefined
                ? formatLevelIDR(safeNumber(performance.previousNetProfit))
                : null,
            priorLabel,
            change: performance.netProfitChangePct,
            negative: safeNumber(performance.netProfit) < 0
        },
        buildTooltip: (bucket, index) => {
            const prior = priorBuckets[index];
            // Swatch follows the column's sign, so the tooltip legend matches the
            // bar the user is pointing at rather than always showing the positive hue.
            const netSwatch = bucket.netProfit < 0 ? CHART_COLORS.netNegative : CHART_COLORS.net;
            return `
                <div class="chart-tooltip-header">${escapeHtml(bucket.label)}</div>
                ${tooltipRow(netSwatch, 'Net profit', formatLevelIDR(bucket.netProfit))}
                ${tooltipRow(CHART_COLORS.income, 'Income', formatIDR(bucket.revenue))}
                ${tooltipRow(CHART_COLORS.expense, 'Expenses', formatIDR(bucket.expense))}
                ${prior ? tooltipRow(CHART_COLORS.netPrior, priorLabel, formatLevelIDR(prior.netProfit), true) : ''}
            `;
        }
    });

    // 2. Total income
    renderTrendMetricCard(document.getElementById('total-income-card'), {
        shape: 'line',
        buckets,
        priorBuckets,
        compact: true,
        valueOf: bucket => bucket.revenue,
        color: CHART_COLORS.income,
        priorColor: CHART_COLORS.incomePrior,
        ariaLabel: 'Total income by period',
        formatAxis: formatCompactIDR,
        head: {
            value: formatIDR(safeNumber(performance.revenue)),
            valueLabel: getRangeCaption(),
            priorValue: hasPrior && performance.previousRevenue !== null && performance.previousRevenue !== undefined
                ? formatIDR(safeNumber(performance.previousRevenue))
                : null,
            priorLabel,
            change: performance.revenueChangePct
        },
        buildTooltip: (bucket, index) => {
            const prior = priorBuckets[index];
            return `
                <div class="chart-tooltip-header">${escapeHtml(bucket.label)}</div>
                ${tooltipRow(CHART_COLORS.income, 'Income', formatIDR(bucket.revenue))}
                ${prior ? tooltipRow(CHART_COLORS.incomePrior, priorLabel, formatIDR(prior.revenue), true) : ''}
            `;
        }
    });

    // 3. Total expenses — `invert` so falling spend reads as good.
    renderTrendMetricCard(document.getElementById('total-expenses-card'), {
        shape: 'line',
        buckets,
        priorBuckets,
        compact: true,
        valueOf: bucket => bucket.expense,
        color: CHART_COLORS.expense,
        priorColor: CHART_COLORS.expensePrior,
        ariaLabel: 'Total expenses by period',
        formatAxis: formatCompactIDR,
        head: {
            value: formatIDR(safeNumber(performance.opex)),
            valueLabel: getRangeCaption(),
            priorValue: hasPrior && performance.previousOpex !== null && performance.previousOpex !== undefined
                ? formatIDR(safeNumber(performance.previousOpex))
                : null,
            priorLabel,
            change: performance.opexChangePct,
            invert: true
        },
        buildTooltip: (bucket, index) => {
            const prior = priorBuckets[index];
            return `
                <div class="chart-tooltip-header">${escapeHtml(bucket.label)}</div>
                ${tooltipRow(CHART_COLORS.expense, 'Expenses', formatIDR(bucket.expense))}
                ${prior ? tooltipRow(CHART_COLORS.expensePrior, priorLabel, formatIDR(prior.expense), true) : ''}
            `;
        }
    });

    renderGrossMarginChart(buckets, priorBuckets, priorLabel);
    renderExpenseBreakdownChart(overview);
    renderBankDistributionChart(overview);
}

// Gross profit margin = (revenue - cost of revenue) / revenue.
//
// Without a mapped cost-of-revenue account there is no COGS to subtract, and
// showing (revenue - 0) / revenue would report a flat 100% margin for every
// business. That is a fabricated figure on a financial statement line, so the
// card renders a setup state instead. Same call report-builder.js makes when it
// returns a null grossMargin rather than inventing one.
function renderGrossMarginChart(buckets, priorBuckets, priorLabel) {
    const card = document.getElementById('gross-margin-card');
    if (!card) return;

    if (!cogsKeys.size) {
        renderTrendMetricCard(card, {
            emptyState: {
                title: 'Cost of revenue not mapped',
                description: 'Map at least one category to Cost of revenue in Accounting to see gross profit margin. Until then, FluxyOS will not guess a margin.',
                buttonText: 'Open Accounting',
                onAction: () => { window.location.href = '/accounting'; }
            }
        });
        return;
    }

    const totals = buckets.reduce((acc, bucket) => {
        acc.revenue += bucket.revenue;
        acc.cogs += bucket.cogs;
        return acc;
    }, { revenue: 0, cogs: 0 });
    const priorTotals = priorBuckets.reduce((acc, bucket) => {
        acc.revenue += bucket.revenue;
        acc.cogs += bucket.cogs;
        return acc;
    }, { revenue: 0, cogs: 0 });

    const marginOf = t => t.revenue > 0 ? ((t.revenue - t.cogs) / t.revenue) * 100 : null;
    const current = marginOf(totals);
    const prior = priorBuckets.length ? marginOf(priorTotals) : null;
    // Margins compare in points, not percent-of-percent — matches the Gross
    // margin KPI card's renderMarginStatus.
    const changePoints = (current !== null && prior !== null) ? current - prior : null;

    renderTrendMetricCard(card, {
        shape: 'line',
        buckets,
        priorBuckets,
        compact: true,
        allowNegative: true,
        valueOf: bucket => bucket.grossMarginPct,
        color: CHART_COLORS.margin,
        priorColor: CHART_COLORS.marginPrior,
        ariaLabel: 'Gross profit margin by period',
        formatAxis: value => formatPercentValue(value, 0),
        head: {
            value: current === null ? 'N/A' : formatPercentValue(current),
            valueLabel: getRangeCaption(),
            priorValue: prior === null ? null : formatPercentValue(prior),
            priorLabel,
            change: changePoints,
            changeUnit: 'points'
        },
        buildTooltip: (bucket, index) => {
            const priorBucket = priorBuckets[index];
            return `
                <div class="chart-tooltip-header">${escapeHtml(bucket.label)}</div>
                ${tooltipRow(CHART_COLORS.margin, 'Gross margin', bucket.grossMarginPct === null ? 'N/A' : formatPercentValue(bucket.grossMarginPct))}
                ${tooltipRow(CHART_COLORS.income, 'Revenue', formatIDR(bucket.revenue))}
                ${tooltipRow('#94A3B8', 'Cost of revenue', formatIDR(bucket.cogs))}
                ${priorBucket ? tooltipRow(CHART_COLORS.marginPrior, priorLabel, priorBucket.grossMarginPct === null ? 'N/A' : formatPercentValue(priorBucket.grossMarginPct), true) : ''}
            `;
        }
    });
}

// Expense breakdown donut. Reuses calculateExpenseBreakdown from report-builder
// (the same aggregation the Expense report ships) rather than a second grouping.
function renderExpenseBreakdownChart(overview) {
    const breakdown = calculateExpenseBreakdown(overview?.chartTransactions || [], []);
    renderDonutCard(document.getElementById('expense-breakdown-card'), {
        rows: (breakdown.categories || []).map(row => ({
            label: row.category || 'Uncategorized',
            value: row.amount
        })),
        totalLabel: 'Total expenses',
        ariaLabel: 'Expense breakdown by category',
        formatValue: formatIDR,
        emptyState: {
            title: 'No expenses in this period',
            description: 'Expense categories appear here once you record spending in the selected period.'
        }
    });
}

// Bank balance distribution. Per-account balances ride along on overview.bankCash
// so this needs no extra read.
function renderBankDistributionChart(overview) {
    const accounts = overview?.bankCash?.accounts || [];
    renderDonutCard(document.getElementById('bank-distribution-card'), {
        rows: accounts.map(account => ({
            label: account.name,
            value: account.balance
        })),
        totalLabel: 'Total balance',
        ariaLabel: 'Bank balance distribution by account',
        formatValue: formatIDR,
        emptyState: {
            title: 'No bank balances yet',
            description: 'Add a bank balance to see how your cash is spread across accounts.',
            buttonText: 'Add bank balance',
            onAction: () => document.querySelector('[data-finance-setup-open="bank"]')?.click()
        }
    });
}

function getRangeCaption() {
    return dashboardPeriodMode === 'all_time'
        ? 'All time'
        : formatRangeLabel(dashboardRangeStart, dashboardRangeEnd);
}

function clearOverviewCharts(message) {
    overviewChartState = null;
    ['net-profit-card', 'total-income-card', 'total-expenses-card', 'gross-margin-card'].forEach(id => {
        const card = document.getElementById(id);
        if (!card) return;
        const head = card.querySelector('[data-chart-head]');
        const plot = card.querySelector('[data-chart-plot]');
        if (head) head.innerHTML = '';
        if (plot) plot.innerHTML = `<div class="chart-loading">${escapeHtml(message)}</div>`;
    });
    ['expense-breakdown-card', 'bank-distribution-card'].forEach(id => {
        const body = document.getElementById(id)?.querySelector('[data-chart-donut]');
        if (body) body.innerHTML = `<div class="chart-loading">${escapeHtml(message)}</div>`;
    });
}

// A line chart's viewBox is baked from the measured container width, so a width
// change (sidebar collapse, breakpoint, window resize) must redraw or the plot
// stretches. Debounced, and it repaints from cached data — no refetch.
let overviewChartResizeTimer = null;
window.addEventListener('resize', () => {
    if (!overviewChartState) return;
    clearTimeout(overviewChartResizeTimer);
    overviewChartResizeTimer = setTimeout(() => paintOverviewCharts(), 180);
});

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
    if (event.target.closest('[data-ask-fluxy]')) {
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
        window.showToast?.('Enter a budget greater than Rp0.', 'error');
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
        <p class="bank-review-note">This will update OpEx vs Budget on Overview.</p>
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
