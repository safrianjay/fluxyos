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

function loadFluxyDocumentAttachment() {
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

(function installFluxyLinkedTargetHighlight() {
    if (window.highlightFluxyLinkedTarget) return;

    if (!document.getElementById('fluxy-linked-target-highlight-style')) {
        const style = document.createElement('style');
        style.id = 'fluxy-linked-target-highlight-style';
        style.textContent = `
            @keyframes fluxy-linked-target-glimpse {
                0% { box-shadow: inset 3px 0 0 #EA580C, 0 0 0 0 rgba(234, 88, 12, 0.28); }
                42% { box-shadow: inset 3px 0 0 #EA580C, 0 0 0 6px rgba(234, 88, 12, 0.14); }
                100% { box-shadow: inset 3px 0 0 #EA580C, 0 0 0 0 rgba(234, 88, 12, 0); }
            }

            .fluxy-linked-target-glimpse {
                animation: fluxy-linked-target-glimpse 1.15s ease-out 2;
                background-color: #F9FAFB !important;
                position: relative;
                z-index: 1;
            }
        `;
        document.head.appendChild(style);
    }

    window.highlightFluxyLinkedTarget = function(target, options = {}) {
        const elements = typeof target === 'string'
            ? Array.from(document.querySelectorAll(target))
            : target instanceof Element
                ? [target]
                : Array.from(target || []).filter(item => item instanceof Element);

        if (!elements.length) return false;
        const { scroll = true, focus = null } = options;
        if (scroll) {
            elements[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        if (focus instanceof HTMLElement) {
            try {
                focus.focus({ preventScroll: true });
            } catch {
                focus.focus();
            }
        }
        elements.slice(0, 12).forEach(element => {
            element.classList.remove('fluxy-linked-target-glimpse');
            void element.offsetWidth;
            element.classList.add('fluxy-linked-target-glimpse');
            window.setTimeout(() => {
                element.classList.remove('fluxy-linked-target-glimpse');
            }, 2800);
        });
        return true;
    };
})();

// ---------- Dialog (canonical popup component) ----------
// Single branded popup used everywhere in FluxyOS — replaces native
// window.confirm() and window.alert(). Two thin wrappers:
//   • window.showConfirmDialog(opts) → Promise<boolean>  (Cancel / Confirm)
//   • window.showAlertDialog(opts)   → Promise<void>      (single OK)
// Opts: { title, body, confirmLabel, cancelLabel, tone }
// tone: 'default' | 'danger'
// body accepts inline HTML (caller is responsible for escaping user input).
// Lucide-style 24x24 stroke icons. Keep them minimal and consistent.
const FLUXY_DIALOG_ICONS = {
    pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    info:   '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    alert:  '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    warn:   '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    trash:  '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    check:  '<path d="M20 6 9 17l-5-5"/>',
    building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>'
};

window.showFluxyDialog = function(options = {}) {
    const {
        title = '',
        body = '',
        confirmLabel = 'Continue',
        cancelLabel = 'Cancel',
        tone = 'default',
        icon,                   // 'pencil' | 'info' | 'alert' | 'warn' | 'trash' | 'check' | 'building' | 'none' | custom SVG string
        singleOk = false
    } = options;

    return new Promise((resolve) => {
        document.getElementById('fluxy-dialog')?.remove();
        const isDanger = tone === 'danger';

        // Pick the icon: explicit option wins, else sensible default per tone.
        const iconKey = icon ?? (isDanger ? 'warn' : 'info');
        const iconInner = iconKey === 'none'
            ? null
            : (FLUXY_DIALOG_ICONS[iconKey] || iconKey); // raw SVG path string also accepted

        const iconBlock = iconInner
            ? `<div class="fluxy-dialog-icon ${isDanger ? 'is-danger' : ''}" aria-hidden="true">
                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${iconInner}</svg>
               </div>`
            : '';

        const cancelBtn = singleOk
            ? ''
            : `<button type="button" class="fluxy-dialog-btn fluxy-dialog-btn--ghost" data-dialog-action="cancel">${cancelLabel}</button>`;

        const wrap = document.createElement('div');
        wrap.id = 'fluxy-dialog';
        wrap.className = 'fluxy-dialog';
        wrap.innerHTML = `
            <div class="fluxy-dialog-overlay" data-dialog-action="cancel"></div>
            <div class="fluxy-dialog-card" role="dialog" aria-modal="true" aria-labelledby="fluxy-dialog-title"${body ? ' aria-describedby="fluxy-dialog-body"' : ''}>
                ${iconBlock}
                <h3 id="fluxy-dialog-title" class="fluxy-dialog-title">${title}</h3>
                ${body ? `<div id="fluxy-dialog-body" class="fluxy-dialog-body">${body}</div>` : ''}
                <div class="fluxy-dialog-actions">
                    ${cancelBtn}
                    <button type="button" class="fluxy-dialog-btn fluxy-dialog-btn--primary ${isDanger ? 'is-danger' : ''}" data-dialog-action="confirm">${confirmLabel}</button>
                </div>
            </div>
        `;
        document.body.appendChild(wrap);

        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const close = (result) => {
            document.removeEventListener('keydown', onKey);
            wrap.classList.add('is-closing');
            window.setTimeout(() => {
                wrap.remove();
                document.body.style.overflow = prevOverflow;
                resolve(singleOk ? undefined : result);
            }, 140);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') close(false);
            else if (e.key === 'Enter') close(true);
        };

        wrap.addEventListener('click', (e) => {
            const action = e.target?.closest('[data-dialog-action]')?.dataset?.dialogAction;
            if (action === 'confirm') close(true);
            else if (action === 'cancel') close(false);
        });
        document.addEventListener('keydown', onKey);
        window.setTimeout(() => {
            wrap.querySelector('[data-dialog-action="confirm"]')?.focus();
        }, 50);
    });
};

window.showConfirmDialog = (options = {}) => window.showFluxyDialog({ ...options, singleOk: false });
window.showAlertDialog   = (options = {}) => window.showFluxyDialog({ confirmLabel: 'OK', ...options, singleOk: true });

window.showReasonDialog = function(options = {}) {
    const {
        title = 'Confirm action',
        body = '',
        confirmLabel = 'Confirm',
        cancelLabel = 'Cancel',
        tone = 'danger',
        reasonLabel = 'Reason',
        otherLabel = 'Other',
        options: reasonOptions = []
    } = options;

    const choices = reasonOptions.length
        ? reasonOptions
        : ['Duplicate transaction', 'Wrong amount', 'Wrong import', 'Test data', otherLabel];

    return new Promise((resolve) => {
        document.getElementById('fluxy-dialog')?.remove();
        const isDanger = tone === 'danger';
        const wrap = document.createElement('div');
        wrap.id = 'fluxy-dialog';
        wrap.className = 'fluxy-dialog fluxy-dialog--reason';
        wrap.innerHTML = `
            <div class="fluxy-dialog-overlay" data-dialog-action="cancel"></div>
            <div class="fluxy-dialog-card fluxy-dialog-card--reason" role="dialog" aria-modal="true" aria-labelledby="fluxy-dialog-title" aria-describedby="fluxy-dialog-body">
                <div class="fluxy-dialog-icon ${isDanger ? 'is-danger' : ''}" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${FLUXY_DIALOG_ICONS.warn}</svg>
                </div>
                <h3 id="fluxy-dialog-title" class="fluxy-dialog-title">${title}</h3>
                ${body ? `<div id="fluxy-dialog-body" class="fluxy-dialog-body">${body}</div>` : ''}
                <div class="fluxy-dialog-field">
                    <label for="fluxy-dialog-reason-select" class="fluxy-dialog-label">${reasonLabel}</label>
                    <select id="fluxy-dialog-reason-select" class="fluxy-dialog-select">
                        <option value="">Choose a reason</option>
                        ${choices.map(choice => `<option value="${String(choice).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}">${String(choice).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</option>`).join('')}
                    </select>
                    <textarea id="fluxy-dialog-reason-other" class="fluxy-dialog-textarea hidden" maxlength="500" placeholder="Write the reason"></textarea>
                    <p id="fluxy-dialog-reason-error" class="fluxy-dialog-error hidden">Choose or write a reason before continuing.</p>
                </div>
                <div class="fluxy-dialog-actions fluxy-dialog-actions--reason">
                    <button type="button" class="fluxy-dialog-btn fluxy-dialog-btn--ghost" data-dialog-action="cancel">${cancelLabel}</button>
                    <button type="button" class="fluxy-dialog-btn fluxy-dialog-btn--primary ${isDanger ? 'is-danger' : ''}" data-dialog-action="confirm">${confirmLabel}</button>
                </div>
            </div>
        `;
        document.body.appendChild(wrap);

        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const select = wrap.querySelector('#fluxy-dialog-reason-select');
        const other = wrap.querySelector('#fluxy-dialog-reason-other');
        const error = wrap.querySelector('#fluxy-dialog-reason-error');

        const close = (result) => {
            document.removeEventListener('keydown', onKey);
            wrap.classList.add('is-closing');
            window.setTimeout(() => {
                wrap.remove();
                document.body.style.overflow = prevOverflow;
                resolve(result);
            }, 140);
        };
        const getReason = () => {
            const selected = String(select?.value || '').trim();
            if (selected === otherLabel) return String(other?.value || '').trim();
            return selected;
        };
        const confirm = () => {
            const reason = getReason();
            if (!reason) {
                error?.classList.remove('hidden');
                (select?.value === otherLabel ? other : select)?.focus();
                return;
            }
            close(reason);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') close(null);
            else if (e.key === 'Enter' && !e.shiftKey && document.activeElement !== other) {
                e.preventDefault();
                confirm();
            }
        };

        select?.addEventListener('change', () => {
            const isOther = select.value === otherLabel;
            other?.classList.toggle('hidden', !isOther);
            error?.classList.add('hidden');
            if (isOther) window.setTimeout(() => other?.focus(), 20);
        });
        other?.addEventListener('input', () => error?.classList.add('hidden'));
        wrap.addEventListener('click', (e) => {
            const action = e.target?.closest('[data-dialog-action]')?.dataset?.dialogAction;
            if (action === 'confirm') confirm();
            else if (action === 'cancel') close(null);
        });
        document.addEventListener('keydown', onKey);
        window.setTimeout(() => select?.focus(), 50);
    });
};

window.showAddTransactionModal = function(options = {}) {
    // Trial/payment access guard: block record creation once the trial has expired
    // or while payment is pending verification. Fails open if state isn't loaded.
    if (window.FluxyAccessGuard && !window.FluxyAccessGuard.requireWriteAccess()) {
        return;
    }
    const {
        title = "Add Transaction",
        submitLabel = "Add Transaction",
        defaultType = 'expense',
        defaultCategory = 'Operations',
        context = 'transaction', // 'transaction', 'bill', 'subscription'
        openBulk = false,
        csvFile = null
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
                                    <option value="Others">Others</option>
                                    `}
                                </select>
                                ${context === 'bill' ? '' : `<input id="tx-type-custom" type="text" maxlength="20" placeholder="Type custom (max 20 chars)" class="hidden mt-2 w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#E85D19] text-[13px]" />`}
                            </div>
                        </div>
                        ${context === 'bill' ? `<div id="tx-budget-preview" class="hidden rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[12px] text-gray-600"></div>` : ''}
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
                        ${context !== 'bill' ? `<div id="tx-receipt-section" data-fluxy-doc-mount></div>` : ''}
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
                        <div id="tx-csv-preview-card" class="hidden rounded-xl border border-gray-200 bg-white p-4">
                            <div class="flex items-start justify-between gap-3">
                                <div class="min-w-0">
                                    <p class="text-[12px] font-bold uppercase tracking-wider text-gray-400">CSV import preview</p>
                                    <p id="tx-csv-preview-title" class="mt-1 truncate text-[13px] font-bold text-gray-900"></p>
                                    <p id="tx-csv-preview-summary" class="mt-1 text-[12px] text-gray-500"></p>
                                </div>
                                <span id="tx-csv-preview-badge" class="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">Ready</span>
                            </div>
                            <div id="tx-csv-mapping-summary" class="mt-3 flex flex-wrap gap-2"></div>
                            <div class="mt-3 overflow-x-auto rounded-lg border border-gray-200">
                                <table class="w-full min-w-[560px] text-left">
                                    <thead class="bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                                        <tr>
                                            <th class="px-3 py-2">Description</th>
                                            <th class="px-3 py-2">Category</th>
                                            <th class="px-3 py-2">Type</th>
                                            <th class="px-3 py-2">Amount</th>
                                            <th class="px-3 py-2">Status</th>
                                            <th class="px-3 py-2">Date</th>
                                        </tr>
                                    </thead>
                                    <tbody id="tx-csv-preview-body" class="divide-y divide-gray-100 text-[12px]"></tbody>
                                </table>
                            </div>
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
    let csvImportState = {
        file: null,
        csvText: '',
        parsed: null,
        status: 'idle'
    };
    const getSelectedCsvFile = () => document.getElementById('tx-csv-file')?.files?.[0] || csvImportState.file || null;

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
                    if (context === 'bill' && typeof renderBillBudgetPreview === 'function') renderBillBudgetPreview();
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
            authDomain: "fluxyos.com",
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
        // For today's entries, preserve the actual moment so the ledger shows
        // a real time of day instead of a noon placeholder. Backdated entries
        // stay at noon (parseLocalDateKey) to dodge timezone day-flips.
        if (dateKey === todayKey) return Timestamp.fromDate(new Date());
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

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[char]));
    }

    function parseCsvAmount(value) {
        const cleaned = String(value || '').replace(/rp/gi, '').replace(/\s/g, '');
        const withoutGrouping = cleaned.includes(',') && cleaned.includes('.')
            ? cleaned.replace(/\./g, '').replace(',', '.')
            : cleaned.replace(/[.,](?=\d{3}(?:\D|$))/g, '');
        return parseFloat(withoutGrouping.replace(/[^\d.-]/g, ''));
    }

    function analyzeBulkCsv(csvText, defaultDateKey, overrideStatus = null) {
        const rows = parseCsv(csvText);
        if (rows.length < 2) throw new Error("CSV needs one header row and at least one transaction row.");
        if (rows.length > 501) throw new Error("CSV imports are limited to 500 transactions at a time.");

        const originalHeaders = rows[0];
        const headers = originalHeaders.map(normalizeHeader);
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

        const transactions = rows.slice(1).map((row, index) => {
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
                dateKey,
                line
            };
        });

        return { headers: originalHeaders, indexes, transactions };
    }

    function parseBulkTransactions(csvText, defaultDateKey, Timestamp, overrideStatus = null) {
        const parsed = analyzeBulkCsv(csvText, defaultDateKey, overrideStatus);
        return parsed.transactions.map(row => {
            const { dateKey, line, ...transaction } = row;
            void line;
            return {
                ...transaction,
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

    // "Others" type custom input (transaction context only)
    const typeSelectEl = document.getElementById('tx-type');
    const typeCustomInput = document.getElementById('tx-type-custom');
    if (typeSelectEl && typeCustomInput) {
        typeSelectEl.addEventListener('change', () => {
            const isOthers = typeSelectEl.value === 'Others';
            typeCustomInput.classList.toggle('hidden', !isOthers);
            if (isOthers) typeCustomInput.focus();
            else typeCustomInput.value = '';
        });
    }

    // Budget impact preview (Phase 1.5) — bill drawer only. Prefetches the
    // active budget + allocations, then re-evaluates the match whenever the
    // user changes amount, category, or due date.
    let billBudgetContext = null; // { budget, allocations, match } | null
    if (context === 'bill') {
        const previewEl = document.getElementById('tx-budget-preview');
        if (previewEl) {
            previewEl.classList.remove('hidden');
            previewEl.innerHTML = '<span class="text-gray-400">Loading budget impact…</span>';

            (async () => {
                try {
                    // Firebase Auth may not have rehydrated currentUser yet when
                    // the drawer opens immediately after page load. Wait for
                    // authStateReady() so the prefetch doesn't false-fire
                    // "Session expired" on the first open.
                    const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js");
                    const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
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
                    if (typeof auth.authStateReady === 'function') {
                        await auth.authStateReady();
                    }
                    if (!auth.currentUser) {
                        previewEl.innerHTML = '<span class="text-gray-400">Sign in to see budget impact.</span>';
                        return;
                    }
                    const { ds, user } = await getTransactionDataService();
                    const loadBudgetForDate = async (dateValue) => {
                        const activeBudget = typeof ds.getBudgetForDate === 'function'
                            ? await ds.getBudgetForDate(user.uid, dateValue)
                            : await ds.getActiveBudget(user.uid);
                        if (!activeBudget) return null;
                        return await ds.getBudgetUsage(user.uid, activeBudget.id);
                    };
                    const initialDueDate = parseLocalDateKey(selectedEntryDate) || new Date();
                    const usage = await loadBudgetForDate(initialDueDate);
                    if (!usage?.budget) {
                        billBudgetContext = {
                            budget: null,
                            allocations: [],
                            budgetDateKey: selectedEntryDate || '',
                            loadForDate: loadBudgetForDate,
                            matchWithUsage: (billData, nextUsage) => ds.matchBillToAllocation({
                                billData,
                                activeBudget: nextUsage?.budget,
                                allocations: nextUsage?.allocations || []
                            }),
                            match: () => ({ allocation: null, status: 'no_active_budget', exceedsBy: 0 })
                        };
                        renderBillBudgetPreview();
                        return;
                    }
                    // Single source of truth: every match goes through
                    // DataService.matchBillToAllocation. No inline duplicate.
                    billBudgetContext = {
                        budget: usage.budget,
                        allocations: usage.allocations || [],
                        budgetDateKey: selectedEntryDate || '',
                        loadForDate: loadBudgetForDate,
                        matchWithUsage: (billData, nextUsage) => ds.matchBillToAllocation({
                            billData,
                            activeBudget: nextUsage?.budget,
                            allocations: nextUsage?.allocations || []
                        }),
                        match: (billData) => ds.matchBillToAllocation({
                            billData,
                            activeBudget: usage.budget,
                            allocations: usage.allocations || []
                        })
                    };
                    renderBillBudgetPreview();
                } catch (err) {
                    console.warn('Budget preview load failed:', err);
                    previewEl.innerHTML = '<span class="text-gray-400">Budget impact unavailable.</span>';
                }
            })();

            amountInput.addEventListener('input', renderBillBudgetPreview);
            categorySelect.addEventListener('change', renderBillBudgetPreview);
            if (categoryCustomInput) categoryCustomInput.addEventListener('input', renderBillBudgetPreview);
            // The date picker doesn't expose a DOM event, but selectedEntryDate
            // changes via its onChange callback (line ~518). updateSingleSubmitState
            // is already called from there; piggyback on the same hook below.
        }
    }

    function getCurrentBillCategory() {
        const sel = categorySelect?.value || '';
        if (sel === 'Others') {
            const custom = categoryCustomInput?.value?.trim();
            return custom?.length ? custom : 'Others';
        }
        return sel;
    }

    function renderBillBudgetPreview() {
        if (context !== 'bill') return;
        const previewEl = document.getElementById('tx-budget-preview');
        if (!previewEl) return;
        if (!billBudgetContext) return;

        const dueDate = parseLocalDateKey(selectedEntryDate) || new Date();
        const dateKey = selectedEntryDate || '';
        if (billBudgetContext.loadForDate && billBudgetContext.budgetDateKey !== dateKey && !billBudgetContext.loadingForDate) {
            billBudgetContext.loadingForDate = true;
            billBudgetContext.loadForDate(dueDate)
                .then((usage) => {
                    if (usage?.budget) {
                        billBudgetContext.budget = usage.budget;
                        billBudgetContext.allocations = usage.allocations || [];
                        billBudgetContext.match = (billData) => billBudgetContext.matchWithUsage(billData, usage);
                    } else {
                        billBudgetContext.budget = null;
                        billBudgetContext.allocations = [];
                        billBudgetContext.match = () => ({ allocation: null, status: 'no_active_budget', exceedsBy: 0 });
                    }
                    billBudgetContext.budgetDateKey = dateKey;
                    billBudgetContext.loadingForDate = false;
                    renderBillBudgetPreview();
                })
                .catch(() => {
                    billBudgetContext.loadingForDate = false;
                });
        }

        // No active budget at all
        if (!billBudgetContext.budget) {
            previewEl.className = 'rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[12px] text-gray-600';
            previewEl.innerHTML = `
                <p class="font-bold text-gray-700">Budget impact</p>
                <p class="mt-1">No active budget for this bill period. This bill will be saved without budget impact.</p>
            `;
            return;
        }

        const rawAmount = (amountInput.value || '').replace(/\./g, '');
        const numericAmount = Number(rawAmount) || 0;
        const billCategory = getCurrentBillCategory();
        // Use the in-progress drawer state (date + category + amount). The
        // matchBillToAllocation helper expects Firestore-style Timestamps or
        // Date objects — we pass plain Dates so the helper's `?.toDate?.()`
        // call falls through to the `instanceof Date` branch.
        const billData = {
            amount: numericAmount,
            category: billCategory,
            due_date: dueDate
        };

        const result = billBudgetContext.match(billData);
        billBudgetContext.lastResult = result;

        const fmt = (n) => 'Rp' + Math.abs(Number(n) || 0).toLocaleString('id-ID');
        const label = result.allocation?.name || 'Budget';
        if (result.status === 'out_of_period') {
            previewEl.className = 'rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[12px] text-gray-600';
            previewEl.innerHTML = `
                <p class="font-bold text-gray-700">Budget impact</p>
                <p class="mt-1">Due date is outside the active budget period. This bill will be saved without budget impact.</p>
            `;
            return;
        }
        if (result.status === 'unmatched') {
            previewEl.className = 'rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[12px] text-gray-600';
            previewEl.innerHTML = `
                <p class="font-bold text-gray-700">Budget impact</p>
                <p class="mt-1">No matching budget allocation found. This bill will be saved as unallocated.</p>
            `;
            return;
        }
        if (result.status === 'exceeded') {
            previewEl.className = 'rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700';
            previewEl.innerHTML = `
                <p class="font-bold">Budget warning</p>
                <p class="mt-1">This bill will exceed <strong>${escapeHtml(label)}</strong> by <span class="font-mono font-bold">${fmt(result.exceedsBy)}</span>. You can still save it, but this allocation will be marked Exceeded.</p>
            `;
            return;
        }
        if (result.status === 'needs_review') {
            previewEl.className = 'rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-700';
            previewEl.innerHTML = `
                <p class="font-bold">Budget impact</p>
                <p class="mt-1">Multiple budget allocations may match this bill. Saving as needs review under <strong>${escapeHtml(label)}</strong>.</p>
            `;
            return;
        }
        // matched
        previewEl.className = 'rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12px] text-emerald-700';
        previewEl.innerHTML = `
            <p class="font-bold">Budget impact</p>
            <p class="mt-1">Auto matched to <strong>${escapeHtml(label)}</strong>. This bill will reserve <span class="font-mono font-bold">${fmt(numericAmount)}</span> from ${escapeHtml(label)}.</p>
        `;
    }

    // Shared document attachment — receipt for expense, revenue_proof for income.
    let attachmentController = null;
    const receiptMountEl = document.querySelector('#tx-receipt-section[data-fluxy-doc-mount]');
    if (receiptMountEl) {
        const isRevenueContext = defaultType === 'income' || defaultType === 'revenue' || defaultCategory === 'Revenue';
        const attachmentRole = isRevenueContext ? 'revenue_proof' : 'receipt';
        const attachmentSourceContext = isRevenueContext ? 'revenue' : 'transaction';
        loadFluxyDocumentAttachment()
            .then((api) => {
                if (!document.body.contains(receiptMountEl)) return;
                attachmentController = api.mount({
                    hostEl: receiptMountEl,
                    role: attachmentRole,
                    sourceContext: attachmentSourceContext
                });
            })
            .catch((err) => {
                console.error('FluxyDocumentAttachment load failed:', err);
                receiptMountEl.innerHTML = '<p class="text-[12px] text-red-500">Attachment uploader could not load. The form still saves without an attachment.</p>';
            });
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

        const renderCsvPreview = (file, parsed) => {
            const card = document.getElementById('tx-csv-preview-card');
            const title = document.getElementById('tx-csv-preview-title');
            const summary = document.getElementById('tx-csv-preview-summary');
            const badge = document.getElementById('tx-csv-preview-badge');
            const mapping = document.getElementById('tx-csv-mapping-summary');
            const body = document.getElementById('tx-csv-preview-body');
            if (!card || !title || !summary || !badge || !mapping || !body) return;

            const indexLabel = (key) => {
                const index = parsed.indexes[key];
                return index === undefined ? 'Not mapped' : parsed.headers[index];
            };
            const requiredMap = [
                ['Description', 'vendor'],
                ['Category', 'category'],
                ['Type', 'type'],
                ['Amount', 'amount'],
                ['Status', 'status'],
                ['Date', 'date'],
            ];

            title.textContent = file.name;
            summary.textContent = `${parsed.transactions.length} row${parsed.transactions.length === 1 ? '' : 's'} ready for review. Showing first ${Math.min(parsed.transactions.length, 5)}.`;
            badge.textContent = 'Ready';
            badge.className = 'shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700';
            mapping.innerHTML = requiredMap.map(([label, key]) => `
                <span class="rounded-full border ${parsed.indexes[key] === undefined ? 'border-gray-200 bg-gray-50 text-gray-500' : 'border-emerald-200 bg-emerald-50 text-emerald-700'} px-2.5 py-1 text-[11px] font-bold">
                    ${escapeHtml(label)}: ${escapeHtml(indexLabel(key))}
                </span>
            `).join('');
            body.innerHTML = parsed.transactions.slice(0, 5).map(row => `
                <tr>
                    <td class="px-3 py-2 font-semibold text-gray-900">${escapeHtml(row.vendor_name)}</td>
                    <td class="px-3 py-2 text-gray-600">${escapeHtml(row.category)}</td>
                    <td class="px-3 py-2 text-gray-600">${escapeHtml(row.type.replace(/_/g, ' '))}</td>
                    <td class="px-3 py-2 font-mono font-bold text-gray-900">Rp${Math.abs(row.amount).toLocaleString('id-ID')}</td>
                    <td class="px-3 py-2 text-gray-600">${escapeHtml(row.status)}</td>
                    <td class="px-3 py-2 text-gray-600">${escapeHtml(row.dateKey)}</td>
                </tr>
            `).join('');
            card.classList.remove('hidden');
        };

        const renderCsvPreviewError = (file, message) => {
            const card = document.getElementById('tx-csv-preview-card');
            const title = document.getElementById('tx-csv-preview-title');
            const summary = document.getElementById('tx-csv-preview-summary');
            const badge = document.getElementById('tx-csv-preview-badge');
            const mapping = document.getElementById('tx-csv-mapping-summary');
            const body = document.getElementById('tx-csv-preview-body');
            if (!card || !title || !summary || !badge || !mapping || !body) return;
            title.textContent = file?.name || 'CSV file';
            summary.textContent = message;
            badge.textContent = 'Needs fix';
            badge.className = 'shrink-0 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700';
            mapping.innerHTML = '';
            body.innerHTML = `<tr><td colspan="6" class="px-3 py-4 text-[12px] font-medium text-red-700">${escapeHtml(message)}</td></tr>`;
            card.classList.remove('hidden');
        };

        const clearCsvPreview = () => {
            document.getElementById('tx-csv-preview-card')?.classList.add('hidden');
        };

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
            setSubmitButton(isBulk ? 'Upload CSV' : submitLabel, isBulk ? csvImportState.status !== 'ready' : !isSingleEntryComplete());
            if (isBulk) {
                if (csvImportState.status === 'ready') setCsvFeedback('CSV preview is ready. Review it, then upload when ready.', 'success');
                else if (csvImportState.status === 'parsing') setCsvFeedback('Reading CSV and building preview...', 'info');
                else if (csvImportState.status !== 'error') setCsvFeedback('', 'info');
            }
            updateDateWarning();
        };

        singleTab.onclick = () => setEntryMode('single');
        bulkTab.onclick = () => setEntryMode('bulk');

        const updateSelectedCsvFile = async (incomingFile = null) => {
            const file = incomingFile || getSelectedCsvFile();
            csvImportState = {
                file,
                csvText: '',
                parsed: null,
                status: file ? 'parsing' : 'idle'
            };
            setSubmitButton('Parsing CSV', true);
            fileLabel.textContent = file ? file.name : 'Choose or drop a CSV file';
            dropzone.classList.toggle('border-[#E85D19]', Boolean(file));
            dropzone.classList.toggle('ring-2', Boolean(file));
            dropzone.classList.toggle('ring-orange-100', Boolean(file));
            setCsvFeedback(file ? 'Reading CSV and building preview...' : '', 'info');
            clearCsvPreview();
            fileInput.dataset.hasPastDates = 'false';
            if (!file) {
                csvImportState.status = 'idle';
                setSubmitButton('Upload CSV', true);
                updateDateWarning();
                return;
            }
            if (!file.name.toLowerCase().endsWith('.csv')) {
                csvImportState.status = 'error';
                setCsvFeedback('Upload a .csv file.', 'error');
                renderCsvPreviewError(file, 'Upload a .csv file.');
                setSubmitButton('Upload CSV', true);
                updateDateWarning();
                return;
            }
            if (file) {
                let csvText = '';
                try {
                    csvText = await file.text();
                    const parsed = analyzeBulkCsv(csvText, todayKey, bulkStatusOverride);
                    csvImportState = { file, csvText, parsed, status: 'ready' };
                    fileInput.dataset.hasPastDates = parsed.transactions.some(row => isPastDateKey(row.dateKey)) ? 'true' : 'false';
                    renderCsvPreview(file, parsed);
                    setCsvFeedback(`${parsed.transactions.length} rows parsed. Review the preview, then upload when ready.`, 'success');
                    setSubmitButton('Upload CSV', false);
                } catch (err) {
                    csvImportState = { file, csvText: '', parsed: null, status: 'error' };
                    fileInput.dataset.hasPastDates = 'false';
                    const message = err?.message || 'Could not read this CSV file.';
                    setCsvFeedback(message, 'error');
                    renderCsvPreviewError(file, message);
                    setSubmitButton('Upload CSV', true);
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
            if (getSelectedCsvFile()) updateSelectedCsvFile();
        };

        bulkStatusSelect.onchange = () => {
            bulkStatusOverride = bulkStatusSelect.value;
            updateBulkStatusNote();
            if (getSelectedCsvFile()) updateSelectedCsvFile();
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

        if (openBulk) {
            setEntryMode('bulk');
        }
        if (csvFile) {
            setEntryMode('bulk');
            try {
                const files = new DataTransfer();
                files.items.add(csvFile);
                fileInput.files = files.files;
            } catch (_) {
                csvImportState.file = csvFile;
            }
            updateSelectedCsvFile(csvFile);
        }
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
                const file = getSelectedCsvFile();
                if (!file) {
                    setCsvFeedback('Choose a CSV file before uploading.', 'error');
                    return;
                }
                if (csvImportState.status !== 'ready') {
                    setCsvFeedback('Fix the CSV issues shown in the preview before uploading.', 'error');
                    return;
                }

                dropzone.classList.add('ring-2', 'ring-orange-100', 'border-[#E85D19]');
                const csvText = csvImportState.csvText || await file.text();
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
                csvImportState = { file: null, csvText: '', parsed: null, status: 'idle' };
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
            const txTypeSel = document.getElementById('tx-type').value;
            const txType = (() => {
                if (txTypeSel === 'Others') {
                    const custom = document.getElementById('tx-type-custom')?.value.trim();
                    return custom && custom.length > 0 ? custom : 'Others';
                }
                return txTypeSel;
            })();
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

            // Shared document attachment (Phase 1):
            //   - receipt for expense transactions
            //   - revenue_proof for income transactions
            //   - subscriptions reuse the receipt flow
            //   - bills attach invoices from the Bill Details drawer instead
            if (context !== 'bill') {
                const attachmentFile = attachmentController?.getPendingFile?.() || null;
                if (attachmentFile) {
                    const isRevenueContext = defaultType === 'income' || defaultType === 'revenue' || defaultCategory === 'Revenue';
                    const role = isRevenueContext ? 'revenue_proof' : 'receipt';
                    const sourceContextValue = isRevenueContext ? 'revenue' : (context === 'subscription' ? 'subscription' : 'transaction');

                    btn.innerText = 'Uploading attachment...';
                    let fileForUpload = attachmentFile;
                    if (attachmentFile.type && attachmentFile.type.startsWith('image/')) {
                        try { fileForUpload = await compressReceiptImage(attachmentFile); } catch (_) { fileForUpload = attachmentFile; }
                    }

                    const api = await loadFluxyDocumentAttachment();
                    const prepared = await api.prepareAttachmentForNewRecord({
                        ds,
                        userId: user.uid,
                        file: fileForUpload,
                        role,
                        sourceContext: sourceContextValue,
                        Timestamp
                    });

                    data.attached_documents = [prepared.attachmentForArray];
                    if (prepared.downloadURL) data.receipt_url = prepared.downloadURL;
                    if (role === 'receipt') data.status = 'Completed';
                }
            }

            if (user) {
                const attachedDocId = Array.isArray(data.attached_documents) && data.attached_documents[0]
                    ? data.attached_documents[0].document_id
                    : null;

                if (context === 'bill') {
                    // Phase 1.5 — attach optional budget fields when an active
                    // budget exists. Omit all five when there is no active
                    // budget so legacy/no-budget bill writes keep working.
                    if (billBudgetContext?.budget) {
                        const match = billBudgetContext.match({
                            amount: data.amount,
                            category: data.category,
                            due_date: data.due_date
                        });
                        const budgetId = billBudgetContext.budget.id;
                        if (match.allocation && (match.status === 'matched' || match.status === 'exceeded')) {
                            data.budget_id = budgetId;
                            data.budget_allocation_id = match.allocation.id;
                            data.budget_match_method = 'auto';
                            data.budget_match_status = 'matched';
                            data.budget_impact_status = 'committed';
                        } else if (match.allocation && match.status === 'needs_review') {
                            data.budget_id = budgetId;
                            data.budget_allocation_id = match.allocation.id;
                            data.budget_match_method = 'auto';
                            data.budget_match_status = 'needs_review';
                            data.budget_impact_status = 'committed';
                        } else if (match.status === 'unmatched' || match.status === 'out_of_period') {
                            data.budget_id = budgetId;
                            data.budget_allocation_id = null;
                            data.budget_match_method = 'none';
                            data.budget_match_status = 'unmatched';
                            data.budget_impact_status = 'committed';
                        }
                    }
                    const billRef = await ds.addBill(user.uid, data);
                    if (attachedDocId && billRef?.id) {
                        try { await ds.linkDocumentTarget(user.uid, attachedDocId, 'bills', billRef.id); } catch (_) {}
                    }
                    window.closeAddTransactionModal();
                    if (window.loadBills) await window.loadBills();
                    window.showToast("Bill successfully added to your schedule!", "success");
                } else if (context === 'subscription') {
                    const subRef = await ds.addSubscription(user.uid, data);
                    if (attachedDocId && subRef?.id) {
                        try { await ds.linkDocumentTarget(user.uid, attachedDocId, 'subscriptions', subRef.id); } catch (_) {}
                    }
                    window.closeAddTransactionModal();
                    if (window.loadSubscriptions) await window.loadSubscriptions();
                    window.showToast("Subscription successfully activated!", "success");
                } else {
                    const txRef = await ds.addTransaction(user.uid, data);
                    if (attachedDocId && txRef?.id) {
                        try { await ds.linkDocumentTarget(user.uid, attachedDocId, 'transactions', txRef.id); } catch (_) {}
                    }
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
                setSubmitButton('Upload CSV', csvImportState.status !== 'ready');
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
        try { window.FluxyDocumentAttachment?.reset(); } catch (_) {}
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
    // Trial/payment access guard: Fluxy AI is locked for expired/payment-pending
    // users (opening to send a message). Fails open if state isn't loaded.
    if (state !== false && window.FluxyAccessGuard && !window.FluxyAccessGuard.requireAIUsage()) {
        return;
    }
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
        // Never flip below the bar: chart axes / date captions / count labels
        // live there, so flipping would overlap them. If there is no room above,
        // clamp the tooltip to the container top — it may overlap the bar's top
        // portion for very tall bars, which is acceptable.
        if (top < padding) top = padding;

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

/**
 * Shared metric-info tooltip — single delegation handler for any
 * `<button class="metric-info" data-tooltip="...">?</button>` on the page.
 *
 * Reusable across the dashboard, budget page, and any future KPI surface.
 * Uses event delegation so dynamically-rendered cards work without any
 * wiring step from the caller. Markup contract:
 *
 *   <p class="metric-label">
 *       Main Budget
 *       <button type="button" class="metric-info"
 *           data-tooltip="The total amount you can spend during this period.">
 *           ?
 *       </button>
 *   </p>
 *
 * window.mountMetricInfoTooltips() is exposed as a no-op shim so existing
 * callers (e.g. dashboard.js) keep compiling after we centralise the logic.
 */
(function () {
    let tooltipNode = null;

    function ensureTooltip() {
        if (tooltipNode) return tooltipNode;
        tooltipNode = document.createElement('div');
        tooltipNode.className = 'metric-tooltip';
        tooltipNode.setAttribute('role', 'tooltip');
        document.body.appendChild(tooltipNode);
        return tooltipNode;
    }

    function hide() {
        if (!tooltipNode) return;
        tooltipNode.classList.remove('is-visible');
    }

    function show(button) {
        const copy = button.dataset.tooltip || '';
        if (!copy) return;
        const tip = ensureTooltip();
        tip.textContent = copy;
        tip.classList.add('is-visible');

        const buttonBox = button.getBoundingClientRect();
        const tipBox = tip.getBoundingClientRect();
        const margin = 12;
        const preferredLeft = buttonBox.left + buttonBox.width / 2 - tipBox.width / 2;
        const left = Math.max(margin, Math.min(preferredLeft, window.innerWidth - tipBox.width - margin));
        let top = buttonBox.bottom + 8;
        if (top + tipBox.height > window.innerHeight - margin) {
            top = Math.max(margin, buttonBox.top - tipBox.height - 8);
        }
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
    }

    function matchedButton(target) {
        return target?.closest?.('.metric-info[data-tooltip]') || null;
    }

    document.addEventListener('mouseover', (e) => {
        const btn = matchedButton(e.target);
        if (btn) show(btn);
    }, true);
    document.addEventListener('mouseout', (e) => {
        if (matchedButton(e.target)) hide();
    }, true);
    document.addEventListener('focusin', (e) => {
        const btn = matchedButton(e.target);
        if (btn) show(btn);
    });
    document.addEventListener('focusout', (e) => {
        if (matchedButton(e.target)) hide();
    });
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);

    // No-op shim. The handler is global delegation, so no per-call mount
    // is required, but existing callers still resolve cleanly.
    window.mountMetricInfoTooltips = function () {};
})();

/**
 * Shared budget assignment drawer (Phase 2).
 *
 * Lazy-injected on first call so any app page can trigger it without
 * carrying the markup. Drives all three actions through one drawer:
 *
 *   window.FluxyBudgetAssignment.open({
 *       action: 'assign' | 'exclude' | 'restore',
 *       recordType: 'transactions' | 'bills',
 *       recordId: 'docId',
 *       vendor: 'AWS',
 *       amountText: 'Rp5.000.000',
 *       currentAllocationId: 'abc' | null,
 *       budgetId: 'budgetDocId',
 *       allocations: [{ id, name, scope_values }],
 *       onDone: () => {}
 *   })
 *
 * Loads DataService lazily and writes the record + audit log atomically.
 */
(function () {
    let ds = null;
    let mounted = false;
    let activeCtx = null;

    function ensureMounted() {
        if (mounted) return;
        const html = `
            <div id="fbx-assignment-backdrop" class="fixed inset-0 bg-black/50 z-[60] hidden"></div>
            <div id="fbx-assignment-drawer" class="fixed top-0 right-0 h-full w-full max-w-[420px] bg-white shadow-2xl z-[70] transform translate-x-full transition-transform duration-300 ease-in-out flex flex-col">
                <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
                    <div class="min-w-0">
                        <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">Budget</p>
                        <h2 id="fbx-assignment-title" class="mt-1 text-[15px] font-bold text-gray-900">Change allocation</h2>
                    </div>
                    <button id="fbx-assignment-close" type="button" class="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <form id="fbx-assignment-form" class="flex-1 flex flex-col overflow-hidden">
                    <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                        <div class="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                            <p id="fbx-assignment-vendor" class="text-[13px] font-bold text-gray-900 truncate">—</p>
                            <p id="fbx-assignment-meta" class="mt-0.5 text-[12px] text-gray-500">—</p>
                        </div>
                        <div id="fbx-assignment-allocation-row">
                            <label for="fbx-assignment-allocation" class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Allocation</label>
                            <select id="fbx-assignment-allocation" class="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#E85D19] text-[13px]"></select>
                        </div>
                        <div>
                            <label for="fbx-assignment-reason" class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Reason <span class="text-[#EA580C]">*</span></label>
                            <textarea id="fbx-assignment-reason" rows="3" maxlength="500" required placeholder="Why is this record being updated?" class="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#E85D19] text-[13px] resize-none"></textarea>
                            <p class="mt-1 text-[11px] text-gray-400">Recorded in the audit log for traceability.</p>
                        </div>
                    </div>
                    <div class="px-6 py-4 border-t border-gray-100 flex items-center gap-3 flex-shrink-0">
                        <button id="fbx-assignment-cancel" type="button" class="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-[13px] font-medium hover:bg-gray-200 transition-colors">Cancel</button>
                        <button id="fbx-assignment-submit" type="submit" class="flex-1 px-4 py-2.5 bg-[#EA580C] text-white rounded-lg text-[13px] font-bold hover:bg-[#D94E0B] transition-colors disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed" disabled>Save</button>
                    </div>
                </form>
            </div>
        `;
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        while (wrapper.firstChild) document.body.appendChild(wrapper.firstChild);

        const back = document.getElementById('fbx-assignment-backdrop');
        const closeBtn = document.getElementById('fbx-assignment-close');
        const cancelBtn = document.getElementById('fbx-assignment-cancel');
        const reasonEl = document.getElementById('fbx-assignment-reason');
        const allocEl = document.getElementById('fbx-assignment-allocation');
        const submitBtn = document.getElementById('fbx-assignment-submit');
        const form = document.getElementById('fbx-assignment-form');

        const close = () => closeDrawer();
        back.addEventListener('click', close);
        closeBtn.addEventListener('click', close);
        cancelBtn.addEventListener('click', close);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !document.getElementById('fbx-assignment-drawer').classList.contains('translate-x-full')) {
                close();
            }
        });

        const validate = () => {
            const reason = reasonEl.value.trim();
            const needsAllocation = activeCtx && activeCtx.action === 'assign';
            const allocOk = !needsAllocation || (allocEl.value && allocEl.value.length > 0);
            submitBtn.disabled = !(reason.length > 0 && allocOk);
        };
        reasonEl.addEventListener('input', validate);
        allocEl.addEventListener('change', validate);

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (submitBtn.disabled || !activeCtx) return;
            submitBtn.disabled = true;
            const originalLabel = submitBtn.textContent;
            submitBtn.textContent = 'Saving…';
            try {
                await commitAssignment(activeCtx, reasonEl.value.trim(), allocEl.value);
                window.showToast?.(actionToastMessage(activeCtx.action), 'success');
                const onDone = activeCtx.onDone;
                close();
                if (typeof onDone === 'function') onDone();
            } catch (err) {
                console.error('Budget assignment failed:', err);
                const friendly = String(err?.message || '').includes('permission-denied')
                    ? 'Permission denied. Try again or contact support.'
                    : (err?.message || 'Could not update the budget assignment.');
                window.showToast?.(friendly, 'error');
                submitBtn.disabled = false;
                submitBtn.textContent = originalLabel;
            }
        });

        mounted = true;
    }

    function actionToastMessage(action) {
        if (action === 'exclude') return 'Record excluded from budget.';
        if (action === 'restore') return 'Record restored to budget.';
        return 'Budget assignment updated.';
    }

    function closeDrawer() {
        const drawer = document.getElementById('fbx-assignment-drawer');
        const back = document.getElementById('fbx-assignment-backdrop');
        drawer?.classList.add('translate-x-full');
        back?.classList.add('hidden');
        activeCtx = null;
        // Release scroll lock only if no other drawer or modal still needs it.
        // The Budget detail drawer is the typical co-resident; checking its
        // open state by looking for its visible backdrop avoids a coupling
        // import. Other drawers (`#budget-drawer-backdrop`, `#bill-drawer-backdrop`)
        // get the same defensive check.
        const lockHolders = ['budget-drawer-backdrop', 'budget-detail-backdrop', 'bill-drawer-backdrop'];
        const anyOpen = lockHolders.some(id => {
            const el = document.getElementById(id);
            return el && !el.classList.contains('hidden');
        });
        if (!anyOpen) document.body.classList.remove('overflow-hidden');
    }

    async function loadDataService() {
        if (ds) return ds;
        const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js");
        const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
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
        if (typeof auth.authStateReady === 'function') await auth.authStateReady();
        if (!auth.currentUser) throw new Error('Sign in required.');
        const { default: DataService } = await import('/assets/js/db-service.js');
        ds = new DataService(app);
        ds._authUserId = auth.currentUser.uid;
        return ds;
    }

    async function commitAssignment(ctx, reason, allocationIdFromSelect) {
        const dataService = await loadDataService();
        const userId = dataService._authUserId;
        const payload = { reason, budgetId: ctx.budgetId };
        if (ctx.action === 'assign') {
            payload.allocationId = allocationIdFromSelect;
            if (ctx.recordType === 'transactions') {
                await dataService.updateTransactionBudgetAssignment(userId, ctx.recordId, payload);
            } else {
                await dataService.updateBillBudgetAssignment(userId, ctx.recordId, payload);
            }
        } else if (ctx.action === 'exclude') {
            if (ctx.recordType === 'transactions') {
                await dataService.excludeTransactionFromBudget(userId, ctx.recordId, payload);
            } else {
                await dataService.excludeBillFromBudget(userId, ctx.recordId, payload);
            }
        } else if (ctx.action === 'restore') {
            await dataService.restoreBudgetAssignment(userId, ctx.recordType, ctx.recordId, payload);
        } else {
            throw new Error('Unknown action: ' + ctx.action);
        }
    }

    window.FluxyBudgetAssignment = {
        open(ctx) {
            if (!ctx || !ctx.recordType || !ctx.recordId) {
                console.warn('FluxyBudgetAssignment.open requires recordType + recordId');
                return;
            }
            ensureMounted();
            activeCtx = ctx;

            const titleEl = document.getElementById('fbx-assignment-title');
            const vendorEl = document.getElementById('fbx-assignment-vendor');
            const metaEl = document.getElementById('fbx-assignment-meta');
            const allocRow = document.getElementById('fbx-assignment-allocation-row');
            const allocEl = document.getElementById('fbx-assignment-allocation');
            const reasonEl = document.getElementById('fbx-assignment-reason');
            const submitBtn = document.getElementById('fbx-assignment-submit');

            const titleMap = {
                assign: 'Change allocation',
                exclude: 'Exclude from budget',
                restore: 'Restore to budget'
            };
            titleEl.textContent = titleMap[ctx.action] || 'Update budget assignment';
            vendorEl.textContent = ctx.vendor || 'Record';
            metaEl.textContent = [ctx.recordType === 'bills' ? 'Bill' : 'Transaction', ctx.amountText || '']
                .filter(Boolean).join(' · ');

            // Allocation select is only meaningful for assign.
            allocRow.style.display = ctx.action === 'assign' ? '' : 'none';
            if (ctx.action === 'assign') {
                const opts = (ctx.allocations || [])
                    .filter(a => a.status !== 'archived')
                    .map(a => `<option value="${a.id}" ${a.id === ctx.currentAllocationId ? 'selected' : ''}>${a.name}</option>`);
                allocEl.innerHTML = `<option value="">Select an allocation…</option>` + opts.join('');
                if (ctx.currentAllocationId) allocEl.value = ctx.currentAllocationId;
            } else {
                allocEl.innerHTML = '';
            }

            reasonEl.value = '';
            submitBtn.disabled = true;
            submitBtn.textContent = 'Save';

            document.getElementById('fbx-assignment-backdrop').classList.remove('hidden');
            requestAnimationFrame(() => {
                document.getElementById('fbx-assignment-drawer').classList.remove('translate-x-full');
                reasonEl.focus();
            });
            // Lock background scroll so the page underneath doesn't drift
            // while the user is filling out the assignment form.
            document.body.classList.add('overflow-hidden');
        },
        close: closeDrawer
    };
})();

/**
 * Shared notifications bell — opens a small dropdown anchored below the
 * button with two tabs: "Variance attention" and "Recent activity".
 *
 *   Variance: allocations on the active budget where status is at_risk
 *             or exceeded.
 *   Activity: the user's most recent budget audit logs (assignment,
 *             exclude, restore, create, allocations_updated).
 *
 * Auto-mounts on every app page by inserting a bell button immediately
 * to the LEFT of the Fluxy AI button. Lazy-loads DataService on first
 * open. Silently no-ops on pages without a Fluxy AI entry (e.g. login).
 *
 *   window.FluxyBudgetNotifications.refresh() — re-fetch + re-render
 *   window.FluxyBudgetNotifications.close()
 */
(function () {
    let injected = false;
    let activeTab = 'variance';
    let ds = null;
    let lastData = null;
    let loading = false;

    function whenReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    }

    function findFluxyAIButton() {
        return document.querySelector('button[onclick*="toggleFluxyAI"], [data-tour-target="fluxy-ai-entry"]');
    }

    function injectBell() {
        if (injected) return;
        const fluxyBtn = findFluxyAIButton();
        if (!fluxyBtn || !fluxyBtn.parentElement) return;
        // Don't double-mount across re-renders.
        if (document.getElementById('fbx-notif-btn')) { injected = true; return; }

        const bellHtml = `
            <button id="fbx-notif-btn" type="button" aria-label="Open budget notifications" class="relative inline-flex items-center justify-center w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors shadow-sm active:scale-95">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path>
                </svg>
                <span id="fbx-notif-dot" class="hidden absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#EA580C] ring-2 ring-white"></span>
            </button>
            <div id="fbx-notif-panel" class="hidden absolute right-0 top-full mt-2 w-[360px] max-w-[calc(100vw-32px)] bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden z-50">
                <div class="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <p class="text-[13px] font-bold text-gray-900">Budget notifications</p>
                    <button id="fbx-notif-close" type="button" class="p-1 text-gray-400 hover:text-gray-700">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div class="flex border-b border-gray-100">
                    <button id="fbx-notif-tab-variance" type="button" data-fbx-tab="variance" class="flex-1 px-3 py-2.5 text-[12px] font-bold text-[#EA580C] border-b-2 border-[#EA580C] transition-colors">
                        Variance attention <span id="fbx-notif-variance-count" class="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-orange-50 text-[10px] font-bold text-[#EA580C] px-1 hidden">0</span>
                    </button>
                    <button id="fbx-notif-tab-activity" type="button" data-fbx-tab="activity" class="flex-1 px-3 py-2.5 text-[12px] font-bold text-gray-500 border-b-2 border-transparent hover:text-gray-900 transition-colors">
                        Recent activity <span id="fbx-notif-activity-count" class="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-gray-100 text-[10px] font-bold text-gray-600 px-1 hidden">0</span>
                    </button>
                </div>
                <div id="fbx-notif-body" class="max-h-[420px] overflow-y-auto">
                    <p class="px-4 py-8 text-[12px] text-gray-400 text-center">Loading notifications…</p>
                </div>
                <div class="px-4 py-2 border-t border-gray-100 bg-gray-50">
                    <a href="/budget" class="text-[12px] font-bold text-[#EA580C] hover:underline">Open Budgets →</a>
                </div>
            </div>
        `;
        // Wrap so the panel is positioned relative to the bell + the right
        // edge of the header. Insert as the immediate left sibling of the
        // Fluxy AI button.
        const wrapper = document.createElement('div');
        wrapper.id = 'fbx-notif-wrap';
        wrapper.className = 'relative inline-flex';
        wrapper.innerHTML = bellHtml;
        fluxyBtn.parentElement.insertBefore(wrapper, fluxyBtn);

        document.getElementById('fbx-notif-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            togglePanel();
        });
        document.getElementById('fbx-notif-close').addEventListener('click', closePanel);
        document.getElementById('fbx-notif-tab-variance').addEventListener('click', () => switchTab('variance'));
        document.getElementById('fbx-notif-tab-activity').addEventListener('click', () => switchTab('activity'));

        // Close on outside click.
        document.addEventListener('click', (e) => {
            const panel = document.getElementById('fbx-notif-panel');
            const wrap = document.getElementById('fbx-notif-wrap');
            if (!panel || panel.classList.contains('hidden')) return;
            if (!wrap?.contains(e.target)) closePanel();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closePanel();
        });

        injected = true;
        // Best-effort dot refresh on mount (so users see the indicator even
        // before opening the panel for the first time).
        refresh().catch(() => {});
    }

    async function loadDS() {
        if (ds) return ds;
        const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js");
        const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
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
        if (typeof auth.authStateReady === 'function') await auth.authStateReady();
        if (!auth.currentUser) throw new Error('Sign in required.');
        const { default: DataService } = await import('/assets/js/db-service.js');
        ds = new DataService(app);
        ds._authUserId = auth.currentUser.uid;
        return ds;
    }

    async function refresh() {
        if (loading) return;
        loading = true;
        try {
            const svc = await loadDS();
            const userId = svc._authUserId;
            const activeBudget = await svc.getActiveBudget(userId);
            if (!activeBudget) {
                lastData = { variance: [], activity: [], hasBudget: false };
            } else {
                const usage = await svc.getBudgetUsage(userId, activeBudget.id);
                const variance = (usage.allocations || []).filter(a => a.status === 'at_risk' || a.status === 'exceeded');
                let activity = [];
                try {
                    activity = await svc.getBudgetActivityLogs(userId, activeBudget.id, 20);
                } catch (_) { activity = []; }
                lastData = { variance, activity, hasBudget: true, usage };
            }
            updateBadgeAndCounts();
            renderBody();
        } catch (err) {
            console.warn('Notifications refresh failed:', err);
            lastData = { variance: [], activity: [], hasBudget: false, error: err?.message };
            updateBadgeAndCounts();
            renderBody();
        } finally {
            loading = false;
        }
    }

    function updateBadgeAndCounts() {
        const dot = document.getElementById('fbx-notif-dot');
        const vCount = document.getElementById('fbx-notif-variance-count');
        const aCount = document.getElementById('fbx-notif-activity-count');
        const variance = lastData?.variance?.length || 0;
        const activity = lastData?.activity?.length || 0;
        if (dot) dot.classList.toggle('hidden', variance === 0);
        if (vCount) {
            vCount.textContent = String(variance);
            vCount.classList.toggle('hidden', variance === 0);
        }
        if (aCount) {
            aCount.textContent = String(activity);
            aCount.classList.toggle('hidden', activity === 0);
        }
    }

    function renderBody() {
        const body = document.getElementById('fbx-notif-body');
        if (!body) return;
        if (!lastData) {
            body.innerHTML = `<p class="px-4 py-8 text-[12px] text-gray-400 text-center">Loading…</p>`;
            return;
        }
        if (!lastData.hasBudget) {
            body.innerHTML = `
                <div class="px-4 py-8 text-center">
                    <p class="text-[12px] text-gray-500">No active budget. <a href="/budget" class="text-[#EA580C] font-bold hover:underline">Create one →</a></p>
                </div>`;
            return;
        }
        body.innerHTML = activeTab === 'variance' ? renderVarianceList(lastData.variance) : renderActivityList(lastData.activity);
    }

    function renderVarianceList(allocations) {
        if (allocations.length === 0) {
            return `<p class="px-4 py-8 text-[12px] text-gray-400 text-center">All allocations look healthy.</p>`;
        }
        const fmtRp = (n) => 'Rp' + Math.abs(Number(n) || 0).toLocaleString('id-ID');
        const fmtPct = (v) => Number.isFinite(v) ? (v >= 1000 ? Math.round(v) : v.toFixed(v >= 10 ? 0 : 1)) + '%' : '0%';
        return `<ul class="divide-y divide-gray-100">${allocations.map(a => {
            const isExceeded = a.status === 'exceeded';
            const cls = isExceeded ? 'text-red-700 bg-red-50 border-red-100' : 'text-orange-700 bg-orange-50 border-orange-100';
            const label = isExceeded ? 'Exceeded' : 'At risk';
            const detail = isExceeded
                ? `Over by ${fmtRp((a.actual_used + a.committed_amount) - a.allocated_amount)}`
                : `${fmtPct(a.usage_percent)} used · ${fmtRp(a.remaining_amount)} left`;
            return `
                <li class="px-4 py-3">
                    <div class="flex items-start justify-between gap-2">
                        <p class="text-[13px] font-semibold text-gray-900 truncate">${escapeHtmlSafe(a.name)}</p>
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${cls}">${label}</span>
                    </div>
                    <p class="mt-1 text-[11px] text-gray-500">${escapeHtmlSafe(detail)}</p>
                </li>`;
        }).join('')}</ul>`;
    }

    function renderActivityList(logs) {
        if (logs.length === 0) {
            return `<p class="px-4 py-8 text-[12px] text-gray-400 text-center">No budget activity yet.</p>`;
        }
        const map = {
            'budget_assignment.update': 'Allocation updated',
            'budget_assignment.exclude': 'Record excluded',
            'budget_assignment.restore': 'Record restored',
            'budget.created': 'Budget created',
            'budget.updated': 'Budget updated',
            'budget.allocations_updated': 'Allocations updated'
        };
        return `<ul class="divide-y divide-gray-100">${logs.map(log => {
            const when = log.created_at?.toDate?.();
            const whenText = when ? when.toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
            const label = map[log.action] || String(log.action || '').replace(/_/g, ' ');
            return `
                <li class="px-4 py-3">
                    <p class="text-[12px] font-semibold text-gray-900">${escapeHtmlSafe(label)}</p>
                    <p class="mt-0.5 text-[11px] text-gray-500">${escapeHtmlSafe(whenText)}${log.reason ? ` · ${escapeHtmlSafe(log.reason)}` : ''}</p>
                </li>`;
        }).join('')}</ul>`;
    }

    function escapeHtmlSafe(s) {
        return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
    }

    function switchTab(tab) {
        activeTab = tab;
        const v = document.getElementById('fbx-notif-tab-variance');
        const a = document.getElementById('fbx-notif-tab-activity');
        const activeCls = 'text-[#EA580C] border-[#EA580C]';
        const inactiveCls = 'text-gray-500 border-transparent hover:text-gray-900';
        if (v) v.className = `flex-1 px-3 py-2.5 text-[12px] font-bold border-b-2 transition-colors ${tab === 'variance' ? activeCls : inactiveCls}`;
        if (a) a.className = `flex-1 px-3 py-2.5 text-[12px] font-bold border-b-2 transition-colors ${tab === 'activity' ? activeCls : inactiveCls}`;
        // Counts get re-appended on every render — preserve them.
        renderBody();
        // Re-add the badge spans so counts stay visible after className swap.
        updateBadgeAndCounts();
    }

    function openPanel() {
        const panel = document.getElementById('fbx-notif-panel');
        if (!panel) return;
        panel.classList.remove('hidden');
        if (!lastData) renderBody();
        refresh().catch(() => {});
    }
    function closePanel() {
        document.getElementById('fbx-notif-panel')?.classList.add('hidden');
    }
    function togglePanel() {
        const panel = document.getElementById('fbx-notif-panel');
        if (!panel) return;
        if (panel.classList.contains('hidden')) openPanel(); else closePanel();
    }

    // Auto-mount once the DOM has the Fluxy AI button. Retry briefly for
    // pages that build their header lazily.
    whenReady(() => {
        let tries = 0;
        const tick = () => {
            if (findFluxyAIButton()) { injectBell(); return; }
            if (++tries < 20) setTimeout(tick, 200);
        };
        tick();
    });

    window.FluxyBudgetNotifications = {
        refresh,
        close: closePanel,
        open: openPanel
    };
})();
