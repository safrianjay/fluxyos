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

function loadFluxyDateRangePicker() {
    if (window.FluxyDateRangePicker) return Promise.resolve(window.FluxyDateRangePicker);
    if (window.__fluxyDateRangePickerPromise) return window.__fluxyDateRangePickerPromise;

    window.__fluxyDateRangePickerPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/assets/js/date-range-picker.js';
        script.onload = () => resolve(window.FluxyDateRangePicker);
        script.onerror = () => reject(new Error('Unable to load date picker.'));
        document.head.appendChild(script);
    });

    return window.__fluxyDateRangePickerPromise;
}

async function compressReceiptImage(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const MAX = 1200;
            let { width, height } = img;
            if (width > MAX || height > MAX) {
                if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
                else { width = Math.round(width * MAX / height); height = MAX; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            canvas.toBlob(blob => blob ? resolve(new File([blob], file.name, { type: 'image/jpeg' })) : reject(new Error('Compression failed')), 'image/jpeg', 0.8);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
        img.src = url;
    });
}
window.__compressReceiptImage = compressReceiptImage;

window.showAddTransactionModal = function(options = {}) {
    const {
        title = "Add Transaction",
        submitLabel = "Add Transaction",
        defaultType = 'expense',
        defaultCategory = 'Operations',
        context = 'transaction' // 'transaction', 'bill', 'subscription'
    } = options;
    const supportsBulkCsv = context === 'transaction';
    const todayKey = getLocalDateKey();

    // Always destroy and recreate so context options (title, labels) are fresh
    const existing = document.getElementById('global-tx-modal');
    if (existing) {
        existing.parentElement.remove();
        document.body.classList.remove('overflow-hidden');
    }
    if (window.__closeAddTransactionModalOnEscape) {
        document.removeEventListener('keydown', window.__closeAddTransactionModalOnEscape);
    }

    const modalHTML = `
        <div id="global-tx-modal" class="fixed inset-0 z-[100] flex justify-end overflow-hidden">
            <div id="global-tx-overlay" class="absolute inset-0 bg-black/55 opacity-0 transition-opacity duration-300 ease-out" onclick="window.closeAddTransactionModal()"></div>
            <div id="global-tx-drawer" role="dialog" aria-modal="true" aria-labelledby="global-tx-title" class="relative z-10 flex h-full w-full max-w-[440px] translate-x-full flex-col overflow-hidden bg-white shadow-2xl transition-transform duration-300 ease-out sm:max-w-[480px]">
                <div class="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <div>
                        <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">Finance entry</p>
                        <h3 id="global-tx-title" class="mt-1 text-lg font-bold text-gray-900">${title}</h3>
                    </div>
                    <button onclick="window.closeAddTransactionModal()" class="text-gray-400 hover:text-gray-600 transition-colors">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <form id="global-tx-form" class="flex flex-1 flex-col overflow-hidden">
                    <div class="flex-1 space-y-5 overflow-y-auto p-6">
                    ${supportsBulkCsv ? `
                    <div class="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1" role="tablist" aria-label="Transaction entry method">
                        <button type="button" id="tx-tab-single" class="tx-entry-tab rounded-lg px-3 py-2 text-[13px] font-bold transition-all bg-white text-gray-900 shadow-sm" aria-selected="true" aria-controls="tx-single-panel">Single transaction</button>
                        <button type="button" id="tx-tab-bulk" class="tx-entry-tab rounded-lg px-3 py-2 text-[13px] font-bold transition-all text-gray-500 hover:text-gray-900" aria-selected="false" aria-controls="tx-bulk-panel">CSV bulk upload</button>
                    </div>
                    ` : ''}
                    <div id="tx-single-panel" class="space-y-5">
                        <div>
                            <label for="tx-amount" class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Amount (Rp)</label>
                            <input type="text" id="tx-amount" name="amount" required placeholder="0" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#E85D19] focus:border-[#E85D19] outline-none font-mono font-bold text-lg">
                        </div>
                        <div>
                            <label for="tx-vendor" class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Vendor / Description</label>
                            <input type="text" id="tx-vendor" name="vendor" required placeholder="e.g. AWS, Client Payment" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#E85D19]">
                        </div>
                        <div>
                            <p class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">${context === 'bill' ? 'Due Date' : 'Transaction Date'}</p>
                            <div id="tx-date-picker"></div>
                            <p class="mt-2 text-[12px] text-gray-500">${context === 'bill' ? 'Set when this bill is due for payment. Future dates are allowed.' : 'Defaults to today. Choose a previous day for backdated records.'}</p>
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
                                    <option value="Others">Others</option>
                                </select>
                                <input id="tx-category-custom" type="text" maxlength="20" placeholder="Type category (max 20 chars)" class="hidden mt-2 w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#E85D19] text-[13px]" />
                            </div>
                            <div>
                                <label for="tx-type" class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Type</label>
                                <select id="tx-type" name="type" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#E85D19]">
                                    ${context === 'bill' ? `
                                    <option value="expense" selected>Expense</option>
                                    <option value="pending_payable">Pending payable</option>
                                    ` : `
                                    <option value="income" ${defaultType === 'income' || defaultType === 'revenue' ? 'selected' : ''}>Income</option>
                                    <option value="expense" ${defaultType === 'expense' ? 'selected' : ''}>Expense</option>
                                    <option value="transfer" ${defaultType === 'transfer' ? 'selected' : ''}>Transfer</option>
                                    <option value="refund" ${defaultType === 'refund' ? 'selected' : ''}>Refund</option>
                                    <option value="adjustment" ${defaultType === 'adjustment' ? 'selected' : ''}>Adjustment</option>
                                    <option value="fee" ${defaultType === 'fee' ? 'selected' : ''}>Fee</option>
                                    <option value="tax" ${defaultType === 'tax' ? 'selected' : ''}>Tax</option>
                                    <option value="pending_receivable" ${defaultType === 'pending_receivable' ? 'selected' : ''}>Pending receivable</option>
                                    <option value="pending_payable" ${defaultType === 'pending_payable' ? 'selected' : ''}>Pending payable</option>
                                    `}
                                </select>
                            </div>
                        </div>
                        ${context !== 'bill' ? `<div>
                            <label for="tx-status" class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Status</label>
                            <select id="tx-status" name="status" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#E85D19]">
                                <option value="Completed">Completed</option>
                                <option value="Reconciled">Reconciled</option>
                                <option value="Pending">Pending</option>
                                <option value="Missing Receipt">Missing Receipt</option>
                                <option value="Cancelled">Cancelled</option>
                            </select>
                        </div>` : ''}
                        ${context !== 'bill' ? `<div id="tx-receipt-section">
                            <label class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Receipt (optional)</label>
                            <label id="tx-receipt-label" for="tx-receipt-file" class="flex items-center gap-3 px-4 py-3 bg-gray-50 border border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-gray-400 transition-colors group">
                                <svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path></svg>
                                <span id="tx-receipt-filename" class="text-[13px] text-gray-500 truncate flex-1">Attach receipt image</span>
                                <button type="button" id="tx-receipt-remove" class="hidden text-gray-400 hover:text-red-500 transition-colors" aria-label="Remove receipt">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                </button>
                            </label>
                            <input type="file" id="tx-receipt-file" accept="image/*" class="sr-only">
                            <div id="tx-receipt-preview-wrapper" class="hidden mt-2">
                                <img id="tx-receipt-preview" src="" alt="Receipt preview" class="w-full rounded-xl border border-gray-200 object-contain max-h-48">
                            </div>
                            <p class="mt-1.5 text-[11px] text-gray-400">JPG, PNG or WebP · Max 1 MB · Compress the image first if it's too large</p>
                        </div>` : ''}
                    </div>
                    ${supportsBulkCsv ? `
                    <div id="tx-bulk-panel" class="hidden space-y-4">
                        <div class="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-5 transition-all duration-200" id="tx-csv-dropzone">
                            <label for="tx-csv-file" class="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-gray-200 bg-white px-5 py-7 text-center transition-all duration-200 hover:border-[#E85D19] hover:bg-gray-50">
                                <span class="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 text-[#E85D19]">
                                    <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"></path></svg>
                                </span>
                                <span id="tx-csv-file-label" class="max-w-full truncate text-[13px] font-bold text-gray-900">Choose or drop a CSV file</span>
                                <span class="mt-1 text-[12px] text-gray-500">The file is validated before anything is saved.</span>
                            </label>
                            <input type="file" id="tx-csv-file" accept=".csv,text/csv" class="sr-only">
                            <div id="tx-csv-feedback" class="hidden mt-3 text-[12px] font-medium"></div>
                        </div>
                        <div class="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-[13px] font-bold text-gray-900">Override row status</p>
                                    <p class="text-[11px] text-gray-500">Apply one status to every uploaded row</p>
                                </div>
                                <button type="button" id="tx-bulk-status-toggle"
                                    class="relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border-2 border-transparent bg-gray-200 transition-colors focus:outline-none"
                                    role="switch" aria-checked="false">
                                    <span class="inline-block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition-transform"></span>
                                </button>
                            </div>
                            <div id="tx-bulk-status-panel" class="hidden space-y-2">
                                <select id="tx-bulk-status-select"
                                    class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#E85D19] text-[13px]">
                                    <option value="Completed">Completed</option>
                                    <option value="Reconciled">Reconciled</option>
                                    <option value="Pending">Pending</option>
                                    <option value="Missing Receipt">Missing Receipt</option>
                                    <option value="Cancelled">Cancelled</option>
                                </select>
                                <p id="tx-bulk-status-note" class="hidden rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[12px] text-blue-800"></p>
                            </div>
                        </div>
                        <div class="rounded-xl border border-gray-200 bg-white p-4">
                            <div class="flex items-center justify-between mb-3">
                                <p class="text-[12px] font-bold uppercase tracking-wider text-gray-400">CSV Column Reference</p>
                                <div class="flex items-center gap-3 text-[10px] font-bold text-gray-500">
                                    <span class="flex items-center gap-1"><span class="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>Required</span>
                                    <span class="flex items-center gap-1"><span class="inline-block w-2 h-2 rounded-full bg-gray-300"></span>Optional</span>
                                </div>
                            </div>
                            <div class="mb-3 rounded-lg border border-gray-200 overflow-hidden">
                                <p class="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 bg-white border-b border-gray-100">Example CSV</p>
                                <div class="overflow-x-auto">
                                    <table class="w-full text-left">
                                        <thead>
                                            <tr class="bg-gray-50 border-b border-gray-200">
                                                <th class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">Description</th>
                                                <th class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">Category</th>
                                                <th class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">Type</th>
                                                <th class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">Amount</th>
                                                <th class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">Status</th>
                                                <th class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">Date</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr class="bg-white">
                                                <td class="px-3 py-2 font-mono text-[12px] text-gray-900 whitespace-nowrap">Client Payment</td>
                                                <td class="px-3 py-2 font-mono text-[12px] text-gray-900 whitespace-nowrap">Revenue</td>
                                                <td class="px-3 py-2 font-mono text-[12px] text-gray-900 whitespace-nowrap">Income</td>
                                                <td class="px-3 py-2 font-mono text-[12px] text-gray-900 whitespace-nowrap">1250000</td>
                                                <td class="px-3 py-2 font-mono text-[12px] text-gray-500 whitespace-nowrap">Completed</td>
                                                <td class="px-3 py-2 font-mono text-[12px] text-gray-500 whitespace-nowrap">${todayKey.split('-').reverse().join('-')}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div class="grid gap-1.5 text-[12px]">
                                <div class="flex items-start gap-2.5 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
                                    <span class="mt-1 inline-block w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0"></span>
                                    <span class="font-mono font-bold text-gray-900 w-24 flex-shrink-0">Description</span>
                                    <span class="text-gray-500">Vendor name or transaction memo</span>
                                </div>
                                <div class="flex items-start gap-2.5 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
                                    <span class="mt-1 inline-block w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0"></span>
                                    <span class="font-mono font-bold text-gray-900 w-24 flex-shrink-0">Category</span>
                                    <span class="text-gray-500">Revenue · Marketing · Infrastructure · Operations · SaaS</span>
                                </div>
                                <div class="flex items-start gap-2.5 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
                                    <span class="mt-1 inline-block w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0"></span>
                                    <span class="font-mono font-bold text-gray-900 w-24 flex-shrink-0">Type</span>
                                    <span class="text-gray-500">Income · Expense · Transfer · Refund · Adjustment · Fee · Tax · Pending receivable · Pending payable</span>
                                </div>
                                <div class="flex items-start gap-2.5 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
                                    <span class="mt-1 inline-block w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0"></span>
                                    <span class="font-mono font-bold text-gray-900 w-24 flex-shrink-0">Amount</span>
                                    <span class="text-gray-500">Raw Rp integer — e.g. <span class="font-mono font-bold text-gray-700">1250000</span></span>
                                </div>
                                <div class="flex items-start gap-2.5 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                                    <span class="mt-1 inline-block w-2 h-2 rounded-full bg-gray-300 flex-shrink-0"></span>
                                    <span class="font-mono font-bold text-gray-900 w-24 flex-shrink-0">Status</span>
                                    <span class="text-gray-500">Completed <span class="text-gray-400">(default)</span> · Reconciled · Pending · Missing Receipt · Cancelled</span>
                                </div>
                                <div class="flex items-start gap-2.5 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                                    <span class="mt-1 inline-block w-2 h-2 rounded-full bg-gray-300 flex-shrink-0"></span>
                                    <span class="font-mono font-bold text-gray-900 w-24 flex-shrink-0">Date</span>
                                    <span class="text-gray-500">DD-MM-YYYY — omit to use the range end date</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    ` : ''}
                    </div>
                    <div class="border-t border-gray-100 bg-white/95 p-4 shadow-[0_-12px_24px_rgba(15,23,42,0.06)] backdrop-blur">
                        <div id="tx-date-warning" class="hidden mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-medium text-amber-800"></div>
                        <button type="submit" id="tx-submit-btn" class="w-full py-4 bg-[#E85D19] hover:bg-[#D44400] text-white font-bold rounded-xl shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 disabled:shadow-none disabled:active:scale-100" disabled>
                            <span>${submitLabel}</span>
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = modalHTML;
    document.body.appendChild(wrapper);
    document.body.classList.add('overflow-hidden');
    window.requestAnimationFrame(() => {
        document.getElementById('global-tx-overlay')?.classList.remove('opacity-0');
        document.getElementById('global-tx-overlay')?.classList.add('opacity-100');
        document.getElementById('global-tx-drawer')?.classList.remove('translate-x-full');
    });
    window.__closeAddTransactionModalOnEscape = (event) => {
        if (event.key === 'Escape') window.closeAddTransactionModal();
    };
    document.addEventListener('keydown', window.__closeAddTransactionModalOnEscape);
    let activeEntryMode = 'single';
    let selectedEntryDate = todayKey;
    let updateSelectedCsvDateState = updateDateWarning;
    let bulkStatusOverride = null;

    // Live Formatting for Amount
    const amountInput = document.getElementById('tx-amount');
    const vendorInput = document.getElementById('tx-vendor');
    mountEntryDatePickers();
    amountInput.oninput = (e) => {
        let value = e.target.value.replace(/\D/g, "");
        e.target.value = value.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
        updateSingleSubmitState();
    };

    async function mountEntryDatePickers() {
        try {
            const picker = await loadFluxyDateRangePicker();

            picker?.mount('#tx-date-picker', {
                mode: 'single',
                start: selectedEntryDate,
                end: selectedEntryDate,
                defaultStart: todayKey,
                defaultEnd: todayKey,
                maxDate: context === 'bill' ? '2099-12-31' : todayKey,
                onChange: ({ start }) => {
                    selectedEntryDate = start;
                    updateSingleSubmitState();
                }
            });

        } catch (error) {
            console.error(error);
            window.showToast?.('Date picker failed to load. Please refresh and try again.', 'error');
        }
    }

    async function getTransactionDataService() {
        const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js");
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
        const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
        const { Timestamp } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
        const auth = getAuth(app);
        const user = auth.currentUser;
        if (!user) throw new Error("Session expired. Please log in again.");

        const { default: DataService } = await import('/assets/js/db-service.js');
        return { ds: new DataService(app), user, Timestamp };
    }

    function getLocalDateKey(date = new Date()) {
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0')
        ].join('-');
    }


    function parseCsvDateInput(raw) {
        const s = String(raw || '').trim();
        // ISO 8601 timestamp: 2026-05-13T20:33:43.196Z (what the ledger CSV download produces)
        if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
        // DD-MM-YYYY
        if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
            const [day, month, year] = s.split('-').map(Number);
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
        // YYYY-MM-DD falls through to parseLocalDateKey
        return s;
    }

    function parseLocalDateKey(dateKey) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return null;
        const [year, month, day] = String(dateKey || '').split('-').map(Number);
        if (!year || !month || !day) return null;
        const date = new Date(year, month - 1, day, 12, 0, 0, 0);
        if (Number.isNaN(date.getTime())) return null;
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
        return date;
    }

    function isPastDateKey(dateKey) {
        return Boolean(dateKey && dateKey !== todayKey);
    }

    function buildTransactionTimestamp(dateKey, Timestamp) {
        const date = parseLocalDateKey(dateKey);
        if (!date) throw new Error("Choose a valid transaction date.");
        if (dateKey > todayKey) throw new Error("Transaction date cannot be in the future.");
        return Timestamp.fromDate(date);
    }

    function buildBillDueDateTimestamp(dateKey, Timestamp) {
        const date = parseLocalDateKey(dateKey);
        if (!date) throw new Error("Choose a valid due date.");
        return Timestamp.fromDate(date);
    }

    function setDateWarning(message = '') {
        const warning = document.getElementById('tx-date-warning');
        if (!warning) return;
        warning.textContent = message;
        warning.classList.toggle('hidden', !message);
    }

    function updateDateWarning() {
        if (activeEntryMode === 'bulk') {
            const hasPastCsvRows = document.getElementById('tx-csv-file')?.dataset.hasPastDates === 'true';
            if (hasPastCsvRows) {
                setDateWarning('Some CSV rows use previous dates. They will be saved on the dates provided in the file.');
                return;
            }
            setDateWarning('');
            return;
        }

        if (context === 'bill') { setDateWarning(''); return; }
        setDateWarning(isPastDateKey(selectedEntryDate) ? 'This record will be saved to a previous day, not today.' : '');
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

    function parseBulkTransactions(csvText, defaultDateKey, Timestamp, overrideStatus = null) {
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
            status: findIndex(['status']),
            date: findIndex(['date', 'transaction_date', 'transactiondate'])
        };

        if ([indexes.vendor, indexes.category, indexes.type, indexes.amount].some(index => index === undefined)) {
            throw new Error("CSV must include Description, Category, Type, and Amount columns.");
        }

        const allowedCategories = ['Revenue', 'Marketing', 'Infrastructure', 'Operations', 'SaaS'];
        const allowedTypes = ['income', 'revenue', 'expense', 'transfer', 'refund', 'adjustment', 'fee', 'tax', 'pending_receivable', 'pending receivable', 'pending_payable', 'pending payable'];
        const allowedStatuses = ['Completed', 'Missing Receipt', 'Pending', 'Reconciled', 'Cancelled'];

        return rows.slice(1).map((row, index) => {
            const line = index + 2;
            const amount = parseCsvAmount(row[indexes.amount]);
            const category = row[indexes.category];
            const type = String(row[indexes.type] || '').toLowerCase().replace(/\s+/g, '_');
            const status = overrideStatus || row[indexes.status] || 'Completed';
            const vendor = row[indexes.vendor];
            const dateKey = indexes.date === undefined || !row[indexes.date] ? defaultDateKey : parseCsvDateInput(row[indexes.date]);

            if (!vendor) throw new Error(`Row ${line}: Description is required.`);
            if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Row ${line}: Amount must be a positive number.`);
            if (!allowedCategories.includes(category)) throw new Error(`Row ${line}: Category must be Revenue, Marketing, Infrastructure, Operations, or SaaS.`);
            if (!allowedTypes.includes(type)) throw new Error(`Row ${line}: Type must be Income, Expense, Transfer, Refund, Adjustment, Fee, Tax, Pending receivable, or Pending payable.`);
            if (!allowedStatuses.includes(status)) throw new Error(`Row ${line}: Status must be one of: Completed, Reconciled, Pending, Missing Receipt, Cancelled.`);
            if (!parseLocalDateKey(dateKey)) throw new Error(`Row ${line}: Date must use DD-MM-YYYY.`);
            if (dateKey > todayKey) throw new Error(`Row ${line}: Date cannot be in the future.`);

            return {
                amount,
                vendor_name: vendor,
                category,
                type,
                status,
                icon: ['income', 'revenue', 'refund', 'pending_receivable'].includes(type) ? '💰' : '💸',
                timestamp: buildTransactionTimestamp(dateKey, Timestamp)
            };
        });
    }

    function hasCsvPastDates(csvText, defaultDateKey) {
        const rows = parseCsv(csvText);
        if (rows.length < 2) return isPastDateKey(defaultDateKey);
        const headers = rows[0].map(normalizeHeader);
        const dateIndex = ['date', 'transaction_date', 'transactiondate']
            .map(normalizeHeader)
            .map(name => headers.indexOf(name))
            .find(index => index >= 0);

        return rows.slice(1).some(row => {
            const dateKey = dateIndex === undefined || !row[dateIndex] ? defaultDateKey : parseCsvDateInput(row[dateIndex]);
            return isPastDateKey(dateKey);
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


    function setSubmitButton(label, disabled = false) {
        const btn = document.getElementById('tx-submit-btn');
        if (!btn) return;
        btn.disabled = disabled;
        btn.innerHTML = `<span>${label}</span><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>`;
    }

    function isSingleEntryComplete() {
        const rawAmount = amountInput.value.replace(/\./g, "");
        const hasDate = Boolean(parseLocalDateKey(selectedEntryDate));
        const dateOk = context === 'bill' ? hasDate : (hasDate && selectedEntryDate <= todayKey);
        return Number(rawAmount) > 0 && vendorInput.value.trim().length > 0 && dateOk;
    }

    function updateSingleSubmitState() {
        if (activeEntryMode !== 'bulk') {
            setSubmitButton(submitLabel, !isSingleEntryComplete());
            updateDateWarning();
        }
    }

    vendorInput.oninput = updateSingleSubmitState;
    updateSingleSubmitState();

    // "Others" category custom input
    const categorySelect = document.getElementById('tx-category');
    const categoryCustomInput = document.getElementById('tx-category-custom');
    categorySelect.addEventListener('change', () => {
        const isOthers = categorySelect.value === 'Others';
        categoryCustomInput.classList.toggle('hidden', !isOthers);
        if (isOthers) categoryCustomInput.focus();
        else categoryCustomInput.value = '';
    });

    // Receipt file input wiring (transaction/subscription only — bills use invoice in the review drawer)
    const receiptFileInput = document.getElementById('tx-receipt-file');
    if (receiptFileInput) {
        const receiptFilename = document.getElementById('tx-receipt-filename');
        const receiptRemoveBtn = document.getElementById('tx-receipt-remove');
        const receiptPreviewWrapper = document.getElementById('tx-receipt-preview-wrapper');
        const receiptPreview = document.getElementById('tx-receipt-preview');

        receiptFileInput.onchange = () => {
            const file = receiptFileInput.files?.[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                window.showToast('Receipt must be an image file (JPG, PNG, WebP).', 'error');
                receiptFileInput.value = '';
                return;
            }
            if (file.size > 1 * 1024 * 1024) {
                window.showToast('Receipt image must be under 1 MB. Compress it first and re-upload.', 'error');
                receiptFileInput.value = '';
                return;
            }
            receiptFilename.textContent = file.name;
            receiptRemoveBtn.classList.remove('hidden');
            const previewUrl = URL.createObjectURL(file);
            receiptPreview.src = previewUrl;
            receiptPreviewWrapper.classList.remove('hidden');
        };

        receiptRemoveBtn.onclick = (e) => {
            e.preventDefault();
            receiptFileInput.value = '';
            receiptFilename.textContent = 'Attach receipt image';
            receiptRemoveBtn.classList.add('hidden');
            if (receiptPreview.src) URL.revokeObjectURL(receiptPreview.src);
            receiptPreview.src = '';
            receiptPreviewWrapper.classList.add('hidden');
        };
    }

    if (supportsBulkCsv) {
        const singleTab = document.getElementById('tx-tab-single');
        const bulkTab = document.getElementById('tx-tab-bulk');
        const singlePanel = document.getElementById('tx-single-panel');
        const bulkPanel = document.getElementById('tx-bulk-panel');
        const singleFields = [amountInput, vendorInput, document.getElementById('tx-category'), document.getElementById('tx-type')];
        const fileInput = document.getElementById('tx-csv-file');
        const fileLabel = document.getElementById('tx-csv-file-label');
        const dropzone = document.getElementById('tx-csv-dropzone');

        const setEntryMode = (mode) => {
            activeEntryMode = mode;
            const isBulk = mode === 'bulk';
            singlePanel.classList.toggle('hidden', isBulk);
            bulkPanel.classList.toggle('hidden', !isBulk);
            singleTab.className = `tx-entry-tab rounded-lg px-3 py-2 text-[13px] font-bold transition-all ${isBulk ? 'text-gray-500 hover:text-gray-900' : 'bg-white text-gray-900 shadow-sm'}`;
            bulkTab.className = `tx-entry-tab rounded-lg px-3 py-2 text-[13px] font-bold transition-all ${isBulk ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`;
            singleTab.setAttribute('aria-selected', String(!isBulk));
            bulkTab.setAttribute('aria-selected', String(isBulk));
            singleFields.forEach(field => {
                field.disabled = isBulk;
            });
            setSubmitButton(isBulk ? 'Upload CSV' : submitLabel, isBulk ? !fileInput.files?.[0] : !isSingleEntryComplete());
            if (isBulk) {
                setCsvFeedback(fileInput.files?.[0] ? 'Ready to upload. We will validate every row before saving.' : '', 'info');
            }
            updateDateWarning();
        };

        singleTab.onclick = () => setEntryMode('single');
        bulkTab.onclick = () => setEntryMode('bulk');

        const updateSelectedCsvFile = async () => {
            const file = fileInput.files?.[0];
            setSubmitButton('Upload CSV', !file);
            fileLabel.textContent = file ? file.name : 'Choose or drop a CSV file';
            dropzone.classList.toggle('border-[#E85D19]', Boolean(file));
            dropzone.classList.toggle('ring-2', Boolean(file));
            dropzone.classList.toggle('ring-orange-100', Boolean(file));
            setCsvFeedback(file ? 'Ready to upload. We will validate every row before saving.' : '', 'info');
            fileInput.dataset.hasPastDates = 'false';
            if (file) {
                try {
                    const csvText = await file.text();
                    fileInput.dataset.hasPastDates = hasCsvPastDates(csvText, todayKey) ? 'true' : 'false';
                } catch (_) {
                    fileInput.dataset.hasPastDates = 'false';
                }
            }
            updateDateWarning();
        };
        updateSelectedCsvDateState = updateSelectedCsvFile;

        fileInput.onchange = () => {
            updateSelectedCsvFile();
        };

        // Status override toggle
        const bulkToggleBtn = document.getElementById('tx-bulk-status-toggle');
        const bulkStatusPanel = document.getElementById('tx-bulk-status-panel');
        const bulkStatusSelect = document.getElementById('tx-bulk-status-select');
        const bulkStatusNote = document.getElementById('tx-bulk-status-note');

        const updateBulkStatusNote = () => {
            if (!bulkStatusOverride) return;
            bulkStatusNote.textContent = `Every uploaded row will be saved with status "${bulkStatusOverride}", overriding any Status column in the CSV.`;
            bulkStatusNote.classList.remove('hidden');
        };

        bulkToggleBtn.onclick = () => {
            const nowOn = bulkToggleBtn.getAttribute('aria-checked') !== 'true';
            bulkToggleBtn.setAttribute('aria-checked', String(nowOn));
            bulkToggleBtn.classList.toggle('bg-gray-200', !nowOn);
            bulkToggleBtn.classList.toggle('bg-[#E85D19]', nowOn);
            bulkToggleBtn.querySelector('span').classList.toggle('translate-x-0.5', !nowOn);
            bulkToggleBtn.querySelector('span').classList.toggle('translate-x-5', nowOn);
            bulkStatusPanel.classList.toggle('hidden', !nowOn);
            bulkStatusOverride = nowOn ? bulkStatusSelect.value : null;
            if (nowOn) updateBulkStatusNote();
            else bulkStatusNote.classList.add('hidden');
        };

        bulkStatusSelect.onchange = () => {
            bulkStatusOverride = bulkStatusSelect.value;
            updateBulkStatusNote();
        };

        dropzone.ondragover = (event) => {
            event.preventDefault();
            dropzone.classList.add('ring-2', 'ring-orange-100', 'border-[#E85D19]');
        };

        dropzone.ondragleave = () => {
            if (!fileInput.files?.[0]) {
                dropzone.classList.remove('ring-2', 'ring-orange-100', 'border-[#E85D19]');
            }
        };

        dropzone.ondrop = (event) => {
            event.preventDefault();
            const file = event.dataTransfer?.files?.[0];
            if (!file) return;
            if (!file.name.toLowerCase().endsWith('.csv')) {
                setCsvFeedback('Upload a .csv file.', 'error');
                return;
            }
            const files = new DataTransfer();
            files.items.add(file);
            fileInput.files = files.files;
            updateSelectedCsvFile();
        };
    }

    // Form Submission
    document.getElementById('global-tx-form').onsubmit = async (e) => {
        e.preventDefault();
        const btn = document.getElementById('tx-submit-btn');
        btn.disabled = true;
        btn.innerText = activeEntryMode === 'bulk' ? "Reading..." : "Deploying...";
        let keepSubmitState = false;

        try {
            if (activeEntryMode === 'bulk') {
                const fileInput = document.getElementById('tx-csv-file');
                const dropzone = document.getElementById('tx-csv-dropzone');
                const fileLabel = document.getElementById('tx-csv-file-label');
                const file = fileInput?.files?.[0];
                if (!file) {
                    setCsvFeedback('Choose a CSV file before uploading.', 'error');
                    return;
                }

                dropzone.classList.add('ring-2', 'ring-orange-100', 'border-[#E85D19]');
                const csvText = await file.text();
                const { ds, user, Timestamp } = await getTransactionDataService();
                const transactions = parseBulkTransactions(csvText, todayKey, Timestamp, bulkStatusOverride);
                btn.innerText = `Uploading ${transactions.length}...`;
                await ds.addTransactions(user.uid, transactions);
                setCsvFeedback(`${transactions.length} transactions imported successfully.`, 'success');
                if (window.loadDashboard) await window.loadDashboard();
                if (window.loadLedger) await window.loadLedger();
                window.showToast(`${transactions.length} transactions imported from CSV.`, "success");
                btn.innerText = 'Uploaded';
                keepSubmitState = true;
                fileInput.value = '';
                fileLabel.textContent = 'Choose or drop a CSV file';
                window.setTimeout(() => {
                    window.closeAddTransactionModal();
                    setSubmitButton('Upload CSV', true);
                    dropzone.classList.remove('ring-2', 'ring-orange-100', 'border-[#E85D19]');
                }, 1200);
                return;
            }

            if (!isSingleEntryComplete()) {
                window.showToast("Add an amount and vendor/description first.", "error");
                return;
            }

            const rawAmount = document.getElementById('tx-amount').value.replace(/\./g, "");
            const txType = document.getElementById('tx-type').value;
            const data = {
                amount: parseFloat(rawAmount),
                vendor_name: document.getElementById('tx-vendor').value,
                category: (() => {
                    const sel = document.getElementById('tx-category').value;
                    if (sel === 'Others') {
                        const custom = document.getElementById('tx-category-custom').value.trim();
                        return custom.length > 0 ? custom : 'Others';
                    }
                    return sel;
                })(),
                type: txType,
                status: context === 'bill' ? 'Upcoming' : (document.getElementById('tx-status')?.value || 'Completed'),
                icon: ['income', 'refund', 'pending_receivable'].includes(txType) ? '💰' : '💸'
            };

            // Initialize Firebase if not already done
            const { ds, user, Timestamp } = await getTransactionDataService();
            if (context === 'bill') {
                data.due_date = buildBillDueDateTimestamp(selectedEntryDate, Timestamp);
            } else {
                data.timestamp = buildTransactionTimestamp(selectedEntryDate, Timestamp);
            }

            // Receipt upload (transaction context only)
            if (context === 'transaction') {
                const receiptFile = document.getElementById('tx-receipt-file')?.files?.[0];
                if (receiptFile) {
                    btn.innerText = 'Compressing...';
                    let toUpload = receiptFile;
                    try { toUpload = await compressReceiptImage(receiptFile); } catch (_) {}
                    btn.innerText = 'Uploading receipt...';
                    data.receipt_url = await ds.uploadReceipt(user.uid, toUpload);
                    data.status = 'Completed';
                }
            }

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
            console.error(activeEntryMode === 'bulk' ? "CSV import failed:" : "FluxyOS Engine Error:", err);
            if (err.message.includes('permission-denied') || err.code === 'permission-denied') {
                window.showToast("CRITICAL: Permission Denied. Check Firestore Rules.", "error");
            } else if (err.message.includes('Session expired')) {
                window.showToast("Session expired. Please log in again.", "error");
            } else if (activeEntryMode === 'bulk') {
                setCsvFeedback(err.message, 'error');
            } else {
                window.showToast("FluxyOS Engine Error: " + err.message, "error");
            }
        } finally {
            if (keepSubmitState) return;
            if (activeEntryMode === 'bulk') {
                const hasFile = Boolean(document.getElementById('tx-csv-file')?.files?.[0]);
                setSubmitButton('Upload CSV', !hasFile);
            } else {
                setSubmitButton(submitLabel, !isSingleEntryComplete());
            }
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
        if (modal.dataset.closing === 'true') return;
        modal.dataset.closing = 'true';
        const overlay = document.getElementById('global-tx-overlay');
        const drawer = document.getElementById('global-tx-drawer');
        overlay?.classList.remove('opacity-100');
        overlay?.classList.add('opacity-0');
        drawer?.classList.add('translate-x-full');
        document.body.classList.remove('overflow-hidden');
        if (window.__closeAddTransactionModalOnEscape) {
            document.removeEventListener('keydown', window.__closeAddTransactionModalOnEscape);
            window.__closeAddTransactionModalOnEscape = null;
        }
        // Fully remove so next open creates fresh context
        window.setTimeout(() => {
            modal.parentElement?.remove();
        }, 300);
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
/**
 * Centralized Table Paginator
 *
 * Usage:
 *   const paginator = window.createTablePaginator({
 *     pageSize: 10,
 *     label: 'bills',
 *     paginationId: 'bill-pagination',
 *     summaryId:    'bill-page-summary',
 *     indicatorId:  'bill-page-indicator',
 *     prevBtnId:    'bill-prev-page',
 *     nextBtnId:    'bill-next-page',
 *   });
 *
 *   paginator.setRows(rows, (visibleRows) => { /* render tbody *\/ });
 */
window.createTablePaginator = function({ pageSize = 20, label = 'records', paginationId, summaryId, indicatorId, prevBtnId, nextBtnId }) {
    let currentPage = 1;
    let rows = [];
    let renderFn = null;

    function _refresh() {
        const total = rows.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        currentPage = Math.min(Math.max(currentPage, 1), totalPages);
        const start = (currentPage - 1) * pageSize;
        const end = Math.min(start + pageSize, total);
        const visible = rows.slice(start, end);

        const paginationEl = document.getElementById(paginationId);
        const summaryEl    = document.getElementById(summaryId);
        const indicatorEl  = document.getElementById(indicatorId);
        const prevBtn      = document.getElementById(prevBtnId);
        const nextBtn      = document.getElementById(nextBtnId);

        if (paginationEl) paginationEl.classList.toggle('hidden', total === 0);
        if (summaryEl) {
            summaryEl.textContent = total === 0
                ? `Showing 0 ${label}`
                : `Showing ${start + 1}–${end} of ${total} ${label}`;
        }
        if (indicatorEl) indicatorEl.textContent = `${currentPage} / ${totalPages}`;
        if (prevBtn) prevBtn.disabled = currentPage === 1;
        if (nextBtn) nextBtn.disabled = currentPage === totalPages;

        if (renderFn) renderFn(visible);
    }

    document.getElementById(prevBtnId)?.addEventListener('click', () => { currentPage--; _refresh(); });
    document.getElementById(nextBtnId)?.addEventListener('click', () => { currentPage++; _refresh(); });

    return {
        setRows(newRows, fn) {
            rows = newRows || [];
            currentPage = 1;
            if (fn) renderFn = fn;
            _refresh();
        },
        refresh() { _refresh(); }
    };
};

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

// ─── Chart Hover (Amplitude-style) ────────────────────────────────
// Wires crosshair + active-bar emphasis + a dark-navy tooltip card to any bar
// chart container. Required for every bar/column chart in the app — see
// docs/DESIGN_SYSTEM.md §4 Charts and docs/COMPONENT_GUIDE.md Recipe 7.
//
// Usage:
//   window.attachChartHover(chartEl, {
//       bars: '[data-chart-bar]',
//       orientation: 'vertical',         // 'vertical' | 'horizontal'
//       buildTooltip: (barEl, index) => '<html>'
//   });
//
// Idempotent — safe to call after every innerHTML re-render. Returns
// { destroy() } so callers can tear it down.
window.attachChartHover = function attachChartHover(container, options) {
    if (!container || !options) return { destroy() {} };
    const { bars: barSelector, buildTooltip, orientation = 'vertical' } = options;

    const bars = typeof barSelector === 'string'
        ? Array.from(container.querySelectorAll(barSelector))
        : Array.from(barSelector || []);
    if (bars.length === 0 || typeof buildTooltip !== 'function') {
        return { destroy() {} };
    }

    if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
    }

    let tooltip = container.querySelector(':scope > .chart-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'chart-tooltip';
        container.appendChild(tooltip);
    }

    let crosshair = container.querySelector(':scope > .chart-crosshair');
    if (orientation === 'vertical') {
        if (!crosshair) {
            crosshair = document.createElement('div');
            crosshair.className = 'chart-crosshair';
            container.appendChild(crosshair);
        }
    } else if (crosshair) {
        crosshair.remove();
        crosshair = null;
    }

    let activeIndex = -1;

    function positionTooltip() {
        if (activeIndex < 0) return;
        const containerRect = container.getBoundingClientRect();
        const barRect = bars[activeIndex].getBoundingClientRect();
        const barCenterX = barRect.left + barRect.width / 2 - containerRect.left;

        if (crosshair) crosshair.style.left = `${barCenterX}px`;

        const tipRect = tooltip.getBoundingClientRect();
        let left = barCenterX - tipRect.width / 2;
        let top = barRect.top - containerRect.top - tipRect.height - 8;

        const padding = 4;
        if (left < padding) left = padding;
        if (left + tipRect.width > containerRect.width - padding) {
            left = Math.max(padding, containerRect.width - tipRect.width - padding);
        }
        if (top < padding) {
            top = barRect.bottom - containerRect.top + 8;
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }

    function setActive(index) {
        if (index === activeIndex) { positionTooltip(); return; }
        if (activeIndex >= 0) bars[activeIndex]?.classList.remove('chart-bar-active');
        activeIndex = index;

        if (index < 0) {
            tooltip.classList.remove('is-visible');
            if (crosshair) crosshair.classList.remove('is-visible');
            return;
        }

        bars[index].classList.add('chart-bar-active');
        tooltip.innerHTML = buildTooltip(bars[index], index);
        tooltip.classList.add('is-visible');
        if (crosshair) crosshair.classList.add('is-visible');
        positionTooltip();
    }

    function findBarIndex(clientX, clientY) {
        let best = -1;
        let bestDist = Infinity;
        for (let i = 0; i < bars.length; i++) {
            const rect = bars[i].getBoundingClientRect();
            const axis = orientation === 'horizontal'
                ? Math.abs((rect.top + rect.height / 2) - clientY)
                : Math.abs((rect.left + rect.width / 2) - clientX);
            if (axis < bestDist) { bestDist = axis; best = i; }
        }
        return best;
    }

    function onMove(event) {
        const rect = container.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right ||
            event.clientY < rect.top || event.clientY > rect.bottom) {
            setActive(-1);
            return;
        }
        setActive(findBarIndex(event.clientX, event.clientY));
    }

    function onLeave() { setActive(-1); }

    container.addEventListener('mousemove', onMove);
    container.addEventListener('mouseleave', onLeave);

    return {
        destroy() {
            container.removeEventListener('mousemove', onMove);
            container.removeEventListener('mouseleave', onLeave);
            tooltip?.remove();
            crosshair?.remove();
        }
    };
};
