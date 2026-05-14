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
                            <label for="tx-date" class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Transaction Date</label>
                            <input type="date" id="tx-date" name="date" required max="${todayKey}" value="${todayKey}" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#E85D19]">
                            <p class="mt-2 text-[12px] text-gray-500">Defaults to today. Choose a previous day for backdated records.</p>
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
                                    <option value="income" ${defaultType === 'income' || defaultType === 'revenue' ? 'selected' : ''}>Income</option>
                                    <option value="expense" ${defaultType === 'expense' ? 'selected' : ''}>Expense</option>
                                    <option value="transfer" ${defaultType === 'transfer' ? 'selected' : ''}>Transfer</option>
                                    <option value="refund" ${defaultType === 'refund' ? 'selected' : ''}>Refund</option>
                                    <option value="adjustment" ${defaultType === 'adjustment' ? 'selected' : ''}>Adjustment</option>
                                    <option value="fee" ${defaultType === 'fee' ? 'selected' : ''}>Fee</option>
                                    <option value="tax" ${defaultType === 'tax' ? 'selected' : ''}>Tax</option>
                                    <option value="pending_receivable" ${defaultType === 'pending_receivable' ? 'selected' : ''}>Pending receivable</option>
                                    <option value="pending_payable" ${defaultType === 'pending_payable' ? 'selected' : ''}>Pending payable</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    ${supportsBulkCsv ? `
                    <div id="tx-bulk-panel" class="hidden space-y-4">
                        <div>
                            <label for="tx-bulk-date" class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Default CSV Date</label>
                            <input type="date" id="tx-bulk-date" name="bulkDate" required max="${todayKey}" value="${todayKey}" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#E85D19]">
                            <p class="mt-2 text-[12px] text-gray-500">Rows without a Date column use this date. Row dates can be today or any previous day.</p>
                        </div>
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
                        <div class="rounded-xl border border-gray-200 bg-white p-4">
                            <p class="text-[12px] font-bold uppercase tracking-wider text-gray-400">CSV structure</p>
                            <div class="mt-3 grid gap-2 text-[12px] text-gray-600">
                                <div class="flex items-start justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2"><span class="font-mono text-gray-900">Description</span><span class="text-right">Required vendor or memo</span></div>
                                <div class="flex items-start justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2"><span class="font-mono text-gray-900">Category</span><span class="text-right">Revenue, Marketing, Infrastructure, Operations, SaaS</span></div>
                                <div class="flex items-start justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2"><span class="font-mono text-gray-900">Type</span><span class="text-right">Income, Expense, Transfer, Refund, Adjustment, Fee, Tax, Pending receivable, or Pending payable</span></div>
                                <div class="flex items-start justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2"><span class="font-mono text-gray-900">Amount</span><span class="text-right">Raw Rp number, e.g. 1250000</span></div>
                                <div class="flex items-start justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2"><span class="font-mono text-gray-900">Status</span><span class="text-right">Optional: Completed or Missing Receipt</span></div>
                                <div class="flex items-start justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2"><span class="font-mono text-gray-900">Date</span><span class="text-right">Optional: YYYY-MM-DD; defaults to the CSV date field above</span></div>
                            </div>
                            <p class="mt-3 rounded-lg bg-gray-50 px-3 py-2 font-mono text-[11px] text-gray-500">Client Payment,Revenue,Income,1250000,Completed,${todayKey}</p>
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

    // Live Formatting for Amount
    const amountInput = document.getElementById('tx-amount');
    const vendorInput = document.getElementById('tx-vendor');
    const dateInput = document.getElementById('tx-date');
    amountInput.oninput = (e) => {
        let value = e.target.value.replace(/\D/g, "");
        e.target.value = value.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
        updateSingleSubmitState();
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

    function setDateWarning(message = '') {
        const warning = document.getElementById('tx-date-warning');
        if (!warning) return;
        warning.textContent = message;
        warning.classList.toggle('hidden', !message);
    }

    function updateDateWarning() {
        if (activeEntryMode === 'bulk') {
            const bulkDate = document.getElementById('tx-bulk-date')?.value;
            const hasPastCsvRows = document.getElementById('tx-csv-file')?.dataset.hasPastDates === 'true';
            if (hasPastCsvRows) {
                setDateWarning('Some CSV rows use previous dates. They will be saved on the dates provided in the file.');
                return;
            }
            setDateWarning(isPastDateKey(bulkDate) ? 'This CSV upload will save rows without a Date column on a previous day.' : '');
            return;
        }

        const dateKey = document.getElementById('tx-date')?.value;
        setDateWarning(isPastDateKey(dateKey) ? 'This record will be saved to a previous day, not today.' : '');
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

    function parseBulkTransactions(csvText, defaultDateKey, Timestamp) {
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
        const allowedStatuses = ['Completed', 'Missing Receipt'];

        return rows.slice(1).map((row, index) => {
            const line = index + 2;
            const amount = parseCsvAmount(row[indexes.amount]);
            const category = row[indexes.category];
            const type = String(row[indexes.type] || '').toLowerCase().replace(/\s+/g, '_');
            const status = row[indexes.status] || 'Completed';
            const vendor = row[indexes.vendor];
            const dateKey = indexes.date === undefined || !row[indexes.date] ? defaultDateKey : row[indexes.date];

            if (!vendor) throw new Error(`Row ${line}: Description is required.`);
            if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Row ${line}: Amount must be a positive number.`);
            if (!allowedCategories.includes(category)) throw new Error(`Row ${line}: Category must be Revenue, Marketing, Infrastructure, Operations, or SaaS.`);
            if (!allowedTypes.includes(type)) throw new Error(`Row ${line}: Type must be Income, Expense, Transfer, Refund, Adjustment, Fee, Tax, Pending receivable, or Pending payable.`);
            if (!allowedStatuses.includes(status)) throw new Error(`Row ${line}: Status must be Completed or Missing Receipt.`);
            if (!parseLocalDateKey(dateKey)) throw new Error(`Row ${line}: Date must use YYYY-MM-DD.`);
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
            const dateKey = dateIndex === undefined || !row[dateIndex] ? defaultDateKey : row[dateIndex];
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
        return Number(rawAmount) > 0 && vendorInput.value.trim().length > 0 && Boolean(parseLocalDateKey(dateInput.value)) && dateInput.value <= todayKey;
    }

    function updateSingleSubmitState() {
        if (activeEntryMode !== 'bulk') {
            setSubmitButton(submitLabel, !isSingleEntryComplete());
            updateDateWarning();
        }
    }

    vendorInput.oninput = updateSingleSubmitState;
    dateInput.oninput = updateSingleSubmitState;
    dateInput.onchange = updateSingleSubmitState;
    updateSingleSubmitState();

    if (supportsBulkCsv) {
        const singleTab = document.getElementById('tx-tab-single');
        const bulkTab = document.getElementById('tx-tab-bulk');
        const singlePanel = document.getElementById('tx-single-panel');
        const bulkPanel = document.getElementById('tx-bulk-panel');
        const bulkDateInput = document.getElementById('tx-bulk-date');
        const singleFields = [amountInput, vendorInput, dateInput, document.getElementById('tx-category'), document.getElementById('tx-type')];
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
                    fileInput.dataset.hasPastDates = hasCsvPastDates(csvText, bulkDateInput.value) ? 'true' : 'false';
                } catch (_) {
                    fileInput.dataset.hasPastDates = 'false';
                }
            }
            updateDateWarning();
        };

        fileInput.onchange = () => {
            updateSelectedCsvFile();
        };
        bulkDateInput.oninput = () => {
            updateSelectedCsvFile();
        };
        bulkDateInput.onchange = () => {
            updateSelectedCsvFile();
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
                const transactions = parseBulkTransactions(csvText, document.getElementById('tx-bulk-date').value, Timestamp);
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
            const data = {
                amount: parseFloat(rawAmount),
                vendor_name: document.getElementById('tx-vendor').value,
                category: document.getElementById('tx-category').value,
                type: document.getElementById('tx-type').value,
                status: 'Completed',
                icon: ['income', 'refund', 'pending_receivable'].includes(document.getElementById('tx-type').value) ? '💰' : '💸'
            };

            // Initialize Firebase if not already done
            const { ds, user, Timestamp } = await getTransactionDataService();
            data.timestamp = buildTransactionTimestamp(document.getElementById('tx-date').value, Timestamp);

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
