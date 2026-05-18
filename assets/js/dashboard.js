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

window.loadDashboard = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const [stats, transactions, chartTransactions] = await Promise.all([
        ds.getDashboardStats(user.uid),
        ds.getTransactions(user.uid, 5),
        ds.getTransactions(user.uid, 1000)
    ]);

    // Update KPIs
    updateKPI('kpi-revenue', formatIDR(stats.revenue));
    updateKPI('kpi-opex', formatIDR(stats.opex));
    updateKPI('kpi-margin', `${stats.margin.toFixed(1)}%`);
    if (document.getElementById('kpi-margin-bar')) {
            document.getElementById('kpi-margin-bar').style.width = `${stats.margin}%`;
    }

    cashflowBuckets = buildCashflowBuckets(chartTransactions);
    renderCashflowChart();
    attachCashflowChartToggle();

    // Update Ledger Table or Show Empty State
    const tableContainer = document.getElementById('ledger-table-container');
    const emptyContainer = document.getElementById('ledger-empty-state');
    const footer = document.getElementById('ledger-footer');
    const ledgerBody = document.getElementById('ledger-body');
    
    if (transactions.length === 0) {
        if (tableContainer) tableContainer.classList.add('hidden');
        if (footer) footer.classList.add('hidden');
        if (emptyContainer) {
            emptyContainer.classList.remove('hidden');
            window.renderEmptyState('ledger-empty-state', {
                title: "Your financial trail starts here.",
                description: "No transactions found in your live ledger. Log your first expense or revenue point to start tracking your business engine.",
                buttonText: "Log First Transaction",
                onAction: () => window.showAddTransactionModal()
            });
        }
    } else {
        if (tableContainer) tableContainer.classList.remove('hidden');
        if (footer) footer.classList.remove('hidden');
        if (emptyContainer) emptyContainer.classList.add('hidden');
        renderLedgerRows(transactions);
    }
};

function updateKPI(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function isPositiveTransaction(tx) {
    return ['revenue', 'income', 'refund', 'pending_receivable'].includes(String(tx.type || '').toLowerCase());
}

function isSpendTransaction(tx) {
    return ['expense', 'fee', 'tax', 'pending_payable'].includes(String(tx.type || '').toLowerCase());
}

function getTxDate(tx) {
    if (tx.timestamp && typeof tx.timestamp.toDate === 'function') return tx.timestamp.toDate();
    if (tx.timestamp instanceof Date) return tx.timestamp;
    if (typeof tx.timestamp === 'string' || typeof tx.timestamp === 'number') {
        const parsed = new Date(tx.timestamp);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}

function buildCashflowBuckets(txs) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const buckets = [];

    for (let startDay = 1; startDay <= lastDay; startDay += 7) {
        const endDay = Math.min(startDay + 6, lastDay);
        buckets.push({
            label: `${startDay}-${endDay}`,
            revenue: 0,
            spend: 0
        });
    }

    txs.forEach(tx => {
        const date = getTxDate(tx);
        if (!date || date.getFullYear() !== year || date.getMonth() !== month) return;

        const index = Math.floor((date.getDate() - 1) / 7);
        const bucket = buckets[index];
        if (!bucket) return;

        const amount = Math.abs(Number(tx.amount) || 0);
        if (isPositiveTransaction(tx)) bucket.revenue += amount;
        else if (isSpendTransaction(tx)) bucket.spend += amount;
    });

    return buckets;
}

function formatIDR(value) {
    return `Rp ${Math.round(Math.abs(value || 0)).toLocaleString('id-ID')}`;
}

function formatCompactIDR(value) {
    return formatIDR(value);
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
                        <div class="cashflow-bar-group"
                            data-chart-bar
                            data-label="${item.label}"
                            data-revenue="${item.revenue}"
                            data-spend="${item.spend}">
                            <div class="cashflow-bar cashflow-bar-revenue" style="height: ${revenueHeight}%"></div>
                            <div class="cashflow-bar cashflow-bar-spend" style="height: ${spendHeight}%"></div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
        <div class="cashflow-labels">
            ${cashflowBuckets.map(item => `<span>${item.label}</span>`).join('')}
        </div>
    `;

    if (window.attachChartHover) {
        window.attachChartHover(chart.querySelector('[data-cashflow-bar-stage]'), {
            bars: '[data-chart-bar]',
            orientation: 'vertical',
            buildTooltip: (barEl) => `
                <div class="chart-tooltip-header">${barEl.dataset.label}</div>
                <div class="chart-tooltip-row">
                    <span class="chart-tooltip-swatch" style="background:#4ADE80"></span>
                    <span class="chart-tooltip-label">Revenue</span>
                    <span class="chart-tooltip-value">${formatIDR(Number(barEl.dataset.revenue || 0))}</span>
                </div>
                <div class="chart-tooltip-row">
                    <span class="chart-tooltip-swatch" style="background:#D1D5DB"></span>
                    <span class="chart-tooltip-label">Spend</span>
                    <span class="chart-tooltip-value">${formatIDR(Number(barEl.dataset.spend || 0))}</span>
                </div>
            `
        });
    }
}

function buildLinePoints(values, maxValue, width, height, paddingX, paddingY) {
    if (values.length === 1) {
        const y = height - paddingY - ((values[0] / maxValue) * (height - paddingY * 2));
        return [{ x: width / 2, y }];
    }

    return values.map((value, index) => {
        const x = paddingX + (index / (values.length - 1)) * (width - paddingX * 2);
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
        <div class="cashflow-line-stage">
            <div class="cashflow-axis">
                <div><span>${formatCompactIDR(maxValue)}</span></div>
                <div><span>${formatCompactIDR(maxValue / 2)}</span></div>
                <div><span>Rp 0</span></div>
            </div>
            <svg class="cashflow-line-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cash flow line chart">
                <polyline class="cashflow-line cashflow-line-revenue" points="${toPolyline(revenuePoints)}"></polyline>
                <polyline class="cashflow-line cashflow-line-spend" points="${toPolyline(spendPoints)}"></polyline>
                ${revenuePoints.map((point, index) => `<circle class="cashflow-point cashflow-point-revenue" cx="${point.x}" cy="${point.y}" r="4"><title>${cashflowBuckets[index].label} Revenue ${formatIDR(revenueValues[index])}</title></circle>`).join('')}
                ${spendPoints.map((point, index) => `<circle class="cashflow-point cashflow-point-spend" cx="${point.x}" cy="${point.y}" r="4"><title>${cashflowBuckets[index].label} Spend ${formatIDR(spendValues[index])}</title></circle>`).join('')}
            </svg>
        </div>
        <div class="cashflow-labels">
            ${cashflowBuckets.map(item => `<span>${item.label}</span>`).join('')}
        </div>
    `;
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
                        ${tx.icon || '💰'}
                    </div>
                    <div>
                        <p class="font-bold text-gray-900">${tx.vendor_name}</p>
                        <p class="text-[11px] text-gray-500">${tx.timestamp?.toDate().toLocaleString() || 'Just now'}</p>
                    </div>
                </div>
            </td>
            <td class="px-5 py-3.5">
                <span class="${isPositiveTransaction(tx) ? 'bg-gray-100 text-gray-600' : 'bg-[#FFEDD5] text-[#C2410C]'} px-2 py-0.5 rounded text-[11px] font-bold">
                    ${tx.category}
                </span>
            </td>
            <td class="px-5 py-3.5 text-gray-600 text-[12px] font-medium">${tx.entity || 'Main Entity'}</td>
            <td class="px-5 py-3.5 text-right font-mono font-bold ${isPositiveTransaction(tx) ? 'text-green-600' : 'text-gray-900'}">
                ${isPositiveTransaction(tx) ? '+' : ''}${formatIDR(tx.amount)}
            </td>
            <td class="px-5 py-3.5 text-right">
                <span class="inline-flex items-center gap-1.5 ${tx.status === 'Missing Receipt' ? 'text-red-500 bg-red-50 px-2 py-1 rounded text-[10px]' : 'text-green-600 text-[11px]'} font-bold">
                    ${tx.status}
                </span>
            </td>
        </tr>
    `).join('');
}

// Auth state is handled by the page-level script in dashboard.html
// Do NOT add another onAuthStateChanged here — it causes loadDashboard() to run twice.
