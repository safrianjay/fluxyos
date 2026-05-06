import DataService from './db-service.js';
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyCaJqmpEMulLdMvRT7mYf2K-XDw46-dT7A",
    authDomain: "fluxyos.firebaseapp.com",
    projectId: "fluxyos",
    storageBucket: "fluxyos.firebasestorage.app",
    messagingSenderId: "1084252368929",
    appId: "1:1084252368929:web:da73dc0db83fe592c7f360"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const ds = new DataService(app);

window.loadDashboard = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const stats = await ds.getDashboardStats(user.uid);
    const transactions = await ds.getTransactions(user.uid, 5);

    // Update KPIs
    updateKPI('kpi-revenue', `Rp ${stats.revenue.toLocaleString()}`);
    updateKPI('kpi-opex', `Rp ${stats.opex.toLocaleString()}`);
    updateKPI('kpi-margin', `${stats.margin.toFixed(1)}%`);
    if (document.getElementById('kpi-margin-bar')) {
        document.getElementById('kpi-margin-bar').style.width = `${stats.margin}%`;
    }

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
                <span class="${tx.type === 'revenue' ? 'bg-gray-100 text-gray-600' : 'bg-[#FFEDD5] text-[#C2410C]'} px-2 py-0.5 rounded text-[11px] font-bold">
                    ${tx.category}
                </span>
            </td>
            <td class="px-5 py-3.5 text-gray-600 text-[12px] font-medium">${tx.entity || 'Main Entity'}</td>
            <td class="px-5 py-3.5 text-right font-mono font-bold ${tx.type === 'revenue' ? 'text-green-600' : 'text-gray-900'}">
                ${tx.type === 'revenue' ? '+' : ''}Rp ${Math.abs(tx.amount).toLocaleString()}
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
