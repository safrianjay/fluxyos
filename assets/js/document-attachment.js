/**
 * FluxyOS Shared Document Attachment (Phase 1)
 *
 * One place to validate, upload, and link receipts / invoices / proof
 * documents to transactions and bills. Reused by:
 *
 *   - Add Transaction drawer (shared-dashboard.js)
 *   - Add Revenue drawer (same drawer, different label)
 *   - Bill Details drawer (bill.html)
 *
 * Phase 2+ AI extraction is intentionally out of scope here — the upload
 * sets `extraction_status = 'not_requested'`, leaving room for a backend
 * /api/v1/documents/extract endpoint to flip it later.
 */
(function () {
    if (window.FluxyDocumentAttachment) return;

    const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
    const MAX_BYTES = 5 * 1024 * 1024;

    const ROLE_LABELS = {
        receipt: {
            blockLabel: 'Receipt (optional)',
            defaultText: 'Attach receipt image or PDF',
            helper: 'JPG, PNG, WebP, or PDF · Max 5 MB'
        },
        revenue_proof: {
            blockLabel: 'Proof / document (optional)',
            defaultText: 'Attach proof of income',
            helper: 'JPG, PNG, WebP, or PDF · Max 5 MB · Payment screenshot, transfer proof, payout report.'
        },
        invoice: {
            blockLabel: 'Attach invoice',
            defaultText: 'Attach invoice file',
            helper: 'JPG, PNG, WebP, or PDF · Max 5 MB'
        },
        payment_proof: {
            blockLabel: 'Payment proof (optional)',
            defaultText: 'Attach payment proof',
            helper: 'JPG, PNG, WebP, or PDF · Max 5 MB'
        }
    };

    function labelFor(role) {
        return ROLE_LABELS[role] || ROLE_LABELS.receipt;
    }

    // Module-scoped pending state for the drawer-mounted single-attachment flow.
    // Bill detail flow does not use this (records exist; it goes straight to the
    // server). reset() clears it when the drawer closes.
    let pending = { file: null };

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return '';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function validateFile(file) {
        if (!file) return { ok: false, error: 'empty', message: 'No file selected.' };
        if (!ALLOWED_MIME.has(file.type)) {
            return {
                ok: false,
                error: 'unsupported_type',
                message: 'This file type is not supported. Please upload JPG, PNG, WebP, or PDF.'
            };
        }
        if (file.size > MAX_BYTES) {
            return {
                ok: false,
                error: 'too_large',
                message: 'This file is too large. Please compress it and try again.'
            };
        }
        if (file.size <= 0) {
            return { ok: false, error: 'empty', message: 'This file looks empty. Please try again.' };
        }
        return { ok: true };
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

    /**
     * Bring a file under the 5 MB document cap without losing the record.
     *
     * Originals are preferred (they are the audit evidence), so a file that
     * already fits is returned untouched. Oversized images are re-encoded with
     * the shared compressor; anything else — an oversized PDF — cannot be
     * shrunk client-side, so the caller is told to skip the attachment rather
     * than fail the save.
     */
    async function fitFileForUpload(file) {
        if (!file) return { file: null, reason: 'empty' };
        if (!ALLOWED_MIME.has(file.type)) return { file: null, reason: 'unsupported_type' };
        if (file.size > 0 && file.size <= MAX_BYTES) return { file, compressed: false };
        if (file.size <= 0) return { file: null, reason: 'empty' };

        if (file.type.startsWith('image/') && typeof window.__compressReceiptImage === 'function') {
            try {
                const smaller = await window.__compressReceiptImage(file);
                if (smaller && smaller.size > 0 && smaller.size <= MAX_BYTES) {
                    return { file: smaller, compressed: true };
                }
            } catch (_) { /* fall through to too_large */ }
        }
        return { file: null, reason: 'too_large' };
    }

    /**
     * SHA-256 of the file bytes, hex (docs/DUPLICATE_PREVENTION.md).
     *
     * Hashing the file the user actually uploads is the one duplicate signal
     * that carries no judgement: identical bytes are the same document, not a
     * similar one. Returns null rather than throwing — `crypto.subtle` needs a
     * secure context, and a duplicate check must never cost someone their
     * attachment.
     */
    async function hashFile(file) {
        try {
            if (!file || !window.crypto?.subtle) return null;
            const buffer = await file.arrayBuffer();
            const digest = await window.crypto.subtle.digest('SHA-256', buffer);
            return Array.from(new Uint8Array(digest))
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('');
        } catch (_) {
            return null;
        }
    }

    function maybeShowPlanLimit(error) {
        const code = String(error?.code || '');
        if (!code.includes('storage_limit')) return;
        window.FluxyAccessGuard?.showSubscriptionLimitModal?.({
            title: code === 'trial_storage_limit_reached' ? 'Trial storage limit reached' : 'Storage limit reached',
            body: error?.message || 'Choose a plan to upload more documents.',
            confirmLabel: code === 'trial_storage_limit_reached' ? 'Activate subscription' : 'Upgrade plan'
        });
    }

    /**
     * Mount the single-attachment UI inside a host element (used by the
     * Add Transaction / Add Revenue drawer).
     *
     * Returns a controller for the host to call from its submit flow.
     */
    function mount({ hostEl, role = 'receipt', sourceContext = 'transaction' }) {
        if (!hostEl) throw new Error('FluxyDocumentAttachment.mount requires hostEl.');
        const label = labelFor(role);
        const blockId = `fluxy-doc-attach-${Math.random().toString(36).slice(2, 8)}`;

        hostEl.innerHTML = `
            <label class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">${escapeHtml(label.blockLabel)}</label>
            <label id="${blockId}-trigger" for="${blockId}-file" class="flex items-center gap-3 px-4 py-3 bg-gray-50 border border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-gray-400 transition-colors">
                <svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path></svg>
                <span id="${blockId}-name" class="text-[13px] text-gray-500 truncate flex-1">${escapeHtml(label.defaultText)}</span>
                <span id="${blockId}-size" class="hidden text-[11px] font-mono text-gray-400"></span>
                <button type="button" id="${blockId}-remove" class="hidden text-gray-400 hover:text-red-500 transition-colors" aria-label="Remove attachment">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </label>
            <input type="file" id="${blockId}-file" accept="image/jpeg,image/png,image/webp,application/pdf" class="sr-only">
            <div id="${blockId}-preview-wrap" class="hidden mt-2">
                <img id="${blockId}-preview" src="" alt="Attachment preview" class="w-full rounded-xl border border-gray-200 object-contain max-h-48">
            </div>
            <p id="${blockId}-helper" class="mt-1.5 text-[11px] text-gray-400">${escapeHtml(label.helper)}</p>
            <p id="${blockId}-error" class="hidden mt-1.5 text-[11px] font-medium text-red-600"></p>
        `;

        const fileInput = document.getElementById(`${blockId}-file`);
        const nameEl = document.getElementById(`${blockId}-name`);
        const sizeEl = document.getElementById(`${blockId}-size`);
        const removeBtn = document.getElementById(`${blockId}-remove`);
        const previewWrap = document.getElementById(`${blockId}-preview-wrap`);
        const previewImg = document.getElementById(`${blockId}-preview`);
        const errorEl = document.getElementById(`${blockId}-error`);

        function clearError() {
            errorEl.textContent = '';
            errorEl.classList.add('hidden');
        }

        function showError(message) {
            errorEl.textContent = message;
            errorEl.classList.remove('hidden');
        }

        function renderEmpty() {
            nameEl.textContent = label.defaultText;
            sizeEl.textContent = '';
            sizeEl.classList.add('hidden');
            removeBtn.classList.add('hidden');
            if (previewImg.src) {
                try { URL.revokeObjectURL(previewImg.src); } catch (_) { /* noop */ }
            }
            previewImg.src = '';
            previewWrap.classList.add('hidden');
        }

        function renderSelected(file) {
            nameEl.textContent = file.name;
            sizeEl.textContent = formatBytes(file.size);
            sizeEl.classList.remove('hidden');
            removeBtn.classList.remove('hidden');
            if (file.type.startsWith('image/')) {
                if (previewImg.src) {
                    try { URL.revokeObjectURL(previewImg.src); } catch (_) { /* noop */ }
                }
                previewImg.src = URL.createObjectURL(file);
                previewWrap.classList.remove('hidden');
            } else {
                previewImg.src = '';
                previewWrap.classList.add('hidden');
            }
        }

        fileInput.addEventListener('change', () => {
            clearError();
            const file = fileInput.files?.[0];
            if (!file) return;
            const check = validateFile(file);
            if (!check.ok) {
                showError(check.message);
                fileInput.value = '';
                pending = { file: null };
                renderEmpty();
                return;
            }
            pending = { file, role, sourceContext };
            renderSelected(file);
        });

        removeBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            fileInput.value = '';
            pending = { file: null };
            renderEmpty();
            clearError();
        });

        return {
            getPendingFile: () => pending.file,
            clear: () => {
                fileInput.value = '';
                pending = { file: null };
                renderEmpty();
                clearError();
            },
            showError
        };
    }

    /**
     * Upload + write metadata for the new-record path used by the Add
     * Transaction / Add Revenue drawer. The caller then folds
     * `attachmentForArray` into the transaction payload so the rule's
     * `hasOnly` list sees one write, not an update right after create.
     */
    async function prepareAttachmentForNewRecord({ ds, userId, file, role, sourceContext, Timestamp }) {
        const check = validateFile(file);
        if (!check.ok) throw new Error(check.message);

        let uploaded;
        try {
            uploaded = await ds.uploadDocument(userId, file);
        } catch (error) {
            maybeShowPlanLimit(error);
            throw error;
        }
        await ds.addDocumentMetadata(userId, uploaded.documentId, {
            file_name: uploaded.fileName,
            file_mime_type: uploaded.fileMimeType,
            file_size: uploaded.fileSize,
            storage_path: uploaded.storagePath,
            document_role: role,
            source_context: sourceContext,
            file_hash: await hashFile(file),
            upload_status: 'uploaded'
        });

        const attachedAt = Timestamp ? Timestamp.now() : null;
        return {
            documentId: uploaded.documentId,
            storagePath: uploaded.storagePath,
            downloadURL: uploaded.downloadURL,
            attachmentForArray: {
                document_id: uploaded.documentId,
                role,
                storage_path: uploaded.storagePath,
                attached_at: attachedAt
            }
        };
    }

    /**
     * Upload + metadata + attach onto an existing record. Used by the bill
     * drawer's Attach Invoice flow.
     */
    async function attachToExistingRecord({ ds, userId, file, role, sourceContext, targetCollection, targetId, Timestamp, clearMissingReceiptStatus = false, currentStatus = null }) {
        const check = validateFile(file);
        if (!check.ok) throw new Error(check.message);

        let uploaded;
        try {
            uploaded = await ds.uploadDocument(userId, file);
        } catch (error) {
            maybeShowPlanLimit(error);
            throw error;
        }
        await ds.addDocumentMetadata(userId, uploaded.documentId, {
            file_name: uploaded.fileName,
            file_mime_type: uploaded.fileMimeType,
            file_size: uploaded.fileSize,
            storage_path: uploaded.storagePath,
            document_role: role,
            source_context: sourceContext,
            target_collection: targetCollection,
            target_id: targetId,
            file_hash: await hashFile(file),
            upload_status: 'uploaded'
        });

        const attachment = {
            document_id: uploaded.documentId,
            role,
            storage_path: uploaded.storagePath,
            attached_at: Timestamp ? Timestamp.now() : null
        };
        const attachResult = await ds.attachDocumentToRecord(
            userId, targetCollection, targetId, attachment,
            // No legacyReceiptUrl: receipt_url stored a PUBLIC download URL in
            // Firestore. attached_documents carries the storage_path instead.
            { clearMissingReceiptStatus, currentStatus }
        );

        try {
            await ds.addAuditLog(userId, {
                action: 'document.attached',
                target_collection: 'documents',
                target_id: uploaded.documentId,
                after: {
                    role,
                    source_context: sourceContext,
                    target_collection: targetCollection,
                    target_id: targetId
                },
                source: 'dashboard'
            });
        } catch (_) {
            // Audit failure should not block the user-facing attachment.
        }

        return {
            documentId: uploaded.documentId,
            storagePath: uploaded.storagePath,
            attachment,
            downloadURL: uploaded.downloadURL || null,
            statusCompleted: !!attachResult?.statusCompleted
        };
    }

    // ── Attachments section (record detail views) ────────────────────────────
    //
    // One component for every detail surface that shows what is attached to a
    // saved record. Replaces the read-only filename lists that used to be
    // duplicated in ledger.html and bill.html, and the ledger's hand-rolled
    // receipt uploader.

    const ICONS = {
        image: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2 1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>',
        file: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>',
        download: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-9-4 4 4m0 0 4-4m-4 4V4"/>',
        replace: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>',
        remove: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>',
        paperclip: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/>'
    };

    const ROLE_CHIPS = {
        receipt: 'Receipt',
        invoice: 'Invoice',
        revenue_proof: 'Proof of income',
        payment_proof: 'Payment proof',
        unknown_finance_document: 'Document'
    };

    function attachmentFileName(entry) {
        if (entry?.file_name) return String(entry.file_name);
        const fromPath = String(entry?.storage_path || '').split('/').pop();
        return fromPath || 'Document';
    }

    function isImageName(name) {
        return /\.(jpe?g|png|webp|gif)$/i.test(String(name || ''));
    }

    // File-type presentation. A PDF and a photo are different things to a user,
    // so the badge says which — and carries the extension rather than a generic
    // sheet-of-paper glyph that reads as "empty".
    function fileKind(name) {
        const ext = String(name || '').split('.').pop().toLowerCase();
        if (isImageName(name)) {
            return { label: ext === 'jpeg' ? 'JPG' : ext.toUpperCase(), badge: 'bg-indigo-50 text-indigo-600' };
        }
        if (ext === 'pdf') return { label: 'PDF', badge: 'bg-red-50 text-red-600' };
        return { label: (ext || 'FILE').slice(0, 4).toUpperCase(), badge: 'bg-gray-100 text-gray-500' };
    }

    function attachedAtMs(entry) {
        const value = entry?.attached_at;
        if (!value) return 0;
        if (typeof value.toMillis === 'function') return value.toMillis();
        if (typeof value.seconds === 'number') return value.seconds * 1000;
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function formatAttachedAt(entry) {
        const ms = attachedAtMs(entry);
        if (!ms) return '';
        try {
            return new Date(ms).toLocaleDateString(window.FluxyMoney.baseLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
        } catch (_) {
            return '';
        }
    }

    function iconButton(action, label, path) {
        return `<button type="button" data-doc-act="${action}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"
            class="flex-shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${path}</svg>
        </button>`;
    }

    /**
     * Render (and keep live) the Attachments block for a saved record.
     *
     * Attachment entries carry only document_id / role / storage_path /
     * attached_at, so the filename is derived from the storage path — no extra
     * Firestore reads. Download URLs are resolved once per row after render so
     * the links are real anchors (a URL resolved inside a click handler gets
     * eaten by popup blockers) and images can show a thumbnail.
     */
    function renderAttachmentsSection(options) {
        const {
            hostEl,
            ds,
            userId,
            record,
            targetCollection,
            targetId,
            legacyReceiptUrl = null,
            readOnly = false,
            role = 'receipt',
            sourceContext = 'transaction',
            variant = 'plain',
            note = '',
            onChange = null
        } = options || {};
        if (!hostEl) throw new Error('renderAttachmentsSection requires hostEl.');
        // Pages that already import the Firestore SDK can pass Timestamp; the rest
        // borrow the one DataService re-exports.
        const Timestamp = options.Timestamp || ds?.Timestamp || null;

        let items = Array.isArray(record?.attached_documents)
            ? record.attached_documents.filter(Boolean).slice()
            : [];
        let busy = false;
        let replaceTarget = null;
        const inputId = `fluxy-doc-add-${Math.random().toString(36).slice(2, 8)}`;

        function sorted() {
            // Chronological — oldest first, so the list reads as a paper trail.
            return items.slice().sort((a, b) => attachedAtMs(a) - attachedAtMs(b));
        }

        function rowHtml(entry, index) {
            const name = attachmentFileName(entry);
            const isImage = isImageName(name);
            const when = formatAttachedAt(entry);
            const chip = ROLE_CHIPS[entry.role] || ROLE_CHIPS.unknown_finance_document;
            const meta = [chip, when ? `Attached ${when}` : ''].filter(Boolean).join(' · ');
            const kind = fileKind(name);
            return `
                <div class="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 transition-colors hover:border-gray-300" data-doc-index="${index}" data-doc-id="${escapeHtml(entry.document_id || '')}">
                    <span data-doc-thumb class="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg text-[9px] font-bold tracking-wide ${kind.badge}">${escapeHtml(kind.label)}</span>
                    <div class="min-w-0 flex-1">
                        <a data-doc-act="open" target="_blank" rel="noopener noreferrer"
                            class="pointer-events-none block truncate text-[13px] font-semibold text-gray-400 hover:text-[#EA580C] hover:underline">${escapeHtml(name)}</a>
                        <p data-doc-meta class="truncate text-[11px] text-gray-400">${escapeHtml(meta)}</p>
                    </div>
                    <a data-doc-act="download" download="${escapeHtml(name)}" title="Download" aria-label="Download"
                        class="pointer-events-none flex-shrink-0 rounded-lg p-1.5 text-gray-400 opacity-40 transition-colors hover:bg-gray-100 hover:text-gray-700">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONS.download}</svg>
                    </a>
                    ${readOnly ? '' : iconButton('replace', 'Replace', ICONS.replace) + iconButton('remove', 'Remove attachment', ICONS.remove)}
                </div>`;
        }

        function legacyRowHtml() {
            // Pre-documents receipts stored only a download URL — no document_id
            // exists behind them, so they can be viewed but never detached.
            return `
                <div class="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5" data-doc-legacy>
                    <span class="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100">
                        <img data-legacy-img alt="" class="h-full w-full object-cover">
                    </span>
                    <div class="min-w-0 flex-1">
                        <a data-legacy-open target="_blank" rel="noopener noreferrer"
                            class="block truncate text-[13px] font-semibold text-gray-800 hover:text-[#EA580C] hover:underline">Receipt</a>
                        <p class="truncate text-[11px] text-gray-400">Receipt · Uploaded before document tracking</p>
                    </div>
                    <a data-legacy-open download="receipt" title="Download" aria-label="Download"
                        class="flex-shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONS.download}</svg>
                    </a>
                </div>`;
        }

        // A historical receipt_url is a Firebase media link:
        //   .../o/<url-encoded storage path>?alt=media&token=...
        // The path is recoverable from it, so legacy rows can be served through
        // the SDK like everything else — and keep working once the public
        // download tokens are revoked.
        function legacyStoragePath(url) {
            try {
                const marker = '/o/';
                const i = String(url).indexOf(marker);
                if (i === -1) return null;
                return decodeURIComponent(String(url).slice(i + marker.length).split('?')[0]);
            } catch (_) { return null; }
        }

        async function resolveLegacyRow() {
            const row = hostEl.querySelector('[data-doc-legacy]');
            if (!row || !legacyReceiptUrl) return;
            const path = legacyStoragePath(legacyReceiptUrl);
            if (!path) return;
            try {
                const url = await ds.getDocumentObjectURL(userId, path);
                const img = row.querySelector('[data-legacy-img]');
                if (img) img.src = url;
                row.querySelectorAll('[data-legacy-open]').forEach((a) => { a.href = url; });
            } catch (_) {
                // Access denied or the object is gone — say so rather than leave
                // a dead thumbnail the user will keep clicking.
                row.querySelectorAll('[data-legacy-open]').forEach((a) => {
                    a.removeAttribute('href');
                    a.classList.add('pointer-events-none', 'opacity-40');
                });
            }
        }

        function render() {
            const list = sorted();
            const rows = (legacyReceiptUrl ? legacyRowHtml() : '')
                + list.map(rowHtml).join('');
            const empty = `<p class="text-[13px] text-gray-400">No document attached to this record yet.</p>`;
            const hasAny = !!(list.length || legacyReceiptUrl);
            // Once something is attached, the prominent dropzone would read as
            // "upload this again". It collapses to a quiet secondary action, and
            // per-row Replace covers swapping the file. The file input itself
            // always stays in the DOM — Replace triggers it.
            const dropzone = `
                <label for="${inputId}"
                    class="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 transition-colors hover:border-gray-400 hover:bg-gray-100/60">
                    <svg class="w-4 h-4 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">${ICONS.paperclip}</svg>
                    <span data-doc-add-label class="flex-1 truncate text-[13px] text-gray-500">Attach a document</span>
                </label>
                <p class="text-[11px] text-gray-400">JPG, PNG, WebP, or PDF · Max 5 MB</p>`;
            const compactAdd = `
                <label for="${inputId}"
                    class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 -ml-2 text-[12px] font-semibold text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900">
                    <svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                    <span data-doc-add-label>Add another document</span>
                </label>`;
            // The format/size hint is instructional and belongs with the dropzone.
            // `note` says what attaching *does* (e.g. it does not mark a bill
            // paid) — that stays true with a file already attached, so it shows
            // in both states.
            const adder = readOnly ? '' : `
                ${hasAny ? compactAdd : dropzone}
                <input type="file" id="${inputId}" accept="image/jpeg,image/png,image/webp,application/pdf" class="sr-only">
                ${note ? `<p class="text-[11px] text-gray-400">${escapeHtml(note)}</p>` : ''}
                <p data-doc-error class="hidden text-[11px] font-medium text-red-600"></p>`;

            const body = `
                <div class="space-y-2" data-doc-list>${rows || empty}</div>
                ${adder ? `<div class="mt-3 space-y-1.5">${adder}</div>` : ''}`;

            hostEl.innerHTML = variant === 'drawer-section'
                ? `<section class="fluxy-drawer-section">
                       <h3 class="fluxy-drawer-section-title">Attachments</h3>
                       ${body}
                   </section>`
                : `<div>
                       <p class="text-[12px] font-bold uppercase tracking-wider text-gray-400 mb-2">Attachments</p>
                       ${body}
                   </div>`;

            wire(list);
            resolveUrls(list);
            resolveLegacyRow();
        }

        function showError(message) {
            const el = hostEl.querySelector('[data-doc-error]');
            if (!el) return;
            el.textContent = message;
            el.classList.remove('hidden');
        }

        function clearError() {
            const el = hostEl.querySelector('[data-doc-error]');
            if (!el) return;
            el.textContent = '';
            el.classList.add('hidden');
        }

        // Resolve one download URL per row and fill in the anchors. Failures are
        // reported on the row itself — never as a silent dead link.
        function resolveUrls(list) {
            list.forEach((entry, index) => {
                const row = hostEl.querySelector(`[data-doc-index="${index}"]`);
                if (!row || !entry.storage_path) return;
                // Authorised bytes, not a public link. getDocumentObjectURL fetches
                // through the SDK (storage.rules enforced) and hands back a blob:
                // URL — origin-bound and useless if pasted elsewhere.
                ds.getDocumentObjectURL(userId, entry.storage_path).then((url) => {
                    ds.logDocumentAccess?.(userId, {
                        documentId: entry.document_id, action: 'viewed', targetCollection, targetId
                    });
                    row.querySelectorAll('[data-doc-act="open"], [data-doc-act="download"]').forEach((a) => {
                        a.href = url;
                        a.classList.remove('pointer-events-none', 'opacity-40');
                        if (a.getAttribute('data-doc-act') === 'open') a.classList.replace('text-gray-400', 'text-gray-800');
                    });
                    const openLink = row.querySelector('[data-doc-act="open"]');
                    if (openLink) openLink.dataset.docUrl = url;
                    const name = attachmentFileName(entry);
                    if (isImageName(name)) {
                        const thumb = row.querySelector('[data-doc-thumb]');
                        if (thumb) {
                            // Swap the type badge for a real preview, but keep the
                            // badge as the fallback — a broken image would
                            // otherwise leave an empty grey square.
                            const badge = thumb.innerHTML;
                            const img = document.createElement('img');
                            img.className = 'h-full w-full object-cover';
                            img.alt = '';
                            img.addEventListener('error', () => { thumb.innerHTML = badge; });
                            img.src = url;
                            thumb.innerHTML = '';
                            thumb.appendChild(img);
                        }
                    }
                }).catch(() => {
                    const meta = row.querySelector('[data-doc-meta]');
                    if (meta) meta.textContent = 'This file could not be loaded.';
                });
            });
        }

        async function uploadAndAttach(file) {
            const fitted = await fitFileForUpload(file);
            if (!fitted.file) {
                showError(fitted.reason === 'too_large'
                    ? 'This file is larger than 5 MB. Please compress it and try again.'
                    : (validateFile(file).message || 'This file cannot be attached.'));
                return null;
            }
            const result = await attachToExistingRecord({
                ds,
                userId,
                file: fitted.file,
                role,
                sourceContext,
                targetCollection,
                targetId,
                Timestamp,
                clearMissingReceiptStatus: role === 'receipt',
                currentStatus: record?.status || null
            });
            return result;
        }

        function setBusy(next, label) {
            busy = next;
            const addLabel = hostEl.querySelector('[data-doc-add-label]');
            // The idle text differs between the empty dropzone and the compact
            // "add another" affordance — restore whichever this render is showing.
            const idleLabel = (items.length || legacyReceiptUrl) ? 'Add another document' : 'Attach a document';
            if (addLabel) addLabel.textContent = next ? label : idleLabel;
            hostEl.querySelectorAll('button[data-doc-act], input[type="file"]').forEach((el) => {
                el.disabled = next;
            });
        }

        function notify(extra) {
            if (typeof onChange === 'function') onChange({ attachments: items.slice(), ...extra });
        }

        async function handleAdd(file) {
            clearError();
            setBusy(true, 'Uploading document…');
            try {
                const result = await uploadAndAttach(file);
                if (!result) return;
                items.push(result.attachment);
                if (replaceTarget) {
                    const old = replaceTarget;
                    replaceTarget = null;
                    // Attach first, detach second — a failure here still leaves the
                    // record with a document rather than none.
                    try {
                        await ds.detachDocumentFromRecord(userId, targetCollection, targetId, old);
                        items = items.filter(item => item.document_id !== old.document_id);
                    } catch (err) {
                        console.error('[document-attachment] replace: detach failed', err);
                        window.showToast?.('New document attached, but the old one could not be removed.', 'info');
                    }
                    window.showToast?.('Document replaced.', 'success');
                } else {
                    window.showToast?.('Document attached.', 'success');
                }
                // Render first so the host owns fresh DOM, then tell the page —
                // a listener that re-renders the whole detail view is safe.
                render();
                notify({ statusCompleted: !!result.statusCompleted, receiptUrl: result.downloadURL || null });
            } catch (err) {
                console.error('[document-attachment] attach failed', err);
                maybeShowPlanLimit(err);
                showError(err?.message || 'We could not attach this document. Please try again.');
            } finally {
                replaceTarget = null;
                setBusy(false);
            }
        }

        async function handleRemove(entry) {
            const confirmed = await window.showConfirmDialog?.({
                title: 'Remove this attachment?',
                body: 'It will be unlinked from this record. The file itself is kept for your audit trail.',
                confirmLabel: 'Remove',
                tone: 'danger',
                icon: 'trash'
            });
            if (!confirmed) return;
            clearError();
            setBusy(true, 'Removing…');
            try {
                await ds.detachDocumentFromRecord(userId, targetCollection, targetId, entry);
                items = items.filter(item => item.document_id !== entry.document_id);
                window.showToast?.('Attachment removed.', 'success');
                render();
                notify({});
            } catch (err) {
                console.error('[document-attachment] detach failed', err);
                showError(err?.message || 'We could not remove this attachment. Please try again.');
            } finally {
                setBusy(false);
            }
        }

        function wire(list) {
            const input = hostEl.querySelector(`#${inputId}`);
            if (input) {
                // Cancelling the OS file dialog fires no event, so a Replace the
                // user backed out of would otherwise turn the next plain attach
                // into a replace. Opening the picker from the label clears it.
                hostEl.querySelector(`label[for="${inputId}"]`)?.addEventListener('click', () => {
                    replaceTarget = null;
                    clearError();
                });
                input.addEventListener('change', () => {
                    const file = input.files?.[0];
                    input.value = '';
                    if (file && !busy) handleAdd(file);
                    else replaceTarget = null;
                });
            }
            hostEl.querySelectorAll('a[data-doc-act="download"]').forEach((link) => {
                link.addEventListener('click', async (event) => {
                    const url = link.getAttribute('href');
                    if (!url) return;
                    // Storage URLs are cross-origin, where the `download`
                    // attribute is ignored and the file would simply open in a
                    // tab. Pull the bytes and hand the browser a same-origin
                    // blob so "Download" really downloads. cors.json already
                    // allows GET from the app origins.
                    event.preventDefault();
                    // `url` is already a blob: URL holding the authorised bytes,
                    // so this saves without another network round trip.
                    try {
                        const temp = document.createElement('a');
                        temp.href = url;
                        temp.download = link.getAttribute('download') || 'document';
                        document.body.appendChild(temp);
                        temp.click();
                        temp.remove();
                        ds.logDocumentAccess?.(userId, {
                            documentId: link.closest('[data-doc-index]')?.dataset.docId || '',
                            action: 'downloaded', targetCollection, targetId
                        });
                    } catch (_) {
                        window.open(url, '_blank', 'noopener');
                    }
                });
            });
            hostEl.querySelectorAll('button[data-doc-act]').forEach((btn) => {
                btn.addEventListener('click', (event) => {
                    event.preventDefault();
                    if (busy) return;
                    const index = Number(btn.closest('[data-doc-index]')?.getAttribute('data-doc-index'));
                    const entry = list[index];
                    if (!entry) return;
                    const action = btn.getAttribute('data-doc-act');
                    if (action === 'remove') handleRemove(entry);
                    if (action === 'replace') {
                        replaceTarget = entry;
                        clearError();
                        input?.click();
                    }
                });
            });
        }

        render();

        return {
            refresh: (nextRecord) => {
                items = Array.isArray(nextRecord?.attached_documents)
                    ? nextRecord.attached_documents.filter(Boolean).slice()
                    : [];
                render();
            },
            getAttachments: () => items.slice()
        };
    }

    function reset() {
        pending = { file: null };
    }

    window.FluxyDocumentAttachment = {
        validateFile,
        fitFileForUpload,
        mount,
        prepareAttachmentForNewRecord,
        attachToExistingRecord,
        hashFile,
        renderAttachmentsSection,
        reset,
        ALLOWED_MIME: Array.from(ALLOWED_MIME),
        MAX_BYTES
    };
})();
