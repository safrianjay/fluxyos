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
            targetCollection: 'bills',
            documentRole: 'invoice',
            sourceContext: 'bill',
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
            targetCollection: 'transactions',
            documentRole: 'receipt',
            sourceContext: 'transaction',
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
            targetCollection: 'subscriptions',
            documentRole: 'receipt',
            sourceContext: 'subscription',
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
        pickers: { primary: null, invoice: null },
        dates: { primary: null, invoice: null },
        errorMessage: null,
        allocationContext: null, // { budget, allocations } | null — transaction allocation picker
        // Multi-currency (matches the invoice/bill convention): the document's own
        // currency, plus the IDR conversion used when the record must land in the
        // Rupiah ledger. `userTouched` pins a manually entered rate.
        currency: 'IDR',
        fx: { rate: null, rateDate: null, loading: false, error: null, userTouched: false },
        bankAccounts: [],
    };

    const SUPPORTED_CURRENCIES = window.FluxyMoney.SUPPORTED;
    // FluxyMoney owns every currency rule (symbols, decimals, minor units,
    // as-you-type grouping). Never re-implement them here.
    function money() { return window.FluxyMoney || null; }
    function normalizeCurrency(cur) {
        const c = String(cur || '').toUpperCase();
        return SUPPORTED_CURRENCIES.includes(c) ? c : 'IDR';
    }
    function isForeign() { return window.FluxyMoney.isForeignCurrency(state.currency); }
    function currencyLabel(cur) {
        return `(${window.FluxyMoney.symbol(cur)})`;
    }
    function formatAmountInput(value, cur) {
        const m = money();
        if (m) return m.formatMoneyInput(value, cur);
        return String(value == null ? '' : value).replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }
    // Parse the review input into integer MINOR units of `cur` (rupiah for IDR,
    // cents for USD/SGD) — the same storage convention invoices and bills use.
    function amountToMinor(value, cur) {
        const m = money();
        if (m) return m.toMinor(value, cur);
        return normalizeRupiahAmount(value);
    }
    function formatMoneyDisplay(minor, cur) {
        const m = money();
        if (m) return m.formatMoney(minor, cur);
        return String(Number(minor) || 0);
    }
    function minorToMajor(minor, cur) {
        const m = money();
        if (m) return m.fromMinor(minor, cur);
        return Number(minor) || 0;
    }

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

    // ── Multi-currency conversion ────────────────────────────────────────────
    // Same source and contract as the Invoices module's mark-paid flow: the
    // same-origin /.netlify/functions/fx-rate proxy (Frankfurter/ECB), asked for
    // the IDR-per-1-unit rate on the document's own date.

    async function fetchFxRate(fromCurrency, dayKey) {
        try {
            const date = dayKey || new Date().toISOString().slice(0, 10);
            const res = await fetch(`/.netlify/functions/fx-rate?from=${encodeURIComponent(fromCurrency)}&to=${encodeURIComponent(window.FluxyMoney.baseCurrency())}&date=${encodeURIComponent(date)}`);
            if (!res.ok) return null;
            const data = await res.json();
            const rate = Number(data.rate) || null;
            return rate ? { rate, rateDate: data.date || date } : null;
        } catch (_) {
            return null;
        }
    }

    // The IDR equivalent of what is currently in the Amount field, or null when
    // there is nothing to convert (IDR, no amount, or no rate yet).
    function convertedIdr() {
        if (!isForeign()) return null;
        const rate = Number(state.fx.rate);
        if (!(rate > 0)) return null;
        const minor = amountToMinor($('scan-review-form')?.querySelector('input[name="amount"]')?.value, state.currency);
        if (!(minor > 0)) return null;
        return Math.round(minorToMajor(minor, state.currency) * rate);
    }

    function renderFxBlock() {
        const host = $('scan-fx-block');
        if (!host) return;
        host.classList.toggle('hidden', !isForeign());
        if (!isForeign()) return;
        const rateInput = $('scan-fx-rate');
        if (rateInput && !state.fx.userTouched) {
            rateInput.value = state.fx.rate ? formatAmountInput(String(Math.round(state.fx.rate)), 'IDR') : '';
        }
        const note = $('scan-fx-note');
        if (!note) return;
        if (state.fx.loading) { note.textContent = 'Fetching the exchange rate…'; return; }
        const idr = convertedIdr();
        if (idr != null) {
            const minor = amountToMinor($('scan-review-form')?.querySelector('input[name="amount"]')?.value, state.currency);
            const dated = state.fx.rateDate ? ` · rate of ${state.fx.rateDate}` : '';
            note.textContent = `${formatMoneyDisplay(minor, state.currency)} ≈ ${formatMoneyDisplay(idr, 'IDR')}${state.fx.userTouched ? ' · your rate' : dated}`;
        } else if (state.fx.error) {
            note.textContent = 'Could not fetch the rate — enter it manually to continue.';
        } else {
            note.textContent = 'Enter an exchange rate to see the Rupiah equivalent.';
        }
    }

    async function refreshFxRate() {
        if (!isForeign() || state.fx.userTouched) { renderFxBlock(); return; }
        state.fx.loading = true;
        state.fx.error = null;
        renderFxBlock();
        const cur = state.currency;
        const dayKey = state.dates.invoice || state.dates.primary || null;
        const result = await fetchFxRate(cur, dayKey);
        // Ignore a stale response if the user switched currency meanwhile.
        if (state.currency !== cur) return;
        state.fx.loading = false;
        if (result) {
            state.fx.rate = result.rate;
            state.fx.rateDate = result.rateDate;
        } else {
            state.fx.rate = null;
            state.fx.error = 'rate_unavailable';
        }
        renderFxBlock();
        updateSaveEnabled();
    }

    // The shared attachment helper is only eagerly loaded on bill.html. Reuse the
    // same memo key as shared-dashboard.js so the script is fetched at most once
    // per page regardless of who asks first.
    function loadAttachmentApi() {
        if (window.FluxyDocumentAttachment) return Promise.resolve(window.FluxyDocumentAttachment);
        if (window.__fluxyDocumentAttachmentPromise) return window.__fluxyDocumentAttachmentPromise;
        window.__fluxyDocumentAttachmentPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/assets/js/document-attachment.js';
            script.onload = () => resolve(window.FluxyDocumentAttachment);
            script.onerror = () => reject(new Error('Unable to load document attachment helper.'));
            document.head.appendChild(script);
        });
        return window.__fluxyDocumentAttachmentPromise;
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
        // Per-document state — a second scan must not inherit the first one's
        // currency, exchange rate, or cash-impact choice.
        state.currency = 'IDR';
        state.fx = { rate: null, rateDate: null, loading: false, error: null, userTouched: false };
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
        clearFile();
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

    // Progress stepper for the scan flow (Upload → Processing → Review). Only
    // rendered where the shell provides a #scan-drawer-stepper host (ai.html,
    // bill.html); ledger.html uses its Receipt/Bank tab strip instead, so the
    // host is absent there and this no-ops. Error/offline steps hide it.
    function renderStepper() {
        const host = $('scan-drawer-stepper');
        if (!host || !window.FluxyDrawer) return;
        const isFlow = ['upload', 'scanning', 'review'].includes(state.step);
        if (!isFlow) { host.classList.add('hidden'); host.innerHTML = ''; return; }
        const stepKey = state.step === 'scanning' ? 'processing' : state.step;
        host.classList.remove('hidden');
        host.innerHTML = window.FluxyDrawer.stepper([
            { key: 'upload', label: 'Upload' },
            { key: 'processing', label: 'Processing' },
            { key: 'review', label: 'Review' }
        ], stepKey);
    }

    function renderDrawer() {
        renderStepper();
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
                <button id="scan-cancel-btn" type="button" class="fluxy-drawer-btn fluxy-drawer-btn--secondary">Cancel</button>
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
            <button id="scan-cancel-btn" type="button" class="fluxy-drawer-btn fluxy-drawer-btn--secondary">Cancel</button>
            <button id="scan-start-btn" type="button" class="fluxy-drawer-btn fluxy-drawer-btn--primary">
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
            <button type="button" disabled class="fluxy-drawer-btn fluxy-drawer-btn--secondary">Cancel</button>
            <button type="button" disabled class="fluxy-drawer-btn fluxy-drawer-btn--primary">Scanning…</button>
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

        // Adopt the detected currency, then render the amount in that currency's
        // own convention (Rupiah has no decimals; USD/SGD keep cents).
        state.currency = normalizeCurrency(data.currency);
        // Seed in the currency's canonical form — "20.5" for a $20.50 receipt
        // reads as $20.05 at a glance.
        const amountValue = data.amount != null && data.amount !== ''
            ? formatAmountInput(
                (Number(data.amount) || 0).toFixed(money() ? money().decimals(state.currency) : 0),
                state.currency)
            : '';

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
                <div class="fluxy-drawer-section-head">
                    <h3 class="fluxy-drawer-section-title">Review before saving</h3>
                    <p class="fluxy-drawer-section-desc">Check what FluxyOS extracted, edit anything that needs fixing, then save.</p>
                </div>
                ${mockBanner}
                ${warningsBlock}

                <div>
                    <label class="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Vendor ${confidenceMark(conf.vendor_name)}</label>
                    <input type="text" name="vendor_name" required value="${escapeHtml(data.vendor_name || '')}" placeholder="Vendor name"
                           class="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#EA580C] focus:border-[#EA580C]">
                </div>

                <div>
                    <div class="flex items-end gap-2">
                        <div class="flex-1 min-w-0">
                            <label class="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Amount <span id="scan-amount-cur">${escapeHtml(currencyLabel(state.currency))}</span> ${confidenceMark(conf.amount)}</label>
                            <input type="text" name="amount" required inputmode="decimal" value="${escapeHtml(amountValue)}" placeholder="${window.FluxyMoney.isZeroDecimal(state.currency) ? '1.250.000' : '1,250.00'}"
                                   class="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-[13px] tabular-nums focus:outline-none focus:ring-1 focus:ring-[#EA580C] focus:border-[#EA580C]">
                        </div>
                        <div class="w-[104px] flex-shrink-0">
                            <label class="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Currency</label>
                            <select name="currency" class="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#EA580C] focus:border-[#EA580C]">
                                ${SUPPORTED_CURRENCIES.map(c => `<option value="${c}" ${c === state.currency ? 'selected' : ''}>${c}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div id="scan-fx-block" class="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 ${isForeign() ? '' : 'hidden'}">
                        <div class="flex items-center gap-2">
                            <label for="scan-fx-rate" class="text-[11px] font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">Rate (${window.FluxyMoney.baseSymbol()})</label>
                            <input type="text" id="scan-fx-rate" inputmode="numeric" placeholder="16.250"
                                   class="flex-1 min-w-0 px-3 py-2 bg-white border border-gray-200 rounded-lg text-[13px] tabular-nums focus:outline-none focus:ring-1 focus:ring-[#EA580C] focus:border-[#EA580C]">
                        </div>
                        <p id="scan-fx-note" class="mt-1.5 text-[11px] text-gray-500"></p>
                    </div>
                </div>

                <div>
                    <label class="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Category ${confidenceMark(conf.category)}</label>
                    <select name="category" required
                            class="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#EA580C] focus:border-[#EA580C]">
                        ${categoryOptions}
                    </select>
                </div>

                <div>
                    <label class="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Account <span id="scan-account-source"></span></label>
                    <div data-scan-account-mount></div>
                    <p class="mt-1 text-[11px] text-gray-400">We suggest the account from your vendor &amp; keyword rules — change it if needed.</p>
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

                <div id="scan-cash-impact"></div>

                <div id="scan-source-doc"></div>

                <div class="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[11px] text-gray-500 leading-relaxed">
                    <p><span class="font-semibold text-gray-700">AI suggests. You confirm. FluxyOS saves.</span></p>
                    <p class="mt-0.5">${footerNote}</p>
                </div>
            </form>
        `;
        footer.innerHTML = `
            <button id="scan-rescan-btn" type="button" class="fluxy-drawer-btn fluxy-drawer-btn--secondary">Rescan</button>
            <button id="scan-save-btn" type="button" class="fluxy-drawer-btn fluxy-drawer-btn--primary">${escapeHtml(cfg.saveLabel)}</button>
        `;
        mountReviewDatePickers();
        wireReviewHandlers();
        updateSaveEnabled();
        mountReviewAllocationPicker();
        mountReviewAccountPicker();
        renderSourceDocument();
        mountCashImpact();
        renderFxBlock();
        if (isForeign()) refreshFxRate();
    }

    // ── Source document ──────────────────────────────────────────────────────
    // The scanned file is already in hand and will be attached on save, so the
    // review step shows it as an attachment — never a second upload prompt.
    function renderSourceDocument() {
        const host = $('scan-source-doc');
        if (!host) return;
        const file = state.file;
        if (!file) { host.innerHTML = ''; return; }
        const isImage = (file.type || '').startsWith('image/');
        const thumb = isImage && state.previewUrl
            ? `<img src="${escapeHtml(state.previewUrl)}" alt="" class="h-full w-full object-cover">`
            : `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>`;
        host.innerHTML = `
            <label class="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Source document</label>
            <div class="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                <span class="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 text-gray-400">${thumb}</span>
                <div class="min-w-0 flex-1">
                    <p class="truncate text-[13px] font-semibold text-gray-800">${escapeHtml(file.name || 'Document')}</p>
                    <p class="truncate text-[11px] text-gray-400"><span class="tabular-nums">${escapeHtml(formatBytes(file.size))}</span> · <span>Attached automatically when you save</span></p>
                </div>
                <button type="button" id="scan-source-replace" class="flex-shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900">Replace</button>
            </div>`;
        $('scan-source-replace')?.addEventListener('click', () => {
            state.extraction = null;
            state.extractionSource = null;
            setStep('upload');
        });
    }

    // ── Cash impact ──────────────────────────────────────────────────────────
    // Shown as soon as the extraction lands so the user can see (and correct)
    // whether this moves cash, before saving. Bills are informational: a bill
    // accrues now and only moves cash when it is marked paid.
    async function mountCashImpact() {
        const host = $('scan-cash-impact');
        if (!host) return;
        const FCI = window.FluxyCashImpact;
        if (!FCI) { host.innerHTML = ''; return; }

        if (state.mode !== 'transaction') {
            host.innerHTML = `
                <div>
                    <p class="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Cash impact</p>
                    <div class="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                        <span class="inline-flex items-center rounded border border-gray-200 bg-white px-2 py-1 text-[11px] font-bold uppercase text-gray-600">No immediate cash impact</span>
                        <p class="mt-1.5 text-[11px] text-gray-500">${state.mode === 'bill'
                            ? 'Saving records what you owe. Cash moves when you mark this bill paid.'
                            : 'Recurring costs move cash on each renewal, not when you save this.'}</p>
                    </div>
                </div>`;
            return;
        }

        // Derived from the Type field above — never asked. Only the cash account
        // is a user choice. See FluxyCashImpact.deriveFromType.
        const typeOf = () => $('scan-review-form')?.querySelector('select[name="type"]')?.value || modeCfg().defaultType;
        host.innerHTML = `<div class="space-y-3" id="scan-cash-control"></div>`;
        const render = () => {
            const control = $('scan-cash-control');
            if (!control) return;
            control.innerHTML = FCI.buildDerivedHtml({
                type: typeOf(), accountId: FCI.accountIdFrom(control), bankAccounts: state.bankAccounts
            });
        };
        render();
        $('scan-review-form')?.querySelector('select[name="type"]')
            ?.addEventListener('change', () => FCI.refreshDerived($('scan-cash-control'), typeOf()));

        if (!state.bankAccounts.length) {
            try {
                const ctx = getContext();
                const uid = ctx?.auth?.currentUser?.uid;
                if (ctx?.ds && uid) {
                    const accounts = await ctx.ds.getBankAccounts(uid);
                    if (Array.isArray(accounts) && accounts.length && $('scan-cash-control')) {
                        state.bankAccounts = accounts;
                        render();
                    }
                }
            } catch (_) { /* the badge still shows without a linked account */ }
        }
    }

    // Account picker for the scan review (Phase 3b): the searchable CoA picker,
    // pre-filled with the account resolved from vendor memory / keyword rules /
    // category, with a small "source" badge so the user can trust or override it.
    function reviewAccountDirection() {
        const cfg = modeCfg();
        let type = cfg.defaultType;
        const sel = $('scan-review-form')?.querySelector('select[name="type"]');
        if (cfg.showTypeStatus && sel && sel.value) type = sel.value;
        return ['income', 'revenue', 'refund', 'pending_receivable'].includes(String(type).toLowerCase()) ? 'in' : 'out';
    }

    function setReviewAccountSource(source) {
        const el = $('scan-account-source');
        if (!el) return;
        const map = {
            vendor_default: { text: 'From vendor', cls: 'text-emerald-600' },
            vendor: { text: 'From vendor', cls: 'text-emerald-600' },
            keyword: { text: 'From keyword rule', cls: 'text-emerald-600' },
            chain: { text: 'From category', cls: 'text-gray-400' },
            fallback: { text: 'Review — no match', cls: 'text-[#EA580C]' }
        };
        const m = source && map[source];
        el.innerHTML = m ? `<span class="ml-2 text-[10px] font-bold ${m.cls}">${escapeHtml(m.text)}</span>` : '';
    }

    async function refreshReviewAccount(force) {
        if (!state.accountPicker) return;
        if (!force && state.accountUserTouched) return;
        const ctx = getContext();
        const uid = ctx?.auth?.currentUser?.uid;
        if (!ctx?.ds || !uid) return;
        const form = $('scan-review-form');
        const vendor = form?.querySelector('input[name="vendor_name"]')?.value || '';
        const category = form?.querySelector('select[name="category"]')?.value || '';
        const cfg = modeCfg();
        const typeSel = form?.querySelector('select[name="type"]');
        const type = (cfg.showTypeStatus && typeSel?.value) ? typeSel.value : cfg.defaultType;
        try {
            state.accountPicker.setDirection(reviewAccountDirection());
            const sug = await ctx.ds.suggestAccountForEntry(uid, { type, category, vendor_name: vendor });
            if (sug && sug.code) {
                state.accountPicker.setValue(sug.code);
                state.accountUserTouched = false;
                setReviewAccountSource(sug.source);
            }
        } catch (_) { /* non-fatal — the field simply stays as-is */ }
    }

    async function mountReviewAccountPicker() {
        const mountEl = $('scan-drawer-content')?.querySelector('[data-scan-account-mount]');
        if (!mountEl || !window.FluxyAccountPicker) return;
        const ctx = getContext();
        const uid = ctx?.auth?.currentUser?.uid;
        if (!ctx?.ds || !uid) return;
        try {
            const chart = await ctx.ds.getChartForPicker(uid);
            state.accountUserTouched = false;
            state.accountPicker = window.FluxyAccountPicker.mount(mountEl, {
                name: 'account_code',
                accounts: chart,
                direction: reviewAccountDirection(),
                placeholder: 'Select an account',
                onChange: () => { state.accountUserTouched = true; setReviewAccountSource(null); },
                onCreateAccount: () => window.open('/accounting', '_blank')
            });
            await refreshReviewAccount(true);
        } catch (_) { /* non-fatal — the review still saves without an explicit account */ }
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
                    // The rate is the document's date rate (same rule as the
                    // Invoices mark-paid flow), so a new date means a new rate —
                    // unless the user has typed their own.
                    if (isForeign()) refreshFxRate();
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
                    if (isForeign()) refreshFxRate();
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
            <button id="scan-retry-btn" type="button" class="fluxy-drawer-btn fluxy-drawer-btn--primary">Try again</button>
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
            <button id="scan-cancel-btn" type="button" class="fluxy-drawer-btn fluxy-drawer-btn--secondary">Close</button>
            <button id="scan-manual-link" type="button" class="fluxy-drawer-btn fluxy-drawer-btn--primary">Add manually</button>
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
            updateSaveEnabled();
        });
        form?.addEventListener('change', () => {
            updateSaveEnabled();
        });
        // Re-suggest the account when the vendor / category / type changes (unless
        // the user has already picked one — refreshReviewAccount guards that).
        form?.querySelector('input[name="vendor_name"]')?.addEventListener('blur', () => refreshReviewAccount(false));
        form?.querySelector('select[name="category"]')?.addEventListener('change', () => refreshReviewAccount(false));
        form?.querySelector('select[name="type"]')?.addEventListener('change', () => refreshReviewAccount(false));

        // Amount: group thousands as the user types, in the selected currency's
        // own convention. Caret is kept at the end — the field is short and the
        // grouping shifts every character before it.
        const amountInput = form?.querySelector('input[name="amount"]');
        amountInput?.addEventListener('input', () => {
            const atEnd = amountInput.selectionStart === amountInput.value.length;
            amountInput.value = formatAmountInput(amountInput.value, state.currency);
            if (atEnd) amountInput.setSelectionRange(amountInput.value.length, amountInput.value.length);
            renderFxBlock();
        });

        // Currency: relabel, re-format the existing amount under the new
        // convention, and re-fetch the rate.
        form?.querySelector('select[name="currency"]')?.addEventListener('change', (e) => {
            const next = normalizeCurrency(e.target.value);
            if (next === state.currency) return;
            state.currency = next;
            state.fx = { rate: null, rateDate: null, loading: false, error: null, userTouched: false };
            const label = $('scan-amount-cur');
            if (label) label.textContent = currencyLabel(next);
            if (amountInput) {
                // Re-interpret the digits already typed under the new convention
                // rather than wiping the user's input.
                const digits = String(amountInput.value || '').replace(/[^\d.]/g, '');
                amountInput.value = formatAmountInput(digits, next);
                amountInput.placeholder = window.FluxyMoney.isZeroDecimal(next) ? '1.250.000' : '1,250.00';
            }
            renderFxBlock();
            if (isForeign()) refreshFxRate();
            updateSaveEnabled();
        });

        // Manual rate override — pins the rate so a later refresh cannot clobber it.
        const rateInput = $('scan-fx-rate');
        rateInput?.addEventListener('input', () => {
            // Reassigning .value resets the caret to the end, so a mid-string
            // correction sends the cursor away and the next digit lands in the
            // wrong place. Re-anchor by digit count, not character index — the
            // separators shift as the grouping changes. (The amount field above
            // only handles the caret-at-end case; this is the general form.)
            const before = rateInput.value.slice(0, rateInput.selectionStart ?? rateInput.value.length);
            const digitsBefore = (before.match(/\d/g) || []).length;
            rateInput.value = formatAmountInput(rateInput.value, 'IDR');
            let pos = 0;
            for (let seen = 0; pos < rateInput.value.length && seen < digitsBefore; pos += 1) {
                if (/\d/.test(rateInput.value[pos])) seen += 1;
            }
            rateInput.setSelectionRange(pos, pos);
            const parsed = amountToMinor(rateInput.value, 'IDR');
            state.fx.userTouched = true;
            state.fx.rate = parsed > 0 ? parsed : null;
            state.fx.rateDate = null;
            state.fx.error = null;
            renderFxBlock();
            updateSaveEnabled();
        });

        $('scan-save-btn')?.addEventListener('click', saveScannedDocument);
        $('scan-rescan-btn')?.addEventListener('click', () => {
            state.extraction = null;
            state.extractionSource = null;
            setStep('upload');
        });
    }


    function updateSaveEnabled() {
        const form = $('scan-review-form');
        const saveBtn = $('scan-save-btn');
        if (!form || !saveBtn) return;
        const fd = new FormData(form);
        const vendor = String(fd.get('vendor_name') || '').trim();
        const amountMinor = amountToMinor(fd.get('amount'), state.currency);
        // A foreign-currency record that must land in the Rupiah ledger cannot be
        // saved without a rate. Bills keep their own currency until payment, so
        // they stay saveable.
        const needsRate = isForeign() && state.mode !== 'bill';
        const rateOk = !needsRate || Number(state.fx.rate) > 0;
        saveBtn.disabled = !(vendor && amountMinor > 0 && rateOk) || state.saving;
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

        // Identity check on the file BYTES, before extraction (D0 in
        // docs/DUPLICATE_PREVENTION.md). Runs first because it is the one signal
        // that needs no judgement — the same bytes are the same document — and
        // because catching it here skips an AI extraction the user would pay for
        // and then throw away.
        if (await warnIfFileAlreadyUploaded()) return;

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
        // Auth rehydrates from IndexedDB asynchronously — without this wait an
        // early scan reports UNAUTHENTICATED ("Your session expired") to a user
        // who is signed in. See getTransactionDataService in shared-dashboard.js.
        if (typeof ctx?.auth?.authStateReady === 'function') await ctx.auth.authStateReady();
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
        const currency = normalizeCurrency(data.currency);
        return {
            vendor_name: typeof data.vendor_name === 'string' ? data.vendor_name : '',
            // Keep the document's own units: a USD total stays 20.00, not 20 or
            // 2000. The review step converts on save.
            amount: typeof data.amount === 'number' ? data.amount : normalizeRupiahAmount(data.amount),
            currency,
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


    const DUPLICATE_KIND = { bill: 'bills', subscription: 'subscriptions', transaction: 'transactions' };

    const RECORD_PAGE = { bills: '/bill', subscriptions: '/subscription', transactions: '/ledger' };

    // Has this exact file already been uploaded and attached to a record?
    // Returns true when the user chose to stop. Silent on any failure — a
    // duplicate check must never block a legitimate scan.
    async function warnIfFileAlreadyUploaded() {
        const ctx = getContext();
        const user = ctx?.auth?.currentUser;
        if (!user || !state.file || typeof ctx.ds?.findDocumentByHash !== 'function') return false;
        try {
            const api = await loadAttachmentApi();
            const hash = await api.hashFile?.(state.file);
            if (!hash) return false;
            const existing = await ctx.ds.findDocumentByHash(user.uid, hash);
            if (!existing) return false;

            const target = existing.target_collection || 'transactions';
            const proceed = await window.showConfirmDialog?.({
                title: 'You have already uploaded this exact file',
                // Filename LAST, so the sentence itself is one whole literal the
                // translation dictionary and the i18n audit can both see.
                body: `This file is already attached to a record, so scanning it again would most likely create a duplicate.<br><strong>${escapeHtml(existing.file_name || '')}</strong>`,
                confirmLabel: 'Scan it anyway',
                cancelLabel: 'Open the record',
                tone: 'default'
            });
            if (proceed) return false; // user insists — carry on scanning

            const page = RECORD_PAGE[target] || '/ledger';
            window.location.href = `${page}?record=${encodeURIComponent(existing.target_id)}`;
            return true;
        } catch (err) {
            console.warn('[duplicates] file-hash check skipped:', err && err.message);
            return false;
        }
    }

    // Attach this scan's source document to the record it duplicates, instead of
    // creating a second one. This is the highest-value outcome of the whole
    // duplicate flow: the existing record is usually a manual entry with no
    // paperwork, and the scan's only unique contribution IS the paperwork. The
    // user keeps the document and the books stay correct.
    async function attachScanToExisting(ctx, user, match, file) {
        if (!file) {
            window.showToast?.('Nothing to attach — this scan has no source file.', 'error');
            return false;
        }
        const targetCollection = DUPLICATE_KIND[state.mode] || 'transactions';
        try {
            const api = await loadAttachmentApi();
            const fitted = await api.fitFileForUpload(file);
            if (!fitted.file) {
                window.showToast?.(fitted.reason === 'too_large'
                    ? 'The source file is over 5 MB, so it could not be attached.'
                    : 'The source file could not be attached.', 'error');
                return false;
            }
            // The shared attachment path: uploads, writes the document metadata
            // WITH its target pointer, unions it onto the record's
            // attached_documents, and writes the document.attached audit log.
            await api.attachToExistingRecord({
                ds: ctx.ds,
                userId: user.uid,
                file: fitted.file,
                role: modeCfg().documentRole,
                sourceContext: modeCfg().sourceContext,
                targetCollection,
                targetId: match.existing_id,
                Timestamp: ctx.ds.Timestamp,
                // A record flagged "Missing Receipt" is complete once its
                // receipt arrives — which is exactly what just happened.
                clearMissingReceiptStatus: targetCollection === 'transactions',
                currentStatus: match.existing?.status || null
            });
            window.showToast?.('Document attached to the record you already had.', 'success');
            return true;
        } catch (err) {
            console.error('[document-capture] attach-to-existing failed:', err);
            window.showToast?.('The document could not be attached to the existing record.', 'error');
            return false;
        }
    }

    async function saveScannedDocument() {
        if (state.saving) return;
        const cfg = modeCfg();
        const ctx = getContext();
        // Never reject a reviewed extraction because auth had not rehydrated yet.
        if (typeof ctx?.auth?.authStateReady === 'function') await ctx.auth.authStateReady();
        const user = ctx?.auth?.currentUser;
        if (!user || !ctx?.ds || typeof ctx.ds[cfg.saveMethod] !== 'function') {
            window.showToast?.('You need to be signed in to save this.', 'error');
            return;
        }
        const form = $('scan-review-form');
        if (!form) return;
        const fd = new FormData(form);

        const vendor_name = String(fd.get('vendor_name') || '').trim();
        const currency = state.currency;
        // Minor units of the document's OWN currency (rupiah / cents).
        const amountMinor = amountToMinor(fd.get('amount'), currency);
        const category = ALLOWED_CATEGORIES.includes(fd.get('category')) ? fd.get('category') : 'Operations';
        if (!vendor_name || amountMinor <= 0) {
            window.showToast?.('Please enter vendor and amount before saving.', 'error');
            return;
        }

        // Bills carry their own currency and stay outside the Rupiah kernel until
        // they are paid (same rule as the Add Bill drawer). Everything else posts
        // straight to the IDR ledger, so it must be converted now.
        const fxRate = Number(state.fx.rate) || null;
        const needsConversion = window.FluxyMoney.isForeignCurrency(currency) && state.mode !== 'bill';
        if (needsConversion && !(fxRate > 0)) {
            window.showToast?.('Enter an exchange rate so this can be saved in Rupiah.', 'error');
            return;
        }
        const amount = needsConversion
            ? Math.round(minorToMajor(amountMinor, currency) * fxRate)
            : amountMinor;

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

        // A converted record stores Rupiah, so the original figure would otherwise
        // be lost. `notes` is the only field transactions/subscriptions accept for
        // it, and it keeps the document auditable next to its attachment.
        if (needsConversion) {
            payload.notes = `Original ${formatMoneyDisplay(amountMinor, currency)} converted at 1 ${currency} = ${formatMoneyDisplay(fxRate, 'IDR')}${state.fx.rateDate ? ` (${state.fx.rateDate})` : ''}.`;
        }

        if (state.mode === 'bill') {
            if (primaryDate) payload.due_date = primaryDate;
            if (invoiceDate) payload.invoice_date = invoiceDate;
            payload.payment_status = 'unpaid';
            // Face currency of the bill; USD/SGD amounts are already minor units.
            payload.currency = currency;
        } else if (state.mode === 'subscription') {
            if (primaryDate) payload.renewal_date = primaryDate;
            if (invoiceDate) payload.invoice_date = invoiceDate;
            payload.billing_cycle = extraction.billing_cycle || 'monthly';
        } else {
            if (primaryDate) payload.timestamp = primaryDate;
            if (invoiceDate) payload.invoice_date = invoiceDate;
            // Cash impact is a function of the type; the account is the only part
            // the user picks in the review step.
            if (window.FluxyCashImpact) {
                Object.assign(payload, window.FluxyCashImpact.deriveFromType(type, {
                    accountId: window.FluxyCashImpact.accountIdFrom($('scan-cash-control')),
                    timestamp: primaryDate ? ctx.ds.Timestamp.fromDate(primaryDate) : null
                }));
            }
            // Pin to the user-selected budget allocation (expense-like types only).
            if (window.FluxyBudgetPicker && window.FluxyBudgetPicker.isExpenseLike(type)
                && state.allocationContext?.budget) {
                Object.assign(payload, window.FluxyBudgetPicker.buildAssignmentFields({
                    budget: state.allocationContext.budget,
                    allocationId: String(fd.get('budget_allocation') || '')
                }));
            }
        }

        // Smart account (Phase 3b): stamp the account the user confirmed in the
        // review picker (pre-filled from vendor memory / keyword rules / category)
        // so the record posts to the right account. Falls back to a fresh resolve
        // if the picker didn't mount, then to the engine's category resolution.
        try {
            if (type !== 'transfer' && type !== 'adjustment') {
                let code = state.accountPicker?.getValue?.() || '';
                let name = code ? (state.accountPicker?.getAccount?.()?.name || null) : null;
                if (!code) {
                    const sug = await ctx.ds.suggestAccountForEntry(user.uid, { type, category, vendor_name });
                    if (sug && sug.code) { code = sug.code; name = sug.name || null; }
                }
                if (code) { payload.account_code = code; if (name) payload.account_name = name; }
            }
        } catch (_) { /* fall back to the engine's category-driven resolution */ }

        // Duplicate check (docs/DUPLICATE_PREVENTION.md). Runs before the source
        // file is uploaded below, so cancelling costs the user no storage quota.
        // `allowAttach` offers the outcome that only exists on this path: keep
        // the record you already have, and give it the document you just scanned.
        if (window.FluxyDuplicateGuard) {
            const saveBtnEl = $('scan-save-btn');
            if (saveBtnEl) saveBtnEl.textContent = 'Checking for duplicates…';
            const verdict = await window.FluxyDuplicateGuard.check({
                ds: ctx.ds,
                userId: user.uid,
                kind: DUPLICATE_KIND[state.mode] || 'transactions',
                payload,
                source: 'scan',
                allowAttach: !!file
            });
            if (saveBtnEl) saveBtnEl.textContent = 'Save';
            if (verdict.decision === 'attached') {
                const ok = await attachScanToExisting(ctx, user, verdict.match, file);
                if (ok) {
                    window.FluxyDataSync?.emit({ kind: state.mode, action: 'update', id: verdict.match.existing_id });
                    closeDrawer();
                }
                return;
            }
            if (!verdict.proceed) return;
        }

        state.saving = true;
        const saveBtn = $('scan-save-btn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving…';
        }

        // Keep the scanned file as the record's source document. It is uploaded
        // BEFORE the create so the attachment rides along in the same write (the
        // pattern the Add Transaction drawer already uses) — a second write on a
        // fresh record would otherwise trip the update validators. An attachment
        // failure must never cost the user their reviewed extraction, so every
        // problem here degrades to a warning and the record still saves.
        let attachment = null;
        let attachWarning = null;
        if (file) {
            if (saveBtn) saveBtn.textContent = 'Attaching document…';
            try {
                const api = await loadAttachmentApi();
                const fitted = await api.fitFileForUpload(file);
                if (!fitted.file) {
                    attachWarning = fitted.reason === 'too_large'
                        ? 'Saved. The source file is over 5 MB, so it was not attached.'
                        : 'Saved, but the source file could not be attached.';
                } else {
                    const prepared = await api.prepareAttachmentForNewRecord({
                        ds: ctx.ds,
                        userId: user.uid,
                        file: fitted.file,
                        role: cfg.documentRole,
                        sourceContext: cfg.sourceContext,
                        Timestamp: ctx.ds.Timestamp
                    });
                    attachment = prepared;
                    payload.attached_documents = [prepared.attachmentForArray];
                    if (state.mode === 'bill') payload.invoice_status = 'attached';
                }
            } catch (err) {
                console.error('[document-capture] attach failed:', err);
                const code = String(err?.code || '');
                attachWarning = code.includes('limit')
                    ? (err.message || 'Saved, but your plan limit stopped the document from being attached.')
                    : 'Saved, but the source file could not be attached.';
                if (code.includes('storage_limit')) {
                    window.FluxyAccessGuard?.showSubscriptionLimitModal?.({
                        title: code === 'trial_storage_limit_reached' ? 'Trial storage limit reached' : 'Storage limit reached',
                        body: err?.message || 'Choose a plan to keep your source documents.',
                        confirmLabel: code === 'trial_storage_limit_reached' ? 'Activate subscription' : 'Upgrade plan'
                    });
                }
            }
            if (saveBtn) saveBtn.textContent = 'Saving…';
        }

        try {
            const savedRef = await ctx.ds[cfg.saveMethod](user.uid, payload);
            if (attachment?.documentId && savedRef?.id) {
                // Back-link the document to the record it created.
                try {
                    await ctx.ds.linkDocumentTarget(user.uid, attachment.documentId, cfg.targetCollection, savedRef.id);
                } catch (_) { /* the record already carries the attachment */ }
            }
            const savedDayKey = (state.mode === 'transaction' && primaryDate)
                ? primaryDate.toISOString().slice(0, 10)
                : null;
            const range = (typeof ctx.getRange === 'function') ? ctx.getRange() : null;
            const outsideRange = !!(savedDayKey && range && (savedDayKey < range.start || savedDayKey > range.end));
            if (attachWarning) {
                window.showToast?.(attachWarning, 'info');
            } else if (outsideRange) {
                window.showToast?.(`Transaction saved on ${savedDayKey}. Switch the date range to view it.`, 'info');
            } else {
                window.showToast?.(cfg.toastSuccess, 'success');
            }
            closeDrawer();
            // Same page-global problem as the Add Transaction drawer: cfg.refreshFn
            // names ONE function that only exists on that record's own page, so a
            // scan saved from anywhere else refreshed nothing. Keep it for the host
            // page, and announce the change so every other surface reloads too.
            const refresh = window[cfg.refreshFn];
            if (typeof refresh === 'function') refresh();
            window.FluxyDataSync?.emit({
                kind: state.mode === 'bill' ? 'bill' : (state.mode === 'subscription' ? 'subscription' : 'transaction'),
                action: 'create', source: 'scan'
            });
        } catch (err) {
            const msg = err?.message || '';
            console.error('[document-capture] save failed:', msg || err);
            // Surface the kernel's actionable reason instead of a generic retry
            // prompt: a closed accounting period, a permission failure, or an
            // expired session can never be fixed by "try again". The scanned date
            // is editable, so the closed-period message tells the user exactly what
            // to change (move the date to an open period, or reopen the period).
            // GL_020/GL_021 are the stable signal; the message regex stays for one
            // release as a fallback for any path not yet emitting a code. Matching
            // on English was the only thing keeping this branch alive, which meant
            // translating the message would have silently downgraded it to the
            // generic retry prompt.
            let toast = 'Could not save. Please try again.';
            if (err?.code === 'GL_020' || err?.code === 'GL_021'
                || /closed accounting period|closed or locked period/i.test(msg)) toast = msg;
            else if (/permission-denied/i.test(msg) || err?.code === 'permission-denied') toast = 'Permission denied — check your access, then try again.';
            else if (/session expired/i.test(msg)) toast = 'Session expired. Please log in again.';
            window.showToast?.(toast, 'error');
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
