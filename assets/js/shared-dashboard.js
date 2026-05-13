/**
 * Global Transaction Modal
 */
(function loadFluxyPageTransition() {
    if (window.__fluxyPageTransitionScriptRequested) return;
    window.__fluxyPageTransitionScriptRequested = true;

    const script = document.createElement('script');
    script.src = '/assets/js/page-transition.js';
    script.defer = true;
    document.head.appendChild(script);
})();

window.showAddTransactionModal = function(options = {}) {
    const {
        title = "Add Transaction",
        submitLabel = "Add Transaction",
        defaultType = 'expense',
        defaultCategory = 'Operations',
        context = 'transaction' // 'transaction', 'bill', 'subscription'
    } = options;
    const supportsBulkCsv = context === 'transaction';

    // Always destroy and recreate so context options (title, labels) are fresh
    const existing = document.getElementById('global-tx-modal');
    if (existing) existing.parentElement.remove();

    const modalHTML = `
        <div id="global-tx-modal" class="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div class="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onclick="window.closeAddTransactionModal()"></div>
            <div class="bg-white w-full max-w-lg max-h-[92vh] rounded-2xl shadow-2xl relative z-10 overflow-hidden animate-in zoom-in-95 duration-300 flex flex-col">
                <div class="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <h3 class="text-lg font-bold text-gray-900">${title}</h3>
                    <button onclick="window.closeAddTransactionModal()" class="text-gray-400 hover:text-gray-600 transition-colors">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <form id="global-tx-form" class="p-6 space-y-5 overflow-y-auto">
                    <div>
                        <label for="tx-amount" class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Amount (Rp)</label>
                        <input type="text" id="tx-amount" name="amount" required placeholder="0" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#E85D19] focus:border-[#E85D19] outline-none font-mono font-bold text-lg">
                    </div>
                    <div>
                        <label for="tx-vendor" class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Vendor / Description</label>
                        <input type="text" id="tx-vendor" name="vendor" required placeholder="e.g. AWS, Client Payment" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#E85D19]">
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label for="tx-category" class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Category</label>
                            <select id="tx-category" name="category" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#E85D19]">
                                <option value="Revenue" ${defaultCategory === 'Revenue' ? 'selected' : ''}>Revenue</option>
                                <option value="Marketing" ${defaultCategory === 'Marketing' ? 'selected' : ''}>Marketing</option>
                                <option value="Infrastructure" ${defaultCategory === 'Infrastructure' ? 'selected' : ''}>Infrastructure</option>
                                <option value="Operations" ${defaultCategory === 'Operations' ? 'selected' : ''}>Operations</option>
                                <option value="SaaS" ${defaultCategory === 'SaaS' ? 'selected' : ''}>SaaS</option>
                            </select>
                        </div>
                        <div>
                            <label for="tx-type" class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Type</label>
                            <select id="tx-type" name="type" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#E85D19]">
                                <option value="expense" ${defaultType === 'expense' ? 'selected' : ''}>Expense</option>
                                <option value="revenue" ${defaultType === 'revenue' ? 'selected' : ''}>Revenue</option>
                            </select>
                        </div>
                    </div>
                    ${supportsBulkCsv ? `
                    <div class="border-t border-gray-100 pt-5">
                        <div class="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 transition-all duration-200" id="tx-csv-dropzone">
                            <div class="flex items-start gap-3">
                                <div class="w-9 h-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-[#E85D19] flex-shrink-0">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"></path></svg>
                                </div>
                                <div class="min-w-0 flex-1">
                                    <p class="text-[13px] font-bold text-gray-900">Bulk add from CSV</p>
                                    <p class="text-[12px] text-gray-500 mt-1 leading-relaxed">Use headers: <span class="font-mono">Description, Category, Type, Amount, Status</span>. Type must be <span class="font-mono">revenue</span> or <span class="font-mono">expense</span>; Status may be <span class="font-mono">Completed</span> or <span class="font-mono">Missing Receipt</span>.</p>
                                    <p class="text-[11px] text-gray-400 mt-2 font-mono">Example: Client Payment,Revenue,revenue,1250000,Completed</p>
                                </div>
                            </div>
                            <div class="mt-4 flex flex-col sm:flex-row gap-2">
                                <label for="tx-csv-file" class="flex-1 cursor-pointer px-3 py-2 bg-white border border-gray-200 rounded-lg text-[12px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors truncate" id="tx-csv-file-label">Choose CSV file</label>
                                <input type="file" id="tx-csv-file" accept=".csv,text/csv" class="sr-only">
                                <button type="button" id="tx-csv-upload-btn" class="px-3 py-2 bg-white border border-gray-200 rounded-lg text-[12px] font-bold text-gray-700 hover:bg-gray-50 transition-all duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60" disabled>Upload CSV</button>
                            </div>
                            <div id="tx-csv-feedback" class="hidden mt-3 text-[12px] font-medium"></div>
                        </div>
                    </div>
                    ` : ''}
                    <button type="submit" id="tx-submit-btn" class="w-full py-4 bg-[#E85D19] hover:bg-[#D44400] text-white font-bold rounded-xl shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2">
                        <span>${submitLabel}</span>
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    </button>
                </form>
            </div>
        </div>
    `;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = modalHTML;
    document.body.appendChild(wrapper);

    // Live Formatting for Amount
    const amountInput = document.getElementById('tx-amount');
    amountInput.oninput = (e) => {
        let value = e.target.value.replace(/\D/g, "");
        e.target.value = value.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    };

    async function getTransactionDataService() {
        const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js");
        const firebaseConfig = {
            apiKey: "AIzaSyCaJqmpEMulLdMvRT7mYf2K-XDw46-dT7A",
            authDomain: "fluxyos.firebaseapp.com",
            projectId: "fluxyos",
            storageBucket: "fluxyos.firebasestorage.app",
            messagingSenderId: "1084252368929",
            appId: "1:1084252368929:web:da73dc0db83fe592c7f360"
        };

        const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
        const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
        const auth = getAuth(app);
        const user = auth.currentUser;
        if (!user) throw new Error("Session expired. Please log in again.");

        const { default: DataService } = await import('/assets/js/db-service.js');
        return { ds: new DataService(app), user };
    }

    function parseCsv(text) {
        const rows = [];
        let current = '';
        let row = [];
        let inQuotes = false;

        for (let index = 0; index < text.length; index++) {
            const char = text[index];
            const next = text[index + 1];

            if (char === '"' && inQuotes && next === '"') {
                current += '"';
                index++;
            } else if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                row.push(current.trim());
                current = '';
            } else if ((char === '\n' || char === '\r') && !inQuotes) {
                if (char === '\r' && next === '\n') index++;
                row.push(current.trim());
                if (row.some(value => value !== '')) rows.push(row);
                row = [];
                current = '';
            } else {
                current += char;
            }
        }

        row.push(current.trim());
        if (row.some(value => value !== '')) rows.push(row);
        return rows;
    }

    function normalizeHeader(header) {
        return header.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function parseCsvAmount(value) {
        const cleaned = String(value || '').replace(/rp/gi, '').replace(/\s/g, '');
        const withoutGrouping = cleaned.includes(',') && cleaned.includes('.')
            ? cleaned.replace(/\./g, '').replace(',', '.')
            : cleaned.replace(/[.,](?=\d{3}(?:\D|$))/g, '');
        return parseFloat(withoutGrouping.replace(/[^\d.-]/g, ''));
    }

    function parseBulkTransactions(csvText) {
        const rows = parseCsv(csvText);
        if (rows.length < 2) throw new Error("CSV needs one header row and at least one transaction row.");
        if (rows.length > 501) throw new Error("CSV imports are limited to 500 transactions at a time.");

        const headers = rows[0].map(normalizeHeader);
        const findIndex = (names) => names.map(normalizeHeader).map(name => headers.indexOf(name)).find(index => index >= 0);
        const indexes = {
            vendor: findIndex(['vendor_name', 'vendor', 'description']),
            category: findIndex(['category']),
            type: findIndex(['type']),
            amount: findIndex(['amount']),
            status: findIndex(['status'])
        };

        if ([indexes.vendor, indexes.category, indexes.type, indexes.amount].some(index => index === undefined)) {
            throw new Error("CSV must include Description, Category, Type, and Amount columns.");
        }

        const allowedCategories = ['Revenue', 'Marketing', 'Infrastructure', 'Operations', 'SaaS'];
        const allowedTypes = ['revenue', 'expense'];
        const allowedStatuses = ['Completed', 'Missing Receipt'];

        return rows.slice(1).map((row, index) => {
            const line = index + 2;
            const amount = parseCsvAmount(row[indexes.amount]);
            const category = row[indexes.category];
            const type = String(row[indexes.type] || '').toLowerCase();
            const status = row[indexes.status] || 'Completed';
            const vendor = row[indexes.vendor];

            if (!vendor) throw new Error(`Row ${line}: Description is required.`);
            if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Row ${line}: Amount must be a positive number.`);
            if (!allowedCategories.includes(category)) throw new Error(`Row ${line}: Category must be Revenue, Marketing, Infrastructure, Operations, or SaaS.`);
            if (!allowedTypes.includes(type)) throw new Error(`Row ${line}: Type must be revenue or expense.`);
            if (!allowedStatuses.includes(status)) throw new Error(`Row ${line}: Status must be Completed or Missing Receipt.`);

            return {
                amount,
                vendor_name: vendor,
                category,
                type,
                status,
                icon: type === 'revenue' ? '💰' : '💸'
            };
        });
    }

    function setCsvFeedback(message, type = 'info') {
        const feedback = document.getElementById('tx-csv-feedback');
        if (!feedback) return;
        if (!message) {
            feedback.classList.add('hidden');
            feedback.textContent = '';
            return;
        }
        feedback.className = `mt-3 text-[12px] font-medium ${type === 'error' ? 'text-red-600' : type === 'success' ? 'text-green-700' : 'text-gray-500'}`;
        feedback.textContent = message;
        feedback.classList.remove('hidden');
    }

    if (supportsBulkCsv) {
        const fileInput = document.getElementById('tx-csv-file');
        const fileLabel = document.getElementById('tx-csv-file-label');
        const uploadButton = document.getElementById('tx-csv-upload-btn');
        const dropzone = document.getElementById('tx-csv-dropzone');

        fileInput.onchange = () => {
            const file = fileInput.files?.[0];
            uploadButton.disabled = !file;
            fileLabel.textContent = file ? file.name : 'Choose CSV file';
            setCsvFeedback(file ? 'Ready to upload. We will validate the rows before saving.' : '', 'info');
        };

        uploadButton.onclick = async () => {
            const file = fileInput.files?.[0];
            if (!file) return;

            uploadButton.disabled = true;
            uploadButton.textContent = 'Reading...';
            dropzone.classList.add('ring-2', 'ring-orange-100', 'border-[#E85D19]');

            try {
                const csvText = await file.text();
                const transactions = parseBulkTransactions(csvText);
                uploadButton.textContent = `Uploading ${transactions.length}...`;
                const { ds, user } = await getTransactionDataService();
                await ds.addTransactions(user.uid, transactions);
                setCsvFeedback(`${transactions.length} transactions imported successfully.`, 'success');
                uploadButton.textContent = 'Uploaded';
                fileInput.value = '';
                fileLabel.textContent = 'Choose CSV file';
                if (window.loadDashboard) await window.loadDashboard();
                if (window.loadLedger) await window.loadLedger();
                window.showToast(`${transactions.length} transactions imported from CSV.`, "success");
                window.setTimeout(() => {
                    uploadButton.textContent = 'Upload CSV';
                    uploadButton.disabled = true;
                    dropzone.classList.remove('ring-2', 'ring-orange-100', 'border-[#E85D19]');
                }, 1200);
            } catch (err) {
                console.error("CSV import failed:", err);
                setCsvFeedback(err.message, 'error');
                uploadButton.textContent = 'Upload CSV';
                uploadButton.disabled = false;
                dropzone.classList.remove('ring-2', 'ring-orange-100', 'border-[#E85D19]');
            }
        };
    }

    // Form Submission
    document.getElementById('global-tx-form').onsubmit = async (e) => {
        e.preventDefault();
        const btn = document.getElementById('tx-submit-btn');
        btn.disabled = true;
        btn.innerText = "Deploying...";

        try {
            const rawAmount = document.getElementById('tx-amount').value.replace(/\./g, "");
            const data = {
                amount: parseFloat(rawAmount),
                vendor_name: document.getElementById('tx-vendor').value,
                category: document.getElementById('tx-category').value,
                type: document.getElementById('tx-type').value,
                status: 'Completed',
                icon: document.getElementById('tx-type').value === 'revenue' ? '💰' : '💸'
            };

            // Initialize Firebase if not already done
            const { ds, user } = await getTransactionDataService();

            if (user) {
                if (context === 'bill') {
                    await ds.addBill(user.uid, data);
                    window.closeAddTransactionModal();
                    if (window.loadBills) await window.loadBills();
                    window.showToast("Bill successfully added to your schedule!", "success");
                } else if (context === 'subscription') {
                    await ds.addSubscription(user.uid, data);
                    window.closeAddTransactionModal();
                    if (window.loadSubscriptions) await window.loadSubscriptions();
                    window.showToast("Subscription successfully activated!", "success");
                } else {
                    await ds.addTransaction(user.uid, data);
                    window.closeAddTransactionModal();
                    if (window.loadDashboard) await window.loadDashboard();
                    if (window.loadLedger) await window.loadLedger();
                    window.showToast("Transaction successfully deployed to your live ledger!", "success");
                }
            } else {
                window.showToast("Session expired. Please log in again.", "error");
            }
        } catch (err) {
            console.error("FluxyOS Engine Error:", err);
            if (err.message.includes('permission-denied') || err.code === 'permission-denied') {
                window.showToast("CRITICAL: Permission Denied. Check Firestore Rules.", "error");
            } else if (err.message.includes('Session expired')) {
                window.showToast("Session expired. Please log in again.", "error");
            } else {
                window.showToast("FluxyOS Engine Error: " + err.message, "error");
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<span>${submitLabel}</span><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>`;
        }
    };
};

/**
 * Global Toast System
 */
window.showToast = function(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'fixed top-6 right-6 z-[200] flex flex-col gap-3 pointer-events-none';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const colors = {
        success: 'bg-green-600 border-green-500',
        error: 'bg-red-600 border-red-500',
        info: 'bg-blue-600 border-blue-500'
    };
    
    toast.className = `
        flex items-center gap-3 px-5 py-4 rounded-xl shadow-2xl border text-white font-bold text-[13px] 
        animate-in slide-in-from-right-full duration-500 pointer-events-auto min-w-[300px]
        ${colors[type] || colors.info}
    `;

    const icon = type === 'success' 
        ? '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>'
        : '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';

    toast.innerHTML = `
        <div class="flex-shrink-0">${icon}</div>
        <div class="flex-1">${message}</div>
    `;

    container.appendChild(toast);

    // Auto-remove
    setTimeout(() => {
        toast.classList.add('animate-out', 'fade-out', 'slide-out-to-right-full', 'duration-500');
        setTimeout(() => toast.remove(), 500);
    }, 4000);
};

window.closeAddTransactionModal = function() {
    const modal = document.getElementById('global-tx-modal');
    if (modal) {
        // Fully remove so next open creates fresh context
        modal.parentElement.remove();
    }
};

window.renderEmptyState = function(containerId, config) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const defaultConfig = {
        title: "No Data Found",
        description: "Start by adding your first record to see the engine in motion.",
        buttonText: "Add Record",
        onAction: () => window.showAddTransactionModal(),
        icon: `<svg class="w-8 h-8 text-[#E85D19]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>`
    };

    const c = { ...defaultConfig, ...config };

    container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-20 text-center px-6 animate-in fade-in duration-700">
            <div class="w-20 h-20 bg-orange-50 rounded-full flex items-center justify-center mb-6 shadow-sm border border-orange-100">
                ${c.icon}
            </div>
            <h3 class="text-xl font-bold text-gray-900 mb-2 tracking-tight">${c.title}</h3>
            <p class="text-[14px] text-gray-500 max-w-[320px] leading-relaxed mb-8">${c.description}</p>
            <button id="empty-state-action" class="inline-flex items-center gap-2 bg-[#E85D19] hover:bg-[#D44400] text-white font-bold text-[13px] px-6 py-3 rounded-xl transition-all shadow-md hover:shadow-lg">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"></path></svg>
                ${c.buttonText}
            </button>
        </div>
    `;

    document.getElementById('empty-state-action').onclick = c.onAction;
};

// Global toggle for Fluxy AI (Drawer)
window.toggleFluxyAI = (state) => {
    if (window.toggleAI) window.toggleAI(state);
    else console.warn("AI Chat not loaded yet");
};

/**
 * Shimmer Loading System
 */
window.renderShimmer = function(containerId, rowCount = 5) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const rows = Array(rowCount).fill(0).map(() => `
        <tr class="animate-pulse">
            <td class="px-6 py-4"><div class="h-4 bg-gray-200 rounded w-24"></div></td>
            <td class="px-6 py-4"><div class="h-4 bg-gray-200 rounded w-48"></div></td>
            <td class="px-6 py-4"><div class="h-4 bg-gray-200 rounded w-20"></div></td>
            <td class="px-6 py-4"><div class="h-4 bg-gray-200 rounded w-16"></div></td>
            <td class="px-6 py-4 text-right"><div class="h-4 bg-gray-200 rounded w-12 ml-auto"></div></td>
        </tr>
    `).join('');

    container.innerHTML = rows;
};
