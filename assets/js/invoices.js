// FluxyOS Invoices page controller (Create Invoice MVP).
// Three in-page states: list, create/edit workspace (split form + live
// preview), and invoice detail. All reads/writes go through DataService;
// amounts are raw integer Rupiah and a finalized invoice never creates a
// ledger transaction. See docs/fluxyos_create_invoice_feature_plan.md.

const PAGE_SIZE = 10;

const DUE_TERM_DAYS = {
    due_on_receipt: 0,
    due_in_7_days: 7,
    due_in_14_days: 14,
    due_in_30_days: 30
};

const DUE_TERM_LABELS = {
    due_on_receipt: 'Due on receipt',
    due_in_7_days: 'Due in 7 days',
    due_in_14_days: 'Due in 14 days',
    due_in_30_days: 'Due in 30 days',
    custom: 'Custom date'
};

const STATUS_BADGES = {
    draft: { label: 'Draft', cls: 'fluxy-status-neutral' },
    open: { label: 'Open', cls: 'fluxy-status-info' },
    overdue: { label: 'Overdue', cls: 'fluxy-status-danger' },
    paid: { label: 'Paid', cls: 'fluxy-status-success' },
    void: { label: 'Void', cls: 'fluxy-status-neutral' }
};

function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatRp(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 'Rp0';
    return 'Rp' + Math.round(Math.abs(amount)).toLocaleString('id-ID');
}

function formatQty(value) {
    const qty = Number(value) || 0;
    return Number.isInteger(qty) ? String(qty) : qty.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

function toDateObj(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value.toDate === 'function') {
        try { return value.toDate(); } catch { return null; }
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value) {
    const date = toDateObj(value);
    if (!date) return '—';
    return date.toLocaleDateString((window.FluxyI18n?.locale?.()||'en-US'), { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(value) {
    const date = toDateObj(value);
    if (!date) return '';
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function parseAmountInput(raw) {
    return Math.round(Number(String(raw ?? '').replace(/[^\d]/g, '')) || 0);
}

function formatAmountInput(raw) {
    const digits = String(raw ?? '').replace(/\D/g, '');
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function parseQtyInput(raw) {
    const cleaned = String(raw ?? '').replace(',', '.').replace(/[^\d.]/g, '');
    const qty = parseFloat(cleaned);
    return Number.isFinite(qty) ? Math.round(qty * 100) / 100 : 0;
}

// Display status: stored status stays 'open'; the UI renders Overdue when an
// open invoice is past due with an amount still owed.
function displayStatus(invoice) {
    if (invoice.status === 'open') {
        const due = toDateObj(invoice.due_date);
        if (due && Number(invoice.amount_due) > 0) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (due < today) return 'overdue';
        }
    }
    return invoice.status;
}

function statusBadgeHTML(statusKey) {
    const badge = STATUS_BADGES[statusKey] || STATUS_BADGES.draft;
    return `<span class="fluxy-table-status ${badge.cls}">${badge.label}</span>`;
}

export function initInvoicesPage({ ds, user }) {
    const uid = user.uid;
    const el = (id) => document.getElementById(id);

    const views = {
        list: el('invoice-list-view'),
        editor: el('invoice-editor-view'),
        detail: el('invoice-detail-view')
    };

    // ---------- shared state ----------
    let invoices = [];
    let invoicesLoaded = false;
    let businessName = 'Your business';
    let currentPage = 1;
    let searchTerm = '';
    let statusFilter = 'all';
    let detailInvoice = null;
    let detailItems = [];

    // Editor state — the single source of truth for the form + preview.
    const blankEditorState = () => ({
        invoiceId: null,
        invoiceNumber: null,
        status: 'draft',
        customerName: '',
        customerEmail: '',
        items: [],
        dueTerms: 'due_in_30_days',
        customDueKey: null,
        paymentMethod: 'request_payment',
        taxRate: null,
        memo: '',
        footer: '',
        issueDate: new Date(),
        dirty: false,
        saving: false,
        lastSavedAt: null,
        editingItemIndex: null
    });
    let editor = blankEditorState();
    let customDuePicker = null;
    let previewDesktop = true;
    let previewMobile = false;

    // ---------- routing ----------
    function setUrl(params, push = true) {
        const qs = params ? `?${params}` : '';
        const url = `${window.location.pathname}${qs}`;
        if (push) history.pushState({}, '', url);
        else history.replaceState({}, '', url);
    }

    function showView(name) {
        Object.entries(views).forEach(([key, node]) => {
            if (node) node.classList.toggle('hidden', key !== name);
        });
        // The back-to-list link lives in the sticky topbar (top-left of the
        // page) and only shows on the editor + detail sub-views.
        const back = el('invoice-topbar-back');
        if (back) {
            const showBack = name === 'editor' || name === 'detail';
            back.classList.toggle('hidden', !showBack);
            back.classList.toggle('inline-flex', showBack);
        }
        document.querySelector('main .overflow-y-auto')?.scrollTo({ top: 0 });
    }

    // Topbar back link: from the editor it honors the unsaved-changes guard,
    // from the detail view it returns straight to the list.
    el('invoice-topbar-back').addEventListener('click', async () => {
        if (!views.editor.classList.contains('hidden')) {
            if (!(await confirmLeaveEditor())) return;
            editor.dirty = false;
        }
        openList(true);
    });

    async function routeFromUrl(push = false) {
        const params = new URLSearchParams(window.location.search);
        if (params.get('create') === '1') {
            await openEditor(null, push);
        } else if (params.get('edit')) {
            await openEditor(params.get('edit'), push);
        } else if (params.get('invoice')) {
            await openDetail(params.get('invoice'), push);
        } else {
            openList(push);
        }
    }

    window.addEventListener('popstate', () => { routeFromUrl(false); });

    window.addEventListener('beforeunload', (event) => {
        if (editor.dirty && !views.editor.classList.contains('hidden')) {
            event.preventDefault();
            event.returnValue = '';
        }
    });

    async function confirmLeaveEditor() {
        if (!editor.dirty) return true;
        return await window.showConfirmDialog({
            title: 'Leave without saving?',
            body: 'This invoice has unsaved changes. If you leave now, they will be lost.',
            confirmLabel: 'Leave editor',
            cancelLabel: 'Keep editing',
            tone: 'danger'
        });
    }

    // ---------- list view ----------
    function openList(push = true) {
        showView('list');
        if (push) setUrl('', true);
        renderList();
    }

    async function loadInvoices() {
        try {
            invoices = await ds.getInvoices(uid, 200);
            invoicesLoaded = true;
        } catch (error) {
            console.error('[invoices] load failed', error);
            invoicesLoaded = true;
            invoices = [];
            window.showToast?.('Could not load invoices. Check your connection and try again.', 'error');
        }
        el('invoice-list-loading').classList.add('hidden');
        el('invoice-list-content').classList.remove('hidden');
        renderList();
    }

    function filteredInvoices() {
        const term = searchTerm.trim().toLowerCase();
        return invoices.filter((invoice) => {
            const shown = displayStatus(invoice);
            if (statusFilter !== 'all' && shown !== statusFilter) return false;
            if (!term) return true;
            return [invoice.invoice_number, invoice.customer_name, invoice.customer_email, shown]
                .some(field => String(field || '').toLowerCase().includes(term));
        });
    }

    function renderSummary() {
        const open = invoices.filter(i => i.status === 'open');
        const overdue = open.filter(i => displayStatus(i) === 'overdue');
        const drafts = invoices.filter(i => i.status === 'draft');
        const now = new Date();
        const paidThisMonth = invoices.filter((i) => {
            if (i.status !== 'paid') return false;
            const paidAt = toDateObj(i.paid_at);
            return paidAt && paidAt.getFullYear() === now.getFullYear() && paidAt.getMonth() === now.getMonth();
        });
        const openAmount = open.reduce((sum, i) => sum + (Number(i.amount_due) || 0), 0);
        const overdueAmount = overdue.reduce((sum, i) => sum + (Number(i.amount_due) || 0), 0);
        const paidAmount = paidThisMonth.reduce((sum, i) => sum + (Number(i.total_amount) || 0), 0);

        el('invoice-summary-open-count').textContent = String(open.length);
        el('invoice-summary-open-amount').textContent = formatRp(openAmount);
        el('invoice-summary-draft-count').textContent = String(drafts.length);
        el('invoice-summary-due-amount').textContent = formatRp(openAmount);
        el('invoice-summary-overdue-note').textContent = overdue.length
            ? `${overdue.length} overdue · ${formatRp(overdueAmount)}`
            : 'No overdue invoices';
        el('invoice-summary-paid-amount').textContent = formatRp(paidAmount);
        el('invoice-summary-paid-count').textContent = String(paidThisMonth.length);
    }

    function renderList() {
        if (!invoicesLoaded) return;
        renderSummary();
        el('invoice-export-btn').disabled = invoices.length === 0;

        const hasAny = invoices.length > 0;
        el('invoice-empty-state').classList.toggle('hidden', hasAny);
        el('invoice-table-card').classList.toggle('hidden', !hasAny);
        if (!hasAny) return;

        const rows = filteredInvoices();
        const totalPages = Math.max(Math.ceil(rows.length / PAGE_SIZE), 1);
        if (currentPage > totalPages) currentPage = totalPages;
        const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

        const body = el('invoice-table-body');
        if (!rows.length) {
            body.innerHTML = `<tr><td colspan="7" class="fluxy-table-loading-cell">No invoices match your search or filter.</td></tr>`;
        } else {
            body.innerHTML = pageRows.map((invoice) => {
                const shown = displayStatus(invoice);
                const canEdit = invoice.status === 'draft';
                return `
                    <tr class="fluxy-table-row fluxy-table-row-clickable" data-invoice-id="${esc(invoice.id)}">
                        <td class="fluxy-table-cell">
                            <span class="fluxy-table-cell-primary font-mono">${esc(invoice.invoice_number || '—')}</span>
                            <span class="fluxy-table-cell-meta">${esc(invoice.item_count || 0)} item(s)</span>
                        </td>
                        <td class="fluxy-table-cell">
                            <span class="fluxy-table-cell-primary">${esc(invoice.customer_name || 'No customer yet')}</span>
                            <span class="fluxy-table-cell-meta">${esc(invoice.customer_email || '')}</span>
                        </td>
                        <td class="fluxy-table-cell fluxy-table-money">${formatRp(['void', 'paid'].includes(invoice.status) ? 0 : invoice.amount_due)}</td>
                        <td class="fluxy-table-cell">${formatDate(invoice.due_date)}</td>
                        <td class="fluxy-table-cell">${statusBadgeHTML(shown)}</td>
                        <td class="fluxy-table-cell">${formatDate(invoice.updated_at)}</td>
                        <td class="fluxy-table-cell text-right whitespace-nowrap">
                            <button type="button" data-action="view" data-id="${esc(invoice.id)}" class="rounded-lg px-2.5 py-1.5 text-[12px] font-bold text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900">View</button>
                            ${canEdit ? `<button type="button" data-action="edit" data-id="${esc(invoice.id)}" class="rounded-lg px-2.5 py-1.5 text-[12px] font-bold text-[#EA580C] transition-colors hover:bg-orange-50">Edit</button>` : ''}
                        </td>
                    </tr>`;
            }).join('');
        }

        const pagination = el('invoice-pagination');
        pagination.classList.toggle('hidden', rows.length <= PAGE_SIZE);
        const from = rows.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
        const to = Math.min(currentPage * PAGE_SIZE, rows.length);
        el('invoice-page-summary').textContent = `Showing ${from}-${to} of ${rows.length} invoices`;
        el('invoice-page-prev').disabled = currentPage <= 1;
        el('invoice-page-next').disabled = currentPage >= totalPages;
    }

    el('invoice-search').addEventListener('input', (event) => {
        searchTerm = event.target.value;
        currentPage = 1;
        renderList();
    });
    el('invoice-status-filter').addEventListener('change', (event) => {
        statusFilter = event.target.value;
        currentPage = 1;
        renderList();
    });
    el('invoice-page-prev').addEventListener('click', () => { currentPage -= 1; renderList(); });
    el('invoice-page-next').addEventListener('click', () => { currentPage += 1; renderList(); });

    el('invoice-table-body').addEventListener('click', (event) => {
        const actionBtn = event.target.closest('[data-action]');
        if (actionBtn) {
            const id = actionBtn.dataset.id;
            if (actionBtn.dataset.action === 'edit') openEditor(id, true);
            else openDetail(id, true);
            return;
        }
        const row = event.target.closest('[data-invoice-id]');
        if (row) openDetail(row.dataset.invoiceId, true);
    });

    el('invoice-create-btn').addEventListener('click', () => openEditor(null, true));
    el('invoice-empty-create-btn').addEventListener('click', () => openEditor(null, true));

    // CSV export — raw integer amounts only, no Rp prefix, no dot separators.
    el('invoice-export-btn').addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        if (!invoices.length || btn.disabled) return;
        btn.disabled = true;
        try {
            const dayKey = (value) => {
                const date = toDateObj(value);
                if (!date) return '';
                return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
            };
            const header = 'invoice_number,status,customer_name,customer_email,issue_date,due_date,currency,subtotal,tax_amount,total_amount,amount_paid,amount_due';
            const csvCell = (value) => {
                const str = String(value ?? '');
                return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
            };
            const lines = invoices.map(invoice => [
                invoice.invoice_number, invoice.status, invoice.customer_name, invoice.customer_email || '',
                dayKey(invoice.issue_date), dayKey(invoice.due_date), invoice.currency || 'IDR',
                Math.round(Number(invoice.subtotal_amount) || 0),
                Math.round(Number(invoice.tax_amount) || 0),
                Math.round(Number(invoice.total_amount) || 0),
                invoice.status === 'paid' ? Math.round(Number(invoice.total_amount) || 0) : 0,
                Math.round(Number(invoice.amount_due) || 0)
            ].map(csvCell).join(','));
            await ds.addAuditLog(uid, {
                action: 'export.create',
                target_collection: 'invoices',
                target_id: '',
                after: { record_count: invoices.length, format: 'csv' },
                source: 'dashboard'
            });
            const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const now = new Date();
            link.href = url;
            link.download = `invoices_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}.csv`;
            link.click();
            URL.revokeObjectURL(url);
            window.showToast?.('Invoice CSV exported.', 'success');
        } catch (error) {
            console.error('[invoices] export failed', error);
            window.showToast?.('Could not export invoices. Try again.', 'error');
        } finally {
            btn.disabled = invoices.length === 0;
        }
    });

    // ---------- editor view ----------
    async function openEditor(invoiceId, push = true) {
        if (!views.editor.classList.contains('hidden') && !(await confirmLeaveEditor())) return;
        editor = blankEditorState();

        if (invoiceId) {
            let invoice = invoices.find(i => i.id === invoiceId) || null;
            try {
                if (!invoice) invoice = await ds.getInvoice(uid, invoiceId);
            } catch (error) {
                console.error('[invoices] open editor failed', error);
            }
            if (!invoice) {
                window.showToast?.('Invoice not found.', 'error');
                openList(true);
                return;
            }
            // Drafts are always editable; a finalized invoice stays editable
            // only while it is "finalize only" (open and not yet marked sent).
            const editableOpen = invoice.status === 'open' && !invoice.sent_at;
            if (invoice.status !== 'draft' && !editableOpen) {
                window.showToast?.('Only draft or unsent invoices can be edited.', 'info');
                openDetail(invoiceId, true);
                return;
            }
            let items = [];
            try {
                items = await ds.getInvoiceItems(uid, invoiceId);
            } catch (error) {
                console.error('[invoices] load items failed', error);
            }
            editor.invoiceId = invoice.id;
            editor.invoiceNumber = invoice.invoice_number || null;
            editor.status = invoice.status || 'draft';
            editor.customerName = invoice.customer_name || '';
            editor.customerEmail = invoice.customer_email || '';
            editor.items = items.map(item => ({
                id: item.id,
                description: item.description,
                quantity: Number(item.quantity) || 1,
                unit_price: Number(item.unit_price) || 0
            }));
            editor.dueTerms = DUE_TERM_LABELS[invoice.due_terms] ? invoice.due_terms : 'due_in_30_days';
            if (editor.dueTerms === 'custom') {
                const due = toDateObj(invoice.due_date);
                editor.customDueKey = due ? window.FluxyDateRangePicker.getDayKey(due) : null;
            }
            editor.paymentMethod = invoice.payment_collection_method === 'manual_only' ? 'manual_only' : 'request_payment';
            editor.taxRate = invoice.tax_rate_percent ?? null;
            editor.memo = invoice.memo || '';
            editor.footer = invoice.footer || '';
            editor.issueDate = toDateObj(invoice.issue_date) || new Date();
            editor.lastSavedAt = toDateObj(invoice.updated_at);
            el('invoice-editor-title').textContent = 'Edit invoice';
            if (push) setUrl(`edit=${encodeURIComponent(invoiceId)}`, true);
        } else {
            el('invoice-editor-title').textContent = 'Create invoice';
            if (push) setUrl('create=1', true);
            // Prefetch the next invoice number so the preview shows the real
            // number before the first save. Best-effort only.
            ds.generateInvoiceNumber(uid)
                .then((number) => {
                    if (!editor.invoiceId && !editor.invoiceNumber) {
                        editor.invoiceNumber = number;
                        updatePreview();
                    }
                })
                .catch(() => {});
        }

        hydrateEditorForm();
        applyEditorMode();
        showView('editor');
        updateEditorStatus();
        updatePreview();
    }

    // A finalized-but-unsent invoice reuses the editor, but there is no second
    // "finalize" step — the primary action just saves the changes in place.
    function applyEditorMode() {
        const editingOpen = editor.status === 'open';
        el('invoice-editor-title').textContent = editor.invoiceId ? 'Edit invoice' : 'Create invoice';
        const primaryLabel = editingOpen ? 'Save changes' : 'Review invoice';
        el('invoice-review-btn').textContent = primaryLabel;
        el('invoice-review-btn-mobile').textContent = primaryLabel;
        ['invoice-save-draft-btn', 'invoice-save-draft-btn-mobile'].forEach((id) => {
            el(id).classList.toggle('hidden', editingOpen);
        });
    }

    function hydrateEditorForm() {
        el('inv-customer-name').value = editor.customerName;
        el('inv-customer-email').value = editor.customerEmail;
        el('inv-due-terms').value = editor.dueTerms;
        // Native select is enhanced by fluxy-select; notify it of the new value.
        el('inv-due-terms').dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelectorAll('input[name="inv-payment-method"]').forEach((radio) => {
            radio.checked = radio.value === editor.paymentMethod;
        });
        el('inv-tax-rate').value = editor.taxRate == null ? '' : String(editor.taxRate);
        el('inv-memo').value = editor.memo;
        el('inv-footer').value = editor.footer;
        closeItemForm();
        renderItemsList();
        syncCustomDueVisibility();
        previewMobile = false;
        previewDesktop = true;
        applyPreviewVisibility();
        // Re-route the just-dispatched change through normal handling so the
        // dirty flag from hydration is cleared last.
        editor.dirty = false;
        updateEditorStatus();
    }

    function markDirty() {
        editor.dirty = true;
        updateEditorStatus();
        updatePreview();
    }

    function updateEditorStatus() {
        const node = el('invoice-editor-status');
        if (editor.saving) node.textContent = 'Saving…';
        else if (editor.dirty) node.textContent = 'Unsaved changes';
        else if (editor.lastSavedAt) node.textContent = `${editor.status === 'open' ? 'Saved' : 'Draft saved'} at ${formatTime(editor.lastSavedAt)}`;
        else node.textContent = 'Not saved yet';
    }

    // Customer + options inputs
    el('inv-customer-name').addEventListener('input', (event) => { editor.customerName = event.target.value; markDirty(); });
    el('inv-customer-email').addEventListener('input', (event) => { editor.customerEmail = event.target.value; markDirty(); });
    el('inv-memo').addEventListener('input', (event) => { editor.memo = event.target.value; markDirty(); });
    el('inv-footer').addEventListener('input', (event) => { editor.footer = event.target.value; markDirty(); });
    el('inv-tax-rate').addEventListener('input', (event) => {
        const cleaned = event.target.value.replace(',', '.').replace(/[^\d.]/g, '');
        event.target.value = cleaned;
        const rate = parseFloat(cleaned);
        editor.taxRate = Number.isFinite(rate) ? Math.min(Math.max(rate, 0), 100) : null;
        markDirty();
    });
    document.querySelectorAll('input[name="inv-payment-method"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            if (radio.checked) { editor.paymentMethod = radio.value; markDirty(); }
        });
    });

    // Due terms + custom date picker
    el('inv-due-terms').addEventListener('change', (event) => {
        const value = event.target.value;
        if (editor.dueTerms === value) { syncCustomDueVisibility(); return; }
        editor.dueTerms = value;
        syncCustomDueVisibility();
        markDirty();
    });

    function syncCustomDueVisibility() {
        const isCustom = editor.dueTerms === 'custom';
        el('inv-custom-due-wrap').classList.toggle('hidden', !isCustom);
        if (isCustom) {
            const picker = window.FluxyDateRangePicker;
            if (!editor.customDueKey) editor.customDueKey = picker.addDays(picker.getDayKey(), 30);
            if (!customDuePicker) {
                customDuePicker = picker.mount(el('inv-custom-due-picker'), {
                    mode: 'single',
                    start: editor.customDueKey,
                    maxDate: picker.addDays(picker.getDayKey(), 1095),
                    onChange: ({ start }) => {
                        editor.customDueKey = start;
                        markDirty();
                    }
                });
            } else {
                customDuePicker.setRange(editor.customDueKey);
            }
        }
        updateDueHint();
    }

    function computeDueDate() {
        if (editor.dueTerms === 'custom') {
            return editor.customDueKey ? window.FluxyDateRangePicker.parseDayKey(editor.customDueKey) : null;
        }
        const days = DUE_TERM_DAYS[editor.dueTerms] ?? 30;
        const due = new Date(editor.issueDate);
        due.setHours(0, 0, 0, 0);
        due.setDate(due.getDate() + days);
        return due;
    }

    function updateDueHint() {
        const due = computeDueDate();
        el('invoice-due-hint').textContent = due
            ? `This invoice will be due on ${formatDate(due)}. FluxyOS will track it as an open receivable after it is finalized.`
            : 'Pick a custom due date to continue.';
    }

    // ---------- items ----------
    function renderItemsList() {
        const list = el('invoice-items-list');
        el('invoice-items-empty').classList.toggle('hidden', editor.items.length > 0);
        list.innerHTML = editor.items.map((item, index) => {
            const amount = Math.round((Number(item.quantity) || 0) * (Number(item.unit_price) || 0));
            return `
                <div class="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2.5">
                    <div class="min-w-0">
                        <p class="truncate text-[14px] font-medium text-gray-900">${esc(item.description)}</p>
                        <p class="text-[12px] text-gray-500"><span class="font-mono">${formatQty(item.quantity)}</span> × <span class="font-mono">${formatRp(item.unit_price)}</span></p>
                    </div>
                    <div class="flex flex-shrink-0 items-center gap-1.5">
                        <span class="font-mono text-[14px] font-semibold text-gray-900">${formatRp(amount)}</span>
                        <button type="button" data-item-edit="${index}" class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700" aria-label="Edit item">
                            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                        </button>
                        <button type="button" data-item-remove="${index}" class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600" aria-label="Remove item">
                            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                    </div>
                </div>`;
        }).join('');
    }

    el('invoice-items-list').addEventListener('click', (event) => {
        const editBtn = event.target.closest('[data-item-edit]');
        if (editBtn) { openItemForm(Number(editBtn.dataset.itemEdit)); return; }
        const removeBtn = event.target.closest('[data-item-remove]');
        if (removeBtn) {
            editor.items.splice(Number(removeBtn.dataset.itemRemove), 1);
            renderItemsList();
            markDirty();
        }
    });

    function openItemForm(index = null) {
        editor.editingItemIndex = index;
        const item = index != null ? editor.items[index] : null;
        el('inv-item-description').value = item ? item.description : '';
        el('inv-item-qty').value = item ? String(item.quantity) : '1';
        el('inv-item-price').value = item ? formatAmountInput(String(item.unit_price)) : '';
        el('invoice-item-form-error').classList.add('hidden');
        el('invoice-item-form').classList.remove('hidden');
        el('invoice-item-add').classList.add('hidden');
        updateItemAmountHint();
        el('inv-item-description').focus();
    }

    function closeItemForm() {
        editor.editingItemIndex = null;
        el('invoice-item-form').classList.add('hidden');
        el('invoice-item-add').classList.remove('hidden');
    }

    function updateItemAmountHint() {
        const qty = parseQtyInput(el('inv-item-qty').value);
        const price = parseAmountInput(el('inv-item-price').value);
        el('invoice-item-amount-hint').textContent = formatRp(Math.round(qty * price));
    }

    el('invoice-item-add').addEventListener('click', () => openItemForm(null));
    el('invoice-item-cancel').addEventListener('click', closeItemForm);
    el('inv-item-price').addEventListener('input', (event) => {
        event.target.value = formatAmountInput(event.target.value);
        updateItemAmountHint();
    });
    el('inv-item-qty').addEventListener('input', updateItemAmountHint);

    el('invoice-item-save').addEventListener('click', () => {
        const description = el('inv-item-description').value.trim();
        const quantity = parseQtyInput(el('inv-item-qty').value);
        const unitPrice = parseAmountInput(el('inv-item-price').value);
        const errorNode = el('invoice-item-form-error');
        let error = '';
        if (!description) error = 'Item description is required.';
        else if (!(quantity > 0)) error = 'Quantity must be greater than zero.';
        else if (!(unitPrice > 0)) error = 'Unit price must be greater than zero.';
        if (error) {
            errorNode.textContent = error;
            errorNode.classList.remove('hidden');
            return;
        }
        const payload = {
            id: editor.editingItemIndex != null ? editor.items[editor.editingItemIndex].id : undefined,
            description,
            quantity,
            unit_price: unitPrice
        };
        if (editor.editingItemIndex != null) editor.items[editor.editingItemIndex] = payload;
        else editor.items.push(payload);
        closeItemForm();
        renderItemsList();
        markDirty();
    });

    // ---------- totals + preview ----------
    function computeTotals() {
        const subtotal = editor.items.reduce(
            (sum, item) => sum + Math.round((Number(item.quantity) || 0) * (Number(item.unit_price) || 0)), 0
        );
        const rate = editor.taxRate == null ? null : editor.taxRate;
        const tax = rate ? Math.round(subtotal * rate / 100) : 0;
        const total = subtotal + tax;
        return { subtotal, rate, tax, total, amountDue: total };
    }

    function updatePreview() {
        if (views.editor.classList.contains('hidden')) return;
        const totals = computeTotals();
        const due = computeDueDate();
        const number = editor.invoiceNumber || 'INV-DRAFT';

        el('pv-business').textContent = businessName;
        el('pv-business-from').textContent = businessName;
        el('pv-number').textContent = number;
        el('pv-issue-date').textContent = formatDate(editor.issueDate);
        el('pv-due-date').textContent = due ? formatDate(due) : '—';
        el('pv-customer-name').textContent = editor.customerName.trim() || 'Customer name';
        el('pv-customer-email').textContent = editor.customerEmail.trim();
        el('pv-amount-line').textContent = `${formatRp(totals.amountDue)} due ${due ? formatDate(due) : '—'}`;

        const memo = editor.memo.trim();
        el('pv-memo').textContent = memo;
        el('pv-memo').classList.toggle('hidden', !memo);
        const footer = editor.footer.trim();
        el('pv-footer').textContent = footer;
        el('pv-footer').classList.toggle('hidden', !footer);

        const body = el('pv-items-body');
        if (!editor.items.length) {
            body.innerHTML = '<tr><td colspan="4" class="py-3 text-center text-gray-400">No line items yet</td></tr>';
        } else {
            body.innerHTML = editor.items.map((item) => {
                const amount = Math.round((Number(item.quantity) || 0) * (Number(item.unit_price) || 0));
                return `
                    <tr class="border-b border-gray-100">
                        <td class="py-2 text-gray-900">${esc(item.description)}</td>
                        <td class="py-2 text-right invoice-doc-money text-gray-700">${formatQty(item.quantity)}</td>
                        <td class="py-2 text-right invoice-doc-money text-gray-700">${formatRp(item.unit_price)}</td>
                        <td class="py-2 text-right invoice-doc-money text-gray-900">${formatRp(amount)}</td>
                    </tr>`;
            }).join('');
        }

        el('pv-subtotal').textContent = formatRp(totals.subtotal);
        el('pv-tax-row').classList.toggle('hidden', !totals.rate);
        el('pv-tax-rate').textContent = totals.rate ? String(totals.rate) : '0';
        el('pv-tax').textContent = formatRp(totals.tax);
        el('pv-total').textContent = formatRp(totals.total);
        el('pv-amount-due').textContent = formatRp(totals.amountDue);
        el('pv-doc-meta').textContent = `${number} · ${formatRp(totals.amountDue)} due ${due ? formatDate(due) : '—'}`;
        updateDueHint();
    }

    function applyPreviewVisibility() {
        const panel = el('invoice-preview-panel');
        panel.classList.toggle('hidden', !previewMobile);
        panel.classList.toggle('lg:block', previewDesktop);
        el('invoice-editor-grid').classList.toggle('lg:grid-cols-2', previewDesktop);
        el('invoice-preview-toggle').textContent = previewMobile ? 'Hide preview' : 'Show preview';
        el('invoice-preview-toggle-desktop').textContent = previewDesktop ? 'Hide preview' : 'Show preview';
    }

    el('invoice-preview-toggle').addEventListener('click', () => {
        previewMobile = !previewMobile;
        applyPreviewVisibility();
        updatePreview();
    });
    el('invoice-preview-toggle-desktop').addEventListener('click', () => {
        previewDesktop = !previewDesktop;
        applyPreviewVisibility();
        updatePreview();
    });

    // ---------- save draft ----------
    function buildInvoicePayload() {
        return {
            customer_name: editor.customerName.trim(),
            customer_email: editor.customerEmail.trim() || null,
            customer_language: 'English',
            issue_date: editor.issueDate,
            due_date: computeDueDate(),
            due_terms: editor.dueTerms,
            items: editor.items,
            tax_rate_percent: editor.taxRate,
            memo: editor.memo.trim() || null,
            footer: editor.footer.trim() || null,
            payment_collection_method: editor.paymentMethod,
            payment_link_enabled: false
        };
    }

    function setSaving(saving) {
        editor.saving = saving;
        ['invoice-save-draft-btn', 'invoice-save-draft-btn-mobile', 'invoice-review-btn', 'invoice-review-btn-mobile']
            .forEach(id => { el(id).disabled = saving; });
        updateEditorStatus();
    }

    async function saveDraft({ silent = false } = {}) {
        if (editor.saving) return false;
        setSaving(true);
        try {
            const payload = buildInvoicePayload();
            if (editor.invoiceId) {
                await ds.updateInvoiceDraft(uid, editor.invoiceId, payload);
            } else {
                if (editor.invoiceNumber) payload.invoice_number = editor.invoiceNumber;
                const created = await ds.createInvoiceDraft(uid, payload);
                editor.invoiceId = created.id;
                editor.invoiceNumber = created.invoice_number;
                setUrl(`edit=${encodeURIComponent(created.id)}`, false);
                el('invoice-editor-title').textContent = 'Edit invoice';
            }
            editor.dirty = false;
            editor.lastSavedAt = new Date();
            invoicesLoaded = false;
            loadInvoices();
            if (!silent) window.showToast?.(editor.status === 'open' ? 'Invoice changes saved.' : 'Invoice draft saved.', 'success');
            return true;
        } catch (error) {
            console.error('[invoices] save draft failed', error);
            window.showToast?.(error?.message || 'Could not save invoice. Check your connection and try again.', 'error');
            return false;
        } finally {
            setSaving(false);
        }
    }

    el('invoice-save-draft-btn').addEventListener('click', () => saveDraft());
    el('invoice-save-draft-btn-mobile').addEventListener('click', () => saveDraft());

    // ---------- review modal ----------
    function finalizeValidationErrors() {
        const errors = [];
        const totals = computeTotals();
        if (!editor.customerName.trim()) errors.push('Customer name is required.');
        if (!editor.items.length) errors.push('Add at least one line item.');
        if (!(totals.total > 0)) errors.push('Invoice total must be greater than zero.');
        if (!computeDueDate()) errors.push('Pick a due date.');
        return errors;
    }

    function openReviewModal() {
        const totals = computeTotals();
        const due = computeDueDate();
        const errors = finalizeValidationErrors();
        const email = editor.customerEmail.trim();

        el('review-title').textContent = editor.customerName.trim()
            ? `Review ${formatRp(totals.amountDue)} invoice for ${editor.customerName.trim()}`
            : `Review ${formatRp(totals.amountDue)} invoice`;
        el('review-customer').textContent = editor.customerName.trim() || '—';
        el('review-email').textContent = email || 'Not provided';
        el('review-due').textContent = due ? formatDate(due) : '—';
        el('review-items-count').textContent = String(editor.items.length);
        el('review-amount').textContent = formatRp(totals.amountDue);
        el('review-method').textContent = editor.paymentMethod === 'manual_only' ? 'Manual only' : 'Request payment';

        const errorNode = el('review-error');
        if (errors.length) {
            errorNode.innerHTML = errors.map(esc).join('<br>');
            errorNode.classList.remove('hidden');
        } else {
            errorNode.classList.add('hidden');
        }
        el('review-email-warning').classList.toggle('hidden', Boolean(email) || errors.length > 0);
        el('review-finalize-btn').disabled = errors.length > 0;
        el('review-finalize-send-btn').disabled = errors.length > 0 || !email;

        // Mirror the live preview document into the modal.
        el('review-preview-host').innerHTML = `<div class="invoice-doc p-5">${el('invoice-preview-doc').innerHTML}</div>`;
        // The clone duplicates preview element ids — strip them so getElementById
        // keeps resolving to the live preview.
        el('review-preview-host').querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));

        const modal = el('invoice-review-modal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.body.style.overflow = 'hidden';
    }

    function closeReviewModal() {
        const modal = el('invoice-review-modal');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.body.style.overflow = '';
    }

    async function handleReviewClick() {
        // Editing a finalized-but-unsent invoice: no review/finalize step, just
        // persist the edits (the invoice stays open) and return to the detail view.
        if (editor.status === 'open') {
            const errors = finalizeValidationErrors();
            if (errors.length) {
                window.showToast?.(errors[0], 'error');
                return;
            }
            const saved = await saveDraft();
            if (saved) openDetail(editor.invoiceId, true);
            return;
        }
        updatePreview();
        openReviewModal();
    }

    el('invoice-review-btn').addEventListener('click', handleReviewClick);
    el('invoice-review-btn-mobile').addEventListener('click', handleReviewClick);
    el('review-cancel').addEventListener('click', closeReviewModal);
    el('review-close').addEventListener('click', closeReviewModal);
    document.querySelector('[data-review-overlay]').addEventListener('click', closeReviewModal);

    async function finalize(markSent) {
        const finalizeBtn = el('review-finalize-btn');
        const sendBtn = el('review-finalize-send-btn');
        finalizeBtn.disabled = true;
        sendBtn.disabled = true;
        try {
            // Persist the latest editor state first so finalize validates the
            // exact document the user reviewed.
            if (editor.dirty || !editor.invoiceId) {
                const saved = await saveDraft({ silent: true });
                if (!saved) return;
            }
            await ds.finalizeInvoice(uid, editor.invoiceId, { markSent });
            editor.dirty = false;
            closeReviewModal();
            window.showToast?.('Invoice finalized and added to receivables.', 'success');
            invoicesLoaded = false;
            await loadInvoices();
            openDetail(editor.invoiceId, true);
        } catch (error) {
            console.error('[invoices] finalize failed', error);
            const errorNode = el('review-error');
            errorNode.textContent = error?.message || 'Could not finalize invoice. Try again.';
            errorNode.classList.remove('hidden');
        } finally {
            finalizeBtn.disabled = false;
            sendBtn.disabled = !editor.customerEmail.trim();
        }
    }

    el('review-finalize-btn').addEventListener('click', () => finalize(false));
    el('review-finalize-send-btn').addEventListener('click', () => finalize(true));

    // ---------- detail view ----------
    async function openDetail(invoiceId, push = true) {
        let invoice = null;
        let items = [];
        try {
            invoice = await ds.getInvoice(uid, invoiceId);
            if (invoice) items = await ds.getInvoiceItems(uid, invoiceId);
        } catch (error) {
            console.error('[invoices] open detail failed', error);
        }
        if (!invoice) {
            window.showToast?.('Invoice not found.', 'error');
            openList(true);
            return;
        }
        detailInvoice = invoice;
        detailItems = items;
        if (push) setUrl(`invoice=${encodeURIComponent(invoiceId)}`, true);
        renderDetail(invoice, items);
        showView('detail');
    }

    // Gmail-compose handoff — opens mail.google.com compose in a new tab,
    // pre-filled with the invoice summary. Works without a configured OS mail
    // app. FluxyOS sends nothing itself; "Mark as sent" stays the explicit
    // delivery stamp.
    function buildInvoiceGmailUrl(invoice, items) {
        const due = formatDate(invoice.due_date);
        const subject = `Invoice ${invoice.invoice_number} from ${businessName}`;
        const itemLines = items.slice(0, 20).map(item =>
            `- ${item.description} — ${formatQty(item.quantity)} × ${formatRp(item.unit_price)} = ${formatRp(item.amount)}`
        );
        if (items.length > 20) itemLines.push(`… and ${items.length - 20} more item(s)`);
        const lines = [
            `Hi ${invoice.customer_name || 'there'},`,
            '',
            `Please find your invoice from ${businessName} below.`,
            '',
            `Invoice number: ${invoice.invoice_number}`,
            `Issue date: ${formatDate(invoice.issue_date)}`,
            `Due date: ${due}`,
            '',
            'Items:',
            ...itemLines,
            '',
            `Total: ${formatRp(invoice.total_amount)}`,
            `Amount due: ${formatRp(invoice.amount_due)} (due ${due})`
        ];
        if (invoice.memo) lines.push('', invoice.memo);
        if (invoice.footer) lines.push('', invoice.footer);
        lines.push('', 'Thank you,', businessName);
        return 'https://mail.google.com/mail/?view=cm&fs=1'
            + `&to=${encodeURIComponent(invoice.customer_email)}`
            + `&su=${encodeURIComponent(subject)}`
            + `&body=${encodeURIComponent(lines.join('\n'))}`;
    }

    function renderDetail(invoice, items) {
        const shown = displayStatus(invoice);
        el('detail-number').textContent = invoice.invoice_number || '—';
        el('detail-status').outerHTML = statusBadgeHTML(shown).replace('<span', '<span id="detail-status"');
        el('detail-customer').textContent = invoice.customer_name || 'No customer';
        el('detail-amount-due').textContent = formatRp(['void', 'paid'].includes(invoice.status) ? 0 : invoice.amount_due);

        const voidBanner = el('detail-void-banner');
        if (invoice.status === 'void') {
            voidBanner.textContent = `Voided${invoice.voided_at ? ` on ${formatDate(invoice.voided_at)}` : ''}${invoice.void_reason ? ` — ${invoice.void_reason}` : ''}`;
            voidBanner.classList.remove('hidden');
        } else {
            voidBanner.classList.add('hidden');
        }

        // Editable while a draft, or while finalized-but-unsent ("finalize only").
        const canEdit = invoice.status === 'draft' || (invoice.status === 'open' && !invoice.sent_at);
        el('detail-edit-btn').classList.toggle('hidden', !canEdit);
        el('detail-edit-btn').classList.toggle('inline-flex', canEdit);
        const canMarkSent = invoice.status === 'open' && !invoice.sent_at;
        el('detail-sent-btn').classList.toggle('hidden', !canMarkSent);
        el('detail-sent-btn').classList.toggle('inline-flex', canMarkSent);
        const canEmail = invoice.status === 'open' && Boolean(invoice.customer_email);
        el('detail-email-btn').classList.toggle('hidden', !canEmail);
        el('detail-email-btn').classList.toggle('inline-flex', canEmail);
        // target="_blank" Gmail compose: a new tab fires no beforeunload here
        // (no stranded page-transition overlay) and uses no iframe (no CSP
        // frame-src violation).
        el('detail-email-btn').href = canEmail ? buildInvoiceGmailUrl(invoice, items) : '#';
        const canVoid = ['draft', 'open'].includes(invoice.status);
        el('detail-void-btn').classList.toggle('hidden', !canVoid);
        el('detail-void-btn').classList.toggle('inline-flex', canVoid);
        // Payment can be recorded on any open invoice (incl. displayed-overdue).
        const canMarkPaid = invoice.status === 'open';
        el('detail-paid-btn').classList.toggle('hidden', !canMarkPaid);
        el('detail-paid-btn').classList.toggle('inline-flex', canMarkPaid);

        el('detail-items-body').innerHTML = items.length
            ? items.map(item => `
                <tr class="fluxy-table-row">
                    <td class="fluxy-table-cell"><span class="fluxy-table-cell-primary">${esc(item.description)}</span></td>
                    <td class="fluxy-table-cell fluxy-table-money">${formatQty(item.quantity)}</td>
                    <td class="fluxy-table-cell fluxy-table-money">${formatRp(item.unit_price)}</td>
                    <td class="fluxy-table-cell fluxy-table-money">${formatRp(item.amount)}</td>
                </tr>`).join('')
            : '<tr><td colspan="4" class="fluxy-table-loading-cell">No line items.</td></tr>';
        el('detail-subtotal').textContent = formatRp(invoice.subtotal_amount);
        el('detail-tax-row').classList.toggle('hidden', !(Number(invoice.tax_amount) > 0));
        el('detail-tax').textContent = formatRp(invoice.tax_amount);
        el('detail-amount-due-2').textContent = formatRp(['void', 'paid'].includes(invoice.status) ? 0 : invoice.amount_due);

        el('detail-issue-date').textContent = formatDate(invoice.issue_date);
        el('detail-due-date').textContent = formatDate(invoice.due_date);
        el('detail-email').textContent = invoice.customer_email || '—';
        el('detail-method').textContent = invoice.payment_collection_method === 'manual_only' ? 'Manual only' : 'Request payment';

        const memoWrap = el('detail-memo-wrap');
        memoWrap.classList.toggle('hidden', !invoice.memo);
        el('detail-memo').textContent = invoice.memo || '';
        const footerWrap = el('detail-footer-wrap');
        footerWrap.classList.toggle('hidden', !invoice.footer);
        el('detail-footer').textContent = invoice.footer || '';

        const activity = [];
        if (invoice.created_at) activity.push(`Draft created · ${formatDate(invoice.created_at)} ${formatTime(invoice.created_at)}`);
        if (invoice.finalized_at) activity.push(`Finalized · ${formatDate(invoice.finalized_at)} ${formatTime(invoice.finalized_at)}`);
        if (invoice.sent_at) activity.push(`Marked as sent · ${formatDate(invoice.sent_at)} ${formatTime(invoice.sent_at)}`);
        if (invoice.paid_at) activity.push(`Payment completed · ${formatDate(invoice.paid_at)} ${formatTime(invoice.paid_at)}`);
        if (invoice.voided_at) activity.push(`Voided · ${formatDate(invoice.voided_at)} ${formatTime(invoice.voided_at)}`);
        el('detail-activity').innerHTML = activity.map(line => `<li class="flex items-start gap-2"><span class="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-300"></span>${esc(line)}</li>`).join('')
            || '<li class="text-gray-400">No activity yet.</li>';
    }


    el('detail-email-btn').addEventListener('click', () => {
        if (!detailInvoice?.customer_email) return;
        window.showToast?.(
            detailInvoice.sent_at
                ? 'Gmail compose opened in a new tab.'
                : 'Gmail compose opened. To include the document, attach the PDF from Preview PDF → Download.',
            'info'
        );
    });

    // ---------- PDF preview modal ----------
    // Renders the invoice as a standalone document; Download PDF prints just
    // the document via the browser's Save-as-PDF (no backend generation, and
    // the app never claims the file was saved).
    function buildInvoiceDocHTML(invoice, items) {
        const due = formatDate(invoice.due_date);
        const isVoid = invoice.status === 'void';
        const isPaid = invoice.status === 'paid';
        const amountDue = (isVoid || isPaid) ? 0 : invoice.amount_due;
        const itemRows = items.length
            ? items.map(item => `
                <tr class="border-b border-gray-100">
                    <td class="py-2 text-gray-900">${esc(item.description)}</td>
                    <td class="py-2 text-right invoice-doc-money text-gray-700">${formatQty(item.quantity)}</td>
                    <td class="py-2 text-right invoice-doc-money text-gray-700">${formatRp(item.unit_price)}</td>
                    <td class="py-2 text-right invoice-doc-money text-gray-900">${formatRp(item.amount)}</td>
                </tr>`).join('')
            : '<tr><td colspan="4" class="py-3 text-center text-gray-400">No line items</td></tr>';
        const taxRow = Number(invoice.tax_amount) > 0
            ? `<tr><td colspan="3" class="py-1.5 text-right text-gray-500">Tax${invoice.tax_rate_percent ? ` (${esc(invoice.tax_rate_percent)}%)` : ''}</td><td class="py-1.5 text-right text-gray-900">${formatRp(invoice.tax_amount)}</td></tr>`
            : '';
        return `
            <div class="invoice-doc bg-white p-6 sm:p-8">
                <div class="flex items-start justify-between gap-4">
                    <div>
                        <h3 class="text-[20px] font-semibold text-gray-900">Invoice</h3>
                        ${isVoid ? '<p class="mt-1 text-[12px] font-bold uppercase tracking-[0.08em] text-red-600">Void</p>' : ''}
                        ${isPaid ? '<p class="mt-1 text-[12px] font-bold uppercase tracking-[0.08em] text-[#16A34A]">Paid</p>' : ''}
                    </div>
                    <p class="max-w-[45%] truncate text-right text-[14px] font-semibold text-gray-500">${esc(businessName)}</p>
                </div>
                <dl class="mt-5 space-y-1 text-[12px]">
                    <div class="flex gap-3"><dt class="w-28 font-medium text-gray-500">Invoice number</dt><dd class="font-mono text-gray-900">${esc(invoice.invoice_number || '—')}</dd></div>
                    <div class="flex gap-3"><dt class="w-28 font-medium text-gray-500">Issue date</dt><dd class="text-gray-900">${formatDate(invoice.issue_date)}</dd></div>
                    <div class="flex gap-3"><dt class="w-28 font-medium text-gray-500">Due date</dt><dd class="text-gray-900">${due}</dd></div>
                </dl>
                <div class="mt-5 grid grid-cols-2 gap-4 text-[12px]">
                    <div>
                        <p class="font-semibold text-gray-900">From</p>
                        <p class="mt-1 text-gray-600">${esc(businessName)}</p>
                    </div>
                    <div>
                        <p class="font-semibold text-gray-900">Bill to</p>
                        <p class="mt-1 text-gray-600">${esc(invoice.customer_name || 'Customer name')}</p>
                        <p class="text-gray-500">${esc(invoice.customer_email || '')}</p>
                    </div>
                </div>
                <p class="mt-6 text-[16px] font-semibold text-gray-900 invoice-doc-money">${formatRp(amountDue)} due ${due}</p>
                ${invoice.memo ? `<p class="mt-2 text-[12px] text-gray-600">${esc(invoice.memo)}</p>` : ''}
                <table class="mt-4 w-full text-[12px]">
                    <thead>
                        <tr class="border-b border-gray-300 text-left text-gray-500">
                            <th class="py-2 font-medium">Description</th>
                            <th class="py-2 text-right font-medium">Qty</th>
                            <th class="py-2 text-right font-medium">Unit price</th>
                            <th class="py-2 text-right font-medium">Amount</th>
                        </tr>
                    </thead>
                    <tbody>${itemRows}</tbody>
                    <tfoot class="invoice-doc-money">
                        <tr class="border-t border-gray-200">
                            <td colspan="3" class="py-1.5 text-right text-gray-500">Subtotal</td>
                            <td class="py-1.5 text-right text-gray-900">${formatRp(invoice.subtotal_amount)}</td>
                        </tr>
                        ${taxRow}
                        <tr class="border-t border-gray-200">
                            <td colspan="3" class="py-1.5 text-right text-gray-500">Total</td>
                            <td class="py-1.5 text-right text-gray-900">${formatRp(invoice.total_amount)}</td>
                        </tr>
                        <tr>
                            <td colspan="3" class="py-1.5 text-right font-semibold text-gray-900">Amount due</td>
                            <td class="py-1.5 text-right font-semibold text-gray-900">${formatRp(amountDue)}</td>
                        </tr>
                    </tfoot>
                </table>
                ${invoice.footer ? `<p class="mt-8 border-t border-gray-100 pt-3 text-[12px] text-gray-500">${esc(invoice.footer)}</p>` : ''}
                <p class="mt-3 text-[10px] uppercase tracking-[0.06em] text-gray-400">${esc(invoice.invoice_number || '')} · ${formatRp(amountDue)} due ${due}</p>
            </div>`;
    }

    function openPdfModal() {
        if (!detailInvoice) return;
        el('invoice-pdf-doc-host').innerHTML = buildInvoiceDocHTML(detailInvoice, detailItems);
        // Download-then-email in one place: surface the Gmail draft from here
        // too, so attaching the saved PDF is a drag away.
        const canEmail = detailInvoice.status === 'open' && Boolean(detailInvoice.customer_email);
        el('pdf-email-btn').classList.toggle('hidden', !canEmail);
        el('pdf-email-btn').classList.toggle('inline-flex', canEmail);
        el('pdf-email-btn').href = canEmail ? buildInvoiceGmailUrl(detailInvoice, detailItems) : '#';
        const modal = el('invoice-pdf-modal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.body.style.overflow = 'hidden';
    }

    function closePdfModal() {
        const modal = el('invoice-pdf-modal');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.body.style.overflow = '';
    }

    el('detail-pdf-btn').addEventListener('click', openPdfModal);
    el('pdf-close').addEventListener('click', closePdfModal);
    el('pdf-close-footer').addEventListener('click', closePdfModal);
    document.querySelector('[data-pdf-overlay]').addEventListener('click', closePdfModal);

    el('pdf-email-btn').addEventListener('click', () => {
        window.showToast?.('Gmail compose opened — drag the saved PDF into the email before sending.', 'info');
    });

    el('pdf-download').addEventListener('click', () => {
        if (!detailInvoice) return;
        const prevTitle = document.title;
        // The document title becomes the suggested PDF filename.
        if (detailInvoice.invoice_number) document.title = detailInvoice.invoice_number;
        document.body.classList.add('invoice-printing');
        const cleanup = () => {
            document.body.classList.remove('invoice-printing');
            document.title = prevTitle;
        };
        window.addEventListener('afterprint', cleanup, { once: true });
        window.print();
        window.setTimeout(cleanup, 1000);
    });
    el('detail-edit-btn').addEventListener('click', () => {
        if (detailInvoice) openEditor(detailInvoice.id, true);
    });

    el('detail-sent-btn').addEventListener('click', async (event) => {
        if (!detailInvoice) return;
        // Capture the button before awaiting — event.currentTarget is null once
        // the click has finished dispatching (i.e. after the confirm dialog).
        const btn = event.currentTarget;
        const ok = await window.showConfirmDialog({
            title: 'Mark this invoice as sent?',
            body: `FluxyOS records that <strong>${esc(detailInvoice.invoice_number)}</strong> was delivered to the customer. No email is sent from FluxyOS in this version.`,
            confirmLabel: 'Mark as sent',
            cancelLabel: 'Cancel',
            tone: 'default'
        });
        if (!ok) return;
        btn.disabled = true;
        try {
            await ds.recordInvoiceSent(uid, detailInvoice.id);
            window.showToast?.('Invoice marked as sent.', 'success');
            invoicesLoaded = false;
            await loadInvoices();
            openDetail(detailInvoice.id, false);
        } catch (error) {
            console.error('[invoices] mark sent failed', error);
            window.showToast?.(error?.message || 'Could not update invoice. Try again.', 'error');
        } finally {
            btn.disabled = false;
        }
    });

    // ---------- void modal ----------
    function openVoidModal() {
        el('void-reason').value = '';
        el('void-error').classList.add('hidden');
        const modal = el('invoice-void-modal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.body.style.overflow = 'hidden';
        el('void-reason').focus();
    }

    function closeVoidModal() {
        const modal = el('invoice-void-modal');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.body.style.overflow = '';
    }

    el('detail-void-btn').addEventListener('click', openVoidModal);
    el('void-cancel').addEventListener('click', closeVoidModal);
    document.querySelector('[data-void-overlay]').addEventListener('click', closeVoidModal);

    el('void-confirm').addEventListener('click', async (event) => {
        if (!detailInvoice) return;
        const reason = el('void-reason').value.trim();
        if (!reason) {
            const errorNode = el('void-error');
            errorNode.textContent = 'A reason is required to void an invoice.';
            errorNode.classList.remove('hidden');
            return;
        }
        const btn = event.currentTarget;
        btn.disabled = true;
        try {
            await ds.voidInvoice(uid, detailInvoice.id, reason);
            closeVoidModal();
            window.showToast?.('Invoice voided.', 'success');
            invoicesLoaded = false;
            await loadInvoices();
            openDetail(detailInvoice.id, false);
        } catch (error) {
            console.error('[invoices] void failed', error);
            const errorNode = el('void-error');
            errorNode.textContent = error?.message || 'Could not void invoice. Try again.';
            errorNode.classList.remove('hidden');
        } finally {
            btn.disabled = false;
        }
    });

    // ---------- mark paid modal ----------
    // Records the payment: invoice open -> paid + one linked income ledger
    // transaction (category Revenue, full total) in a single batch.
    let paidDatePicker = null;
    let paidDateKey = null;

    function openPaidModal() {
        if (!detailInvoice) return;
        const picker = window.FluxyDateRangePicker;
        paidDateKey = picker.getDayKey();
        el('paid-number').textContent = detailInvoice.invoice_number || '—';
        el('paid-customer').textContent = detailInvoice.customer_name || '—';
        el('paid-amount').textContent = formatRp(detailInvoice.total_amount);
        el('paid-error').classList.add('hidden');
        if (!paidDatePicker) {
            paidDatePicker = picker.mount(el('paid-date-picker'), {
                mode: 'single',
                start: paidDateKey,
                maxDate: picker.getDayKey(),
                onChange: ({ start }) => { paidDateKey = start; }
            });
        } else {
            paidDatePicker.setRange(paidDateKey);
        }
        const modal = el('invoice-paid-modal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.body.style.overflow = 'hidden';
    }

    function closePaidModal() {
        const modal = el('invoice-paid-modal');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.body.style.overflow = '';
    }

    el('detail-paid-btn').addEventListener('click', openPaidModal);
    el('paid-cancel').addEventListener('click', closePaidModal);
    document.querySelector('[data-paid-overlay]').addEventListener('click', closePaidModal);

    el('paid-confirm').addEventListener('click', async (event) => {
        if (!detailInvoice) return;
        // Capture before any await — event.currentTarget is null post-dispatch.
        const btn = event.currentTarget;
        btn.disabled = true;
        try {
            const paymentDate = paidDateKey
                ? window.FluxyDateRangePicker.parseDayKey(paidDateKey)
                : new Date();
            const result = await ds.markInvoicePaid(uid, detailInvoice.id, { paymentDate });
            closePaidModal();
            window.showToast?.(`Payment recorded — ${formatRp(detailInvoice.total_amount)} added to your ledger as Revenue.`, 'success');
            invoicesLoaded = false;
            await loadInvoices();
            openDetail(result.id, false);
        } catch (error) {
            console.error('[invoices] mark paid failed', error);
            const errorNode = el('paid-error');
            errorNode.textContent = error?.message || 'Could not record the payment. Try again.';
            errorNode.classList.remove('hidden');
        } finally {
            btn.disabled = false;
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (!el('invoice-review-modal').classList.contains('hidden')) closeReviewModal();
        if (!el('invoice-void-modal').classList.contains('hidden')) closeVoidModal();
        if (!el('invoice-paid-modal').classList.contains('hidden')) closePaidModal();
        if (!el('invoice-pdf-modal').classList.contains('hidden')) closePdfModal();
    });

    // ---------- boot ----------
    ds.getUserSettings(uid)
        .then((settings) => {
            const name = settings?.company?.business_name;
            if (name && String(name).trim() && name !== 'Global HQ') {
                businessName = String(name).trim();
                updatePreview();
            }
        })
        .catch(() => {});

    loadInvoices().then(() => routeFromUrl(false));
}
