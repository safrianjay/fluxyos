(function () {
    'use strict';

    const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    const ALLOWED_EXT_LABEL = 'JPG, PNG, WebP, or PDF';
    const MAX_FILE_BYTES = 10 * 1024 * 1024;
    const ALLOWED_CATEGORIES = ['Revenue', 'Marketing', 'Infrastructure', 'Operations', 'SaaS'];
    const TRANSACTION_TYPES = ['expense', 'income', 'transfer', 'refund', 'adjustment', 'fee', 'tax', 'pending_payable', 'pending_receivable'];
    const TRANSACTION_STATUSES = ['Completed', 'Pending', 'Reconciled', 'Missing Receipt', 'Cancelled'];
    const EXTRACT_ENDPOINT = '/api/v1/bills/extract';

    const MODES = {
        bill: {
            title: 'Scan Bill',
            subtitle: 'Upload a bill, invoice, receipt, or payment request. FluxyOS will extract the key details for review.',
            primaryDateLabel: 'Due Date',
            contextKey: '__fluxyBillsContext',
            saveMethod: 'addBill',
            refreshFn: 'loadBills',
            defaultType: 'pending_payable',
            defaultStatus: 'Missing Receipt',
            source: 'bill_scan',
            createdVia: 'ai_bill_capture',
            toastSuccess: 'Bill scanned and added to your schedule.',
            saveLabel: 'Save Bill',
            showTypeStatus: false,
            futureDates: true,
        },
        transaction: {
            title: 'Scan Transaction',
            subtitle: 'Upload a receipt, invoice, or payment confirmation. FluxyOS will extract the key details for review.',
            primaryDateLabel: 'Transaction Date',
            contextKey: '__fluxyTxContext',
            saveMethod: 'addTransaction',
            refreshFn: 'loadLedger',
            defaultType: 'expense',
            defaultStatus: 'Completed',
            source: 'transaction_scan',
            createdVia: 'ai_transaction_capture',
            toastSuccess: 'Transaction scanned and added to your ledger.',
            saveLabel: 'Save Transaction',
            showTypeStatus: true,
            futureDates: false,
        },
        subscription: {
            title: 'Review Subscription',
            subtitle: 'Review a subscription invoice before adding it to your recurring costs.',
            primaryDateLabel: 'Renewal Date',
            contextKey: '__fluxySubContext',
            saveMethod: 'addSubscription',
            refreshFn: 'loadSubscriptions',
            defaultType: 'expense',
            defaultStatus: 'Completed',
            source: 'subscription_scan',
            createdVia: 'ai_subscription_capture',
            toastSuccess: 'Subscription scanned and added to your recurring costs.',
            saveLabel: 'Save Subscription',
            showTypeStatus: false,
            futureDates: true,
        },
    };

    const state = {
        mode: 'bill',
        step: 'upload',
        file: null,
        previewUrl: null,
        extraction: null,
        extractionSource: null,
        saving: false,
        duplicateConfirmed: false,
        pickers: { primary: null, invoice: null },
        dates: { primary: null, invoice: null },
        errorMessage: null,
        allocationContext: null, // { budget, allocations } | null — transaction allocation picker
    };

    function $(id) { return document.getElementById(id); }
    function modeCfg() { return MODES[state.mode] || MODES.bill; }
    function normalizeMode(mode) {
        return Object.prototype.hasOwnProperty.call(MODES, mode) ? mode : 'bill';
    }

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatBytes(bytes) {
        if (!bytes && bytes !== 0) return '';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }

    function normalizeRupiahAmount(raw) {
        if (raw == null) return 0;
        if (typeof raw === 'number') return Math.round(raw);
        const cleaned = String(raw).replace(/[^\d,.-]/g, '');
        if (!cleaned) return 0;
        const lastComma = cleaned.lastIndexOf(',');
        const lastDot = cleaned.lastIndexOf('.');
        let normalized;
        if (lastComma > lastDot) {
            normalized = cleaned.replace(/\./g, '').replace(',', '.');
        } else {
            normalized = cleaned.replace(/,/g, '');
            const dots = normalized.split('.');
            if (dots.length > 2 || (dots.length === 2 && dots[1].length === 3)) {
                normalized = normalized.replace(/\./g, '');
            }
        }
        const num = parseFloat(normalized);
        return Number.isFinite(num) ? Math.round(num) : 0;
    }

    function parseDateInput(value) {
        if (!value) return null;
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    function validateBillFile(file) {
        if (!file) return 'Please choose a file.';
        if (!ALLOWED_MIME.includes(file.type)) {
            return `Unsupported file type. Please upload ${ALLOWED_EXT_LABEL}.`;
        }
        if (file.size > MAX_FILE_BYTES) {
            return `File is too large (${formatBytes(file.size)}). Max ${formatBytes(MAX_FILE_BYTES)}.`;
        }
        return null;
    }

    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Could not read file.'));
            reader.onload = () => {
                const result = String(reader.result || '');
                const comma = result.indexOf(',');
                resolve(comma >= 0 ? result.slice(comma + 1) : result);
            };
            reader.readAsDataURL(file);
        });
    }

    async function maybeCompressImage(file) {
        if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
        if (typeof window.__compressReceiptImage !== 'function') return file;
        try {
            return await window.__compressReceiptImage(file);
        } catch {
            return file;
        }
    }

    function destroyPickers() {
        if (state.pickers.primary?.destroy) state.pickers.primary.destroy();
        if (state.pickers.invoice?.destroy) state.pickers.invoice.destroy();
        state.pickers = { primary: null, invoice: null };
    }

    function setStep(nextStep) {
        destroyPickers();
        state.step = nextStep;
        const content = $('scan-drawer-content');
        if (content) content.setAttribute('data-step', nextStep);
        renderDrawer();
    }

    function clearFile() {
        if (state.previewUrl) {
            URL.revokeObjectURL(state.previewUrl);
            state.previewUrl = null;
        }
        state.file = null;
        state.extraction = null;
        state.extractionSource = null;
        state.duplicateConfirmed = false;
    }

    function setHeader() {
        const cfg = modeCfg();
        const titleEl = $('scan-drawer-title');
        const subEl = $('scan-drawer-subtitle');
        if (titleEl) titleEl.textContent = cfg.title;
        if (subEl) subEl.textContent = cfg.subtitle;
    }

    function openDrawer(mode) {
        state.mode = normalizeMode(mode);
        setHeader();
        const isOnline = navigator.onLine !== false;
        state.dates = { primary: null, invoice: null };
        state.duplicateConfirmed = false;
        setStep(isOnline ? 'upload' : 'offline');
        $('scan-drawer-backdrop')?.classList.remove('hidden');
        requestAnimationFrame(() => {
            $('scan-drawer')?.classList.remove('translate-x-full');
        });
    }

    function closeDrawer() {
        $('scan-drawer')?.classList.add('translate-x-full');
        $('scan-drawer-backdrop')?.classList.add('hidden');
        clearFile();
        destroyPickers();
        state.dates = { primary: null, invoice: null };
        state.saving = false;
        setTimeout(() => {
            const content = $('scan-drawer-content');
            if (content) content.innerHTML = '';
            const footer = $('scan-drawer-footer');
            if (footer) footer.innerHTML = '';
        }, 300);
    }

    // ── Renderers ────────────────────────────────────────────────────────

    function renderDrawer() {
        switch (state.step) {
            case 'upload':   return renderUploadStep();
            case 'scanning': return renderScanningStep();
            case 'review':   return renderReviewStep();
            case 'error':    return renderErrorStep(state.errorMessage || 'Something went wrong.');
            case 'offline':  return renderOfflineStep();
            default:         return renderUploadStep();
        }
    }

    function renderUploadStep() {
        const content = $('scan-drawer-content');
        const footer = $('scan-drawer-footer');
        const file = state.file;
        const manualLabel = state.mode === 'transaction'
            ? 'Use Add Transaction'
            : state.mode === 'subscription'
                ? 'Use Add Subscription'
                : 'Use Add New Bill';

        if (!file) {
            content.innerHTML = `
                <div class="space-y-4">
                    <label id="scan-dropzone" for="scan-file-input"
                           class="block border-2 border-dashed border-gray-300 hover:border-[#EA580C] rounded-xl px-6 py-10 text-center cursor-pointer transition-colors bg-gray-50/50">
                        <div class="flex justify-center mb-3">
                            <div class="w-12 h-12 rounded-full bg-orange-50 flex items-center justify-center">
                                <svg class="w-6 h-6 text-[#EA580C]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M12 12V4m0 0-4 4m4-4 4 4"></path></svg>
                            </div>
                        </div>
                        <p class="text-[13px] font-semibold text-gray-900">Drag and drop your document here</p>
                        <p class="text-[12px] text-gray-500 mt-1">or click to browse</p>
                        <p class="text-[11px] text-gray-400 mt-3">${ALLOWED_EXT_LABEL} · max ${formatBytes(MAX_FILE_BYTES)}</p>
                    </label>
                    <input id="scan-file-input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" class="hidden">
                    <p class="text-[11px] text-gray-400 text-center">Prefer to enter manually? <button id="scan-manual-link" type="button" class="text-[#EA580C] font-semibold hover:underline">${escapeHtml(manualLabel)}</button></p>
                </div>
            `;
            footer.innerHTML = `
                <button id="scan-cancel-btn" type="button" class="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-[13px] font-medium hover:bg-gray-200 transition-colors">Cancel</button>
            `;
            wireUploadHandlers();
            return;
        }

        const isPdf = file.type === 'application/pdf';
        const previewHtml = isPdf
            ? `<div class="bg-gray-50 border border-gray-200 rounded-xl p-5 flex items-center gap-3">
                   <div class="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                       <svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"></path></svg>
                   </div>
                   <div class="min-w-0 flex-1">
                       <p class="text-[13px] font-semibold text-gray-900 truncate">${escapeHtml(file.name)}</p>
                       <p class="text-[11px] text-gray-500">${escapeHtml(file.type)} · ${formatBytes(file.size)}</p>
                   </div>
               </div>`
            : `<div class="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden">
                   <img src="${state.previewUrl}" alt="Document preview" class="w-full max-h-72 object-contain bg-white">
                   <div class="px-4 py-3 border-t border-gray-200 flex items-center justify-between gap-3">
                       <p class="text-[12px] text-gray-700 font-medium truncate">${escapeHtml(file.name)}</p>
                       <p class="text-[11px] text-gray-400 flex-shrink-0">${formatBytes(file.size)}</p>
                   </div>
               </div>`;

        content.innerHTML = `
            <div class="space-y-4">
                ${previewHtml}
                <button id="scan-replace-btn" type="button" class="text-[12px] font-semibold text-gray-600 hover:text-gray-900">Replace file</button>
                <input id="scan-file-input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" class="hidden">
            </div>
        `;
        footer.innerHTML = `
            <button id="scan-cancel-btn" type="button" class="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-[13px] font-medium hover:bg-gray-200 transition-colors">Cancel</button>
            <button id="scan-start-btn" type="button" class="flex-1 px-4 py-2.5 bg-[#EA580C] text-white rounded-lg text-[13px] font-bold hover:bg-[#D94E0B] transition-colors flex items-center justify-center gap-2 active:scale-95">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                ${escapeHtml(modeCfg().title)}
            </button>
        `;
        wireUploadHandlers();
    }

    function renderScanningStep() {
        const content = $('scan-drawer-content');
        const footer = $('scan-drawer-footer');
        content.innerHTML = `
            <div class="relative overflow-hidden rounded-2xl bg-white border border-gray-100">
                <div class="absolute -inset-12 scan-loader-bg-purple opacity-25 blur-2xl"></div>
                <div class="absolute inset-0" style="background: radial-gradient(ellipse at center, rgba(255,255,255,0) 30%, rgba(255,255,255,0.92) 78%);"></div>

                <span class="scan-star scan-star-lg" style="top:14%; left:12%; animation-delay: 0s;"></span>
                <span class="scan-star" style="top:22%; right:14%; animation-delay: 0.7s;"></span>
                <span class="scan-star scan-star-sm" style="top:8%; left:46%; animation-delay: 1.1s;"></span>
                <span class="scan-star scan-star-sm" style="top:46%; left:6%; animation-delay: 1.6s;"></span>
                <span class="scan-star" style="bottom:24%; right:10%; animation-delay: 0.4s;"></span>
                <span class="scan-star scan-star-sm" style="bottom:14%; left:24%; animation-delay: 1.3s;"></span>
                <span class="scan-star scan-star-lg" style="bottom:10%; right:30%; animation-delay: 0.2s;"></span>
                <span class="scan-star scan-star-sm" style="top:52%; right:7%; animation-delay: 0.9s;"></span>
                <span class="scan-star scan-star-sm" style="bottom:6%; left:50%; animation-delay: 1.8s;"></span>

                <div class="relative flex flex-col items-center justify-center py-14 px-6">
                    <div class="relative w-36 h-36 flex items-center justify-center">
                        <div class="absolute inset-0 rounded-full scan-loader-halo-purple opacity-70 blur-2xl"></div>
                        <div class="absolute inset-3 rounded-full scan-loader-halo-purple opacity-55 blur-md"></div>
                        <div class="relative scan-loader-pulse">
                            <div class="w-20 h-20 rounded-2xl bg-white shadow-xl ring-1 ring-violet-100 flex items-center justify-center">
                                <img src="assets/images/favicon.svg" alt="" class="w-12 h-12 scan-loader-spin" aria-hidden="true" onerror="this.style.display='none'">
                            </div>
                        </div>
                    </div>
                    <p class="text-[13px] font-semibold text-gray-900 mt-6">Reading your document with AI…</p>
                    <p class="text-[12px] text-gray-500 mt-1">This usually takes a few seconds.</p>
                </div>
            </div>
        `;
        footer.innerHTML = `
            <button type="button" disabled class="flex-1 px-4 py-2.5 bg-gray-100 text-gray-400 rounded-lg text-[13px] font-medium cursor-not-allowed">Cancel</button>
            <button type="button" disabled class="flex-1 px-4 py-2.5 bg-orange-200 text-white rounded-lg text-[13px] font-bold cursor-not-allowed">Scanning…</button>
        `;
    }

    function confidenceMark(score) {
        if (typeof score !== 'number') return '';
        if (score >= 0.7) return '';
        return `<span class="inline-flex items-center gap-1 ml-2 text-[10px] font-bold text-[#EA580C]" title="AI is not fully confident — please review.">
            <span class="w-1.5 h-1.5 rounded-full bg-[#EA580C]"></span>Review
        </span>`;
    }

    function renderReviewStep() {
        const content = $('scan-drawer-content');
        const footer = $('scan-drawer-footer');
        const cfg = modeCfg();
        const data = state.extraction || {};
        const conf = data.confidence || {};
        const warnings = Array.isArray(data.warnings) ? data.warnings : [];
        const isMock = state.extractionSource === 'mock';

        const categoryOptions = ALLOWED_CATEGORIES.map(c => {
            const selected = (data.category === c) ? ' selected' : '';
            return `<option value="${c}"${selected}>${c}</option>`;
        }).join('');

        const mockBanner = isMock ? `
            <div class="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-[12px] text-amber-800">
                <p class="font-semibold">Sample extraction</p>
                <p class="mt-0.5">Live AI extraction is unavailable right now. The fields below are placeholder values — please replace them before saving.</p>
            </div>
        ` : '';

        const warningsBlock = warnings.length ? `
            <div class="bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 text-[12px] text-orange-800 space-y-1">
                ${warnings.map(w => `<p>• ${escapeHtml(w)}</p>`).join('')}
            </div>
        ` : '';

        const typeStatusBlock = cfg.showTypeStatus ? `
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Type</label>
                    <select name="type" required
                            class="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#EA580C] focus:border-[#EA580C]">
                        ${TRANSACTION_TYPES.map(t => `<option value="${t}"${t === cfg.defaultType ? ' selected' : ''}>${t}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Status</label>
                    <select name="status" required
                            class="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#EA580C] focus:border-[#EA580C]">
                        ${TRANSACTION_STATUSES.map(s => `<option value="${s}"${s === cfg.defaultStatus ? ' selected' : ''}>${s}</option>`).join('')}
                    </select>
                </div>
            </div>
        ` : '';

        const allocationBlock = state.mode === 'transaction' ? `
            <div id="scan-allocation-wrap" class="hidden">
                <label class="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Budget allocation</label>
                <select name="budget_allocation"
                        class="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#EA580C] focus:border-[#EA580C]">
                    <option value="">Auto-match by category</option>
                </select>
            </div>
        ` : '';

        const footerNote = state.mode === 'bill'
            ? 'This bill will be saved as a <span class="font-mono">pending_payable</span>. No ledger transaction will be created.'
            : state.mode === 'subscription'
                ? 'This subscription will be saved to recurring costs. No payment or ledger transaction will be created.'
                : 'This will be saved as a ledger transaction. You can refine its category and status later.';
        const dateConfidence = conf.due_date ?? conf.renewal_date ?? conf.transaction_date ?? conf.date;

        content.innerHTML = `
            <form id="scan-review-form" class="space-y-4">
                ${mockBanner}
                ${warningsBlock}
                <div id="scan-duplicate-warning" class="hidden rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800"></div>

                <div>
                    <label class="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Vendor ${confidenceMark(conf.vendor_name)}</label>
                    <input type="text" name="vendor_name" required value="${escapeHtml(data.vendor_name || '')}" placeholder="Vendor name"
                           class="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#EA580C] focus:border-[#EA580C]">
                </div>

                <div>
                    <label class="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Amount (Rp) ${confidenceMark(conf.amount)}</label>
                    <input type="text" name="amount" required inputmode="numeric" value="${data.amount != null ? Number(data.amount).toLocaleString('id-ID') : ''}" placeholder="1.250.000"
                           class="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-[13px] font-mono focus:outline-none focus:ring-1 focus:ring-[#EA580C] focus:border-[#EA580C]">
                </div>

                <div>
                    <label class="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Category ${confidenceMark(conf.category)}</label>
                    <select name="category" required
                            class="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#EA580C] focus:border-[#EA580C]">
                        ${categoryOptions}
                    </select>
                </div>

                ${typeStatusBlock}

                ${allocationBlock}

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">${escapeHtml(cfg.primaryDateLabel)} ${confidenceMark(dateConfidence)}</label>
                        <div data-picker="primary"></div>
                    </div>
                    <div>
                        <label class="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Invoice Date</label>
                        <div data-picker="invoice"></div>
                    </div>
                </div>

                <div>
                    <label class="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Invoice Number</label>
                    <input type="text" name="invoice_number" value="${escapeHtml(data.invoice_number || '')}" placeholder="INV-2026-001"
                           class="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#EA580C] focus:border-[#EA580C]">
                </div>

                <div class="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[11px] text-gray-500 leading-relaxed">
                    <p><span class="font-semibold text-gray-700">AI suggests. You confirm. FluxyOS saves.</span></p>
                    <p class="mt-0.5">${footerNote}</p>
                </div>
            </form>
        `;
        footer.innerHTML = `
            <button id="scan-rescan-btn" type="button" class="px-4 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-[13px] font-medium hover:bg-gray-50 transition-colors">Rescan</button>
            <button id="scan-save-btn" type="button" class="flex-1 px-4 py-2.5 bg-[#EA580C] text-white rounded-lg text-[13px] font-bold hover:bg-[#D94E0B] transition-colors active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed">${escapeHtml(cfg.saveLabel)}</button>
        `;
        mountReviewDatePickers();
        wireReviewHandlers();
        updateSaveEnabled();
        mountReviewAllocationPicker();
    }

    // Budget allocation picker for the receipt-capture review (transaction mode).
    // Loads allocations for the transaction date so the user can pin the expense
    // to a specific allocation at save, instead of reassigning it from the Budget
    // page later. Hidden when no active budget covers the date.
    async function mountReviewAllocationPicker() {
        if (state.mode !== 'transaction' || !window.FluxyBudgetPicker) return;
        const wrap = $('scan-allocation-wrap');
        const select = $('scan-review-form')?.querySelector('select[name="budget_allocation"]');
        if (!wrap || !select) return;
        try {
            const ctx = getContext();
            const uid = ctx?.auth?.currentUser?.uid;
            if (!ctx?.ds || !uid) return;
            const when = state.dates.primary || window.FluxyDateRangePicker?.getDayKey?.() || new Date();
            state.allocationContext = await window.FluxyBudgetPicker.loadForDate(ctx.ds, uid, when);
            select.innerHTML = window.FluxyBudgetPicker.buildOptionsHtml(
                state.allocationContext.allocations, select.value || ''
            );
            wrap.classList.toggle('hidden', !(state.allocationContext && state.allocationContext.budget));
        } catch (_) {
            state.allocationContext = { budget: null, allocations: [] };
        }
    }

    function mountReviewDatePickers() {
        const data = state.extraction || {};
        const cfg = modeCfg();
        const today = window.FluxyDateRangePicker?.getDayKey?.() || null;
        // bill mode → primary picker is "Due Date", source it from extraction's due_date.
        // transaction mode → primary picker is "Transaction Date", source it from
        // invoice_date (when the receipt was issued / money was spent). Using due_date
        // for a transaction yielded a future timestamp that landed outside the ledger's
        // current month filter, so the row never appeared after save.
        const primarySource = state.mode === 'bill'
            ? data.due_date
            : state.mode === 'subscription'
                ? data.renewal_date
                : (data.transaction_date || data.invoice_date);
        state.dates.primary = (primarySource && /^\d{4}-\d{2}-\d{2}$/.test(primarySource)) ? primarySource : null;
        state.dates.invoice = (data.invoice_date && /^\d{4}-\d{2}-\d{2}$/.test(data.invoice_date)) ? data.invoice_date : null;

        const primaryEl = $('scan-drawer-content')?.querySelector('[data-picker="primary"]');
        const invoiceEl = $('scan-drawer-content')?.querySelector('[data-picker="invoice"]');
        if (!window.FluxyDateRangePicker?.mount) return;

        if (primaryEl) {
            state.pickers.primary = window.FluxyDateRangePicker.mount(primaryEl, {
                mode: 'single',
                start: state.dates.primary || today,
                defaultStart: state.dates.primary || today,
                maxDate: cfg.futureDates ? '2099-12-31' : (today || undefined),
                onChange: ({ start }) => {
                    state.dates.primary = start;
                    updateSaveEnabled();
                    mountReviewAllocationPicker();
                },
            });
        }
        if (invoiceEl) {
            state.pickers.invoice = window.FluxyDateRangePicker.mount(invoiceEl, {
                mode: 'single',
                start: state.dates.invoice || today,
                defaultStart: state.dates.invoice || today,
                maxDate: today || undefined,
                onChange: ({ start }) => {
                    state.dates.invoice = start;
                },
            });
        }
    }

    function renderErrorStep(message) {
        const content = $('scan-drawer-content');
        const footer = $('scan-drawer-footer');
        content.innerHTML = `
            <div class="bg-red-50 border border-red-200 rounded-xl px-5 py-6 text-center">
                <div class="flex justify-center mb-3">
                    <div class="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                        <svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 5c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"></path></svg>
                    </div>
                </div>
                <p class="text-[13px] font-semibold text-gray-900">Scan didn't go through</p>
                <p class="text-[12px] text-gray-600 mt-1">${escapeHtml(message)}</p>
            </div>
        `;
        footer.innerHTML = `
            <button id="scan-manual-link" type="button" class="px-4 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-[13px] font-medium hover:bg-gray-50 transition-colors">Add manually</button>
            <button id="scan-retry-btn" type="button" class="flex-1 px-4 py-2.5 bg-[#EA580C] text-white rounded-lg text-[13px] font-bold hover:bg-[#D94E0B] transition-colors active:scale-95">Try again</button>
        `;
        $('scan-retry-btn')?.addEventListener('click', () => {
            state.errorMessage = null;
            setStep('upload');
        });
        $('scan-manual-link')?.addEventListener('click', openManualEntry);
    }

    function renderOfflineStep() {
        const content = $('scan-drawer-content');
        const footer = $('scan-drawer-footer');
        content.innerHTML = `
            <div class="bg-gray-50 border border-gray-200 rounded-xl px-5 py-6 text-center">
                <div class="flex justify-center mb-3">
                    <div class="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                        <svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636 5.636 18.364m0-12.728L18.364 18.364M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z"></path></svg>
                    </div>
                </div>
                <p class="text-[13px] font-semibold text-gray-900">You're offline</p>
                <p class="text-[12px] text-gray-600 mt-1">Scanning needs an internet connection. You can still add this manually.</p>
            </div>
        `;
        footer.innerHTML = `
            <button id="scan-cancel-btn" type="button" class="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-[13px] font-medium hover:bg-gray-200 transition-colors">Close</button>
            <button id="scan-manual-link" type="button" class="flex-1 px-4 py-2.5 bg-[#EA580C] text-white rounded-lg text-[13px] font-bold hover:bg-[#D94E0B] transition-colors active:scale-95">Add manually</button>
        `;
        $('scan-cancel-btn')?.addEventListener('click', closeDrawer);
        $('scan-manual-link')?.addEventListener('click', openManualEntry);
    }

    // ── Event handlers ───────────────────────────────────────────────────

    function wireUploadHandlers() {
        const dropzone = $('scan-dropzone');
        const fileInput = $('scan-file-input');
        const cancelBtn = $('scan-cancel-btn');
        const startBtn = $('scan-start-btn');
        const replaceBtn = $('scan-replace-btn');
        const manualLink = $('scan-manual-link');

        fileInput?.addEventListener('change', (e) => {
            const f = e.target.files?.[0];
            if (f) handleFileSelected(f);
        });

        if (dropzone) {
            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropzone.classList.add('border-[#EA580C]', 'bg-orange-50/40');
            });
            dropzone.addEventListener('dragleave', () => {
                dropzone.classList.remove('border-[#EA580C]', 'bg-orange-50/40');
            });
            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('border-[#EA580C]', 'bg-orange-50/40');
                const f = e.dataTransfer?.files?.[0];
                if (f) handleFileSelected(f);
            });
        }

        cancelBtn?.addEventListener('click', closeDrawer);
        startBtn?.addEventListener('click', startScan);
        replaceBtn?.addEventListener('click', () => fileInput?.click());
        manualLink?.addEventListener('click', openManualEntry);
    }

    function wireReviewHandlers() {
        const form = $('scan-review-form');
        form?.addEventListener('input', () => {
            state.duplicateConfirmed = false;
            hideDuplicateWarning();
            updateSaveEnabled();
        });
        form?.addEventListener('change', () => {
            state.duplicateConfirmed = false;
            hideDuplicateWarning();
            updateSaveEnabled();
        });
        $('scan-save-btn')?.addEventListener('click', saveScannedDocument);
        $('scan-rescan-btn')?.addEventListener('click', () => {
            state.extraction = null;
            state.extractionSource = null;
            state.duplicateConfirmed = false;
            setStep('upload');
        });
    }

    function hideDuplicateWarning() {
        const warning = $('scan-duplicate-warning');
        if (!warning) return;
        warning.classList.add('hidden');
        warning.textContent = '';
    }

    function showDuplicateWarning(message) {
        const warning = $('scan-duplicate-warning');
        if (!warning) return;
        warning.textContent = message;
        warning.classList.remove('hidden');
    }

    function updateSaveEnabled() {
        const form = $('scan-review-form');
        const saveBtn = $('scan-save-btn');
        if (!form || !saveBtn) return;
        const fd = new FormData(form);
        const vendor = String(fd.get('vendor_name') || '').trim();
        const amount = normalizeRupiahAmount(fd.get('amount'));
        saveBtn.disabled = !(vendor && amount > 0) || state.saving;
    }

    function openManualEntry() {
        if (typeof window.showAddTransactionModal !== 'function') return;
        closeDrawer();
        if (state.mode === 'transaction') {
            window.showAddTransactionModal();
        } else if (state.mode === 'subscription') {
            window.showAddTransactionModal({
                title: 'Add Subscription',
                submitLabel: 'Activate Subscription',
                defaultCategory: 'SaaS',
                context: 'subscription',
            });
        } else {
            window.showAddTransactionModal({
                title: 'Add New Bill',
                submitLabel: 'Save Bill',
                defaultCategory: 'Operations',
                context: 'bill',
            });
        }
    }

    function handleFileSelected(file) {
        const err = validateBillFile(file);
        if (err) {
            window.showToast?.(err, 'error');
            return;
        }
        clearFile();
        state.file = file;
        if (file.type.startsWith('image/')) {
            state.previewUrl = URL.createObjectURL(file);
        }
        setStep('upload');
    }

    function openDrawerWithFile(mode, file, options = {}) {
        openDrawer(mode);
        if (!file) return;
        const err = validateBillFile(file);
        if (err) {
            window.showToast?.(err, 'error');
            return;
        }
        clearFile();
        state.file = file;
        if (file.type.startsWith('image/')) {
            state.previewUrl = URL.createObjectURL(file);
        }
        const extraction = options.extraction || options.mappedFields || options.mapped_fields || null;
        if (extraction && typeof extraction === 'object') {
            state.extraction = normalizeExtraction(extraction);
            state.extractionSource = options.extractionSource || options.provider_state || 'prefilled';
            setStep('review');
            return;
        }
        setStep('upload');
    }

    async function startScan() {
        if (!state.file) return;
        if (navigator.onLine === false) {
            setStep('offline');
            return;
        }
        setStep('scanning');
        try {
            const fileToSend = await maybeCompressImage(state.file);
            const base64 = await readFileAsBase64(fileToSend);
            const result = await callExtractEndpoint({
                file_base64: base64,
                mime_type: fileToSend.type,
                file_name: fileToSend.name,
                size_bytes: fileToSend.size,
            });
            state.extraction = normalizeExtraction(result.data);
            state.extractionSource = result.extraction_source || 'openai';
            setStep('review');
        } catch (err) {
            console.error('[document-capture] scan failed:', err?.message || err);
            state.errorMessage = friendlyError(err);
            setStep('error');
        }
    }

    function friendlyError(err) {
        const msg = String(err?.message || '');
        if (msg.includes('UNREADABLE_DOCUMENT')) {
            return "We couldn't read this document clearly. Try a sharper image or enter the details manually.";
        }
        if (msg.includes('FILE_TOO_LARGE')) {
            return 'File is too large. Please upload a smaller image or PDF.';
        }
        if (msg.includes('UNSUPPORTED_MIME')) {
            return `Unsupported file type. Please upload ${ALLOWED_EXT_LABEL}.`;
        }
        if (msg.includes('401') || msg.includes('UNAUTHENTICATED')) {
            return 'Your session expired. Please refresh and sign in again.';
        }
        return 'Could not scan this document right now. Please try again or enter the details manually.';
    }

    function getContext() {
        return window[modeCfg().contextKey];
    }

    async function callExtractEndpoint(payload) {
        const ctx = getContext();
        const currentUser = ctx?.auth?.currentUser;
        if (!currentUser) throw new Error('UNAUTHENTICATED');
        const token = await currentUser.getIdToken();
        const res = await fetch(EXTRACT_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
        });
        let body = null;
        try { body = await res.json(); } catch { body = null; }
        if (!res.ok || !body?.ok) {
            const code = body?.error?.code || `HTTP_${res.status}`;
            throw new Error(code);
        }
        return body;
    }

    function normalizeExtraction(data) {
        if (!data || typeof data !== 'object') return {};
        const category = ALLOWED_CATEGORIES.includes(data.category) ? data.category : 'Operations';
        return {
            vendor_name: typeof data.vendor_name === 'string' ? data.vendor_name : '',
            amount: typeof data.amount === 'number' ? Math.round(data.amount) : normalizeRupiahAmount(data.amount),
            category,
            due_date: typeof data.due_date === 'string' ? data.due_date : '',
            renewal_date: typeof data.renewal_date === 'string' ? data.renewal_date : '',
            transaction_date: typeof data.transaction_date === 'string' ? data.transaction_date : '',
            invoice_date: typeof data.invoice_date === 'string' ? data.invoice_date : '',
            invoice_number: typeof data.invoice_number === 'string' ? data.invoice_number : '',
            document_type: typeof data.document_type === 'string' ? data.document_type : 'unknown',
            billing_cycle: typeof data.billing_cycle === 'string' ? data.billing_cycle : '',
            notes: typeof data.notes === 'string' ? data.notes : '',
            confidence: data.confidence || {},
            warnings: Array.isArray(data.warnings) ? data.warnings : [],
            raw_text_preview: typeof data.raw_text_preview === 'string' ? data.raw_text_preview.slice(0, 500) : null,
        };
    }

    function dayKeyFromAny(value) {
        if (!value) return '';
        if (typeof value === 'string') return value.slice(0, 10);
        if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
        if (typeof value.toDate === 'function') {
            try {
                return value.toDate().toISOString().slice(0, 10);
            } catch {
                return '';
            }
        }
        if (Number.isFinite(value.seconds)) return new Date(value.seconds * 1000).toISOString().slice(0, 10);
        return '';
    }

    async function findPossibleDuplicate(ctx, userId, payload) {
        const vendor = String(payload.vendor_name || '').trim().toLowerCase();
        const amount = Number(payload.amount) || 0;
        if (!vendor || amount <= 0) return null;
        try {
            if (state.mode === 'bill' && typeof ctx.ds.getBills === 'function') {
                const dueKey = dayKeyFromAny(payload.due_date);
                const invoice = String(payload.invoice_number || '').trim().toLowerCase();
                const bills = await ctx.ds.getBills(userId);
                return bills.find(item => {
                    const sameVendor = String(item.vendor_name || '').trim().toLowerCase() === vendor;
                    const sameAmount = Number(item.amount) === amount;
                    const sameInvoice = invoice && String(item.invoice_number || '').trim().toLowerCase() === invoice;
                    const sameDue = dueKey && dayKeyFromAny(item.due_date) === dueKey;
                    return sameVendor && sameAmount && (sameInvoice || sameDue);
                }) || null;
            }
            if (state.mode === 'transaction' && typeof ctx.ds.getTransactions === 'function') {
                const txKey = dayKeyFromAny(payload.timestamp);
                const txs = await ctx.ds.getTransactions(userId, 1000);
                return txs.find(item => (
                    String(item.vendor_name || '').trim().toLowerCase() === vendor &&
                    Number(item.amount) === amount &&
                    txKey &&
                    dayKeyFromAny(item.timestamp) === txKey
                )) || null;
            }
            if (state.mode === 'subscription' && typeof ctx.ds.getSubscriptions === 'function') {
                const subs = await ctx.ds.getSubscriptions(userId);
                return subs.find(item => (
                    String(item.vendor_name || '').trim().toLowerCase() === vendor &&
                    Number(item.amount) === amount
                )) || null;
            }
        } catch {
            return null;
        }
        return null;
    }

    async function saveScannedDocument() {
        if (state.saving) return;
        const cfg = modeCfg();
        const ctx = getContext();
        const user = ctx?.auth?.currentUser;
        if (!user || !ctx?.ds || typeof ctx.ds[cfg.saveMethod] !== 'function') {
            window.showToast?.('You need to be signed in to save this.', 'error');
            return;
        }
        const form = $('scan-review-form');
        if (!form) return;
        const fd = new FormData(form);

        const vendor_name = String(fd.get('vendor_name') || '').trim();
        const amount = normalizeRupiahAmount(fd.get('amount'));
        const category = ALLOWED_CATEGORIES.includes(fd.get('category')) ? fd.get('category') : 'Operations';
        if (!vendor_name || amount <= 0) {
            window.showToast?.('Please enter vendor and amount before saving.', 'error');
            return;
        }

        const formType = fd.get('type');
        const type = (cfg.showTypeStatus && TRANSACTION_TYPES.includes(formType)) ? formType : cfg.defaultType;
        const formStatus = fd.get('status');
        const status = (cfg.showTypeStatus && TRANSACTION_STATUSES.includes(formStatus)) ? formStatus : cfg.defaultStatus;

        const primaryDate = parseDateInput(state.dates.primary);
        const invoiceDate = parseDateInput(state.dates.invoice);
        const invoiceNumber = String(fd.get('invoice_number') || '').trim();
        const extraction = state.extraction || {};
        const file = state.file;

        const payload = {
            vendor_name,
            category,
            amount,
            type,
            status,
            icon: '💸',
            source: cfg.source,
            created_via: cfg.createdVia,
            extraction_status: 'reviewed',
            extraction_source: state.extractionSource || 'openai',
            extraction_confidence: extraction.confidence?.overall ?? null,
            extraction_warnings: extraction.warnings || [],
            document_type: extraction.document_type || 'unknown',
            invoice_number: invoiceNumber || null,
            raw_text_preview: extraction.raw_text_preview || null,
            source_file_name: file?.name || null,
            source_file_mime_type: file?.type || null,
            source_file_size_bytes: file?.size || null,
        };

        if (state.mode === 'bill') {
            if (primaryDate) payload.due_date = primaryDate;
            if (invoiceDate) payload.invoice_date = invoiceDate;
            payload.payment_status = 'unpaid';
        } else if (state.mode === 'subscription') {
            if (primaryDate) payload.renewal_date = primaryDate;
            if (invoiceDate) payload.invoice_date = invoiceDate;
            payload.billing_cycle = extraction.billing_cycle || 'monthly';
        } else {
            if (primaryDate) payload.timestamp = primaryDate;
            if (invoiceDate) payload.invoice_date = invoiceDate;
            // Pin to the user-selected budget allocation (expense-like types only).
            if (window.FluxyBudgetPicker && window.FluxyBudgetPicker.isExpenseLike(type)
                && state.allocationContext?.budget) {
                Object.assign(payload, window.FluxyBudgetPicker.buildAssignmentFields({
                    budget: state.allocationContext.budget,
                    allocationId: String(fd.get('budget_allocation') || '')
                }));
            }
        }

        const duplicate = await findPossibleDuplicate(ctx, user.uid, payload);
        if (duplicate && !state.duplicateConfirmed) {
            state.duplicateConfirmed = true;
            const message = 'Possible duplicate found. Review the existing record, then click save again if you still want to continue.';
            showDuplicateWarning(message);
            window.showToast?.(message, 'info');
            return;
        }

        state.saving = true;
        const saveBtn = $('scan-save-btn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving…';
        }

        try {
            await ctx.ds[cfg.saveMethod](user.uid, payload);
            const savedDayKey = (state.mode === 'transaction' && primaryDate)
                ? primaryDate.toISOString().slice(0, 10)
                : null;
            const range = (typeof ctx.getRange === 'function') ? ctx.getRange() : null;
            const outsideRange = !!(savedDayKey && range && (savedDayKey < range.start || savedDayKey > range.end));
            if (outsideRange) {
                window.showToast?.(`Transaction saved on ${savedDayKey}. Switch the date range to view it.`, 'info');
            } else {
                window.showToast?.(cfg.toastSuccess, 'success');
            }
            closeDrawer();
            const refresh = window[cfg.refreshFn];
            if (typeof refresh === 'function') refresh();
        } catch (err) {
            console.error('[document-capture] save failed:', err?.message || err);
            window.showToast?.('Could not save. Please try again.', 'error');
            state.saving = false;
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = cfg.saveLabel;
            }
            updateSaveEnabled();
        }
    }

    // ── Boot ─────────────────────────────────────────────────────────────

    function init() {
        document.querySelectorAll('[data-scan-mode]').forEach(btn => {
            btn.addEventListener('click', () => {
                openDrawer(btn.getAttribute('data-scan-mode'));
            });
        });
        $('scan-drawer-close-btn')?.addEventListener('click', closeDrawer);
        $('scan-drawer-backdrop')?.addEventListener('click', closeDrawer);
        window.addEventListener('online', () => {
            if (state.step === 'offline') setStep('upload');
        });
        window.addEventListener('offline', () => {
            if (state.step === 'upload' || state.step === 'review') setStep('offline');
        });
    }

    window.openScanDrawer = openDrawer;
    window.openScanDrawerWithFile = openDrawerWithFile;
    window.openScanBillDrawer = () => openDrawer('bill');
    window.openScanTransactionDrawer = () => openDrawer('transaction');
    window.openScanSubscriptionDrawer = () => openDrawer('subscription');
    window.closeScanDrawer = closeDrawer;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
