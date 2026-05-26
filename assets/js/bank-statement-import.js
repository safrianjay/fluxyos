// FluxyOS — Bank Statement Import drawer (Phase 1)
// Spec: docs/BANK_STATEMENT_IMPORT_AUTOMATION_PLAN.md
//
// Phase 1 scope (this file):
//   • Render a right-side drawer titled "Import Bank Statement".
//   • Accept PDF, CSV, XLS, XLSX (validated by mime + extension + size).
//   • Upload the file to users/{uid}/bank_statement_imports/{importId}/{fileName}
//     and create a review draft in Firestore with review_status: "draft".
//   • Show detection summary and review table only when extraction data exists.
//     Until the backend parser is connected, the drawer shows a clear
//     "Extraction not connected" state — it never fabricates bank data.
//   • Provide a "Reject draft" action that flips review_status to "rejected".
//   • Never create transactions. Never update a bank account balance.
//
// Callers attach via: window.FluxyBankStatementImport.open({ app, auth, ds })

(function () {
    if (window.FluxyBankStatementImport) return;

    const ACCEPTED_EXTENSIONS = ['pdf', 'csv', 'xls', 'xlsx'];
    const ACCEPTED_MIME_TYPES = new Set([
        'application/pdf',
        'text/csv',
        'application/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '' // empty when browser cannot infer mime — fall back to extension check
    ]);
    const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

    const STATE_DEFAULT = 'default';
    const STATE_UPLOADING = 'uploading';
    const STATE_UPLOADED = 'uploaded';
    const STATE_ERROR = 'error';

    let mounted = null;

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatIDR(amount) {
        const n = Number(amount);
        if (!Number.isFinite(n)) return 'Rp —';
        return 'Rp ' + Math.abs(Math.round(n)).toLocaleString('id-ID');
    }

    function formatDate(value) {
        if (!value) return '—';
        try {
            const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
            if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
            return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        } catch (_) {
            return '—';
        }
    }

    function extensionFromName(name) {
        const idx = String(name || '').lastIndexOf('.');
        if (idx < 0) return '';
        return String(name).slice(idx + 1).toLowerCase();
    }

    function validateFile(file) {
        if (!file) return { ok: false, message: 'Choose a bank statement file to continue.' };
        const ext = extensionFromName(file.name);
        if (!ACCEPTED_EXTENSIONS.includes(ext)) {
            return {
                ok: false,
                message: `Unsupported file type (.${ext || 'unknown'}). Upload a PDF, CSV, XLS, or XLSX bank statement.`
            };
        }
        if (file.type && !ACCEPTED_MIME_TYPES.has(file.type)) {
            // Some Excel files come through with quirky mimes; trust the extension if present.
            const looksLikeExcelMime = file.type.includes('excel') || file.type.includes('spreadsheet');
            const looksLikeCsvMime = file.type.includes('csv') || file.type === 'text/plain';
            if (!looksLikeExcelMime && !looksLikeCsvMime && file.type !== 'application/pdf') {
                return {
                    ok: false,
                    message: 'File looks like the wrong format. Upload a PDF, CSV, XLS, or XLSX bank statement.'
                };
            }
        }
        if (file.size > MAX_FILE_BYTES) {
            return {
                ok: false,
                message: 'File is larger than 10 MB. Split the statement or upload a smaller file.'
            };
        }
        if (file.size <= 0) {
            return { ok: false, message: 'File is empty.' };
        }
        return { ok: true };
    }

    function drawerMarkup() {
        return `
        <div id="bsi-overlay" class="absolute inset-0 bg-black/55 opacity-0 transition-opacity duration-300 ease-out" data-bsi-close></div>
        <div id="bsi-drawer" role="dialog" aria-modal="true" aria-labelledby="bsi-title" class="relative z-10 ml-auto flex h-full w-full max-w-[520px] translate-x-full flex-col overflow-hidden bg-white shadow-2xl transition-transform duration-300 ease-out">
            <div class="flex items-start justify-between gap-4 border-b border-gray-100 bg-gray-50/50 px-6 py-5">
                <div class="min-w-0">
                    <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">Bank statement</p>
                    <h3 id="bsi-title" class="mt-1 text-lg font-bold text-gray-900">Import Bank Statement</h3>
                    <p class="mt-1 text-[12px] text-gray-500">Phase 1 · draft &amp; review only. Nothing is saved to your ledger or bank balance without explicit confirmation.</p>
                </div>
                <button type="button" data-bsi-close class="flex-shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600" aria-label="Close">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
            <div id="bsi-content" class="flex-1 overflow-y-auto px-6 py-5"></div>
            <div id="bsi-footer" class="flex flex-shrink-0 items-center gap-3 border-t border-gray-100 bg-white/95 px-6 py-4 shadow-[0_-12px_24px_rgba(15,23,42,0.06)]"></div>
        </div>`;
    }

    function uploadStepMarkup(ctx) {
        const errorBlock = ctx.errorMessage
            ? `<div class="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] font-medium text-rose-700">${escapeHtml(ctx.errorMessage)}</div>`
            : '';
        const fileBlock = ctx.file
            ? `<div class="mt-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <p class="truncate text-[13px] font-bold text-gray-900">${escapeHtml(ctx.file.name)}</p>
                        <p class="mt-0.5 text-[12px] text-gray-500">${escapeHtml(ctx.file.type || extensionFromName(ctx.file.name).toUpperCase())} · ${(ctx.file.size / 1024).toLocaleString('en-US', { maximumFractionDigits: 0 })} KB</p>
                    </div>
                    <button type="button" data-bsi-clear-file class="text-[12px] font-bold text-gray-500 hover:text-gray-900">Remove</button>
                </div>
            </div>`
            : '';
        return `
            ${errorBlock}
            <div class="space-y-5">
                <p class="text-[14px] text-gray-700">Upload a bank statement PDF, CSV, or spreadsheet. FluxyOS will extract transactions and show a review before anything is saved.</p>
                <div class="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-5" id="bsi-dropzone">
                    <label for="bsi-file-input" class="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-gray-200 bg-white px-5 py-7 text-center transition-all duration-200 hover:border-[#EA580C] hover:bg-gray-50">
                        <span class="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 text-[#EA580C]">
                            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"></path></svg>
                        </span>
                        <span class="text-[13px] font-bold text-gray-900">${ctx.file ? 'Replace file' : 'Choose or drop a statement file'}</span>
                        <span class="mt-1 text-[12px] text-gray-500">PDF, CSV, XLS, or XLSX · up to 10 MB</span>
                    </label>
                    <input type="file" id="bsi-file-input" accept=".pdf,.csv,.xls,.xlsx,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="sr-only">
                    ${fileBlock}
                </div>
                <div class="rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3 text-[12px] text-gray-600">
                    <p class="font-bold text-gray-900 text-[12px]">What happens next</p>
                    <ul class="mt-2 space-y-1.5 list-disc pl-4">
                        <li>FluxyOS uploads the file to your private storage under <span class="font-mono text-[11px]">users/&lt;you&gt;/bank_statement_imports/</span>.</li>
                        <li>A draft import is created in review status — no transactions are written and no balances change.</li>
                        <li>You will see the detection summary and review table when the parser is connected.</li>
                    </ul>
                </div>
            </div>`;
    }

    function uploadingStepMarkup(ctx) {
        return `
            <div class="flex h-full flex-col items-center justify-center py-12 text-center">
                <div class="h-10 w-10 animate-spin rounded-full border-2 border-gray-200 border-t-[#EA580C]"></div>
                <p class="mt-4 text-[14px] font-bold text-gray-900">Uploading statement…</p>
                <p class="mt-1 text-[12px] text-gray-500">${escapeHtml(ctx.file?.name || 'Your file')} is being stored securely.</p>
            </div>`;
    }

    function badgeForStatus(status) {
        if (status === 'passed') return '<span class="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">Passed</span>';
        if (status === 'failed') return '<span class="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700">Failed</span>';
        return '<span class="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-bold text-gray-600">Unavailable</span>';
    }

    function summaryRow(label, value) {
        return `
            <div class="flex items-baseline justify-between gap-3 border-b border-gray-100 py-2 last:border-b-0">
                <span class="text-[12px] text-gray-500">${escapeHtml(label)}</span>
                <span class="text-[13px] font-bold text-gray-900">${value}</span>
            </div>`;
    }

    function uploadedStepMarkup(ctx) {
        const draft = ctx.draft || {};
        const hasExtraction = draft.extraction_status === 'completed' && draft.row_count > 0;
        const rows = Array.isArray(ctx.rows) ? ctx.rows : [];

        const summary = `
            <div class="rounded-xl border border-gray-200 bg-white p-4">
                <div class="flex items-center justify-between gap-3">
                    <div>
                        <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">Import draft</p>
                        <p class="mt-1 text-[14px] font-bold text-gray-900">${escapeHtml(draft.file_name || ctx.file?.name || 'Bank statement')}</p>
                    </div>
                    <span class="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">${escapeHtml(draft.review_status || 'draft')}</span>
                </div>
                <div class="mt-3">
                    ${summaryRow('Detected bank', escapeHtml(draft.bank_name || 'Not detected'))}
                    ${summaryRow('Account', escapeHtml(draft.account_number_masked || 'Not detected'))}
                    ${summaryRow('Period', `${escapeHtml(formatDate(draft.statement_start_date))} – ${escapeHtml(formatDate(draft.statement_end_date))}`)}
                    ${summaryRow('Opening balance', escapeHtml(draft.opening_balance == null ? 'Not detected' : formatIDR(draft.opening_balance)))}
                    ${summaryRow('Closing balance', escapeHtml(draft.closing_balance == null ? 'Not detected' : formatIDR(draft.closing_balance)))}
                    ${summaryRow('Rows detected', escapeHtml(String(draft.row_count ?? 0)))}
                    ${summaryRow('Balance check', badgeForStatus(draft.balance_check_status))}
                    ${summaryRow('Possible duplicates', escapeHtml(String(draft.duplicate_count ?? 0)))}
                    ${summaryRow('Needs review', escapeHtml(String(draft.needs_review_count ?? 0)))}
                </div>
            </div>`;

        const extractionStub = !hasExtraction
            ? `<div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
                    <p class="font-bold text-[12px]">Automated extraction is not connected yet</p>
                    <p class="mt-1">Your file is stored safely under your private user scope and the draft is recorded for review. The detection summary and review table will populate once the FluxyOS parser is connected. No transactions or balances will be changed.</p>
                </div>`
            : '';

        const tableHeader = `
            <thead class="bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                <tr>
                    <th class="px-3 py-2 text-left">Date</th>
                    <th class="px-3 py-2 text-left">Description</th>
                    <th class="px-3 py-2 text-right">Money in</th>
                    <th class="px-3 py-2 text-right">Money out</th>
                    <th class="px-3 py-2 text-right">Balance</th>
                    <th class="px-3 py-2 text-left">Suggested type</th>
                    <th class="px-3 py-2 text-left">Suggested category</th>
                    <th class="px-3 py-2 text-left">Match status</th>
                    <th class="px-3 py-2 text-left">Action</th>
                </tr>
            </thead>`;

        const tableBody = rows.length === 0
            ? `<tbody><tr><td colspan="9" class="px-3 py-6 text-center text-[12px] text-gray-400">No rows extracted yet. The review table appears when the parser returns rows.</td></tr></tbody>`
            : `<tbody class="divide-y divide-gray-100 text-[12px]">${rows.map(row => `
                <tr>
                    <td class="px-3 py-2 whitespace-nowrap text-gray-700">${escapeHtml(formatDate(row.transaction_date))}</td>
                    <td class="px-3 py-2 text-gray-900">${escapeHtml(row.description_raw || '')}</td>
                    <td class="px-3 py-2 text-right font-mono text-emerald-700">${row.credit ? escapeHtml(formatIDR(row.credit)) : '—'}</td>
                    <td class="px-3 py-2 text-right font-mono text-gray-900">${row.debit ? escapeHtml(formatIDR(row.debit)) : '—'}</td>
                    <td class="px-3 py-2 text-right font-mono text-gray-700">${row.running_balance != null ? escapeHtml(formatIDR(row.running_balance)) : '—'}</td>
                    <td class="px-3 py-2 text-gray-700">${escapeHtml(row.suggested_type || '—')}</td>
                    <td class="px-3 py-2 text-gray-700">${escapeHtml(row.suggested_category || '—')}</td>
                    <td class="px-3 py-2 text-gray-700">${escapeHtml(row.match_status || 'new')}</td>
                    <td class="px-3 py-2 text-gray-400">—</td>
                </tr>`).join('')}</tbody>`;

        const reviewTable = `
            <div class="rounded-xl border border-gray-200 bg-white">
                <div class="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                    <div>
                        <p class="text-[13px] font-bold text-gray-900">Review table</p>
                        <p class="text-[12px] text-gray-500">Rows are read-only in Phase 1.</p>
                    </div>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full min-w-[820px] text-left">
                        ${tableHeader}
                        ${tableBody}
                    </table>
                </div>
            </div>`;

        return `
            <div class="space-y-5">
                ${summary}
                ${extractionStub}
                ${reviewTable}
            </div>`;
    }

    function errorStepMarkup(ctx) {
        return `
            <div class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
                <p class="font-bold">We could not import this statement.</p>
                <p class="mt-1 text-[12px]">${escapeHtml(ctx.errorMessage || 'Try a different file or retry the upload.')}</p>
            </div>`;
    }

    function footerMarkup(ctx) {
        if (ctx.state === STATE_UPLOADING) {
            return `<button type="button" disabled class="ml-auto rounded-xl bg-gray-200 px-5 py-3 text-[13px] font-bold text-gray-500">Uploading…</button>`;
        }
        if (ctx.state === STATE_UPLOADED) {
            const rejectBtn = ctx.draft?.review_status === 'rejected'
                ? `<span class="text-[12px] font-bold text-gray-500">Draft rejected</span>`
                : `<button type="button" data-bsi-reject class="rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13px] font-bold text-gray-700 transition-colors hover:bg-gray-50 active:scale-95">Reject draft</button>`;
            return `
                ${rejectBtn}
                <button type="button" data-bsi-close class="ml-auto rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13px] font-bold text-gray-700 transition-colors hover:bg-gray-50 active:scale-95">Close</button>
                <button type="button" disabled class="rounded-xl bg-gray-200 px-5 py-3 text-[13px] font-bold text-gray-500" title="Phase 2 — coming soon">Confirm Import (Phase 2)</button>
            `;
        }
        if (ctx.state === STATE_ERROR) {
            return `
                <button type="button" data-bsi-close class="ml-auto rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13px] font-bold text-gray-700 transition-colors hover:bg-gray-50 active:scale-95">Close</button>
                <button type="button" data-bsi-retry class="rounded-xl bg-[#EA580C] px-5 py-3 text-[13px] font-bold text-white transition-colors hover:bg-[#D44400] active:scale-95">Try again</button>
            `;
        }
        const stageDisabled = !ctx.file ? 'disabled' : '';
        const stageClass = ctx.file
            ? 'bg-[#EA580C] text-white hover:bg-[#D44400]'
            : 'bg-gray-200 text-gray-500 cursor-not-allowed';
        return `
            <button type="button" data-bsi-close class="ml-auto rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13px] font-bold text-gray-700 transition-colors hover:bg-gray-50 active:scale-95">Cancel</button>
            <button type="button" data-bsi-stage ${stageDisabled} class="rounded-xl px-5 py-3 text-[13px] font-bold transition-colors active:scale-95 ${stageClass}">Stage statement</button>
        `;
    }

    function renderContent(ctx) {
        const content = document.getElementById('bsi-content');
        const footer = document.getElementById('bsi-footer');
        if (!content || !footer) return;
        if (ctx.state === STATE_UPLOADING) content.innerHTML = uploadingStepMarkup(ctx);
        else if (ctx.state === STATE_UPLOADED) content.innerHTML = uploadedStepMarkup(ctx);
        else if (ctx.state === STATE_ERROR) content.innerHTML = errorStepMarkup(ctx);
        else content.innerHTML = uploadStepMarkup(ctx);
        footer.innerHTML = footerMarkup(ctx);
        attachStepHandlers(ctx);
    }

    function attachStepHandlers(ctx) {
        const fileInput = document.getElementById('bsi-file-input');
        if (fileInput) {
            fileInput.onchange = (event) => {
                const file = event.target.files && event.target.files[0];
                if (!file) return;
                const validation = validateFile(file);
                if (!validation.ok) {
                    ctx.errorMessage = validation.message;
                    ctx.file = null;
                    fileInput.value = '';
                    renderContent(ctx);
                    return;
                }
                ctx.errorMessage = '';
                ctx.file = file;
                renderContent(ctx);
            };
        }
        document.querySelectorAll('[data-bsi-clear-file]').forEach(btn => {
            btn.onclick = () => {
                ctx.file = null;
                ctx.errorMessage = '';
                renderContent(ctx);
            };
        });
        document.querySelectorAll('[data-bsi-stage]').forEach(btn => {
            btn.onclick = () => stageImport(ctx);
        });
        document.querySelectorAll('[data-bsi-reject]').forEach(btn => {
            btn.onclick = () => rejectDraft(ctx);
        });
        document.querySelectorAll('[data-bsi-retry]').forEach(btn => {
            btn.onclick = () => {
                ctx.state = STATE_DEFAULT;
                ctx.errorMessage = '';
                renderContent(ctx);
            };
        });
    }

    async function stageImport(ctx) {
        const validation = validateFile(ctx.file);
        if (!validation.ok) {
            ctx.errorMessage = validation.message;
            renderContent(ctx);
            return;
        }
        if (!ctx.user || !ctx.ds) {
            ctx.state = STATE_ERROR;
            ctx.errorMessage = 'You need to be signed in to import a bank statement.';
            renderContent(ctx);
            return;
        }

        ctx.state = STATE_UPLOADING;
        renderContent(ctx);

        try {
            const draft = await ctx.ds.createBankStatementImport(ctx.user.uid, {
                file_name: ctx.file.name,
                file_mime_type: ctx.file.type || 'application/octet-stream',
                file_size: ctx.file.size,
                extraction_status: 'pending',
                review_status: 'draft'
            });

            const uploadResult = await ctx.ds.uploadBankStatementFile(ctx.user.uid, draft.id, ctx.file);

            await ctx.ds.updateBankStatementImport(ctx.user.uid, draft.id, {
                storage_path: uploadResult.storagePath
            });

            // Re-read the draft so we have the persisted storage_path-aware copy.
            const refreshed = await ctx.ds.getBankStatementImport(ctx.user.uid, draft.id);
            ctx.draft = refreshed || { ...draft, storage_path: uploadResult.storagePath };
            ctx.rows = await ctx.ds.getBankStatementRows(ctx.user.uid, draft.id);
            ctx.state = STATE_UPLOADED;
            renderContent(ctx);
            window.showToast?.('Bank statement uploaded as a draft. Nothing has been saved to your ledger.', 'success');
        } catch (error) {
            // Avoid printing the file contents or sensitive payload.
            console.warn('Bank statement import failed:', error?.message || error);
            ctx.state = STATE_ERROR;
            ctx.errorMessage = error?.code === 'permission-denied'
                ? 'You do not have permission to import bank statements. Sign in again and retry.'
                : (error?.message || 'Something went wrong while uploading the statement.');
            renderContent(ctx);
        }
    }

    async function rejectDraft(ctx) {
        if (!ctx.draft?.id || !ctx.user || !ctx.ds) return;
        try {
            await ctx.ds.updateBankStatementImport(ctx.user.uid, ctx.draft.id, {
                review_status: 'rejected'
            });
            ctx.draft = { ...ctx.draft, review_status: 'rejected' };
            renderContent(ctx);
            window.showToast?.('Bank statement draft rejected.', 'info');
        } catch (error) {
            window.showToast?.('Could not reject the draft. Try again.', 'error');
        }
    }

    function openDrawer(options = {}) {
        if (mounted) return;
        const ctx = {
            user: options.user || options.auth?.currentUser || null,
            ds: options.ds || null,
            file: null,
            draft: null,
            rows: [],
            state: STATE_DEFAULT,
            errorMessage: ''
        };

        const wrapper = document.createElement('div');
        wrapper.id = 'bsi-modal';
        wrapper.className = 'fixed inset-0 z-[100] flex justify-end overflow-hidden';
        wrapper.innerHTML = drawerMarkup();
        document.body.appendChild(wrapper);
        document.body.classList.add('overflow-hidden');
        mounted = wrapper;

        window.requestAnimationFrame(() => {
            document.getElementById('bsi-overlay')?.classList.remove('opacity-0');
            document.getElementById('bsi-overlay')?.classList.add('opacity-100');
            document.getElementById('bsi-drawer')?.classList.remove('translate-x-full');
        });

        const escapeHandler = (event) => {
            if (event.key === 'Escape') closeDrawer();
        };
        document.addEventListener('keydown', escapeHandler);
        wrapper.__bsiEscapeHandler = escapeHandler;

        wrapper.addEventListener('click', (event) => {
            const closeEl = event.target.closest('[data-bsi-close]');
            if (closeEl) closeDrawer();
        });

        renderContent(ctx);
    }

    function closeDrawer() {
        if (!mounted) return;
        const wrapper = mounted;
        mounted = null;
        document.body.classList.remove('overflow-hidden');
        document.getElementById('bsi-overlay')?.classList.remove('opacity-100');
        document.getElementById('bsi-overlay')?.classList.add('opacity-0');
        document.getElementById('bsi-drawer')?.classList.add('translate-x-full');
        if (wrapper.__bsiEscapeHandler) {
            document.removeEventListener('keydown', wrapper.__bsiEscapeHandler);
        }
        setTimeout(() => {
            if (wrapper && wrapper.parentElement) wrapper.parentElement.removeChild(wrapper);
        }, 280);
    }

    window.FluxyBankStatementImport = {
        open: openDrawer,
        close: closeDrawer
    };

    // Delegated trigger: any element with id `import-bank-statement-btn` opens
    // the drawer regardless of when the click happens vs page auth. The drawer
    // reads auth + DataService from `window.__fluxyTxContext` when available.
    function delegatedClick(event) {
        const trigger = event.target && event.target.closest && event.target.closest('#import-bank-statement-btn');
        if (!trigger) return;
        event.preventDefault();
        const ctx = window.__fluxyTxContext || {};
        openDrawer({
            app: ctx.app || null,
            auth: ctx.auth || null,
            ds: ctx.ds || null,
            user: ctx.auth?.currentUser || null
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            document.addEventListener('click', delegatedClick);
        });
    } else {
        document.addEventListener('click', delegatedClick);
    }
})();
