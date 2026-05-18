(function () {
    'use strict';

    const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    const ALLOWED_EXT_LABEL = 'JPG, PNG, WebP, or PDF';
    const MAX_FILE_BYTES = 5 * 1024 * 1024;
    const ALLOWED_CATEGORIES = ['Revenue', 'Marketing', 'Infrastructure', 'Operations', 'SaaS'];
    const EXTRACT_ENDPOINT = '/api/v1/bills/extract';

    const state = {
        step: 'upload',
        file: null,
        previewUrl: null,
        extraction: null,
        extractionSource: null,
        saving: false,
    };

    function $(id) { return document.getElementById(id); }

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

    function formatIDRDisplay(amount) {
        const n = typeof amount === 'number' && !Number.isNaN(amount) ? amount : 0;
        return 'Rp ' + Math.abs(n).toLocaleString('id-ID');
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

    function setStep(nextStep) {
        state.step = nextStep;
        const content = $('bill-scan-drawer-content');
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
    }

    function openDrawer() {
        const isOnline = navigator.onLine !== false;
        setStep(isOnline ? 'upload' : 'offline');
        $('bill-scan-drawer-backdrop').classList.remove('hidden');
        requestAnimationFrame(() => {
            $('bill-scan-drawer').classList.remove('translate-x-full');
        });
    }

    function closeDrawer() {
        $('bill-scan-drawer').classList.add('translate-x-full');
        $('bill-scan-drawer-backdrop').classList.add('hidden');
        clearFile();
        state.saving = false;
        setTimeout(() => {
            const content = $('bill-scan-drawer-content');
            if (content) content.innerHTML = '';
            const footer = $('bill-scan-drawer-footer');
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
        const content = $('bill-scan-drawer-content');
        const footer = $('bill-scan-drawer-footer');
        const file = state.file;

        if (!file) {
            content.innerHTML = `
                <div class="space-y-4">
                    <label id="bill-scan-dropzone" for="bill-scan-file-input"
                           class="block border-2 border-dashed border-gray-300 hover:border-[#EA580C] rounded-xl px-6 py-10 text-center cursor-pointer transition-colors bg-gray-50/50">
                        <div class="flex justify-center mb-3">
                            <div class="w-12 h-12 rounded-full bg-orange-50 flex items-center justify-center">
                                <svg class="w-6 h-6 text-[#EA580C]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M12 12V4m0 0-4 4m4-4 4 4"></path></svg>
                            </div>
                        </div>
                        <p class="text-[13px] font-semibold text-gray-900">Drag and drop your bill here</p>
                        <p class="text-[12px] text-gray-500 mt-1">or click to browse</p>
                        <p class="text-[11px] text-gray-400 mt-3">${ALLOWED_EXT_LABEL} · max ${formatBytes(MAX_FILE_BYTES)}</p>
                    </label>
                    <input id="bill-scan-file-input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" class="hidden">
                    <p class="text-[11px] text-gray-400 text-center">Prefer to enter manually? <button id="bill-scan-manual-link" type="button" class="text-[#EA580C] font-semibold hover:underline">Use Add New Bill</button></p>
                </div>
            `;
            footer.innerHTML = `
                <button id="bill-scan-cancel-btn" type="button" class="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-[13px] font-medium hover:bg-gray-200 transition-colors">Cancel</button>
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
                   <img src="${state.previewUrl}" alt="Bill preview" class="w-full max-h-72 object-contain bg-white">
                   <div class="px-4 py-3 border-t border-gray-200 flex items-center justify-between gap-3">
                       <p class="text-[12px] text-gray-700 font-medium truncate">${escapeHtml(file.name)}</p>
                       <p class="text-[11px] text-gray-400 flex-shrink-0">${formatBytes(file.size)}</p>
                   </div>
               </div>`;

        content.innerHTML = `
            <div class="space-y-4">
                ${previewHtml}
                <button id="bill-scan-replace-btn" type="button" class="text-[12px] font-semibold text-gray-600 hover:text-gray-900">Replace file</button>
                <input id="bill-scan-file-input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" class="hidden">
            </div>
        `;
        footer.innerHTML = `
            <button id="bill-scan-cancel-btn" type="button" class="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-[13px] font-medium hover:bg-gray-200 transition-colors">Cancel</button>
            <button id="bill-scan-start-btn" type="button" class="flex-1 px-4 py-2.5 bg-[#EA580C] text-white rounded-lg text-[13px] font-bold hover:bg-[#D94E0B] transition-colors flex items-center justify-center gap-2 active:scale-95">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                Scan Bill
            </button>
        `;
        wireUploadHandlers();
    }

    function renderScanningStep() {
        const content = $('bill-scan-drawer-content');
        const footer = $('bill-scan-drawer-footer');
        content.innerHTML = `
            <div class="space-y-4">
                <div class="bg-gray-50 border border-gray-200 rounded-xl px-6 py-8 text-center">
                    <div class="flex justify-center mb-4">
                        <div class="w-12 h-12 rounded-full bg-orange-50 flex items-center justify-center">
                            <svg class="w-6 h-6 text-[#EA580C] animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636-.707.707M21 12h-1M4 12H3m3.343-5.657-.707-.707m12.728 0-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z"></path></svg>
                        </div>
                    </div>
                    <p class="text-[13px] font-semibold text-gray-900">Reading document and extracting bill details...</p>
                    <p class="text-[12px] text-gray-500 mt-1">This usually takes a few seconds.</p>
                </div>
                <div class="space-y-2">
                    ${Array(4).fill().map(() => `
                        <div class="h-9 bg-gray-100 rounded-lg animate-pulse"></div>
                    `).join('')}
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
        const content = $('bill-scan-drawer-content');
        const footer = $('bill-scan-drawer-footer');
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
                <p class="mt-0.5">Bill scanning provider is not configured. The fields below are placeholder values — please replace them before saving.</p>
            </div>
        ` : '';

        const warningsBlock = warnings.length ? `
            <div class="bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 text-[12px] text-orange-800 space-y-1">
                ${warnings.map(w => `<p>• ${escapeHtml(w)}</p>`).join('')}
            </div>
        ` : '';

        content.innerHTML = `
            <form id="bill-scan-review-form" class="space-y-4">
                ${mockBanner}
                ${warningsBlock}

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

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Due Date ${confidenceMark(conf.due_date)}</label>
                        <input type="date" name="due_date" value="${escapeHtml(data.due_date || '')}"
                               class="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#EA580C] focus:border-[#EA580C]">
                    </div>
                    <div>
                        <label class="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Invoice Date</label>
                        <input type="date" name="invoice_date" value="${escapeHtml(data.invoice_date || '')}"
                               class="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#EA580C] focus:border-[#EA580C]">
                    </div>
                </div>

                <div>
                    <label class="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Invoice Number</label>
                    <input type="text" name="invoice_number" value="${escapeHtml(data.invoice_number || '')}" placeholder="INV-2026-001"
                           class="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#EA580C] focus:border-[#EA580C]">
                </div>

                <div class="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[11px] text-gray-500 leading-relaxed">
                    <p><span class="font-semibold text-gray-700">AI suggests. You confirm. FluxyOS saves.</span></p>
                    <p class="mt-0.5">This bill will be saved as a <span class="font-mono">pending_payable</span>. No ledger transaction will be created.</p>
                </div>
            </form>
        `;
        footer.innerHTML = `
            <button id="bill-scan-rescan-btn" type="button" class="px-4 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-[13px] font-medium hover:bg-gray-50 transition-colors">Rescan</button>
            <button id="bill-scan-save-btn" type="button" class="flex-1 px-4 py-2.5 bg-[#EA580C] text-white rounded-lg text-[13px] font-bold hover:bg-[#D94E0B] transition-colors active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed">Save Bill</button>
        `;
        wireReviewHandlers();
        updateSaveEnabled();
    }

    function renderErrorStep(message) {
        const content = $('bill-scan-drawer-content');
        const footer = $('bill-scan-drawer-footer');
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
            <button id="bill-scan-manual-link" type="button" class="px-4 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-[13px] font-medium hover:bg-gray-50 transition-colors">Add manually</button>
            <button id="bill-scan-retry-btn" type="button" class="flex-1 px-4 py-2.5 bg-[#EA580C] text-white rounded-lg text-[13px] font-bold hover:bg-[#D94E0B] transition-colors active:scale-95">Try again</button>
        `;
        $('bill-scan-retry-btn')?.addEventListener('click', () => {
            state.errorMessage = null;
            setStep(state.file ? 'upload' : 'upload');
        });
        $('bill-scan-manual-link')?.addEventListener('click', openManualEntry);
    }

    function renderOfflineStep() {
        const content = $('bill-scan-drawer-content');
        const footer = $('bill-scan-drawer-footer');
        content.innerHTML = `
            <div class="bg-gray-50 border border-gray-200 rounded-xl px-5 py-6 text-center">
                <div class="flex justify-center mb-3">
                    <div class="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                        <svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636 5.636 18.364m0-12.728L18.364 18.364M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z"></path></svg>
                    </div>
                </div>
                <p class="text-[13px] font-semibold text-gray-900">You're offline</p>
                <p class="text-[12px] text-gray-600 mt-1">Scanning needs an internet connection. You can still add this bill manually.</p>
            </div>
        `;
        footer.innerHTML = `
            <button id="bill-scan-cancel-btn" type="button" class="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-[13px] font-medium hover:bg-gray-200 transition-colors">Close</button>
            <button id="bill-scan-manual-link" type="button" class="flex-1 px-4 py-2.5 bg-[#EA580C] text-white rounded-lg text-[13px] font-bold hover:bg-[#D94E0B] transition-colors active:scale-95">Add manually</button>
        `;
        $('bill-scan-cancel-btn')?.addEventListener('click', closeDrawer);
        $('bill-scan-manual-link')?.addEventListener('click', openManualEntry);
    }

    // ── Event handlers ───────────────────────────────────────────────────

    function wireUploadHandlers() {
        const dropzone = $('bill-scan-dropzone');
        const fileInput = $('bill-scan-file-input');
        const cancelBtn = $('bill-scan-cancel-btn');
        const startBtn = $('bill-scan-start-btn');
        const replaceBtn = $('bill-scan-replace-btn');
        const manualLink = $('bill-scan-manual-link');

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
        const form = $('bill-scan-review-form');
        form?.addEventListener('input', updateSaveEnabled);
        form?.addEventListener('change', updateSaveEnabled);
        $('bill-scan-save-btn')?.addEventListener('click', saveScannedBill);
        $('bill-scan-rescan-btn')?.addEventListener('click', () => {
            state.extraction = null;
            state.extractionSource = null;
            setStep('upload');
        });
    }

    function updateSaveEnabled() {
        const form = $('bill-scan-review-form');
        const saveBtn = $('bill-scan-save-btn');
        if (!form || !saveBtn) return;
        const fd = new FormData(form);
        const vendor = String(fd.get('vendor_name') || '').trim();
        const amount = normalizeRupiahAmount(fd.get('amount'));
        saveBtn.disabled = !(vendor && amount > 0) || state.saving;
    }

    function openManualEntry() {
        if (typeof window.showAddTransactionModal === 'function') {
            closeDrawer();
            window.showAddTransactionModal({
                title: 'Add New Bill',
                submitLabel: 'Save Bill',
                defaultCategory: 'Operations',
                context: 'bill'
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
            console.error('[bill-capture] scan failed:', err?.message || err);
            state.errorMessage = friendlyError(err);
            setStep('error');
        }
    }

    function friendlyError(err) {
        const msg = String(err?.message || '');
        if (msg.includes('UNREADABLE_DOCUMENT')) {
            return "We couldn't read this bill clearly. Try a sharper image or enter the details manually.";
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
        return 'Could not scan this bill right now. Please try again or enter the details manually.';
    }

    async function callExtractEndpoint(payload) {
        const ctx = window.__fluxyBillsContext;
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
            invoice_date: typeof data.invoice_date === 'string' ? data.invoice_date : '',
            invoice_number: typeof data.invoice_number === 'string' ? data.invoice_number : '',
            document_type: typeof data.document_type === 'string' ? data.document_type : 'unknown',
            confidence: data.confidence || {},
            warnings: Array.isArray(data.warnings) ? data.warnings : [],
            raw_text_preview: typeof data.raw_text_preview === 'string' ? data.raw_text_preview.slice(0, 500) : null,
        };
    }

    async function saveScannedBill() {
        if (state.saving) return;
        const ctx = window.__fluxyBillsContext;
        const user = ctx?.auth?.currentUser;
        if (!user || !ctx?.ds) {
            window.showToast?.('You need to be signed in to save this bill.', 'error');
            return;
        }
        const form = $('bill-scan-review-form');
        if (!form) return;
        const fd = new FormData(form);

        const vendor_name = String(fd.get('vendor_name') || '').trim();
        const amount = normalizeRupiahAmount(fd.get('amount'));
        const category = ALLOWED_CATEGORIES.includes(fd.get('category')) ? fd.get('category') : 'Operations';
        if (!vendor_name || amount <= 0) {
            window.showToast?.('Please enter vendor and amount before saving.', 'error');
            return;
        }

        const dueDate = parseDateInput(fd.get('due_date'));
        const invoiceDate = parseDateInput(fd.get('invoice_date'));
        const invoiceNumber = String(fd.get('invoice_number') || '').trim();
        const extraction = state.extraction || {};
        const file = state.file;

        const payload = {
            vendor_name,
            category,
            amount,
            type: 'pending_payable',
            status: 'Missing Receipt',
            icon: '💸',
            source: 'bill_scan',
            created_via: 'ai_bill_capture',
            payment_status: 'unpaid',
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
        if (dueDate) payload.due_date = dueDate;
        if (invoiceDate) payload.invoice_date = invoiceDate;

        state.saving = true;
        const saveBtn = $('bill-scan-save-btn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving…';
        }

        try {
            await ctx.ds.addBill(user.uid, payload);
            window.showToast?.('Bill scanned and added to your schedule.', 'success');
            closeDrawer();
            if (typeof window.loadBills === 'function') window.loadBills();
        } catch (err) {
            console.error('[bill-capture] save failed:', err?.message || err);
            window.showToast?.('Could not save bill. Please try again.', 'error');
            state.saving = false;
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Bill';
            }
            updateSaveEnabled();
        }
    }

    // ── Public + boot ────────────────────────────────────────────────────

    function init() {
        $('scan-bill-btn')?.addEventListener('click', openDrawer);
        $('bill-scan-drawer-close-btn')?.addEventListener('click', closeDrawer);
        $('bill-scan-drawer-backdrop')?.addEventListener('click', closeDrawer);
        window.addEventListener('online', () => {
            if (state.step === 'offline') setStep(state.file ? 'upload' : 'upload');
        });
        window.addEventListener('offline', () => {
            if (state.step === 'upload' || state.step === 'review') setStep('offline');
        });
    }

    window.openScanBillDrawer = openDrawer;
    window.closeScanBillDrawer = closeDrawer;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
