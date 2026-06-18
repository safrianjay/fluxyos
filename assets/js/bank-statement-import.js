// FluxyOS — Bank Statement Import drawer/panel
// Spec: docs/BANK_STATEMENT_IMPORT_AUTOMATION_PLAN.md
//
// Scope:
//   • Accept PDF, CSV, XLS, XLSX (validated by mime + extension + size).
//   • Upload the file to users/{uid}/bank_statement_imports/{importId}/{fileName}
//     and create a review draft in Firestore with review_status: "draft".
//   • Trigger backend extraction (bank-statement-extract-background): the panel
//     watches the draft until extraction_status flips to completed/failed, then
//     renders the detected metadata + an interactive review table. It never
//     fabricates bank data — a failed extraction shows a manual-review message.
//   • Let the user select/edit rows and Confirm Import to create linked ledger
//     transactions (DataService.confirmBankStatementImport). "Reject draft"
//     flips review_status to "rejected".
//   • Never update a bank account balance (Phase 3).
//
// Two ways to use this module:
//   window.FluxyBankStatementImport.open({ app, auth, ds, user })
//     → opens a standalone right-side drawer.
//   window.FluxyBankStatementImport.mount({ contentEl, footerEl, app, auth, ds, user })
//     → renders the upload/review UI into caller-owned content + footer
//     containers (used by the unified Scan / Import drawer on the Ledger
//     page). Returns { destroy(), getState() }.

(function () {
    if (window.FluxyBankStatementImport) return;

    const ACCEPTED_EXTENSIONS = ['pdf', 'csv', 'xls', 'xlsx'];
    const ACCEPTED_MIME_TYPES = new Set([
        'application/pdf',
        'text/csv',
        'application/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ''
    ]);
    const MAX_FILE_BYTES = 10 * 1024 * 1024;

    const STATE_DEFAULT = 'default';
    const STATE_UPLOADING = 'uploading';
    const STATE_PROCESSING = 'processing';
    const STATE_UPLOADED = 'uploaded';
    const STATE_IMPORTED = 'imported';
    const STATE_ERROR = 'error';

    const REVIEW_TYPES = ['income', 'expense', 'transfer', 'refund', 'fee', 'tax'];
    const REVIEW_CATEGORIES = ['Revenue', 'Marketing', 'Infrastructure', 'Operations', 'SaaS', 'Others'];
    const PAGE_SIZE = 25;
    const EXTRACTION_TIMEOUT_MS = 8 * 60 * 1000;
    const MANUAL_REVIEW_MESSAGE = 'This statement needs manual review. We detected the file but could not extract reliable rows. Try a clearer PDF or a CSV/XLSX export from your bank.';

    let standaloneMounted = null;

    // True for any row that money actually flows on and the user kept selected.
    function isImportableRow(row) {
        return row && row.selected_for_import !== false && row.review_status !== 'ignored'
            && !row.created_transaction_id && ((Number(row.credit) || 0) > 0 || (Number(row.debit) || 0) > 0);
    }
    function selectedCount(rows) {
        return (Array.isArray(rows) ? rows : []).filter(isImportableRow).length;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatIDR(amount) {
        const n = Number(amount);
        if (!Number.isFinite(n)) return 'Rp—';
        return 'Rp' + Math.abs(Math.round(n)).toLocaleString('id-ID');
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
                <div class="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[12px] text-blue-800">
                    <svg class="mt-0.5 h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"></path></svg>
                    <p>Upload a bank statement PDF, CSV, or spreadsheet. FluxyOS will extract transactions and show a review before anything is saved.</p>
                </div>
                <div class="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-5" data-bsi-dropzone>
                    <label data-bsi-file-label class="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-gray-200 bg-white px-5 py-7 text-center transition-all duration-200 hover:border-[#EA580C] hover:bg-gray-50">
                        <span class="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 text-[#EA580C]">
                            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"></path></svg>
                        </span>
                        <span class="text-[13px] font-bold text-gray-900">${ctx.file ? 'Replace file' : 'Choose or drop a statement file'}</span>
                        <span class="mt-1 text-[12px] text-gray-500">PDF, CSV, XLS, or XLSX · up to 10 MB</span>
                    </label>
                    <input type="file" data-bsi-file-input accept=".pdf,.csv,.xls,.xlsx,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="sr-only">
                    ${fileBlock}
                </div>
                <div class="rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3 text-[12px] text-gray-600">
                    <p class="font-bold text-gray-900 text-[12px]">What happens next</p>
                    <ul class="mt-2 space-y-1.5 list-disc pl-4">
                        <li>FluxyOS uploads the file to your private storage under <span class="font-mono text-[11px]">users/&lt;you&gt;/bank_statement_imports/</span>.</li>
                        <li>A draft import is created in review status — no transactions are written and no balances change.</li>
                        <li>FluxyOS reads the statement, then shows a review table where you pick the rows to import.</li>
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

    function processingStepMarkup() {
        // Reuse the shared scan loader (glow + floating dots) from the
        // Receipt/Invoice flow — classes live in shared-dashboard.css.
        return `
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

                <div class="relative flex flex-col items-center justify-center py-14 px-6 text-center">
                    <div class="relative w-36 h-36 flex items-center justify-center">
                        <div class="absolute inset-0 rounded-full scan-loader-halo-purple opacity-70 blur-2xl"></div>
                        <div class="absolute inset-3 rounded-full scan-loader-halo-purple opacity-55 blur-md"></div>
                        <div class="relative scan-loader-pulse">
                            <div class="w-20 h-20 rounded-2xl bg-white shadow-xl ring-1 ring-violet-100 flex items-center justify-center">
                                <img src="assets/images/favicon.svg" alt="" class="w-12 h-12 scan-loader-spin" aria-hidden="true" onerror="this.style.display='none'">
                            </div>
                        </div>
                    </div>
                    <p class="text-[13px] font-semibold text-gray-900 mt-6">Reading your statement with AI…</p>
                    <p class="text-[12px] text-gray-500 mt-1">This usually takes under a minute — keep this open.</p>
                </div>
            </div>`;
    }

    function importedStepMarkup(ctx) {
        const count = ctx.importedCount || 0;
        return `
            <div class="flex h-full flex-col items-center justify-center py-12 text-center">
                <span class="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                    <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                </span>
                <p class="mt-4 text-[14px] font-bold text-gray-900">${count} transaction${count === 1 ? '' : 's'} imported</p>
                <p class="mt-1 text-[12px] text-gray-500">They are now in your Ledger, tagged as imported from this statement. Balances were not changed.</p>
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

    function matchBadge(status) {
        if (status === 'possible_duplicate') return '<span class="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">Possible duplicate</span>';
        if (status === 'needs_review') return '<span class="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">Needs review</span>';
        if (status === 'matched_existing') return '<span class="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">Matched</span>';
        return '<span class="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-bold text-gray-600">New</span>';
    }

    function optionList(values, selected) {
        return values.map(v => `<option value="${escapeHtml(v)}"${v === selected ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
    }

    function uploadedStepMarkup(ctx) {
        const draft = ctx.draft || {};
        const rows = Array.isArray(ctx.rows) ? ctx.rows : [];
        const dupCount = draft.duplicate_count ?? rows.filter(r => r.match_status === 'possible_duplicate').length;

        const balanceWarn = draft.balance_check_status === 'failed'
            ? `<div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
                    <p class="font-bold text-[12px]">Balance check did not reconcile</p>
                    <p class="mt-1">Opening + money in − money out doesn't equal the closing balance, so some rows may be missing or misread. Review before importing.</p>
                </div>`
            : '';

        const summary = `
            <div class="rounded-xl border border-gray-200 bg-white p-4">
                <div class="flex items-center justify-between gap-3">
                    <div>
                        <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">Import draft</p>
                        <p class="mt-1 text-[14px] font-bold text-gray-900">${escapeHtml(draft.file_name || ctx.file?.name || 'Bank statement')}</p>
                    </div>
                    <span class="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">${escapeHtml(draft.review_status || 'ready_to_import')}</span>
                </div>
                <div class="mt-3">
                    ${summaryRow('Detected bank', escapeHtml(draft.bank_name || 'Not detected'))}
                    ${summaryRow('Account', escapeHtml(draft.account_number_masked || 'Not detected'))}
                    ${summaryRow('Period', `${escapeHtml(formatDate(draft.statement_start_date))} – ${escapeHtml(formatDate(draft.statement_end_date))}`)}
                    ${summaryRow('Opening balance', escapeHtml(draft.opening_balance == null ? 'Not detected' : formatIDR(draft.opening_balance)))}
                    ${summaryRow('Closing balance', escapeHtml(draft.closing_balance == null ? 'Not detected' : formatIDR(draft.closing_balance)))}
                    ${summaryRow('Rows detected', escapeHtml(String(draft.row_count ?? rows.length)))}
                    ${summaryRow('Balance check', badgeForStatus(draft.balance_check_status))}
                    ${summaryRow('Possible duplicates', escapeHtml(String(dupCount)))}
                    ${summaryRow('Needs review', escapeHtml(String(draft.needs_review_count ?? 0)))}
                </div>
            </div>`;

        const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
        const page = Math.min(ctx.page || 0, totalPages - 1);
        const start = page * PAGE_SIZE;
        const pageRows = rows.slice(start, start + PAGE_SIZE);

        const tableHeader = `
            <thead class="bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                <tr>
                    <th class="px-3 py-2 text-left">Import</th>
                    <th class="px-3 py-2 text-left">Date</th>
                    <th class="px-3 py-2 text-left">Description</th>
                    <th class="px-3 py-2 text-right">Money in</th>
                    <th class="px-3 py-2 text-right">Money out</th>
                    <th class="px-3 py-2 text-right">Balance</th>
                    <th class="px-3 py-2 text-left">Type</th>
                    <th class="px-3 py-2 text-left">Category</th>
                    <th class="px-3 py-2 text-left">Match</th>
                </tr>
            </thead>`;

        const tableBody = rows.length === 0
            ? `<tbody><tr><td colspan="9" class="px-3 py-6 text-center text-[12px] text-gray-400">No rows were extracted from this statement.</td></tr></tbody>`
            : `<tbody class="divide-y divide-gray-100 text-[12px]">${pageRows.map(row => {
                const selected = isImportableRow(row);
                return `
                <tr data-bsi-row="${escapeHtml(row.id)}"${row.match_status === 'possible_duplicate' ? ' class="bg-amber-50/40"' : ''}>
                    <td class="px-3 py-2"><input type="checkbox" data-bsi-select class="h-4 w-4 rounded border-gray-300 text-[#EA580C] focus:ring-[#EA580C]"${selected ? ' checked' : ''}></td>
                    <td class="px-3 py-2 whitespace-nowrap text-gray-700">${escapeHtml(formatDate(row.transaction_date))}</td>
                    <td class="px-3 py-2 text-gray-900 max-w-[220px] truncate" title="${escapeHtml(row.description_raw || '')}">${escapeHtml(row.description_raw || '')}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-emerald-700">${row.credit ? escapeHtml(formatIDR(row.credit)) : '—'}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-gray-900">${row.debit ? escapeHtml(formatIDR(row.debit)) : '—'}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-gray-700">${row.running_balance != null ? escapeHtml(formatIDR(row.running_balance)) : '—'}</td>
                    <td class="px-3 py-2"><select data-bsi-type class="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[12px]">${optionList(REVIEW_TYPES, row.suggested_type)}</select></td>
                    <td class="px-3 py-2"><select data-bsi-cat class="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[12px]">${optionList(REVIEW_CATEGORIES, row.suggested_category)}</select></td>
                    <td class="px-3 py-2">${matchBadge(row.match_status)}</td>
                </tr>`; }).join('')}</tbody>`;

        const pagination = rows.length > PAGE_SIZE
            ? `<div class="flex items-center justify-between border-t border-gray-100 px-4 py-2.5 text-[12px] text-gray-500">
                    <span>Showing ${start + 1}–${Math.min(start + PAGE_SIZE, rows.length)} of ${rows.length}</span>
                    <div class="flex items-center gap-2">
                        <button type="button" data-bsi-prev class="rounded-lg border border-gray-200 px-2.5 py-1 font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40" ${page === 0 ? 'disabled' : ''}>Prev</button>
                        <button type="button" data-bsi-next class="rounded-lg border border-gray-200 px-2.5 py-1 font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40" ${page >= totalPages - 1 ? 'disabled' : ''}>Next</button>
                    </div>
                </div>`
            : '';

        const dupNote = dupCount > 0
            ? `<button type="button" data-bsi-skip-dupes class="text-[12px] font-bold text-[#EA580C] hover:underline">Skip ${dupCount} possible duplicate${dupCount === 1 ? '' : 's'}</button>`
            : '';

        const reviewTable = `
            <div class="rounded-xl border border-gray-200 bg-white">
                <div class="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                    <div>
                        <p class="text-[13px] font-bold text-gray-900">Review table</p>
                        <p class="text-[12px] text-gray-500">Tick the rows to import; adjust type or category before confirming. Nothing is saved until you confirm.</p>
                    </div>
                    ${dupNote}
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full min-w-[860px] text-left">
                        ${tableHeader}
                        ${tableBody}
                    </table>
                </div>
                ${pagination}
            </div>`;

        return `
            <div class="space-y-5">
                ${summary}
                ${balanceWarn}
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
        const showStandaloneClose = !!ctx.closable;
        if (ctx.state === STATE_UPLOADING) {
            return `<button type="button" disabled class="ml-auto rounded-xl bg-gray-200 px-5 py-3 text-[13px] font-bold text-gray-500">Uploading…</button>`;
        }
        if (ctx.state === STATE_PROCESSING) {
            return `<button type="button" disabled class="ml-auto rounded-xl bg-gray-200 px-5 py-3 text-[13px] font-bold text-gray-500">Reading statement…</button>`;
        }
        if (ctx.state === STATE_IMPORTED) {
            const closeBtn = showStandaloneClose
                ? `<button type="button" data-bsi-close class="ml-auto rounded-xl bg-[#EA580C] px-5 py-3 text-[13px] font-bold text-white transition-colors hover:bg-[#D44400] active:scale-95">Done</button>`
                : `<span class="ml-auto text-[12px] font-bold text-emerald-600">Import complete</span>`;
            return closeBtn;
        }
        if (ctx.state === STATE_UPLOADED) {
            const rejectBtn = ctx.draft?.review_status === 'rejected'
                ? `<span class="text-[12px] font-bold text-gray-500">Draft rejected</span>`
                : `<button type="button" data-bsi-reject class="rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13px] font-bold text-gray-700 transition-colors hover:bg-gray-50 active:scale-95">Reject draft</button>`;
            const count = selectedCount(ctx.rows);
            const confirmDisabled = count === 0 || ctx.draft?.review_status === 'rejected';
            const confirmClass = confirmDisabled ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-[#EA580C] text-white hover:bg-[#D44400]';
            return `
                ${rejectBtn}
                <span class="ml-auto mr-1 text-[12px] text-gray-500">${count} selected</span>
                <button type="button" data-bsi-confirm ${confirmDisabled ? 'disabled' : ''} class="rounded-xl px-5 py-3 text-[13px] font-bold transition-colors active:scale-95 ${confirmClass}">Confirm Import</button>
            `;
        }
        if (ctx.state === STATE_ERROR) {
            const closeBtn = showStandaloneClose
                ? `<button type="button" data-bsi-close class="ml-auto rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13px] font-bold text-gray-700 transition-colors hover:bg-gray-50 active:scale-95">Close</button>`
                : `<span class="ml-auto"></span>`;
            return `
                ${closeBtn}
                <button type="button" data-bsi-retry class="rounded-xl bg-[#EA580C] px-5 py-3 text-[13px] font-bold text-white transition-colors hover:bg-[#D44400] active:scale-95">Try again</button>
            `;
        }
        const stageDisabled = !ctx.file ? 'disabled' : '';
        const stageClass = ctx.file
            ? 'bg-[#EA580C] text-white hover:bg-[#D44400]'
            : 'bg-gray-200 text-gray-500 cursor-not-allowed';
        const cancelBtn = showStandaloneClose
            ? `<button type="button" data-bsi-close class="ml-auto rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13px] font-bold text-gray-700 transition-colors hover:bg-gray-50 active:scale-95">Cancel</button>`
            : `<span class="ml-auto"></span>`;
        return `
            ${cancelBtn}
            <button type="button" data-bsi-stage ${stageDisabled} class="rounded-xl px-5 py-3 text-[13px] font-bold transition-colors active:scale-95 ${stageClass}">Stage statement</button>
        `;
    }

    function renderContent(ctx) {
        if (!ctx.contentEl || !ctx.footerEl) return;
        if (ctx.state === STATE_UPLOADING) ctx.contentEl.innerHTML = uploadingStepMarkup(ctx);
        else if (ctx.state === STATE_PROCESSING) ctx.contentEl.innerHTML = processingStepMarkup(ctx);
        else if (ctx.state === STATE_UPLOADED) ctx.contentEl.innerHTML = uploadedStepMarkup(ctx);
        else if (ctx.state === STATE_IMPORTED) ctx.contentEl.innerHTML = importedStepMarkup(ctx);
        else if (ctx.state === STATE_ERROR) ctx.contentEl.innerHTML = errorStepMarkup(ctx);
        else ctx.contentEl.innerHTML = uploadStepMarkup(ctx);
        ctx.footerEl.innerHTML = footerMarkup(ctx);
        attachStepHandlers(ctx);
    }

    function attachStepHandlers(ctx) {
        const fileInput = ctx.contentEl.querySelector('[data-bsi-file-input]');
        if (fileInput) {
            // Wire the visible label to the hidden file input (id-free so multiple instances can coexist).
            const labelEl = ctx.contentEl.querySelector('[data-bsi-file-label]');
            if (labelEl) labelEl.onclick = (e) => { e.preventDefault(); fileInput.click(); };
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
        ctx.contentEl.querySelectorAll('[data-bsi-clear-file]').forEach(btn => {
            btn.onclick = () => {
                ctx.file = null;
                ctx.errorMessage = '';
                renderContent(ctx);
            };
        });
        ctx.footerEl.querySelectorAll('[data-bsi-stage]').forEach(btn => {
            btn.onclick = () => stageImport(ctx);
        });
        ctx.footerEl.querySelectorAll('[data-bsi-reject]').forEach(btn => {
            btn.onclick = () => rejectDraft(ctx);
        });
        ctx.footerEl.querySelectorAll('[data-bsi-confirm]').forEach(btn => {
            btn.onclick = () => runConfirm(ctx);
        });
        ctx.footerEl.querySelectorAll('[data-bsi-retry]').forEach(btn => {
            btn.onclick = () => {
                if (ctx.canRetryExtraction && ctx.draft?.id) { startExtraction(ctx); return; }
                ctx.state = STATE_DEFAULT;
                ctx.errorMessage = '';
                ctx.canRetryExtraction = false;
                renderContent(ctx);
            };
        });

        // Review-table interactions (in-memory; persisted to Firestore on confirm).
        const findRow = (el) => {
            const id = el.closest('[data-bsi-row]')?.getAttribute('data-bsi-row');
            return (ctx.rows || []).find(r => r.id === id);
        };
        ctx.contentEl.querySelectorAll('[data-bsi-select]').forEach(cb => {
            cb.onchange = () => {
                const row = findRow(cb);
                if (row) { row.selected_for_import = cb.checked; ctx.ds?.updateBankStatementRow?.(ctx.user?.uid, ctx.draft?.id, row.id, { selected_for_import: cb.checked }).catch(() => {}); }
                ctx.footerEl.innerHTML = footerMarkup(ctx);
                attachStepHandlers(ctx);
            };
        });
        ctx.contentEl.querySelectorAll('[data-bsi-type]').forEach(sel => {
            sel.onchange = () => {
                const row = findRow(sel);
                if (row) { row.suggested_type = sel.value; ctx.ds?.updateBankStatementRow?.(ctx.user?.uid, ctx.draft?.id, row.id, { suggested_type: sel.value }).catch(() => {}); }
            };
        });
        ctx.contentEl.querySelectorAll('[data-bsi-cat]').forEach(sel => {
            sel.onchange = () => {
                const row = findRow(sel);
                if (row) { row.suggested_category = sel.value; ctx.ds?.updateBankStatementRow?.(ctx.user?.uid, ctx.draft?.id, row.id, { suggested_category: sel.value }).catch(() => {}); }
            };
        });
        ctx.contentEl.querySelectorAll('[data-bsi-prev]').forEach(btn => {
            btn.onclick = () => { ctx.page = Math.max(0, (ctx.page || 0) - 1); renderContent(ctx); };
        });
        ctx.contentEl.querySelectorAll('[data-bsi-next]').forEach(btn => {
            btn.onclick = () => { ctx.page = (ctx.page || 0) + 1; renderContent(ctx); };
        });
        ctx.contentEl.querySelectorAll('[data-bsi-skip-dupes]').forEach(btn => {
            btn.onclick = () => {
                (ctx.rows || []).forEach(r => { if (r.match_status === 'possible_duplicate') r.selected_for_import = false; });
                renderContent(ctx);
            };
        });
    }

    function resolveUser(ctx) {
        return ctx.user || ctx.auth?.currentUser || null;
    }

    async function stageImport(ctx) {
        const validation = validateFile(ctx.file);
        if (!validation.ok) {
            ctx.errorMessage = validation.message;
            renderContent(ctx);
            return;
        }
        const user = resolveUser(ctx);
        if (!user || !ctx.ds) {
            ctx.state = STATE_ERROR;
            ctx.errorMessage = 'You need to be signed in to import a bank statement.';
            renderContent(ctx);
            return;
        }
        ctx.user = user;

        ctx.state = STATE_UPLOADING;
        renderContent(ctx);

        try {
            const draft = await ctx.ds.createBankStatementImport(user.uid, {
                file_name: ctx.file.name,
                file_mime_type: ctx.file.type || 'application/octet-stream',
                file_size: ctx.file.size,
                extraction_status: 'pending',
                review_status: 'draft'
            });

            const uploadResult = await ctx.ds.uploadBankStatementFile(user.uid, draft.id, ctx.file);

            await ctx.ds.updateBankStatementImport(user.uid, draft.id, {
                storage_path: uploadResult.storagePath
            });

            const refreshed = await ctx.ds.getBankStatementImport(user.uid, draft.id);
            ctx.draft = refreshed || { ...draft, storage_path: uploadResult.storagePath };
            // Hand off to backend extraction; the panel watches the draft for the result.
            await startExtraction(ctx);
        } catch (error) {
            console.warn('Bank statement import failed:', error?.message || error);
            if (String(error?.code || '').includes('storage_limit')) {
                window.FluxyAccessGuard?.showSubscriptionLimitModal?.({
                    title: error.code === 'trial_storage_limit_reached' ? 'Trial storage limit reached' : 'Storage limit reached',
                    body: error?.message || 'Choose a plan to import more files.',
                    confirmLabel: error.code === 'trial_storage_limit_reached' ? 'Activate subscription' : 'Upgrade plan'
                });
            }
            ctx.state = STATE_ERROR;
            ctx.errorMessage = error?.code === 'permission-denied'
                ? 'You do not have permission to import bank statements. Sign in again and retry.'
                : (error?.message || 'Something went wrong while uploading the statement.');
            renderContent(ctx);
        }
    }

    function stopWatch(ctx) {
        if (ctx._unwatch) { try { ctx._unwatch(); } catch (_) {} ctx._unwatch = null; }
        if (ctx._timeout) { clearTimeout(ctx._timeout); ctx._timeout = null; }
    }

    // Trigger backend extraction and watch the draft until it completes or fails.
    async function startExtraction(ctx) {
        const user = resolveUser(ctx);
        if (!user || !ctx.ds || !ctx.draft?.id) return;
        ctx.user = user;
        stopWatch(ctx);
        ctx.canRetryExtraction = false;
        ctx.state = STATE_PROCESSING;
        renderContent(ctx);

        try {
            const idToken = await user.getIdToken();
            await ctx.ds.requestBankStatementExtraction(ctx.draft.id, idToken);
        } catch (error) {
            ctx.state = STATE_ERROR;
            ctx.errorMessage = MANUAL_REVIEW_MESSAGE;
            ctx.canRetryExtraction = true;
            renderContent(ctx);
            return;
        }

        ctx._unwatch = ctx.ds.watchBankStatementImport(user.uid, ctx.draft.id, (draft) => {
            onDraftUpdate(ctx, draft);
        });
        ctx._timeout = setTimeout(() => {
            if (ctx.state === STATE_PROCESSING) {
                stopWatch(ctx);
                ctx.state = STATE_ERROR;
                ctx.errorMessage = 'Extraction is taking longer than expected. Try again, or use a CSV/XLSX export from your bank.';
                ctx.canRetryExtraction = true;
                renderContent(ctx);
            }
        }, EXTRACTION_TIMEOUT_MS);
    }

    async function onDraftUpdate(ctx, draft) {
        if (!draft) return;
        ctx.draft = draft;
        if (draft.extraction_status === 'completed') {
            stopWatch(ctx);
            try { ctx.rows = await ctx.ds.getBankStatementRows(ctx.user.uid, ctx.draft.id); }
            catch (_) { ctx.rows = []; }
            ctx.page = 0;
            ctx.state = STATE_UPLOADED;
            renderContent(ctx);
            window.showToast?.('Statement read. Review the rows, then confirm to import.', 'success');
        } else if (draft.extraction_status === 'failed') {
            stopWatch(ctx);
            ctx.state = STATE_ERROR;
            ctx.errorMessage = MANUAL_REVIEW_MESSAGE;
            ctx.canRetryExtraction = true;
            renderContent(ctx);
        }
        // 'pending' / 'processing' keep the spinner up.
    }

    async function runConfirm(ctx) {
        const user = resolveUser(ctx);
        if (!user || !ctx.ds || !ctx.draft?.id) return;
        const count = selectedCount(ctx.rows);
        if (count === 0) return;
        const dupSkipped = (ctx.rows || []).filter(r => r.match_status === 'possible_duplicate' && !isImportableRow(r)).length;
        const body = `This adds <strong>${count}</strong> transaction${count === 1 ? '' : 's'} to your Ledger`
            + (dupSkipped ? `, skipping <strong>${dupSkipped}</strong> possible duplicate${dupSkipped === 1 ? '' : 's'}` : '')
            + '. Balances are not changed and this can be edited in the Ledger afterwards.';
        const ok = await (window.showConfirmDialog
            ? window.showConfirmDialog({ title: 'Import these transactions?', body, confirmLabel: 'Confirm Import', cancelLabel: 'Cancel', tone: 'default' })
            : Promise.resolve(window.confirm(`Import ${count} transactions?`)));
        if (!ok) return;
        try {
            const result = await ctx.ds.confirmBankStatementImport(user.uid, ctx.draft.id, ctx.rows);
            ctx.importedCount = result?.created ?? count;
            ctx.state = STATE_IMPORTED;
            renderContent(ctx);
            window.showToast?.(`${ctx.importedCount} transaction${ctx.importedCount === 1 ? '' : 's'} imported to your Ledger.`, 'success');
            window.dispatchEvent(new CustomEvent('fluxy:bank-statement-imported', { detail: { count: ctx.importedCount } }));
        } catch (error) {
            console.warn('Bank statement confirm failed:', error?.message || error);
            window.showToast?.('Could not import the transactions. Try again.', 'error');
        }
    }

    async function rejectDraft(ctx) {
        const user = resolveUser(ctx);
        if (!ctx.draft?.id || !user || !ctx.ds) return;
        try {
            stopWatch(ctx);
            await ctx.ds.updateBankStatementImport(user.uid, ctx.draft.id, {
                review_status: 'rejected'
            });
            ctx.draft = { ...ctx.draft, review_status: 'rejected' };
            renderContent(ctx);
            window.showToast?.('Bank statement draft rejected.', 'info');
        } catch (error) {
            window.showToast?.('Could not reject the draft. Try again.', 'error');
        }
    }

    function mount(options = {}) {
        const { contentEl, footerEl } = options;
        if (!contentEl || !footerEl) {
            throw new Error('FluxyBankStatementImport.mount requires { contentEl, footerEl }.');
        }
        const ctx = {
            app: options.app || null,
            auth: options.auth || null,
            ds: options.ds || null,
            user: options.user || options.auth?.currentUser || null,
            contentEl,
            footerEl,
            closable: !!options.closable,
            file: null,
            draft: null,
            rows: [],
            state: STATE_DEFAULT,
            errorMessage: ''
        };
        if (options.onClose && ctx.closable) {
            contentEl.__bsiOnClose = options.onClose;
        }
        renderContent(ctx);
        // Close button (only present when ctx.closable) routes through the
        // optional onClose callback.
        ctx.footerEl.addEventListener('click', (event) => {
            if (event.target.closest?.('[data-bsi-close]')) {
                options.onClose?.();
            }
        });
        return {
            destroy: () => {
                stopWatch(ctx);
                contentEl.innerHTML = '';
                footerEl.innerHTML = '';
            },
            getState: () => ctx.state,
            getDraftId: () => ctx.draft?.id || null
        };
    }

    // Standalone right-side drawer (kept for callers that want a self-contained launcher).
    function openDrawer(options = {}) {
        if (standaloneMounted) return;
        const wrapper = document.createElement('div');
        wrapper.id = 'bsi-modal';
        wrapper.className = 'fixed inset-0 z-[100] flex justify-end overflow-hidden';
        wrapper.innerHTML = `
            <div id="bsi-overlay" class="absolute inset-0 bg-black/55 opacity-0 transition-opacity duration-300 ease-out" data-bsi-close></div>
            <div id="bsi-drawer" role="dialog" aria-modal="true" aria-labelledby="bsi-title" class="relative z-10 ml-auto flex h-full w-full max-w-[520px] translate-x-full flex-col overflow-hidden bg-white shadow-2xl transition-transform duration-300 ease-out">
                <div class="flex items-start justify-between gap-4 border-b border-gray-100 bg-gray-50/50 px-6 py-5">
                    <div class="min-w-0">
                        <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">Bank statement</p>
                        <h3 id="bsi-title" class="mt-1 text-lg font-bold text-gray-900">Import Bank Statement</h3>
                        <p class="mt-1 text-[12px] text-gray-500">Upload, review the extracted rows, then confirm. Nothing is saved to your ledger or bank balance without explicit confirmation.</p>
                    </div>
                    <button type="button" data-bsi-close class="flex-shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600" aria-label="Close">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div id="bsi-content" class="flex-1 overflow-y-auto px-6 py-5"></div>
                <div id="bsi-footer" class="flex flex-shrink-0 items-center gap-3 border-t border-gray-100 bg-white/95 px-6 py-4 shadow-[0_-12px_24px_rgba(15,23,42,0.06)]"></div>
            </div>`;
        document.body.appendChild(wrapper);
        document.body.classList.add('overflow-hidden');
        standaloneMounted = wrapper;
        window.requestAnimationFrame(() => {
            wrapper.querySelector('#bsi-overlay')?.classList.remove('opacity-0');
            wrapper.querySelector('#bsi-overlay')?.classList.add('opacity-100');
            wrapper.querySelector('#bsi-drawer')?.classList.remove('translate-x-full');
        });

        const escapeHandler = (event) => { if (event.key === 'Escape') closeDrawer(); };
        document.addEventListener('keydown', escapeHandler);
        wrapper.__bsiEscapeHandler = escapeHandler;

        wrapper.addEventListener('click', (event) => {
            if (event.target.closest?.('[data-bsi-close]')) closeDrawer();
        });

        wrapper.__bsiController = mount({
            contentEl: wrapper.querySelector('#bsi-content'),
            footerEl: wrapper.querySelector('#bsi-footer'),
            app: options.app,
            auth: options.auth,
            ds: options.ds,
            user: options.user,
            closable: false
        });
    }

    function closeDrawer() {
        if (!standaloneMounted) return;
        const wrapper = standaloneMounted;
        standaloneMounted = null;
        document.body.classList.remove('overflow-hidden');
        wrapper.querySelector('#bsi-overlay')?.classList.remove('opacity-100');
        wrapper.querySelector('#bsi-overlay')?.classList.add('opacity-0');
        wrapper.querySelector('#bsi-drawer')?.classList.add('translate-x-full');
        if (wrapper.__bsiEscapeHandler) {
            document.removeEventListener('keydown', wrapper.__bsiEscapeHandler);
        }
        try { wrapper.__bsiController?.destroy(); } catch (_) {}
        setTimeout(() => {
            if (wrapper && wrapper.parentElement) wrapper.parentElement.removeChild(wrapper);
        }, 280);
    }

    window.FluxyBankStatementImport = {
        mount,
        open: openDrawer,
        close: closeDrawer
    };
})();
