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
    async function attachToExistingRecord({ ds, userId, file, role, sourceContext, targetCollection, targetId, Timestamp }) {
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
            upload_status: 'uploaded'
        });

        const attachment = {
            document_id: uploaded.documentId,
            role,
            storage_path: uploaded.storagePath,
            attached_at: Timestamp ? Timestamp.now() : null
        };
        await ds.attachDocumentToRecord(userId, targetCollection, targetId, attachment);

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
            attachment
        };
    }

    function reset() {
        pending = { file: null };
    }

    window.FluxyDocumentAttachment = {
        validateFile,
        mount,
        prepareAttachmentForNewRecord,
        attachToExistingRecord,
        reset,
        ALLOWED_MIME: Array.from(ALLOWED_MIME),
        MAX_BYTES
    };
})();
